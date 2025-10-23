require('dotenv').config();
const { Pool } = require('pg');
const readline = require('readline');

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Database configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 5,
  min: 1,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Function to remove all tags except 'stop bot' for a company
async function removeAllTagsExceptStopBot(companyId) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get all contacts for the company
    const { rows: contacts } = await client.query(
      'SELECT contact_id, tags FROM contacts WHERE company_id = $1',
      [companyId]
    );

    console.log(`Found ${contacts.length} contacts for company ${companyId}`);
    
    let updatedCount = 0;
    
    // Process each contact
    for (const contact of contacts) {
      const currentTags = contact.tags || [];
      
      // Check if 'stop bot' is in the tags (case insensitive)
      const hasStopBot = currentTags.some(tag => 
        typeof tag === 'string' && tag.toLowerCase() === 'stop bot'
      );
      
      // Only update if there are tags to remove
      if (currentTags.length > 0) {
        const newTags = hasStopBot ? ['stop bot'] : [];
        
        await client.query(
          'UPDATE contacts SET tags = $1 WHERE contact_id = $2 AND company_id = $3',
          [newTags, contact.contact_id, companyId]
        );
        
        updatedCount++;
        
        if (updatedCount % 100 === 0) {
          console.log(`Processed ${updatedCount} contacts...`);
        }
      }
    }
    
    await client.query('COMMIT');
    console.log(`\n✅ Successfully updated ${updatedCount} contacts.`);
    console.log(`All tags have been removed except 'stop bot' for company ${companyId}.`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing contacts:', error);
    throw error;
  } finally {
    client.release();
    pool.end();
    rl.close();
  }
}

// Get company ID from command line arguments or prompt
let companyId = process.argv[2];

if (!companyId) {
  rl.question('Please enter the company ID: ', (input) => {
    companyId = input.trim();
    if (!companyId) {
      console.error('Error: Company ID is required');
      process.exit(1);
    }
    removeAllTagsExceptStopBot(companyId).catch(console.error);
  });
} else {
  removeAllTagsExceptStopBot(companyId).catch(console.error);
}
