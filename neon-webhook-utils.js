const { neon, neonConfig } = require("@neondatabase/serverless");
const { Pool } = require("pg");
require('dotenv').config({ path: '.env' });

// Configure Neon for WebSocket pooling
neonConfig.webSocketConstructor = require("ws");

// For direct SQL queries (single connection)
const sql = neon(process.env.DATABASE_URL);

// For connection pooling
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 500,
  min: 5,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 10000,
  acquireTimeoutMillis: 30000,
  createTimeoutMillis: 10000,
  destroyTimeoutMillis: 5000,
  reapIntervalMillis: 1000,
  createRetryIntervalMillis: 100,
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

// ======================
// UTILITY FUNCTIONS
// ======================

function createRevotrendMessage(firstName) {
  return `Hello! Thank you for contacting Revotrend.

Please type:
1️⃣ English
2️⃣ Bahasa Malaysia
3️⃣ Simplified Chinese`;
}

function createRevotrendNotification(firstName, email, company, phone) {
  return `🆕 New Lead Alert!

👤 Contact Details:
• Name: ${firstName}
• Email: ${email}
• Phone: ${phone}
${company ? `• Company: ${company}` : ''}

💻 Source: Revotrend Website Form`;
}

function formatPhoneNumberShipguru(phone) {
  if (!phone) return '';
  
  // Convert to string and remove all non-numeric characters
  let formattedPhone = phone.toString().replace(/\D/g, '');
  
  // For Malaysian numbers:
  // If starts with '1', add '60' prefix
  if (formattedPhone.startsWith('1')) {
    formattedPhone = '60' + formattedPhone;
  }
  // If starts with '01', replace '0' with '6'
  else if (formattedPhone.startsWith('01')) {
    formattedPhone = '6' + formattedPhone;
  }
  // If starts with '+60', remove the '+'
  else if (formattedPhone.startsWith('60')) {
    // already in correct format
  }
  // For any other format, assume it needs '60' prefix
  else if (!formattedPhone.startsWith('60')) {
    formattedPhone = '60' + formattedPhone;
  }
  
  // Add '+' prefix
  return '+' + formattedPhone;
}

// Improved phone number formatting function
function formatPhoneNumber(phone) {
  if (!phone) return '';
  
  // Convert to string and remove all non-numeric characters and any '+' prefix
  let formattedPhone = phone.toString().replace(/\D/g, '');
  
  // For Malaysian numbers starting with '01', replace '0' with '60'
  if (formattedPhone.startsWith('01')) {
    formattedPhone = '6' + formattedPhone;
  }
  // For numbers that don't start with '60' or '6', add '60'
  else if (!formattedPhone.startsWith('60') && !formattedPhone.startsWith('6')) {
    formattedPhone = '60' + formattedPhone;
  }
  
  // Add '+' prefix
  const phoneWithPlus = '+' + formattedPhone;
  
  // Validate final phone number length for Malaysian numbers (should be 12-13 digits including country code)
  if (formattedPhone.length < 11 || formattedPhone.length > 12) {
    console.warn(`Warning: Potentially invalid Malaysian phone number length: ${formattedPhone}`);
  }
  
  return phoneWithPlus;
}

const retryOperation = async (operation, retries = 3, delay = 1000) => {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (error) {
      console.log(`Operation failed (attempt ${i + 1}/${retries}): ${error.message}`);
      lastError = error;
      if (i < retries - 1) {
        const backoffDelay = delay * Math.pow(2, i);
        console.log(`Retrying in ${backoffDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }
  }
  throw lastError;
};

function createShipGuruMessage() {
  return `Hello! Thank you for reaching out to ShipGuru. 

Please type a number to select your fulfillment type:
1️⃣ B2B (Business-to-Business)  
2️⃣ B2C (Business-to-Customer)`;
}

function createStoreGuruMessage() {
  return `Hello! Thank you for your interest in StoreGuru Storage Solutions.

Please type a number to select your preferred language:
1️⃣ English
2️⃣ Bahasa Malaysia
3️⃣ 中文`;
}

function createStoreGuruNotification(data) {
  const services = Array.isArray(data.services) ? data.services : [data.services];
  const additionalServices = services.filter(Boolean).join('\n• ');

  return `🆕 New Storage Inquiry!

👤 Contact Details:
• Name: ${data.salutation} ${data['first-name']} ${data['last-name']}
• Phone: ${data.phone}
• Email: ${data.email}

📦 Storage Requirements:
• Space Required: ${data['storage-space'] || 'Not specified'} sqft
• Duration: ${data['storage-duration'] || 'Not specified'}
• Location: ${data['store-location'] || 'Not specified'}

🚛 Moving Services:
• Lorry Size: ${data['lorry-size'] || 'Not specified'}
• Manpower: ${data.manpower || 'Not specified'}

📋 Additional Services:
${additionalServices ? '• ' + additionalServices : 'None requested'}

💬 Customer Message:
${data.message}

Source: StoreGuru Website Form`;
}

// Update notification message function to include date and time
function createNotificationMessage(firstName, lastName, companyName, phone, services, monthlyShipments, customerMessage, date, time) {
  return `🆕 New Lead from Shipguru Website Form!

👤 Contact Details:
• Name: ${firstName} ${lastName}
• Company: ${companyName}
• Phone: ${phone}
• Monthly Shipments: ${monthlyShipments}

📋 Services Interested:
${services.map(service => `• ${service}`).join('\n')}

💬 Customer Message:
${customerMessage || 'No message provided'}

📅 Submitted on: ${date} at ${time}`;
}

// Helper function to format channel details
function formatChannelDetails(title, contacts) {
  if (!contacts || contacts.length === 0) return '';
  return `${title}\n${contacts.map(c => 
      `- ${c.contactName} (${c.phoneNumber})`
  ).join('\n')}\n\n`;
}

module.exports = {
  query,
  getRow,
  getRows,
  insertRow,
  updateRow,
  deleteRow,
  createRevotrendMessage,
  createRevotrendNotification,
  formatPhoneNumberShipguru,
  formatPhoneNumber,
  retryOperation,
  createShipGuruMessage,
  createStoreGuruMessage,
  createStoreGuruNotification,
  createNotificationMessage,
  formatChannelDetails
}; 