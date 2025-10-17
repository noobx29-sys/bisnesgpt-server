#!/usr/bin/env node

// Verify tag accuracy by checking a sample of contacts
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5
});

async function verifyAccuracy(companyId, sampleSize = 5) {
  const client = await pool.connect();

  try {
    console.log('\n' + '='.repeat(70));
    console.log('TAG ACCURACY VERIFICATION');
    console.log('='.repeat(70));

    // Get sample of tagged contacts
    const query = `
      SELECT c.contact_id, c.phone, c.name, c.tags,
             (SELECT COUNT(*) FROM messages WHERE contact_id = c.contact_id) as message_count,
             (SELECT MAX(timestamp) FROM messages WHERE contact_id = c.contact_id) as last_msg_time,
             (SELECT COUNT(*) FROM messages WHERE contact_id = c.contact_id AND from_me = false) as inbound_count,
             (SELECT COUNT(*) FROM messages WHERE contact_id = c.contact_id AND from_me = true) as outbound_count
      FROM contacts c
      WHERE c.company_id = $1
        AND c.tags IS NOT NULL
        AND c.tags != '[]'::jsonb
        AND (c.phone NOT LIKE '%@g.us' OR c.phone IS NULL)
      ORDER BY RANDOM()
      LIMIT $2
    `;

    const result = await client.query(query, [companyId, sampleSize]);

    console.log(`\nChecking ${result.rows.length} randomly selected contacts...\n`);

    for (const contact of result.rows) {
      console.log('─'.repeat(70));
      console.log(`📋 Contact: ${contact.name || contact.contact_id}`);
      console.log(`   Phone: ${contact.phone}`);
      console.log(`   Tags: ${JSON.stringify(contact.tags)}`);
      console.log(`   Messages: ${contact.message_count} total (${contact.inbound_count} inbound, ${contact.outbound_count} outbound)`);

      if (contact.last_msg_time) {
        // FIX: timestamp is already a Date object from PostgreSQL
        const daysSince = Math.floor((Date.now() - new Date(contact.last_msg_time).getTime()) / (1000 * 86400));
        console.log(`   Last Message: ${daysSince} days ago`);
      }

      // Verify tag accuracy
      const tags = contact.tags || [];
      const issues = [];

      // Check "new" tag
      if (tags.includes('new')) {
        if (contact.message_count > 0) {
          issues.push('❌ HAS "new" tag but has messages!');
        }
      }

      // Check "active" tag
      if (tags.includes('active')) {
        if (contact.last_msg_time) {
          const daysSince = Math.floor((Date.now() - new Date(contact.last_msg_time).getTime()) / (1000 * 86400));
          if (daysSince > 3) {
            issues.push(`❌ HAS "active" tag but last message was ${daysSince} days ago (should be <3 days)`);
          }
        }
      }

      // Check "dormant" tag
      if (tags.includes('dormant')) {
        if (contact.last_msg_time) {
          const daysSince = Math.floor((Date.now() - new Date(contact.last_msg_time).getTime()) / (1000 * 86400));
          if (daysSince < 30) {
            issues.push(`❌ HAS "dormant" tag but last message was only ${daysSince} days ago (should be 30+ days)`);
          }
        }
      }

      // Check "cold" tag
      if (tags.includes('cold')) {
        // Need to check if there are actually 3+ consecutive outbound messages
        const lastMsgs = await client.query(
          `SELECT from_me FROM messages WHERE contact_id = $1 ORDER BY timestamp DESC LIMIT 5`,
          [contact.contact_id]
        );

        let consecutive = 0;
        for (const msg of lastMsgs.rows) {
          if (msg.from_me) consecutive++;
          else break;
        }

        if (consecutive < 3) {
          issues.push(`❌ HAS "cold" tag but only ${consecutive} consecutive outbound messages (should be 3+)`);
        }
      }

      // Check engagement tags
      if (tags.includes('hot-lead') || tags.includes('warm-lead') || tags.includes('cold-lead')) {
        // Need actual response time data to verify
        console.log('   ℹ️  Engagement tags require response time analysis (use debug-tags.js for details)');
      }

      // Display issues or OK
      if (issues.length > 0) {
        console.log('\n   🔴 ISSUES FOUND:');
        issues.forEach(issue => console.log(`      ${issue}`));
      } else {
        console.log('   ✅ Tags appear accurate');
      }

      console.log('');
    }

    console.log('='.repeat(70));
    console.log('💡 For detailed analysis of a specific contact, run:');
    console.log('   node debug-tags.js <companyId> <contactId>');
    console.log('='.repeat(70) + '\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    client.release();
    await pool.end();
  }
}

const companyId = process.argv[2] || '0210';
const sampleSize = parseInt(process.argv[3]) || 5;

console.log(`\nVerifying tag accuracy for company ${companyId} (${sampleSize} samples)...`);

verifyAccuracy(companyId, sampleSize);
