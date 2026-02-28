const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const { getRow, getRows, insertRow } = require('../../db');

const openai = new OpenAI({ apiKey: process.env.OPENAIKEY || process.env.OPENAI_API_KEY });

// ── LLM Proxy ──────────────────────────────────────────

router.post('/chat', async (req, res) => {
  try {
    const { messages, tools, model, tool_choice } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ success: false, error: 'messages array is required' });
    }

    console.log(`[Firaz] Chat request: ${messages.length} messages, ${tools?.length || 0} tools, tool_choice: ${JSON.stringify(tool_choice) || 'auto'}`);

    const params = {
      model: model || 'gpt-4.1',
      messages,
      temperature: 0.7,
      max_tokens: 4096,
    };

    if (tools && tools.length > 0) {
      params.tools = tools;
      params.tool_choice = tool_choice || 'auto';
    }

    const completion = await openai.chat.completions.create(params);
    const choice = completion.choices[0];

    if (!choice) {
      return res.status(500).json({ success: false, error: 'No completion choice returned' });
    }

    console.log(`[Firaz] Response: ${choice.finish_reason}, tools: ${choice.message.tool_calls?.length || 0}`);

    const response = {
      success: true,
      content: choice.message.content || null,
      tool_calls: choice.message.tool_calls
        ? choice.message.tool_calls.map(tc => ({
            id: tc.id,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          }))
        : null,
      finish_reason: choice.finish_reason,
      usage: completion.usage,
    };

    return res.json(response);
  } catch (error) {
    console.error('Firaz AI chat error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ── Lead Management ─────────────────────────────────────

// Save a new lead
router.post('/leads', async (req, res) => {
  try {
    const { company_id, name, company_name, phone, email, website, address, city, source, stage, score, has_facebook_ads, ad_count, research_data, notes } = req.body;

    if (!company_id || !name) {
      return res.status(400).json({ success: false, error: 'company_id and name are required' });
    }

    const lead = await insertRow(
      `INSERT INTO firaz_leads (company_id, name, company_name, phone, email, website, address, city, source, stage, score, has_facebook_ads, ad_count, research_data, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [company_id, name, company_name || null, phone || null, email || null, website || null, address || null, city || null, source || 'google_maps', stage || 'new', score || 0, has_facebook_ads || false, ad_count || 0, research_data ? JSON.stringify(research_data) : '{}', notes || null]
    );

    return res.json({ success: true, lead });
  } catch (error) {
    console.error('Firaz save lead error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Bulk save leads
router.post('/leads/bulk', async (req, res) => {
  try {
    const { company_id, leads } = req.body;

    if (!company_id || !leads || !Array.isArray(leads)) {
      return res.status(400).json({ success: false, error: 'company_id and leads array required' });
    }

    let saved = 0;
    for (const lead of leads) {
      await insertRow(
        `INSERT INTO firaz_leads (company_id, name, company_name, phone, email, website, address, city, source, research_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [company_id, lead.name, lead.company_name || null, lead.phone || null, lead.email || null, lead.website || null, lead.address || null, lead.city || null, lead.source || 'google_maps', lead.research_data ? JSON.stringify(lead.research_data) : '{}']
      );
      saved++;
    }

    return res.json({ success: true, saved, total: leads.length });
  } catch (error) {
    console.error('Firaz bulk save error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Get leads with filters
router.get('/leads', async (req, res) => {
  try {
    const { company_id, stage, min_score, has_facebook_ads, limit, order_by } = req.query;

    if (!company_id) {
      return res.status(400).json({ success: false, error: 'company_id is required' });
    }

    let sql = 'SELECT * FROM firaz_leads WHERE company_id = $1';
    const params = [company_id];
    let paramIdx = 2;

    if (stage) {
      sql += ` AND stage = $${paramIdx++}`;
      params.push(stage);
    }
    if (min_score) {
      sql += ` AND score >= $${paramIdx++}`;
      params.push(parseInt(min_score));
    }
    if (has_facebook_ads === 'true') {
      sql += ' AND has_facebook_ads = true';
    }

    const orderMap = {
      score_desc: 'score DESC',
      score_asc: 'score ASC',
      newest: 'created_at DESC',
      oldest: 'created_at ASC',
      name: 'name ASC',
    };
    sql += ` ORDER BY ${orderMap[order_by] || 'created_at DESC'}`;
    sql += ` LIMIT $${paramIdx}`;
    params.push(parseInt(limit) || 50);

    const leads = await getRows(sql, params);
    return res.json({ success: true, leads, count: leads.length });
  } catch (error) {
    console.error('Firaz get leads error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Update a lead
router.put('/leads/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = ['name', 'company_name', 'phone', 'email', 'website', 'address', 'city', 'stage', 'score', 'has_facebook_ads', 'ad_count', 'research_data', 'qualification_notes', 'notes'];
    const setParts = [];
    const values = [id];
    let idx = 2;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setParts.push(`${key} = $${idx++}`);
        values.push(key === 'research_data' ? JSON.stringify(value) : value);
      }
    }

    if (setParts.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }

    setParts.push('updated_at = NOW()');

    const lead = await getRow(
      `UPDATE firaz_leads SET ${setParts.join(', ')} WHERE id = $1 RETURNING *`,
      values
    );

    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    return res.json({ success: true, lead });
  } catch (error) {
    console.error('Firaz update lead error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ── Conversation Tracking ───────────────────────────────

// Save conversation message
router.post('/conversations', async (req, res) => {
  try {
    const { lead_id, company_id, direction, channel, message, sent_by } = req.body;

    if (!company_id || !message || !sent_by) {
      return res.status(400).json({ success: false, error: 'company_id, message, and sent_by are required' });
    }

    const convo = await insertRow(
      `INSERT INTO firaz_conversations (lead_id, company_id, direction, channel, message, sent_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [lead_id || null, company_id, direction || 'outbound', channel || 'whatsapp', message, sent_by]
    );

    return res.json({ success: true, conversation: convo });
  } catch (error) {
    console.error('Firaz save conversation error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Get conversations for a lead
router.get('/conversations/:leadId', async (req, res) => {
  try {
    const { leadId } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    const conversations = await getRows(
      `SELECT * FROM firaz_conversations WHERE lead_id = $1 ORDER BY created_at ASC LIMIT $2`,
      [leadId, limit]
    );

    return res.json({ success: true, conversations, count: conversations.length });
  } catch (error) {
    console.error('Firaz get conversations error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ── Pipeline Summary ────────────────────────────────────

router.get('/pipeline', async (req, res) => {
  try {
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ success: false, error: 'company_id is required' });
    }

    const stages = await getRows(
      `SELECT stage, COUNT(*) as count FROM firaz_leads WHERE company_id = $1 GROUP BY stage ORDER BY count DESC`,
      [company_id]
    );

    const topLeads = await getRows(
      `SELECT id, name, company_name, phone, score, stage, has_facebook_ads FROM firaz_leads
       WHERE company_id = $1 AND score >= 70 ORDER BY score DESC LIMIT 10`,
      [company_id]
    );

    const totalLeads = await getRow(
      `SELECT COUNT(*) as total FROM firaz_leads WHERE company_id = $1`,
      [company_id]
    );

    const recentActivity = await getRows(
      `SELECT l.name, c.message, c.direction, c.channel, c.created_at
       FROM firaz_conversations c
       JOIN firaz_leads l ON c.lead_id = l.id
       WHERE c.company_id = $1
       ORDER BY c.created_at DESC LIMIT 10`,
      [company_id]
    );

    return res.json({
      success: true,
      pipeline: {
        total: parseInt(totalLeads?.total || 0),
        stages,
        topLeads,
        recentActivity,
      },
    });
  } catch (error) {
    console.error('Firaz pipeline error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ── Email Sending ──────────────────────────────────────

const nodemailer = require('nodemailer');

// Create transporter lazily (so env vars are read at runtime)
let _transporter = null;
function getMailTransporter() {
  if (_transporter) return _transporter;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  _transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  });
  return _transporter;
}

router.post('/email/send', async (req, res) => {
  try {
    const { to, subject, body, html, from_name, reply_to } = req.body;

    if (!to || !subject || (!body && !html)) {
      return res.status(400).json({ success: false, error: 'to, subject, and body (or html) are required' });
    }

    const transporter = getMailTransporter();
    if (!transporter) {
      return res.status(500).json({
        success: false,
        error: 'Email not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS in environment variables.',
      });
    }

    const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
    const fromDisplay = from_name || process.env.SMTP_FROM_NAME || 'Firaz AI';

    const info = await transporter.sendMail({
      from: `"${fromDisplay}" <${fromEmail}>`,
      to,
      subject,
      text: body || undefined,
      html: html || undefined,
      replyTo: reply_to || fromEmail,
    });

    console.log(`[Firaz] Email sent to ${to}: ${info.messageId}`);

    return res.json({
      success: true,
      messageId: info.messageId,
      to,
      subject,
    });
  } catch (error) {
    console.error('Firaz email send error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ── Health Check ────────────────────────────────────────

router.get('/health', (req, res) => {
  res.json({ success: true, service: 'firaz-ai', status: 'ok' });
});

module.exports = router;
