/**
 * Firaz AI — MCP-style Integration Routes
 * Phase 5: Google Sheets, Google Calendar, WhatsApp Cloud API
 * Phase 6: Server-side scheduler, WebSocket alerts
 */

const express = require('express');
const router = express.Router();
const { getRow, getRows, insertRow } = require('../../db');
const { getService } = require('../services/whatsapp/WhatsAppService');

// ── Google Sheets Integration ────────────────────────────

/**
 * Export leads to a CSV-like format (for Sheets import or direct display).
 * In production, this would use Google Sheets API with OAuth.
 * For now, returns formatted data that can be pasted into Sheets.
 */
router.post('/sheets/export', async (req, res) => {
  try {
    const { company_id, stage, format = 'csv' } = req.body;

    if (!company_id) {
      return res.status(400).json({ success: false, error: 'company_id required' });
    }

    let sql = 'SELECT name, company_name, phone, email, website, address, city, stage, score, has_facebook_ads, created_at FROM firaz_leads WHERE company_id = $1';
    const params = [company_id];

    if (stage) {
      sql += ' AND stage = $2';
      params.push(stage);
    }

    sql += ' ORDER BY score DESC';

    const leads = await getRows(sql, params);

    if (format === 'csv') {
      const headers = ['Name', 'Company', 'Phone', 'Email', 'Website', 'Address', 'City', 'Stage', 'Score', 'FB Ads', 'Created'];
      const rows = leads.map(l => [
        l.name, l.company_name || '', l.phone || '', l.email || '',
        l.website || '', l.address || '', l.city || '', l.stage,
        l.score, l.has_facebook_ads ? 'Yes' : 'No',
        new Date(l.created_at).toISOString().split('T')[0],
      ]);
      const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
      return res.json({ success: true, csv, count: leads.length });
    }

    return res.json({ success: true, leads, count: leads.length });
  } catch (error) {
    console.error('Firaz sheets export error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Import leads from CSV/JSON format.
 */
router.post('/sheets/import', async (req, res) => {
  try {
    const { company_id, data, format = 'json' } = req.body;

    if (!company_id || !data) {
      return res.status(400).json({ success: false, error: 'company_id and data required' });
    }

    let leads = [];

    if (format === 'csv') {
      const lines = data.split('\n').filter(l => l.trim());
      if (lines.length < 2) return res.json({ success: true, imported: 0 });

      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].match(/("([^"]|"")*"|[^,]*)/g).map(v => v.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
        const lead = {};
        headers.forEach((h, idx) => { lead[h] = values[idx] || null; });
        leads.push(lead);
      }
    } else {
      leads = Array.isArray(data) ? data : [data];
    }

    let imported = 0;
    for (const lead of leads) {
      if (!lead.name && !lead.Name) continue;
      await insertRow(
        `INSERT INTO firaz_leads (company_id, name, company_name, phone, email, website, address, city, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'import')
         ON CONFLICT DO NOTHING`,
        [company_id, lead.name || lead.Name, lead.company_name || lead.Company || null,
         lead.phone || lead.Phone || null, lead.email || lead.Email || null,
         lead.website || lead.Website || null, lead.address || lead.Address || null,
         lead.city || lead.City || null]
      );
      imported++;
    }

    return res.json({ success: true, imported, total: leads.length });
  } catch (error) {
    console.error('Firaz sheets import error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});


// ── Google Calendar Integration ──────────────────────────

// In-memory event store (would use Google Calendar API in production)
const events = new Map();

router.post('/calendar/create', async (req, res) => {
  try {
    const { company_id, title, description, start_time, end_time, attendee_email, attendee_name, lead_id } = req.body;

    if (!title || !start_time) {
      return res.status(400).json({ success: false, error: 'title and start_time required' });
    }

    const event = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      company_id: company_id || 'default',
      title,
      description: description || '',
      start_time,
      end_time: end_time || new Date(new Date(start_time).getTime() + 60 * 60 * 1000).toISOString(),
      attendee_email: attendee_email || null,
      attendee_name: attendee_name || null,
      lead_id: lead_id || null,
      status: 'confirmed',
      created_at: new Date().toISOString(),
    };

    events.set(event.id, event);

    // Also save to DB if we have a leads table entry
    if (lead_id) {
      try {
        await insertRow(
          `INSERT INTO firaz_conversations (lead_id, company_id, direction, channel, message, sent_by)
           VALUES ($1, $2, 'outbound', 'calendar', $3, 'firaz')`,
          [lead_id, company_id || 'default', `Meeting booked: ${title} at ${start_time}`]
        );
      } catch { /* ignore if conversations table doesn't exist */ }
    }

    return res.json({ success: true, event });
  } catch (error) {
    console.error('Firaz calendar create error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/calendar/events', async (req, res) => {
  try {
    const { company_id, from, to } = req.query;
    let filtered = Array.from(events.values());

    if (company_id) {
      filtered = filtered.filter(e => e.company_id === company_id);
    }
    if (from) {
      filtered = filtered.filter(e => new Date(e.start_time) >= new Date(from));
    }
    if (to) {
      filtered = filtered.filter(e => new Date(e.start_time) <= new Date(to));
    }

    filtered.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

    return res.json({ success: true, events: filtered, count: filtered.length });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});


// ── WhatsApp Cloud API (Coexistence Meta Direct) ─────────

/**
 * Send WhatsApp message via the existing Meta Direct / coexistence setup.
 * Uses WhatsAppService.getService() which routes to metaDirect, dialog360, or wwebjs
 * based on the company's phone_configs connection_type.
 */
router.post('/whatsapp/send', async (req, res) => {
  try {
    const { phone, message, template, template_lang, template_components, lead_id, company_id, phone_index = 0 } = req.body;

    if (!phone || (!message && !template)) {
      return res.status(400).json({ success: false, error: 'phone and (message or template) required' });
    }

    if (!company_id) {
      return res.status(400).json({ success: false, error: 'company_id required to resolve WhatsApp connection' });
    }

    // Use the existing unified WhatsApp service (Meta Direct coexistence)
    const service = await getService(company_id, phone_index);

    if (!service.config) {
      return res.json({
        success: false,
        error: 'No WhatsApp connection configured for this company. Connect via Settings > WhatsApp.',
        hint: 'Use whatsapp_web_send browser tool as fallback.',
      });
    }

    // Clean phone number — Meta API wants just digits
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    // Meta Direct expects chatId without @c.us suffix
    const chatId = cleanPhone.includes('@') ? cleanPhone : cleanPhone;

    let result;

    if (template) {
      // Send template message (for re-engaging outside 24hr window)
      result = await service.sendTemplate(chatId, template, template_lang || 'en', template_components || []);
    } else {
      // Send text message (within 24hr messaging window)
      result = await service.sendText(chatId, message);
    }

    // Log the conversation
    try {
      await insertRow(
        `INSERT INTO firaz_conversations (lead_id, company_id, direction, channel, message, sent_by)
         VALUES ($1, $2, 'outbound', 'whatsapp', $3, 'firaz')`,
        [lead_id || null, company_id, message || `[Template: ${template}]`]
      );
    } catch { /* ignore if table doesn't exist */ }

    return res.json({
      success: true,
      messageId: result?.id || null,
      provider: result?.provider || 'unknown',
      status: 'sent',
      via: service.isMetaDirect() ? 'meta_direct' : service.isOfficial() ? '360dialog' : 'wwebjs',
    });
  } catch (error) {
    console.error('Firaz WhatsApp send error:', error.message);

    // Handle 24hr window expiry for Meta Direct
    if (error.message?.includes('TEMPLATE_REQUIRED')) {
      return res.status(400).json({
        success: false,
        error: '24-hour messaging window expired. Use a template message to re-engage, or use browser WhatsApp Web.',
        code: 'TEMPLATE_REQUIRED',
      });
    }

    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Check WhatsApp connection status for a company
 */
router.get('/whatsapp/status', async (req, res) => {
  try {
    const { company_id, phone_index = 0 } = req.query;

    if (!company_id) {
      return res.json({ success: true, configured: false });
    }

    const service = await getService(company_id, parseInt(phone_index));

    return res.json({
      success: true,
      configured: !!service.config,
      connectionType: service.config?.connection_type || null,
      status: service.config?.status || 'not_configured',
      phoneNumber: service.config?.display_phone_number || null,
      isMetaDirect: service.isMetaDirect(),
    });
  } catch (error) {
    return res.json({ success: true, configured: false, error: error.message });
  }
});

/**
 * Bulk send WhatsApp messages to multiple leads
 */
router.post('/whatsapp/bulk-send', async (req, res) => {
  try {
    const { company_id, phone_index = 0, recipients, message_template, delay_ms = 3000 } = req.body;

    if (!company_id || !recipients || !message_template) {
      return res.status(400).json({ success: false, error: 'company_id, recipients, and message_template required' });
    }

    const service = await getService(company_id, phone_index);
    if (!service.config) {
      return res.json({ success: false, error: 'No WhatsApp connection configured' });
    }

    let sent = 0;
    let failed = 0;
    const errors = [];

    for (const recipient of recipients) {
      if (!recipient.phone) { failed++; continue; }

      const cleanPhone = recipient.phone.replace(/[^0-9]/g, '');
      const personalizedMsg = message_template
        .replace(/\{name\}/gi, recipient.name || 'there')
        .replace(/\{company\}/gi, recipient.company || 'your business');

      try {
        await service.sendText(cleanPhone, personalizedMsg);
        sent++;

        // Log conversation
        try {
          await insertRow(
            `INSERT INTO firaz_conversations (lead_id, company_id, direction, channel, message, sent_by)
             VALUES ($1, $2, 'outbound', 'whatsapp', $3, 'firaz')`,
            [recipient.lead_id || null, company_id, personalizedMsg]
          );
        } catch { /* ignore */ }
      } catch (e) {
        failed++;
        errors.push(`${recipient.phone}: ${e.message}`);
      }

      // Rate limiting delay
      if (sent + failed < recipients.length) {
        await new Promise(r => setTimeout(r, Math.max(delay_ms, 2000)));
      }
    }

    return res.json({ success: sent > 0, sent, failed, total: recipients.length, errors: errors.slice(0, 5) });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});


// ── Server-Side Scheduler (Phase 6) ─────────────────────

// Scheduled tasks stored in memory (would use DB in production)
const scheduledTasks = new Map();

router.post('/scheduler/create', async (req, res) => {
  try {
    const { company_id, name, action, schedule, config } = req.body;

    if (!name || !action || !schedule) {
      return res.status(400).json({ success: false, error: 'name, action, and schedule required' });
    }

    const task = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      company_id: company_id || 'default',
      name,
      action, // e.g. 'prospect', 'follow_up', 'report', 'custom'
      schedule, // { frequency, time, dayOfWeek, dayOfMonth }
      config: config || {}, // action-specific config (query, message template, etc.)
      enabled: true,
      lastRun: null,
      nextRun: null,
      created_at: new Date().toISOString(),
    };

    scheduledTasks.set(task.id, task);

    return res.json({ success: true, task });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/scheduler/tasks', (req, res) => {
  const { company_id } = req.query;
  let tasks = Array.from(scheduledTasks.values());
  if (company_id) {
    tasks = tasks.filter(t => t.company_id === company_id);
  }
  return res.json({ success: true, tasks, count: tasks.length });
});

router.delete('/scheduler/tasks/:id', (req, res) => {
  scheduledTasks.delete(req.params.id);
  return res.json({ success: true });
});


// ── Proactive Alerts (Phase 6) ──────────────────────────

router.get('/alerts', async (req, res) => {
  try {
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ success: false, error: 'company_id required' });
    }

    const alerts = [];

    // Alert 1: Cold leads (contacted > 3 days ago, no follow-up)
    try {
      const coldLeads = await getRows(
        `SELECT l.id, l.name, l.stage, l.updated_at
         FROM firaz_leads l
         WHERE l.company_id = $1
         AND l.stage IN ('contacted', 'interested')
         AND l.updated_at < NOW() - INTERVAL '3 days'
         ORDER BY l.updated_at ASC LIMIT 5`,
        [company_id]
      );
      if (coldLeads.length > 0) {
        alerts.push({
          type: 'cold_leads',
          severity: 'warning',
          title: `${coldLeads.length} lead${coldLeads.length > 1 ? 's' : ''} going cold`,
          message: `${coldLeads.map(l => l.name).join(', ')} haven't been contacted in 3+ days`,
          data: coldLeads,
          action: 'Follow up with cold leads',
        });
      }
    } catch { /* table might not exist */ }

    // Alert 2: Empty pipeline
    try {
      const pipelineCount = await getRow(
        `SELECT COUNT(*) as total FROM firaz_leads WHERE company_id = $1 AND stage NOT IN ('closed_won', 'closed_lost')`,
        [company_id]
      );
      if (parseInt(pipelineCount?.total || 0) === 0) {
        alerts.push({
          type: 'empty_pipeline',
          severity: 'critical',
          title: 'Pipeline is empty',
          message: 'No active leads. Start prospecting to fill your pipeline.',
          action: 'Start prospecting',
        });
      }
    } catch { /* ignore */ }

    // Alert 3: Hot leads needing attention (high score, still in early stage)
    try {
      const hotLeads = await getRows(
        `SELECT id, name, score, stage FROM firaz_leads
         WHERE company_id = $1 AND score >= 80 AND stage IN ('new', 'researched')
         ORDER BY score DESC LIMIT 3`,
        [company_id]
      );
      if (hotLeads.length > 0) {
        alerts.push({
          type: 'hot_leads',
          severity: 'info',
          title: `${hotLeads.length} hot lead${hotLeads.length > 1 ? 's' : ''} ready to contact`,
          message: `${hotLeads.map(l => `${l.name} (${l.score})`).join(', ')} have high scores but haven't been contacted yet`,
          data: hotLeads,
          action: 'Contact hot leads',
        });
      }
    } catch { /* ignore */ }

    // Alert 4: Daily summary stats
    try {
      const todayLeads = await getRow(
        `SELECT COUNT(*) as total FROM firaz_leads WHERE company_id = $1 AND created_at >= CURRENT_DATE`,
        [company_id]
      );
      const todayConvos = await getRow(
        `SELECT COUNT(*) as total FROM firaz_conversations WHERE company_id = $1 AND created_at >= CURRENT_DATE`,
        [company_id]
      );
      if (parseInt(todayLeads?.total || 0) > 0 || parseInt(todayConvos?.total || 0) > 0) {
        alerts.push({
          type: 'daily_summary',
          severity: 'info',
          title: 'Today\'s activity',
          message: `${todayLeads?.total || 0} new leads, ${todayConvos?.total || 0} messages today`,
        });
      }
    } catch { /* ignore */ }

    return res.json({ success: true, alerts, count: alerts.length });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});


// ── Dashboard Data (Phase 7) ────────────────────────────

router.get('/dashboard', async (req, res) => {
  try {
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ success: false, error: 'company_id required' });
    }

    // Pipeline stats
    const stages = await getRows(
      `SELECT stage, COUNT(*) as count FROM firaz_leads WHERE company_id = $1 GROUP BY stage`,
      [company_id]
    );

    const totalLeads = await getRow(
      `SELECT COUNT(*) as total FROM firaz_leads WHERE company_id = $1`,
      [company_id]
    );

    // Top leads
    const topLeads = await getRows(
      `SELECT id, name, company_name, phone, email, score, stage, has_facebook_ads, created_at
       FROM firaz_leads WHERE company_id = $1
       ORDER BY score DESC LIMIT 20`,
      [company_id]
    );

    // Recent conversations
    const recentActivity = await getRows(
      `SELECT c.id, l.name as lead_name, c.direction, c.channel, c.message, c.sent_by, c.created_at
       FROM firaz_conversations c
       LEFT JOIN firaz_leads l ON c.lead_id = l.id
       WHERE c.company_id = $1
       ORDER BY c.created_at DESC LIMIT 20`,
      [company_id]
    );

    // Weekly trends
    const weeklyLeads = await getRows(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM firaz_leads WHERE company_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY DATE(created_at) ORDER BY date`,
      [company_id]
    );

    const weeklyConvos = await getRows(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM firaz_conversations WHERE company_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY DATE(created_at) ORDER BY date`,
      [company_id]
    );

    // Conversion metrics
    const wonCount = stages.find(s => s.stage === 'closed_won')?.count || 0;
    const lostCount = stages.find(s => s.stage === 'closed_lost')?.count || 0;
    const total = parseInt(totalLeads?.total || 0);
    const conversionRate = total > 0 ? ((wonCount / total) * 100).toFixed(1) : '0';

    return res.json({
      success: true,
      dashboard: {
        total: total,
        stages,
        conversionRate: parseFloat(conversionRate),
        wonCount: parseInt(wonCount),
        lostCount: parseInt(lostCount),
        topLeads,
        recentActivity,
        trends: {
          leads: weeklyLeads,
          conversations: weeklyConvos,
        },
      },
    });
  } catch (error) {
    console.error('Firaz dashboard error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
