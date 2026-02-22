const express = require('express');
const router = express.Router();
const { ContactTagger } = require('../../analytics-dashboard/contactTagger');
const { query, getRow } = require('../../db');
const fs = require('fs');
const path = require('path');

// ─── Audit file logger ────────────────────────────────────────────────────────
const LOG_FILE = path.join(__dirname, '../../logs/audit.log'); // src/routes → src → bisnesgpt-server/logs
function auditLog(companyId, level = 'INFO', message, extra = {}) {
    const ts = new Date().toISOString();
    const extraStr = Object.keys(extra).length ? ' ' + JSON.stringify(extra) : '';
    const line = `[${ts}] [${level}] [company:${companyId}] ${message}${extraStr}\n`;
    fs.appendFile(LOG_FILE, line, () => { }); // fire-and-forget
    if (level === 'ERROR') console.error(line.trimEnd());
    else console.log(line.trimEnd());
}

// ─── Auto-create results table ────────────────────────────────────────────────
async function ensureAuditTable() {
    await query(`
        CREATE TABLE IF NOT EXISTS audit_results (
            id          SERIAL PRIMARY KEY,
            company_id  VARCHAR(255) NOT NULL UNIQUE,
            status      VARCHAR(20)  DEFAULT 'idle',
            pipeline_data JSONB,
            stats         JSONB,
            settings      JSONB,
            error_message TEXT,
            total_contacts INTEGER DEFAULT 0,
            processed_contacts INTEGER DEFAULT 0,
            started_at  TIMESTAMP DEFAULT NOW(),
            completed_at TIMESTAMP
        )
    `);
    // Add settings column if table already existed without it
    await query(`ALTER TABLE audit_results ADD COLUMN IF NOT EXISTS settings JSONB`).catch(() => { });
}
ensureAuditTable().catch(err => console.error('audit_results table init failed:', err.message));

// ─── In-memory progress tracker ───────────────────────────────────────────────
const liveJobs = new Map(); // companyId -> { status, progress, progressLabel }

// ─── Tag sanitiser ────────────────────────────────────────────────────────────
function sanitiseTags(arr) {
    if (!arr) return [];
    if (typeof arr === 'string') {
        try { arr = JSON.parse(arr); } catch { return []; }
    }
    if (!Array.isArray(arr)) return [];
    return arr.filter(s => typeof s === 'string');
}

// ─── Non-lead filter ──────────────────────────────────────────────────────────
// Returns true if this contact should be EXCLUDED from the pipeline entirely
function isNonLead(tags, metrics) {
    const t = sanitiseTags(tags).map(s => s.toLowerCase());
    const m = metrics || {};
    const has = (...args) => args.some(tag => t.includes(tag));

    if (has('group')) return true;                        // group chat
    if (has('not-a-lead')) return true;                   // AI classified as spam / general
    if (has('unresponsive') && !m.inboundMessages) return true; // only outbound, never replied
    if (m.inboundMessages === 0 && m.outboundMessages > 0) return true; // never replied (metric-based)
    if (m.aiIntent === 'spam' || m.aiIntent === 'general') return true; // AI intent
    return false;
}

// ─── Recency + tag → pipeline stage ──────────────────────────────────────────
// settings: { hotLeadDays, coldLeadDays, avgDealSize, businessType }
function classifyToStage(tags, metrics, settings = {}) {
    const t = sanitiseTags(tags).map(s => s.toLowerCase());
    const m = metrics || {};
    const has = (...args) => args.some(tag => t.includes(tag));

    const hotDays = settings.hotLeadDays || 7;
    const coldDays = settings.coldLeadDays || 30;
    const days = typeof m.daysSinceLastMessage === 'number' ? m.daysSinceLastMessage : 999;
    const lastFromContact = m.lastMessageFromContact || false;

    // ── Explicitly rejected / lost ───────────────────────────────────────────
    if (has('not-interested')) {
        return { stage: 'leaked', score: 8, reason: 'Expressed disinterest or rejection' };
    }

    // ── Customer / Closed Deal ─────────────────────────────────────────────────────
    if (has('customer', 'closed', 'sold')) {
        if (days <= coldDays) return { stage: 'closed', score: 100, reason: 'Closed deal — active customer' };
        return { stage: 'closed', score: 90, reason: `Closed deal — dormant (${Math.round(days)}d)` };
    }

    // ── Qualified lead (Consideration / Decision) ────────────────────────────
    if (has('qualified-lead')) {
        if (days <= hotDays) {
            return { stage: 'decision', score: 85, reason: 'Qualified lead, recent engagement' };
        }
        if (days <= coldDays) {
            return { stage: 'consideration', score: 70, reason: `Qualified lead — pending decision` };
        }
        return { stage: 'leaked', score: 22, reason: `Qualified lead gone silent` };
    }

    // ── Potential lead (Intent / Interest) ────────────────────────────────────────────────────────
    if (has('potential-lead')) {
        if (days <= hotDays && lastFromContact) {
            return { stage: 'intent', score: 65, reason: `Potential lead showing intent` };
        }
        if (days <= hotDays) {
            return { stage: 'interest', score: 55, reason: `Potential lead — exploring` };
        }
        if (days <= coldDays) {
            return { stage: 'interest', score: 40, reason: `Potential lead — needs re-engagement` };
        }
        return { stage: 'leaked', score: 18, reason: `Potential lead dormant` };
    }

    // ── Fallback (Awareness) ────────────────────────────────────────────────
    if (lastFromContact && days <= hotDays) {
        return { stage: 'awareness', score: 35, reason: `Recent inbound — needs qualification` };
    }
    if (days <= hotDays) {
        return { stage: 'awareness', score: 25, reason: `Recent contact — building awareness` };
    }
    if (days <= coldDays) {
        return { stage: 'awareness', score: 15, reason: `Inactive contact — low awareness` };
    }
    return { stage: 'leaked', score: 10, reason: `Inactive for ${Math.round(days)}d` };
}

// ─── Batch AI Classifier ──────────────────────────────────────────────────────
// Makes ONE OpenAI call per batch of up to 20 contacts.
// Returns a Map of contactId -> { sentiment, intent, stage }
const OpenAI = require('openai');
const _openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function batchAIClassify(contactBatch, companyContext = '') {
    if (!contactBatch || contactBatch.length === 0) return new Map();

    const businessCtx = companyContext
        ? `Business context: ${companyContext.slice(0, 400)}`
        : '';

    const items = contactBatch.map(({ id, recentMessages, daysSinceLastMessage }) => {
        const msgs = (recentMessages || []).slice(-5).map(m =>
            `${m.from_me ? 'Bot' : 'Customer'}: ${(m.content || '').slice(0, 150).trim()}`
        ).filter(Boolean).join('\n');
        return `[ID:${id}] (inactive ${daysSinceLastMessage ?? '?'}d)\n${msgs || '(no messages)'}`;
    });

    const prompt = `You are a CRM AI analyst. ${businessCtx}

Classify each conversation below. For each [ID:xxx] respond with ONE JSON object.
Return a JSON ARRAY — one entry per conversation:
{ "id":"xxx", "sentiment":"positive|neutral|negative", "intent":"inquiry|purchase|support|complaint|spam|general", "stage":"awareness|interest|intent|consideration|decision|closed|leaked" }

Stage definitions:
- awareness: first contact, no intent yet
- interest: asking questions, exploring
- intent: clearly wants product/service, showing buying signals
- consideration: comparing, near decision point
- decision: ready to buy / negotiating / committing
- closed: already bought, is a customer
- leaked: went cold, rejected, or unresponsive

Conversations:
${items.join('\n\n---\n\n')}

Reply ONLY with valid JSON array. No markdown. No explanation.`;

    try {
        const completion = await _openaiClient.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0,
            max_tokens: 1500,
            messages: [{ role: 'user', content: prompt }]
        });

        const raw = (completion.choices[0]?.message?.content || '[]').trim();
        const jsonStr = raw.replace(/```json|```/g, '').trim();
        const results = JSON.parse(jsonStr);

        const map = new Map();
        if (Array.isArray(results)) {
            for (const r of results) {
                if (r.id) map.set(String(r.id), r);
            }
        }
        return map;
    } catch (err) {
        console.error('[batchAIClassify] OpenAI error:', err.message);
        return new Map(); // graceful fallback — no AI for this batch
    }
}

// ─── Background worker ────────────────────────────────────────────────────────
async function runAuditBackground(companyId, settings = {}) {
    const setProgress = (progress, label) =>
        liveJobs.set(companyId, { status: 'running', progress, progressLabel: label });

    auditLog(companyId, 'INFO', 'Audit started', { settings });
    try {
        setProgress(5, 'Fetching contacts…');

        // Pull business context from instruction_templates (same prompt the bot uses)
        let companyContext = '';
        try {
            const tmplRow = await getRow(
                `SELECT instructions FROM instruction_templates WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`,
                [companyId]
            );
            if (tmplRow?.instructions) {
                companyContext = tmplRow.instructions;
                auditLog(companyId, 'INFO', `Loaded instruction template (${companyContext.length} chars)`);
            }
        } catch (e) {
            auditLog(companyId, 'WARN', 'Could not fetch instruction template', { error: e.message });
        }

        // aiEnabled: false — we skip per-contact AI, do batch AI separately below
        const tagger = new ContactTagger(companyId, {
            dryRun: false,
            verbose: false,
            aiEnabled: false,
            daysFilter: null,
            companyContext
        });

        const contacts = await tagger.getAllContacts();

        if (contacts.length === 0) {
            await persistResult(companyId, buildEmptyResult(), settings, 0, 0);
            liveJobs.set(companyId, { status: 'done', progress: 100 });
            return;
        }

        const total = contacts.length;
        auditLog(companyId, 'INFO', `Phase 1: rule-based pass on ${total} contacts`);
        setProgress(10, `Processing ${total} contacts…`);
        await query('UPDATE audit_results SET total_contacts=$1 WHERE company_id=$2', [total, companyId]);

        // ── PHASE 1: Rule-based pass (no AI, parallelised in batches of 20) ────
        const RULE_BATCH = 20;
        const taggedContacts = [];

        for (let i = 0; i < total; i += RULE_BATCH) {
            const batch = contacts.slice(i, i + RULE_BATCH);
            const settled = await Promise.allSettled(
                batch.map(c => tagger.tagContact(c.contact_id, { skipAI: true }))
            );

            settled.forEach((outcome, idx) => {
                const orig = batch[idx];
                if (outcome.status === 'rejected') {
                    auditLog(companyId, 'WARN', `tagContact failed`, { id: orig.contact_id, error: outcome.reason?.message });
                }
                const result = outcome.status === 'fulfilled' ? outcome.value : null;
                taggedContacts.push({
                    id: orig.contact_id,
                    name: orig.name,
                    phone: orig.phone,
                    email: orig.email,
                    tags: sanitiseTags((result?.success && result.tags?.recommended) ? result.tags.recommended : (orig.tags || [])),
                    metrics: (result?.success && result.metrics) ? result.metrics : {}
                });
            });

            const processed = Math.min(i + RULE_BATCH, total);
            const pct = Math.round(10 + (processed / total) * 40); // phase 1 occupies 10–50%
            setProgress(pct, `Processing contacts… ${processed}/${total}`);
            await query('UPDATE audit_results SET processed_contacts=$1 WHERE company_id=$2', [processed, companyId]);
        }

        auditLog(companyId, 'INFO', `Phase 1 complete. Starting Phase 2: batch AI classification`);

        // ── PHASE 2: Batch AI (1 OpenAI call per 20 actual leads) ────────────
        // Only classify contacts that are actual leads and have messages — skipping
        // groups/spam/never-replied saves tokens and makes AI more accurate.
        const leadsForAI = taggedContacts.filter(c =>
            !isNonLead(c.tags, c.metrics) && (c.metrics.totalMessages || 0) > 0
        );
        auditLog(companyId, 'INFO', `Phase 2: AI batch for ${leadsForAI.length}/${total} leads`);

        // Pre-fetch messages for all leads in parallel (DB reads, no AI cost)
        setProgress(52, `Fetching messages for ${leadsForAI.length} leads…`);
        const msgFetches = await Promise.allSettled(
            leadsForAI.map(c => tagger.getMessages(c.id).catch(() => []))
        );
        const messagesMap = new Map();
        msgFetches.forEach((outcome, idx) => {
            messagesMap.set(leadsForAI[idx].id,
                outcome.status === 'fulfilled' ? outcome.value : []);
        });

        // Batch AI classify
        const AI_BATCH = 20;
        const aiResults = new Map(); // contactId -> { sentiment, intent, stage }
        let aiProcessed = 0;

        for (let i = 0; i < leadsForAI.length; i += AI_BATCH) {
            const batch = leadsForAI.slice(i, i + AI_BATCH).map(c => ({
                id: c.id,
                recentMessages: messagesMap.get(c.id) || [],
                daysSinceLastMessage: c.metrics.daysSinceLastMessage
            }));

            const batchResult = await batchAIClassify(batch, companyContext);
            batchResult.forEach((v, k) => aiResults.set(k, v));
            aiProcessed += batch.length;

            const pct = Math.round(55 + (aiProcessed / Math.max(leadsForAI.length, 1)) * 35); // 55–90%
            auditLog(companyId, 'INFO', `AI batch done`, { aiProcessed, leads: leadsForAI.length });
            setProgress(pct, `AI classifying leads… ${aiProcessed}/${leadsForAI.length}`);

            if (i + AI_BATCH < leadsForAI.length) await new Promise(r => setTimeout(r, 600));
        }

        // Merge AI results into contact metrics
        for (const contact of taggedContacts) {
            const ai = aiResults.get(String(contact.id));
            if (ai) {
                contact.metrics.aiSentiment = ai.sentiment || null;
                contact.metrics.aiIntent = ai.intent || null;
                contact.metrics.aiStage = ai.stage || null;
            }
        }

        auditLog(companyId, 'INFO', `AI enriched ${aiResults.size} contacts. Building pipeline…`);
        setProgress(92, 'Building pipeline…');

        // ── Build pipeline ─────────────────────────────────────────────────────
        const pipeline = { awareness: [], interest: [], intent: [], consideration: [], decision: [], closed: [], leaked: [] };
        const AVG_DEAL = settings.avgDealSize || 2500;
        let filteredOut = 0;

        for (const contact of taggedContacts) {
            if (isNonLead(contact.tags, contact.metrics)) { filteredOut++; continue; }
            const { stage, score, reason } = classifyToStage(contact.tags, contact.metrics, settings);
            pipeline[stage].push({ ...contact, stage, score, reason });
        }

        for (const stage of Object.keys(pipeline)) {
            pipeline[stage].sort((a, b) => b.score - a.score);
        }

        const stats = {
            totalAnalyzed: total,
            filteredOut,
            leakedRevenue: pipeline.leaked.length * AVG_DEAL,
            closedRevenue: pipeline.closed.length * AVG_DEAL,
            stages: {
                awareness: pipeline.awareness.length,
                interest: pipeline.interest.length,
                intent: pipeline.intent.length,
                consideration: pipeline.consideration.length,
                decision: pipeline.decision.length,
                closed: pipeline.closed.length,
                leaked: pipeline.leaked.length
            }
        };

        await persistResult(companyId, { pipelineData: pipeline, stats }, settings, total, total);
        auditLog(companyId, 'INFO', 'Audit complete', { total, filteredOut, aiEnriched: aiResults.size, stages: stats.stages });
        liveJobs.set(companyId, { status: 'done', progress: 100, progressLabel: 'Done!' });

    } catch (error) {
        const msg = error?.message || String(error) || 'Unknown error';
        auditLog(companyId, 'ERROR', 'Audit background error', { error: msg, stack: error?.stack });
        liveJobs.set(companyId, { status: 'error', progress: 0, progressLabel: msg });
        await query(
            `UPDATE audit_results SET status='error', error_message=$1, completed_at=NOW() WHERE company_id=$2`,
            [msg, companyId]
        ).catch(() => { });
    }
}




function buildEmptyResult() {
    return {
        pipelineData: { awareness: [], interest: [], intent: [], consideration: [], decision: [], closed: [], leaked: [] },
        stats: { totalAnalyzed: 0, filteredOut: 0, leakedRevenue: 0, closedRevenue: 0, stages: { awareness: 0, interest: 0, intent: 0, consideration: 0, decision: 0, closed: 0, leaked: 0 } }
    };
}

async function persistResult(companyId, { pipelineData, stats }, settings, total, processed) {
    await query(`
        INSERT INTO audit_results (company_id, status, pipeline_data, stats, settings, total_contacts, processed_contacts, completed_at)
        VALUES ($1, 'done', $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (company_id) DO UPDATE
        SET status='done', pipeline_data=$2, stats=$3, settings=$4,
            total_contacts=$5, processed_contacts=$6, completed_at=NOW(), error_message=NULL
    `, [companyId, JSON.stringify(pipelineData), JSON.stringify(stats), JSON.stringify(settings), total, processed]);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /api/audit/run
router.post('/run', async (req, res) => {
    try {
        const { companyId, settings } = req.body;
        if (!companyId) return res.status(400).json({ error: 'companyId is required' });

        const live = liveJobs.get(companyId);
        if (live?.status === 'running') {
            return res.json({ status: 'running', progress: live.progress, progressLabel: live.progressLabel });
        }

        liveJobs.set(companyId, { status: 'running', progress: 0, progressLabel: 'Starting…' });
        await query(`
            INSERT INTO audit_results (company_id, status, started_at)
            VALUES ($1, 'running', NOW())
            ON CONFLICT (company_id) DO UPDATE SET status='running', started_at=NOW(), error_message=NULL
        `, [companyId]);

        res.json({ status: 'running', message: 'Audit started in background' });

        runAuditBackground(companyId, settings || {});

    } catch (error) {
        const msg = error?.message || String(error) || 'Unknown error';
        console.error('Error starting audit:', msg, error?.stack);
        res.status(500).json({ error: msg });
    }
});

// GET /api/audit/status/:companyId
router.get('/status/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        const live = liveJobs.get(companyId);

        // Only return 'running' from memory — never return 'done' from memory
        // because the memory object doesn't include pipelineData/stats
        if (live?.status === 'running') {
            return res.json({ status: 'running', progress: live.progress, progressLabel: live.progressLabel });
        }

        const row = await getRow('SELECT * FROM audit_results WHERE company_id=$1', [companyId]);
        if (!row) return res.json({ status: 'idle' });

        if (row.status === 'done') {
            // Neon may return JSON columns as strings — parse defensively
            const parseSafe = (v) => {
                if (!v) return null;
                if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
                return v;
            };
            return res.json({
                status: 'done',
                progress: 100,
                pipelineData: parseSafe(row.pipeline_data),
                stats: parseSafe(row.stats),
                settings: parseSafe(row.settings),
                completedAt: row.completed_at,
                totalContacts: row.total_contacts
            });
        }
        if (row.status === 'error') {
            return res.json({ status: 'error', message: row.error_message });
        }

        return res.json({ status: 'idle', message: 'Previous audit was interrupted. Please re-run.' });

    } catch (error) {
        const msg = error?.message || String(error) || 'Unknown error';
        console.error('Error checking audit status:', msg);
        res.status(500).json({ error: msg });
    }
});

module.exports = router;
