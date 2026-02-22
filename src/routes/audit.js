const express = require('express');
const router = express.Router();
const { ContactTagger } = require('../../analytics-dashboard/contactTagger');
const { query, getRow } = require('../../db');

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

// ─── Background worker ────────────────────────────────────────────────────────
async function runAuditBackground(companyId, settings = {}) {
    const setProgress = (progress, label) =>
        liveJobs.set(companyId, { status: 'running', progress, progressLabel: label });

    try {
        setProgress(5, 'Fetching contacts…');

        // Pull the company's existing AI assistant prompt from instruction_templates.
        // This is the same business context the bot already uses — no form needed.
        let companyContext = '';
        try {
            const tmplRow = await getRow(
                `SELECT instructions FROM instruction_templates WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`,
                [companyId]
            );
            if (tmplRow?.instructions) {
                companyContext = tmplRow.instructions;
                console.log(`[Audit] Using instruction template for company ${companyId} (${companyContext.length} chars)`);
            }
        } catch (e) {
            console.warn('[Audit] Could not fetch instruction template:', e.message);
        }

        const tagger = new ContactTagger(companyId, {
            dryRun: false,
            verbose: false,
            aiEnabled: true,
            daysFilter: null,
            companyContext  // feeds directly into GPT sentiment/intent/stage prompts
        });

        const contacts = await tagger.getAllContacts();

        if (contacts.length === 0) {
            const empty = buildEmptyResult();
            await persistResult(companyId, empty, settings, 0, 0);
            liveJobs.set(companyId, { status: 'done', progress: 100 });
            return;
        }

        const total = contacts.length;
        setProgress(10, `AI reading ${total} conversations…`);
        await query('UPDATE audit_results SET total_contacts=$1 WHERE company_id=$2', [total, companyId]);

        const BATCH = 15;
        const taggedContacts = [];

        for (let i = 0; i < total; i += BATCH) {
            const batch = contacts.slice(i, i + BATCH);
            const settled = await Promise.allSettled(
                batch.map(c => tagger.tagContact(c.contact_id))
            );

            settled.forEach((outcome, idx) => {
                const orig = batch[idx];
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

            const processed = Math.min(i + BATCH, total);
            const pct = Math.round(10 + (processed / total) * 80);
            setProgress(pct, `AI reading conversations… ${processed}/${total}`);
            await query('UPDATE audit_results SET processed_contacts=$1 WHERE company_id=$2', [processed, companyId]);
        }

        // ── Build pipeline (filter non-leads, classify the rest) ───────────────
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
        liveJobs.set(companyId, { status: 'done', progress: 100, progressLabel: 'Done!' });

    } catch (error) {
        const msg = error?.message || String(error) || 'Unknown error';
        console.error('Audit background error:', msg, error?.stack);
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

        if (live?.status === 'running') {
            return res.json({ status: 'running', progress: live.progress, progressLabel: live.progressLabel });
        }

        const row = await getRow('SELECT * FROM audit_results WHERE company_id=$1', [companyId]);
        if (!row) return res.json({ status: 'idle' });

        if (row.status === 'done') {
            return res.json({
                status: 'done',
                progress: 100,
                pipelineData: row.pipeline_data,
                stats: row.stats,
                settings: row.settings,
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
