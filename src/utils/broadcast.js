/**
 * WebSocket broadcast utilities
 */

// Map of companyId -> array of WebSocket connections
const clients = new Map();

/**
 * Broadcast message to all connections for a company
 * @param {string} companyId - Company ID
 * @param {string} type - Message type
 * @param {object} data - Message data
 */
function toCompany(companyId, type, data) {
  const list = clients.get(companyId) || [];
  const msg = JSON.stringify({ type, ...data });
  list.forEach(ws => ws.readyState === 1 && ws.send(msg));
}

/**
 * Broadcast auth status update
 * @param {string} companyId - Company ID
 * @param {string} status - Auth status
 * @param {string|null} qr - QR code (if applicable)
 * @param {number} phoneIndex - Phone index
 * @param {object} extra - Extra data
 */
function authStatus(companyId, status, qr, phoneIndex, extra = {}) {
  toCompany(companyId, 'auth_status', { status, qrCode: qr, phoneIndex, ...extra });
}

/**
 * Broadcast new message
 * @param {string} companyId - Company ID
 * @param {object} data - Message data
 */
function newMessage(companyId, data) {
  toCompany(companyId, 'new_message', data);
}

/**
 * Broadcast phone status update
 * @param {string} companyId - Company ID
 * @param {number} phoneIndex - Phone index
 * @param {string} status - Status
 * @param {object} extra - Extra data
 */
function phoneStatus(companyId, phoneIndex, status, extra = {}) {
  toCompany(companyId, 'phone_status', { phoneIndex, status, ...extra });
}

module.exports = { clients, toCompany, authStatus, newMessage, phoneStatus };
