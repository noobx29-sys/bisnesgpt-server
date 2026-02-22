/**
 * Test Audit Script
 * Run: node scripts/test-audit.js <companyId>
 * Example: node scripts/test-audit.js 728219
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { ContactTagger } = require('../analytics-dashboard/contactTagger');
const { query, getRow, pool } = require('../db');

const companyId = process.argv[2];

if (!companyId) {
    console.error('Usage: node scripts/test-audit.js <companyId>');
    process.exit(1);
}

function sanitiseTags(arr) {
    if (!arr) return [];
    if (typeof arr === 'string') {
        try { arr = JSON.parse(arr); } catch { return []; }
    }
    if (!Array.isArray(arr)) return [];
    return arr.filter(s => typeof s === 'string');
}

function classifyToStage(tags, metrics) {
    const t = sanitiseTags(tags).map(s => s.toLowerCase());
    const m = metrics || {};
    const has = (...args) => args.some(tag => t.includes(tag));

    if (has('unresponsive', 'not-interested')) return { stage: 'leaked', score: 10, reason: 'Never replied / expressed disinterest' };
    if (has('potential-lead') && has('dormant', 'cold', 'cold-lead')) return { stage: 'leaked', score: 22, reason: 'Potential lead gone dormant' };
    if (has('not-a-lead')) return { stage: 'cold', score: 15, reason: 'Not a sales lead' };
    if (has('qualified-lead')) {
        if (has('hot-lead', 'active', 'follow-up-needed', 'needs-attention')) return { stage: 'hot', score: 92, reason: 'Qualified lead — high engagement' };
        if (has('awaiting-response', 'followup-active', 'followup-responded'))  return { stage: 'hot', score: 78, reason: 'Qualified lead awaiting follow-up' };
        return { stage: 'warm', score: 65, reason: 'Qualified lead — moderate engagement' };
    }
    if (has('potential-lead')) {
        if (has('warm-lead', 'followup-active', 'query', 'active')) return { stage: 'warm', score: 55, reason: 'Potential lead showing interest' };
        return { stage: 'cold', score: 35, reason: 'Potential lead — needs nurturing' };
    }
    if (has('customer')) return { stage: 'warm', score: 50, reason: 'Existing customer — upsell opportunity' };

    const days = typeof m.daysSinceLastMessage === 'number' ? m.daysSinceLastMessage : 999;
    if (days > 30 || has('dormant', 'cold')) return { stage: 'leaked', score: 18, reason: `Inactive for ${Math.round(days)} days` };
    if (has('active', 'query')) return { stage: 'warm', score: 45, reason: 'Active conversation' };
    return { stage: 'cold', score: 28, reason: 'Low engagement' };
}

async function run() {
    console.log('\n🔍 Testing audit for company:', companyId);
    console.log('─'.repeat(60));

    // 1. DB connection
    console.log('\n[1/5] Testing DB connection...');
    try {
        const res = await query('SELECT NOW() as now');
        console.log('  ✅ Connected:', res.rows[0].now);
    } catch (e) {
        console.error('  ❌ DB connection failed:', e.message);
        process.exit(1);
    }

    // 2. audit_results table
    console.log('\n[2/5] Checking audit_results table...');
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS audit_results (
                id SERIAL PRIMARY KEY,
                company_id VARCHAR(255) NOT NULL UNIQUE,
                status VARCHAR(20) DEFAULT 'idle',
                pipeline_data JSONB,
                stats JSONB,
                error_message TEXT,
                total_contacts INTEGER DEFAULT 0,
                processed_contacts INTEGER DEFAULT 0,
                started_at TIMESTAMP DEFAULT NOW(),
                completed_at TIMESTAMP
            )
        `);
        console.log('  ✅ Table ready');
    } catch (e) {
        console.error('  ❌ Table creation failed:', e.message);
    }

    // 3. Fetch contacts
    console.log('\n[3/5] Fetching contacts from Neon...');
    const tagger = new ContactTagger(companyId, { dryRun: true, verbose: false, aiEnabled: false });
    let contacts;
    try {
        contacts = await tagger.getAllContacts();
        console.log(`  ✅ Found ${contacts.length} contacts`);
        if (contacts.length === 0) {
            console.log('  ⚠️  No contacts — audit would return empty results');
            process.exit(0);
        }
        // Show first 3 with their current tags and tag type
        contacts.slice(0, 3).forEach(c => {
            const tagType = typeof c.tags;
            const tags = sanitiseTags(c.tags);
            console.log(`     • ${c.name || c.phone || c.contact_id} | tags (${tagType}):`, tags.slice(0, 4));
        });
    } catch (e) {
        console.error('  ❌ Failed to fetch contacts:', e.message);
        process.exit(1);
    }

    // 4. Test tag classification on existing tags (no AI call)
    console.log('\n[4/5] Classifying existing tags (no AI) for first 10 contacts...');
    const pipeline = { hot: [], warm: [], cold: [], leaked: [] };
    const sample = contacts.slice(0, 10);
    for (const c of sample) {
        const tags = sanitiseTags(c.tags);
        const { stage, score, reason } = classifyToStage(tags, {});
        pipeline[stage].push(c.name || c.phone || c.contact_id);
        console.log(`  ${stage.toUpperCase().padEnd(7)} [${score}] ${(c.name || c.phone || c.contact_id || '').toString().slice(0, 30)} — ${reason}`);
    }

    // 5. Test single AI tag call
    console.log('\n[5/5] Testing AI tagging on 1 contact (dryRun: true)...');
    const aiTagger = new ContactTagger(companyId, { dryRun: true, verbose: false, aiEnabled: true });
    const testContact = contacts[0];
    try {
        const result = await aiTagger.tagContact(testContact.contact_id);
        if (result.success) {
            console.log('  ✅ AI tagging worked');
            console.log('     Tags recommended:', result.tags?.recommended);
            console.log('     AI intent:', result.metrics?.aiIntent);
            console.log('     AI sentiment:', result.metrics?.aiSentiment);
            console.log('     AI stage:', result.metrics?.aiStage);
        } else {
            console.log('  ⚠️  tagContact returned success:false —', result.error);
        }
    } catch (e) {
        console.error('  ❌ AI tagging threw:', e.message);
    }

    console.log('\n' + '─'.repeat(60));
    console.log('✅ Test complete. If all checks passed, the audit API should work.\n');
    await pool.end();
}

run().catch(e => {
    console.error('Unexpected error:', e);
    pool.end();
    process.exit(1);
});
