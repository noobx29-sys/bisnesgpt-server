#!/usr/bin/env node

// Test JSONB tags update
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5
});

async function testJsonbTags() {
  const client = await pool.connect();

  try {
    console.log('Testing JSONB tags update...\n');

    const sampleQuery = `
      SELECT contact_id, tags
      FROM contacts
      WHERE company_id = '0210'
      LIMIT 1
    `;

    const sampleResult = await client.query(sampleQuery);
    const contact = sampleResult.rows[0];

    console.log('Sample contact:', contact.contact_id);
    console.log('Current tags:', contact.tags);
    console.log('');

    const testTags = ['test-tag-1', 'test-tag-2', 'active'];
    const jsonTags = JSON.stringify(testTags);

    console.log('Test tags array:', testTags);
    console.log('JSON string:', jsonTags);
    console.log('');

    // Update with JSONB
    await client.query(
      'UPDATE contacts SET tags = $1::jsonb WHERE contact_id = $2',
      [jsonTags, contact.contact_id]
    );

    console.log('✅ Update successful!');

    // Verify
    const verifyResult = await client.query(
      'SELECT tags FROM contacts WHERE contact_id = $1',
      [contact.contact_id]
    );

    console.log('New tags:', verifyResult.rows[0].tags);
    console.log('Is Array?', Array.isArray(verifyResult.rows[0].tags));
    console.log('');

    // Test JSONB contains operator
    const searchResult = await client.query(
      'SELECT contact_id FROM contacts WHERE company_id = $1 AND tags @> $2::jsonb',
      ['0210', JSON.stringify(['active'])]
    );

    console.log(`✅ Found ${searchResult.rows.length} contacts with 'active' tag`);

    // Restore original
    await client.query(
      'UPDATE contacts SET tags = $1::jsonb WHERE contact_id = $2',
      [JSON.stringify(contact.tags), contact.contact_id]
    );

    console.log('✅ Original tags restored');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

testJsonbTags();
