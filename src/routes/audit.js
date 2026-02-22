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
            error_message TEXT,
            total_contacts INTEGER DEFAULT 0,
            processed_contacts INTEGER DEFAULT 0,
            started_at  TIMESTAMP DEFAULT NOW(),
            completed_at TIMESTAMP
        )
    `);
}
ensureAuditTable().catch(err => console.error('audit_results table init failed:', err.message));

// ─── In-memory progress tracker (per company) ─────────────────────────────────
// Holds live progress while a job is running. Falls back to DB after done.
const liveJobs = new Map();

// ─── Tag → pipeline stage mapper ─────────────────────────────────────────────
function classifyToStage(tags, metrics) {
    // tags from Neon JSONB can contain non-strings — always sanitise
    const t = (tags || []).filter(s => typeof s === 'string').map(s => s.toLowerCase());
    const m = metrics || {};
    const has = (...args) => args.some(tag => t.includes(tag));

    if (has('unresponsive', 'not-interested')) {
        return {
            stage: 'leaked',
            score: 10,
            reason: t.includes('unresponsive')
                ? 'Never replied to any outreach'
                : 'Expressed disinterest or rejection'
        };
    }
    if (has('potential-lead') && has('dormant', 'cold', 'cold-lead')) {
        return { stage: 'leaked', score: 22, reason: 'Potential lead gone dormant (30+ days)' };
    }
    if (has('not-a-lead')) {
        return { stage: 'cold', score: 15, reason: 'Not a sales lead (general / spam inquiry)' };
    }
    if (has('qualified-lead')) {
        if (has('hot-lead', 'active', 'follow-up-needed', 'needs-attention')) {
            return { stage: 'hot', score: 92, reason: 'Qualified lead — high engagement, action needed' };
        }
        if (has('awaiting-response', 'followup-active', 'followup-responded')) {
            return { stage: 'hot', score: 78, reason: 'Qualified lead awaiting your follow-up' };
        }
        return { stage: 'warm', score: 65, reason: 'Qualified lead — moderate engagement' };
    }
    if (has('potential-lead')) {
        if (has('warm-lead', 'followup-active', 'query', 'active')) {
            return { stage: 'warm', score: 55, reason: 'Potential lead showing active interest' };
        }
        return { stage: 'cold', score: 35, reason: 'Potential lead — needs nurturing outreach' };
    }
    if (has('customer')) {
        return { stage: 'warm', score: 50, reason: 'Existing customer — upsell / support opportunity' };
    }

    const days = typeof m.daysSinceLastMessage === 'number' ? m.daysSinceLastMessage : 999;
    if (days > 30 || has('dormant', 'cold')) {
        return { stage: 'leaked', score: 18, reason: `Inactive for ${Math.round(days)} days — at risk of permanent loss` };
    }
    if (has('active', 'query')) {
        return { stage: 'warm', score: 45, reason: 'Active conversation — qualification needed' };
    }
    return { stage: 'cold', score: 28, reason: 'Low engagement — no clear buying signal yet' };
}

function sanitiseTags(arr) {
    return (arr || []).filter(s => typeof s === 'string');
}

// ─── Background worker ────────────────────────────────────────────────────────
async function runAuditBackground(companyId) {
    const setProgress = (progress, label) => {
        liveJobs.set(companyId, { status: 'running', progress, progressLabel: label });
    };

    try {
        setProgress(5, 'Fetching contacts…');

        const tagger = new ContactTagger(companyId, {
            dryRun: false,
            verbose: false,
            aiEnabled: true,
            daysFilter: null
        });

        const contacts = await tagger.getAllContacts();

        if (contacts.length === 0) {
            const empty = {
                pipelineData: { hot: [], warm: [], cold: [], leaked: [] },
                stats: { totalAnalyzed: 0, leakedRevenue: 0, activeOpportunities: 0, warmLeads: 0, hotLeads: 0, coldLeads: 0, leakedLeads: 0, conversionRate: 0 }
            };
            await persistResult(companyId, empty, 0, 0);
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
                    tags: sanitiseTags(
                        (result?.success && result.tags?.recommended)
                            ? result.tags.recommended
                            : (orig.tags || [])
                    ),
                    metrics: (result?.success && result.metrics) ? result.metrics : {}
                });
            });

            const processed = Math.min(i + BATCH, total);
            const pct = Math.round(10 + (processed / total) * 80);
            setProgress(pct, `AI reading conversations… ${processed}/${total}`);
            await query('UPDATE audit_results SET processed_contacts=$1 WHERE company_id=$2', [processed, companyId]);
        }

        // Build pipeline
        const pipeline = { hot: [], warm: [], cold: [], leaked: [] };
        const AVG_DEAL = 2500;

        for (const contact of taggedContacts) {
            const { stage, score, reason } = classifyToStage(contact.tags, contact.metrics);
            pipeline[stage].push({ ...contact, stage, score, reason });
        }
        for (const stage of Object.keys(pipeline)) {
            pipeline[stage].sort((a, b) => b.score - a.score);
        }

        const hot    = pipeline.hot.length;
        const warm   = pipeline.warm.length;
        const cold   = pipeline.cold.length;
        const leaked = pipeline.leaked.length;

        const stats = {
            totalAnalyzed: taggedContacts.length,
            leakedRevenue: leaked * AVG_DEAL,
            activeOpportunities: hot + warm,
            hotLeads: hot,
            warmLeads: warm,
            coldLeads: cold,
            leakedLeads: leaked,
            conversionRate: taggedContacts.length > 0 ? Math.round((hot / taggedContacts.length) * 100) : 0
        };

        await persistResult(companyId, { pipelineData: pipeline, stats }, total, total);
        liveJobs.set(companyId, { status: 'done', progress: 100, progressLabel: 'Done!' });

    } catch (error) {
        const msg = error?.message || String(error) || 'Unknown error';
        console.error('Audit background error:', msg, error?.stack);
        liveJobs.set(companyId, { status: 'error', progress: 0, progressLabel: msg });
        await query(
            `UPDATE audit_results SET status='error', error_message=$1, completed_at=NOW() WHERE company_id=$2`,
            [msg, companyId]
        ).catch(() => {});
    }
}

async function persistResult(companyId, { pipelineData, stats }, total, processed) {
    await query(`
        INSERT INTO audit_results (company_id, status, pipeline_data, stats, total_contacts, processed_contacts, completed_at)
        VALUES ($1, 'done', $2, $3, $4, $5, NOW())
        ON CONFLICT (company_id) DO UPDATE
        SET status='done',
            pipeline_data=$2,
            stats=$3,
            total_contacts=$4,
            processed_contacts=$5,
            completed_at=NOW(),
            error_message=NULL
    `, [companyId, JSON.stringify(pipelineData), JSON.stringify(stats), total, processed]);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /api/audit/run  — start background audit, return immediately
router.post('/run', async (req, res) => {
    try {
        const { companyId } = req.body;
        if (!companyId) return res.status(400).json({ error: 'companyId is required' });

        const live = liveJobs.get(companyId);
        if (live?.status === 'running') {
            return res.json({ status: 'running', progress: live.progress, progressLabel: live.progressLabel });
        }

        // Mark running in memory + DB
        liveJobs.set(companyId, { status: 'running', progress: 0, progressLabel: 'Starting…' });
        await query(`
            INSERT INTO audit_results (company_id, status, started_at)
            VALUES ($1, 'running', NOW())
            ON CONFLICT (company_id) DO UPDATE SET status='running', started_at=NOW(), error_message=NULL
        `, [companyId]);

        // Fire-and-forget — response returns before audit finishes
        res.json({ status: 'running', message: 'Audit started in background' });

        runAuditBackground(companyId);

    } catch (error) {
        const msg = error?.message || String(error) || 'Unknown error';
        console.error('Error starting audit:', msg, error?.stack);
        res.status(500).json({ error: msg });
    }
});

// GET /api/audit/status/:companyId  — poll this while audit is running
router.get('/status/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        const live = liveJobs.get(companyId);

        // Still running in memory — return live progress
        if (live?.status === 'running') {
            return res.json({ status: 'running', progress: live.progress, progressLabel: live.progressLabel });
        }

        // Check DB
        const row = await getRow('SELECT * FROM audit_results WHERE company_id=$1', [companyId]);
        if (!row) return res.json({ status: 'idle' });

        if (row.status === 'done') {
            return res.json({
                status: 'done',
                progress: 100,
                pipelineData: row.pipeline_data,
                stats: row.stats,
                completedAt: row.completed_at,
                totalContacts: row.total_contacts
            });
        }
        if (row.status === 'error') {
            return res.json({ status: 'error', message: row.error_message });
        }

        // DB says running but no live job — server probably restarted mid-audit
        return res.json({ status: 'idle', message: 'Previous audit was interrupted. Please re-run.' });

    } catch (error) {
        const msg = error?.message || String(error) || 'Unknown error';
        console.error('Error checking audit status:', msg);
        res.status(500).json({ error: msg });
    }
});

module.exports = router;
