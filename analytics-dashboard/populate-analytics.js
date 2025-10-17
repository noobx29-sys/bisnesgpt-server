// =====================================================
// Populate Analytics Data
// Run this script to analyze contacts and populate analytics
// =====================================================

require('dotenv').config();
const { ContactTagger } = require('./contactTagger');
const sqlDb = require('../db');

async function populateAnalytics() {
  try {
    console.log('\n' + '='.repeat(60));
    console.log('📊 Populating Analytics Data');
    console.log('='.repeat(60) + '\n');

    // Get list of companies
    const companiesQuery = `
      SELECT DISTINCT company_id, COUNT(*) as contact_count
      FROM contacts
      WHERE is_group = false
      GROUP BY company_id
      ORDER BY company_id
    `;
    
    const companies = await sqlDb.query(companiesQuery);
    
    if (companies.rows.length === 0) {
      console.log('❌ No companies found in database');
      process.exit(1);
    }

    console.log(`Found ${companies.rows.length} companies:\n`);
    companies.rows.forEach((company, index) => {
      console.log(`  ${index + 1}. ${company.company_id} (${company.contact_count} contacts)`);
    });

    console.log('\n' + '-'.repeat(60));
    console.log('Select a company to analyze:');
    console.log('  - Enter company ID (e.g., 0210)');
    console.log('  - Or type "all" to analyze all companies');
    console.log('-'.repeat(60) + '\n');

    // Get user input
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    readline.question('Company ID or "all": ', async (answer) => {
      readline.close();
      
      const selectedCompanies = answer.toLowerCase() === 'all' 
        ? companies.rows.map(c => c.company_id)
        : [answer.trim()];

      console.log('\n' + '='.repeat(60));
      console.log(`Analyzing ${selectedCompanies.length} company(ies)...`);
      console.log('='.repeat(60) + '\n');

      for (const companyId of selectedCompanies) {
        await analyzeCompany(companyId);
      }

      console.log('\n' + '='.repeat(60));
      console.log('✅ Analytics Population Complete!');
      console.log('='.repeat(60));
      console.log('\n📊 Next steps:');
      console.log('  1. Start analytics server: node analytics-server.js');
      console.log('  2. Open dashboard: http://localhost:3005');
      console.log('  3. Select your company and view analytics\n');
      
      process.exit(0);
    });

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

async function analyzeCompany(companyId) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`📈 Analyzing Company: ${companyId}`);
  console.log(`📅 Filtering: Contacts with activity in last 30 days`);
  console.log('─'.repeat(60));

  try {
    // Create tagger instance
    const tagger = new ContactTagger(companyId, {
      verbose: false,
      aiEnabled: true,
      dryRun: false,
      daysFilter: 30  // Only analyze contacts with messages in last 30 days
    });

    // Get contact count (with 30-day filter)
    const countQuery = `
      SELECT COUNT(DISTINCT c.contact_id) as total
      FROM contacts c
      WHERE c.company_id = $1 
        AND c.is_group = false
        AND EXISTS (
          SELECT 1 FROM messages m
          WHERE m.contact_id = c.contact_id
            AND m.company_id = c.company_id
            AND m.timestamp >= NOW() - INTERVAL '30 days'
        )
    `;
    const countResult = await sqlDb.query(countQuery, [companyId]);
    const totalContacts = parseInt(countResult.rows[0].total);

    console.log(`\n📊 Total contacts to analyze: ${totalContacts}`);
    
    if (totalContacts === 0) {
      console.log('⚠️  No contacts found for this company');
      return;
    }

    console.log('⏳ Starting analysis... (this may take a while)\n');

    // Run the tagger
    const startTime = Date.now();
    const result = await tagger.tagAllContacts();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n✅ Analysis Complete!');
    console.log(`   Total: ${result.total}`);
    console.log(`   Success: ${result.success}`);
    console.log(`   Failed: ${result.failed}`);
    console.log(`   Duration: ${duration}s`);

    // Show sample analytics
    const sampleQuery = `
      SELECT 
        contact_id,
        name,
        custom_fields->'analytics'->>'last_response_stage' as stage,
        custom_fields->'analytics'->>'reactivation_eligible' as reactivation_eligible,
        custom_fields->'analytics'->>'reactivation_priority' as priority
      FROM contacts
      WHERE company_id = $1
        AND custom_fields->'analytics' IS NOT NULL
      LIMIT 5
    `;
    const samples = await sqlDb.query(sampleQuery, [companyId]);

    if (samples.rows.length > 0) {
      console.log('\n📋 Sample Analytics Data:');
      samples.rows.forEach((row, i) => {
        console.log(`   ${i + 1}. ${row.name || row.contact_id}`);
        console.log(`      Stage: ${row.stage || 'N/A'}`);
        console.log(`      Reactivation: ${row.reactivation_eligible === 'true' ? `Yes (Priority: ${row.priority})` : 'No'}`);
      });
    }

  } catch (error) {
    console.error(`\n❌ Error analyzing ${companyId}:`, error.message);
  }
}

// Run the script
populateAnalytics();
