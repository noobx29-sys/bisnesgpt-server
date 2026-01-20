/**
 * WhatsApp Web.js client management
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const path = require('path');

// Map of companyId -> array of wwebjs clients
const botMap = new Map();

/**
 * Create a new WhatsApp Web.js client
 * @param {string} companyId - Company ID
 * @param {number} phoneIndex - Phone index
 * @returns {Client} - WhatsApp Web.js client
 */
function create(companyId, phoneIndex) {
  return new Client({
    authStrategy: new LocalAuth({
      clientId: `${companyId}-phone${phoneIndex}`,
      dataPath: path.join(__dirname, '../../../.wwebjs_auth'),
    }),
    authTimeoutMs: 20000,
    takeoverOnConflict: true,
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
      ],
    },
  });
}

/**
 * Get a client from the bot map
 * @param {string} companyId - Company ID
 * @param {number} phoneIndex - Phone index (default 0)
 * @returns {Client|undefined} - WhatsApp client or undefined
 */
function get(companyId, phoneIndex = 0) {
  return botMap.get(companyId)?.[phoneIndex];
}

/**
 * Set a client in the bot map
 * @param {string} companyId - Company ID
 * @param {number} phoneIndex - Phone index
 * @param {Client} client - WhatsApp client
 */
function set(companyId, phoneIndex, client) {
  if (!botMap.has(companyId)) {
    botMap.set(companyId, []);
  }
  botMap.get(companyId)[phoneIndex] = client;
}

/**
 * Remove a client from the bot map
 * @param {string} companyId - Company ID
 * @param {number} phoneIndex - Phone index
 */
function remove(companyId, phoneIndex) {
  const clients = botMap.get(companyId);
  if (clients && clients[phoneIndex]) {
    clients[phoneIndex] = null;
  }
}

/**
 * Get all clients for a company
 * @param {string} companyId - Company ID
 * @returns {Client[]} - Array of clients
 */
function getAll(companyId) {
  return botMap.get(companyId) || [];
}

/**
 * Check if a client exists and is ready
 * @param {string} companyId - Company ID
 * @param {number} phoneIndex - Phone index
 * @returns {boolean} - Whether client is ready
 */
function isReady(companyId, phoneIndex = 0) {
  const client = get(companyId, phoneIndex);
  return client?.info?.wid ? true : false;
}

module.exports = { botMap, create, get, set, remove, getAll, isReady };
