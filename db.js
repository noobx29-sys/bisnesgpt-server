const { neon, neonConfig } = require("@neondatabase/serverless");
const { Pool } = require("pg");

// Configure Neon for WebSocket pooling
neonConfig.webSocketConstructor = require("ws");

// For direct SQL queries (single connection)
const sql = neon(process.env.DATABASE_URL);

// For connection pooling
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2000,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

// Helper function to execute SQL queries
async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

// Helper function to get a single row
async function getRow(text, params) {
  const result = await query(text, params);
  return result.rows[0];
}

// Helper function to get multiple rows
async function getRows(text, params) {
  const result = await query(text, params);
  return result.rows;
}

// Helper function to insert a row and return the inserted row
async function insertRow(text, params) {
  const result = await query(text, params);
  return result.rows[0];
}

// Helper function to update a row and return the updated row
async function updateRow(text, params) {
  const result = await query(text, params);
  return result.rows[0];
}

// Helper function to delete a row and return the deleted row
async function deleteRow(text, params) {
  const result = await query(text, params);
  return result.rows[0];
}

// Message operations
async function saveMessage(message) {
  const { company_id, contact_id, message_id, content, message_type, from_me, timestamp, thread_id, logs, tags } = message;
  const result = await insertRow(
    `INSERT INTO messages (company_id, contact_id, message_id, content, message_type, from_me, timestamp, thread_id, logs, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [company_id, contact_id, message_id, content, message_type, from_me, timestamp, thread_id, logs, tags]
  );
  return result;
}

async function getMessage(messageId, companyId) {
  return await getRow(
    'SELECT * FROM messages WHERE message_id = $1 AND company_id = $2',
    [messageId, companyId]
  );
}

async function updateMessage(messageId, companyId, updates) {
  const setClause = Object.keys(updates)
    .map((key, index) => `${key} = $${index + 3}`)
    .join(', ');
  const values = Object.values(updates);
  const result = await updateRow(
    `UPDATE messages SET ${setClause} WHERE message_id = $1 AND company_id = $2 RETURNING *`,
    [messageId, companyId, ...values]
  );
  return result;
}

async function deleteMessage(messageId, companyId) {
  return await deleteRow(
    'DELETE FROM messages WHERE message_id = $1 AND company_id = $2 RETURNING *',
    [messageId, companyId]
  );
}

// Contact operations
async function saveContact(contact) {
  const { company_id, contact_id, phone, name, email, profile, tags, last_updated } = contact;
  const result = await insertRow(
    `INSERT INTO contacts (company_id, contact_id, phone, name, email, profile, tags, last_updated)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (phone, company_id) DO UPDATE
     SET name = EXCLUDED.name,
         email = EXCLUDED.email,
         profile = EXCLUDED.profile,
         tags = EXCLUDED.tags,
         last_updated = EXCLUDED.last_updated
     RETURNING *`,
    [company_id, contact_id, phone, name, email, profile, tags, last_updated]
  );
  return result;
}

async function getContactByPhone(phone, companyId) {
  return await getRow(
    'SELECT * FROM contacts WHERE phone = $1 AND company_id = $2',
    [phone, companyId]
  );
}

async function getContactByEmail(email) {
  return await getRow(
    'SELECT * FROM contacts WHERE email = $1',
    [email]
  );
}

// Thread operations
async function saveThread(thread) {
  const { company_id, thread_id, contact_id, created_at, updated_at } = thread;
  const result = await insertRow(
    `INSERT INTO threads (company_id, thread_id, contact_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (thread_id) DO UPDATE
     SET updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [company_id, thread_id, contact_id, created_at, updated_at]
  );
  return result;
}

async function getThread(threadId) {
  return await getRow(
    'SELECT * FROM threads WHERE thread_id = $1',
    [threadId]
  );
}

// Phone status operations
async function updatePhoneStatus(companyId, phoneIndex, status, details = {}) {
  const result = await insertRow(
    `INSERT INTO phone_status (company_id, phone_index, status, details, updated_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (company_id, phone_index) DO UPDATE
     SET status = EXCLUDED.status,
         details = EXCLUDED.details,
         updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [companyId, phoneIndex, status, details]
  );
  return result;
}

async function getPhoneStatus(companyId, phoneIndex) {
  return await getRow(
    'SELECT * FROM phone_status WHERE company_id = $1 AND phone_index = $2',
    [companyId, phoneIndex]
  );
}

// Settings operations
async function saveSetting(companyId, settingType, settingKey, value) {
  const result = await insertRow(
    `INSERT INTO settings (company_id, setting_type, setting_key, value)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (company_id, setting_type, setting_key) DO UPDATE
     SET value = EXCLUDED.value
     RETURNING *`,
    [companyId, settingType, settingKey, value]
  );
  return result;
}

async function getSetting(companyId, settingType, settingKey) {
  return await getRow(
    'SELECT * FROM settings WHERE company_id = $1 AND setting_type = $2 AND setting_key = $3',
    [companyId, settingType, settingKey]
  );
}

module.exports = {
  query,
  getRow,
  getRows,
  insertRow,
  updateRow,
  deleteRow,
  saveMessage,
  getMessage,
  updateMessage,
  deleteMessage,
  saveContact,
  getContactByPhone,
  getContactByEmail,
  saveThread,
  getThread,
  updatePhoneStatus,
  getPhoneStatus,
  saveSetting,
  getSetting
}; 