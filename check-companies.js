const { Client } = require('pg');
const client = new Client({ 
  connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg-Usd8JqxGgF5s@ep-billowing-pond-a1z2qov5.ap-southeast-1.aws.neon.tech/neondb?sslmode=require' 
});

const companyIds = [
  '621275', '0245', '0342', '0377', '049815', '058666', '063', '079', '920072',
  '088', '092', '296245', '325117', '399849', '458752', '728219', '765943', '946386'
];

client.connect().then(() => {
  const placeholders = companyIds.map((_, i) => `$${i + 1}`).join(', ');
  const query = `SELECT company_id, name, phone_numbers, phone_count FROM companies WHERE company_id IN (${placeholders}) ORDER BY company_id`;
  return client.query(query, companyIds);
}).then(result => {
  console.log(`\nTotal companies: ${result.rows.length}`);
  console.log('\nCompanies with phone configuration:');
  let withPhones = 0;
  result.rows.forEach(row => {
    const phoneCount = row.phone_count || (row.phone_numbers || []).length;
    if (phoneCount > 0) {
      withPhones++;
      console.log(`  ✅ ${row.company_id}: ${row.name || 'No name'} - ${phoneCount} phones`);
    } else {
      console.log(`  ❌ ${row.company_id}: ${row.name || 'No name'} - NO PHONES`);
    }
  });
  console.log(`\nCompanies with phones: ${withPhones}/${result.rows.length}`);
  client.end();
}).catch(err => {
  console.error('Error:', err.message);
  client.end();
  process.exit(1);
});
