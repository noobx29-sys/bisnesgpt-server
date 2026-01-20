#!/usr/bin/env node

// Quick test script to verify tags update is working
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5
});

async function testTagsUpdate() {
  const client = await pool.connect();

  try {
    console.log('Testing tags column update...\n');

    // Get a sample contact
    const sampleQuery = `
      SELECT contact_id, tags, pg_typeof(tags) as type
      FROM contacts
      WHERE company_id = '0210'
      LIMIT 1
    `;

    const sampleResult = await client.query(sampleQuery);

    if (sampleResult.rows.length === 0) {
      console.log('❌ No contacts found for company 0210');
      return;
    }

    const contact = sampleResult.rows[0];
    console.log('Sample contact:', contact.contact_id);
    console.log('Current tags:', contact.tags);
    console.log('Tags type:', contact.type);
    console.log('');

    // Test different update methods
    const testTags = ['test-tag-1', 'test-tag-2', 'active'];

    console.log('Attempting to update with array:', testTags);

    try {
      // Method 1: Direct array with type cast
      await client.query(
        'UPDATE contacts SET tags = $1::text[] WHERE contact_id = $2',
        [testTags, contact.contact_id]
      );
      console.log('✅ Method 1 (direct array with ::text[] cast) - SUCCESS');
    } catch (err) {
      console.log('❌ Method 1 failed:', err.message);

      // Method 2: Try with ARRAY[] constructor
      try {
        const arrayStr = testTags.map(t => `'${t}'`).join(',');
        await client.query(
          `UPDATE contacts SET tags = ARRAY[${arrayStr}]::text[] WHERE contact_id = $1`,
          [contact.contact_id]
        );
        console.log('✅ Method 2 (ARRAY[] constructor) - SUCCESS');
      } catch (err2) {
        console.log('❌ Method 2 failed:', err2.message);
      }
    }

    // Verify the update
    const verifyResult = await client.query(
      'SELECT tags FROM contacts WHERE contact_id = $1',
      [contact.contact_id]
    );

    console.log('\nFinal tags:', verifyResult.rows[0].tags);
    console.log('Is Array?', Array.isArray(verifyResult.rows[0].tags));

    // Restore original tags
    await client.query(
      'UPDATE contacts SET tags = $1::text[] WHERE contact_id = $2',
      [contact.tags, contact.contact_id]
    );
    console.log('\n✅ Original tags restored');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Full error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

testTagsUpdate();
