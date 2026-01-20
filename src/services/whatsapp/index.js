/**
 * WhatsApp services index
 */

const client = require('./client');
const dialog360 = require('./dialog360');
const { WhatsAppService, getService } = require('./WhatsAppService');

module.exports = {
  // wwebjs client management
  client,
  botMap: client.botMap,

  // 360dialog service
  dialog360,

  // Unified service
  WhatsAppService,
  getService,
};
