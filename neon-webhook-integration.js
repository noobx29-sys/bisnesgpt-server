// ======================
// NEON WEBHOOK INTEGRATION
// ======================

const { setupRevotrendWebhook } = require('./neon-revotrend-webhook');
const { setupShipGuruWebhook } = require('./neon-shipguru-webhook');
const { setupStoreGuruWebhook } = require('./neon-storeguru-webhook');
const { setupDailyReportRoutes, initializeDailyReports } = require('./neon-daily-reports');

// ======================
// MAIN INTEGRATION FUNCTION
// ======================

function setupNeonWebhooks(app, botMap) {
  console.log('🚀 Setting up Neon webhook handlers...');
  
  // Setup all webhook routes
  setupRevotrendWebhook(app, botMap);
  setupShipGuruWebhook(app, botMap);
  setupStoreGuruWebhook(app, botMap);
  setupDailyReportRoutes(app, botMap);
  
  // Initialize daily reports system
  initializeDailyReports();
  
  console.log('✅ All Neon webhook handlers configured successfully');
}

// ======================
// USAGE EXAMPLE
// ======================

/*
// In your main server.js file, replace the Firebase webhook handlers with:

const { setupNeonWebhooks } = require('./neon-webhook-integration');

// Setup all Neon webhook handlers
setupNeonWebhooks(app, botMap);

// Remove or comment out the old Firebase webhook handlers:
// app.post('/api/revotrend/webhook', ...)
// app.post('/api/shipguru/webhook', ...)
// app.post('/api/storeguru/webhook', ...)
// app.post("/api/daily-report/:companyId", ...)
// app.post('/api/daily-report/:companyId/trigger', ...)
*/

// ======================
// DATABASE SCHEMA REQUIREMENTS
// ======================

/*
The following database tables are required in your Neon PostgreSQL database:

1. contacts table:
   - company_id (text)
   - contact_id (text)
   - phone (text)
   - name (text)
   - email (text)
   - profile (jsonb)
   - tags (text[])
   - last_updated (timestamp)
   - additional_emails (text[])
   - address1 (text)
   - assigned_to (text)
   - business_id (text)
   - chat_id (text)
   - city (text)
   - company_name (text)
   - contact_name (text)
   - job_title (text)
   - monthly_shipments (text)
   - customer_message (text)
   - created_at (timestamp)
   - phone_index (integer)
   - thread_id (text)
   - form_submission (jsonb)
   - storage_requirements (jsonb)
   - services (text[])
   - message (text)

2. messages table:
   - company_id (text)
   - contact_id (text)
   - message_id (text)
   - content (text)
   - message_type (text)
   - from_me (boolean)
   - timestamp (bigint)
   - thread_id (text)
   - logs (jsonb)
   - tags (text[])
   - source (text)
   - status (text)
   - text_body (text)
   - phone_index (integer)

3. threads table:
   - company_id (text)
   - thread_id (text)
   - contact_id (text)
   - created_at (timestamp)
   - updated_at (timestamp)

4. settings table:
   - company_id (text)
   - setting_type (text)
   - setting_key (text)
   - value (jsonb)

5. phone_status table:
   - company_id (text)
   - phone_index (integer)
   - status (text)
   - details (jsonb)
   - updated_at (timestamp)

Required indexes:
- contacts: (phone, company_id) UNIQUE
- messages: (message_id, company_id) UNIQUE
- threads: (thread_id) UNIQUE
- settings: (company_id, setting_type, setting_key) UNIQUE
- phone_status: (company_id, phone_index) UNIQUE
*/

// ======================
// MIGRATION HELPER
// ======================

function getDatabaseSchema() {
  return `
-- Create contacts table
CREATE TABLE IF NOT EXISTS contacts (
  company_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  profile JSONB,
  tags TEXT[],
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  additional_emails TEXT[],
  address1 TEXT,
  assigned_to TEXT,
  business_id TEXT,
  chat_id TEXT,
  city TEXT,
  company_name TEXT,
  contact_name TEXT,
  job_title TEXT,
  monthly_shipments TEXT,
  customer_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  phone_index INTEGER DEFAULT 0,
  thread_id TEXT,
  form_submission JSONB,
  storage_requirements JSONB,
  services TEXT[],
  message TEXT,
  UNIQUE(phone, company_id)
);

-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
  company_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  content TEXT,
  message_type TEXT,
  from_me BOOLEAN DEFAULT false,
  timestamp BIGINT,
  thread_id TEXT,
  logs JSONB,
  tags TEXT[],
  source TEXT,
  status TEXT,
  text_body TEXT,
  phone_index INTEGER DEFAULT 0,
  UNIQUE(message_id, company_id)
);

-- Create threads table
CREATE TABLE IF NOT EXISTS threads (
  company_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(thread_id)
);

-- Create settings table
CREATE TABLE IF NOT EXISTS settings (
  company_id TEXT NOT NULL,
  setting_type TEXT NOT NULL,
  setting_key TEXT NOT NULL,
  value JSONB,
  UNIQUE(company_id, setting_type, setting_key)
);

-- Create phone_status table
CREATE TABLE IF NOT EXISTS phone_status (
  company_id TEXT NOT NULL,
  phone_index INTEGER NOT NULL,
  status TEXT,
  details JSONB,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, phone_index)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_contacts_company_phone ON contacts(company_id, phone);
CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON contacts(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_company_contact ON messages(company_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_threads_company ON threads(company_id);
CREATE INDEX IF NOT EXISTS idx_settings_company ON settings(company_id);
CREATE INDEX IF NOT EXISTS idx_phone_status_company ON phone_status(company_id);
`;
}

module.exports = {
  setupNeonWebhooks,
  getDatabaseSchema
}; 