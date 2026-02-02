const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkData() {
  const client = await pool.connect();
  try {
    // Check media messages specifically
    const result = await client.query(`
      SELECT message_type, 
             COUNT(*) as total,
             COUNT(media_url) as has_media_url,
             COUNT(media_data) as has_media_data,
             COUNT(media_metadata) as has_media_metadata
      FROM messages 
      WHERE message_type IN ('image', 'document', 'video', 'audio', 'ptt', 'album', 'sticker')
      GROUP BY message_type
      ORDER BY total DESC
    `);
    console.log('Media message statistics:');
    console.table(result.rows);
    
    // Get a sample image message
    const sampleImg = await client.query(`
      SELECT message_id, message_type, media_url, 
             CASE WHEN media_data IS NOT NULL THEN LENGTH(media_data) ELSE 0 END as media_data_length,
             media_metadata, timestamp
      FROM messages 
      WHERE message_type = 'image'
      ORDER BY timestamp DESC
      LIMIT 3
    `);
    console.log('\nSample IMAGE messages:');
    sampleImg.rows.forEach(row => {
      console.log(JSON.stringify(row, null, 2));
    });
    
    // Get a sample document message
    const sampleDoc = await client.query(`
      SELECT message_id, message_type, media_url, 
             CASE WHEN media_data IS NOT NULL THEN LENGTH(media_data) ELSE 0 END as media_data_length,
             media_metadata, timestamp
      FROM messages 
      WHERE message_type = 'document'
      ORDER BY timestamp DESC
      LIMIT 3
    `);
    console.log('\nSample DOCUMENT messages:');
    sampleDoc.rows.forEach(row => {
      console.log(JSON.stringify(row, null, 2));
    });
  } finally {
    client.release();
    pool.end();
  }
}

checkData().catch(console.error);
