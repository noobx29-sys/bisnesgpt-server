const { query, getRow, getRows, insertRow, updateRow } = require('./neon-webhook-utils');

// ======================
// CONTACT OPERATIONS
// ======================

async function saveContact(contact) {
  const {
    company_id,
    contact_id,
    phone,
    name,
    email,
    profile,
    tags,
    last_updated,
    additional_emails,
    address1,
    assigned_to,
    business_id,
    chat_id,
    city,
    company_name,
    contact_name,
    job_title,
    monthly_shipments,
    customer_message,
    created_at,
    phone_index,
    thread_id,
    form_submission,
    storage_requirements,
    services,
    message
  } = contact;

  const result = await insertRow(
    `INSERT INTO contacts (
      company_id, contact_id, phone, name, email, profile, tags, last_updated,
      additional_emails, address1, assigned_to, business_id, chat_id, city,
      company_name, contact_name, job_title, monthly_shipments, customer_message,
      created_at, phone_index, thread_id, form_submission, storage_requirements,
      services, message
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
    ON CONFLICT (phone, company_id) DO UPDATE
    SET name = EXCLUDED.name,
        email = EXCLUDED.email,
        profile = EXCLUDED.profile,
        tags = EXCLUDED.tags,
        last_updated = EXCLUDED.last_updated,
        additional_emails = EXCLUDED.additional_emails,
        address1 = EXCLUDED.address1,
        assigned_to = EXCLUDED.assigned_to,
        business_id = EXCLUDED.business_id,
        chat_id = EXCLUDED.chat_id,
        city = EXCLUDED.city,
        company_name = EXCLUDED.company_name,
        contact_name = EXCLUDED.contact_name,
        job_title = EXCLUDED.job_title,
        monthly_shipments = EXCLUDED.monthly_shipments,
        customer_message = EXCLUDED.customer_message,
        phone_index = EXCLUDED.phone_index,
        thread_id = EXCLUDED.thread_id,
        form_submission = EXCLUDED.form_submission,
        storage_requirements = EXCLUDED.storage_requirements,
        services = EXCLUDED.services,
        message = EXCLUDED.message
    RETURNING *`,
    [
      company_id, contact_id, phone, name, email, profile, tags, last_updated,
      additional_emails, address1, assigned_to, business_id, chat_id, city,
      company_name, contact_name, job_title, monthly_shipments, customer_message,
      created_at, phone_index, thread_id, form_submission, storage_requirements,
      services, message
    ]
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

async function updateContact(phone, companyId, updates) {
  const setClause = Object.keys(updates)
    .map((key, index) => `${key} = $${index + 3}`)
    .join(', ');
  const values = Object.values(updates);
  const result = await updateRow(
    `UPDATE contacts SET ${setClause} WHERE phone = $1 AND company_id = $2 RETURNING *`,
    [phone, companyId, ...values]
  );
  return result;
}

// ======================
// MESSAGE OPERATIONS
// ======================

async function saveMessage(message) {
  const {
    company_id,
    contact_id,
    message_id,
    content,
    message_type,
    from_me,
    timestamp,
    thread_id,
    logs,
    tags,
    source,
    status,
    text_body,
    phone_index
  } = message;

  const result = await insertRow(
    `INSERT INTO messages (
      company_id, contact_id, message_id, content, message_type, from_me,
      timestamp, thread_id, logs, tags, source, status, text_body, phone_index
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (message_id, company_id) DO UPDATE
    SET content = EXCLUDED.content,
        message_type = EXCLUDED.message_type,
        from_me = EXCLUDED.from_me,
        timestamp = EXCLUDED.timestamp,
        thread_id = EXCLUDED.thread_id,
        logs = EXCLUDED.logs,
        tags = EXCLUDED.tags,
        source = EXCLUDED.source,
        status = EXCLUDED.status,
        text_body = EXCLUDED.text_body,
        phone_index = EXCLUDED.phone_index
    RETURNING *`,
    [
      company_id, contact_id, message_id, content, message_type, from_me,
      timestamp, thread_id, logs, tags, source, status, text_body, phone_index
    ]
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

// ======================
// THREAD OPERATIONS
// ======================

async function saveThread(thread) {
  const {
    company_id,
    thread_id,
    contact_id,
    created_at,
    updated_at
  } = thread;

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

// ======================
// SETTINGS OPERATIONS
// ======================

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

// ======================
// PHONE STATUS OPERATIONS
// ======================

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

// ======================
// STATISTICS OPERATIONS
// ======================

async function getContactsByChannel(companyId, startTimestamp, endTimestamp) {
  const result = await getRows(
    `SELECT 
      phone_index,
      contact_name,
      phone,
      tags,
      created_at
     FROM contacts 
     WHERE company_id = $1 
     AND created_at >= $2 
     AND created_at <= $3
     ORDER BY created_at DESC`,
    [companyId, startTimestamp, endTimestamp]
  );

  const stats = {
    revotrend: { count: 0, contacts: [] },
    storeguru: { count: 0, contacts: [] },
    shipguru: { count: 0, contacts: [] },
    total: 0
  };

  result.forEach(contact => {
    const phoneIndex = contact.phone_index || 0;
    let channel;

    if (phoneIndex === 0) {
      channel = 'revotrend';
    } else if (phoneIndex === 1 || phoneIndex === 3) {
      channel = 'storeguru';
    } else if (phoneIndex === 2) {
      channel = 'shipguru';
    }

    if (channel) {
      stats[channel].count++;
      stats[channel].contacts.push({
        contactName: contact.contact_name || 'Unknown',
        phoneNumber: contact.phone || contact.contact_id,
        tags: contact.tags || []
      });
      stats.total++;
    }
  });

  return stats;
}

module.exports = {
  saveContact,
  getContactByPhone,
  getContactByEmail,
  updateContact,
  saveMessage,
  getMessage,
  updateMessage,
  saveThread,
  getThread,
  saveSetting,
  getSetting,
  updatePhoneStatus,
  getPhoneStatus,
  getContactsByChannel
}; 