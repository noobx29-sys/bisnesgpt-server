const express = require('express');
const router = express.Router();
const { ContactTagger } = require('../../analytics-dashboard/contactTagger');

// Map AI-derived tags to pipeline stages
function classifyToStage(tags, metrics) {
    const t = (tags || []).map(s => s.toLowerCase());
    const m = metrics || {};

    const has = (...args) => args.some(tag => t.includes(tag));

    // Leaked / Dead
    if (has('unresponsive', 'not-interested')) {
        return {
            stage: 'leaked',
            score: 10,
            reason: t.includes('unresponsive')
                ? 'Never replied to any outreach'
                : 'Expressed disinterest or rejection'
        };
    }

    // Potential lead gone dormant
    if (has('potential-lead') && has('dormant', 'cold', 'cold-lead')) {
        return { stage: 'leaked', score: 22, reason: 'Potential lead gone dormant (30+ days)' };
    }

    // Not a sales lead
    if (has('not-a-lead')) {
        return { stage: 'cold', score: 15, reason: 'Not a sales lead (general/spam inquiry)' };
    }

    // Qualified lead - hottest bucket
    if (has('qualified-lead')) {
        if (has('hot-lead', 'active', 'follow-up-needed', 'needs-attention')) {
            return { stage: 'hot', score: 92, reason: 'Qualified lead — high engagement, action needed' };
        }
        if (has('awaiting-response', 'followup-active', 'followup-responded')) {
            return { stage: 'hot', score: 78, reason: 'Qualified lead awaiting your follow-up' };
        }
        return { stage: 'warm', score: 65, reason: 'Qualified lead — moderate engagement' };
    }

    // Potential lead
    if (has('potential-lead')) {
        if (has('warm-lead', 'followup-active', 'query', 'active')) {
            return { stage: 'warm', score: 55, reason: 'Potential lead showing active interest' };
        }
        return { stage: 'cold', score: 35, reason: 'Potential lead — needs nurturing outreach' };
    }

    // Existing customer
    if (has('customer')) {
        return { stage: 'warm', score: 50, reason: 'Existing customer — upsell / support opportunity' };
    }

    // Fallback: use metrics
    const days = m.daysSinceLastMessage ?? 999;
    if (days > 30 || has('dormant', 'cold')) {
        return { stage: 'leaked', score: 18, reason: `Inactive for ${Math.round(days)} days — at-risk of permanent loss` };
    }
    if (has('active', 'query')) {
        return { stage: 'warm', score: 45, reason: 'Active conversation — qualification needed' };
    }
    return { stage: 'cold', score: 28, reason: 'Low engagement — no clear buying signal yet' };
}

router.post('/run', async (req, res) => {
    try {
        const { companyId } = req.body;

        if (!companyId) {
            return res.status(400).json({ error: 'companyId is required' });
        }

        const tagger = new ContactTagger(companyId, {
            dryRun: false,
            verbose: false,
            aiEnabled: true,
            daysFilter: null // analyze all contacts
        });

        // Fetch contacts directly from Neon (excludes groups)
        const contacts = await tagger.getAllContacts();

        if (contacts.length === 0) {
            return res.json({
                pipelineData: { hot: [], warm: [], cold: [], leaked: [] },
                stats: {
                    totalAnalyzed: 0,
                    leakedRevenue: 0,
                    activeOpportunities: 0,
                    warmLeads: 0,
                    hotLeads: 0,
                    coldLeads: 0,
                    leakedLeads: 0,
                    conversionRate: 0
                }
            });
        }

        // Run AI analysis in parallel batches of 15 for speed
        const BATCH = 15;
        const taggedContacts = [];

        for (let i = 0; i < contacts.length; i += BATCH) {
            const batch = contacts.slice(i, i + BATCH);
            const results = await Promise.all(batch.map(c => tagger.tagContact(c.contact_id)));
            results.forEach((result, idx) => {
                const original = batch[idx];
                taggedContacts.push({
                    id: original.contact_id,
                    name: original.name,
                    phone: original.phone,
                    email: original.email,
                    tags: result.success ? (result.tags?.recommended || original.tags || []) : (original.tags || []),
                    metrics: result.success ? (result.metrics || {}) : {}
                });
            });
        }

        // Classify each contact into pipeline stage
        const pipeline = { hot: [], warm: [], cold: [], leaked: [] };
        const defaultAvgDeal = 2500;

        for (const contact of taggedContacts) {
            const { stage, score, reason } = classifyToStage(contact.tags, contact.metrics);
            pipeline[stage].push({
                ...contact,
                stage,
                score,
                reason
            });
        }

        // Sort each stage by score desc (highest priority first)
        for (const stage of Object.keys(pipeline)) {
            pipeline[stage].sort((a, b) => b.score - a.score);
        }

        const leakedCount = pipeline.leaked.length;
        const hotCount = pipeline.hot.length;
        const warmCount = pipeline.warm.length;
        const coldCount = pipeline.cold.length;
        const total = taggedContacts.length;

        const stats = {
            totalAnalyzed: total,
            leakedRevenue: leakedCount * defaultAvgDeal,
            activeOpportunities: hotCount + warmCount,
            warmLeads: warmCount,
            hotLeads: hotCount,
            coldLeads: coldCount,
            leakedLeads: leakedCount,
            conversionRate: total > 0 ? Math.round((hotCount / total) * 100) : 0
        };

        res.json({ pipelineData: pipeline, stats });

    } catch (error) {
        console.error('Error running AI audit:', error);
        res.status(500).json({ error: 'Internal server error while running audit' });
    }
});

module.exports = router;
