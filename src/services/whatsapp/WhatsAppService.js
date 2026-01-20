/**
 * Unified WhatsApp Service
 * Abstracts wwebjs, 360dialog, and Meta Direct behind a common interface
 */

const dialog360 = require('./dialog360');
const metaDirect = require('./metaDirect');
const { get: getClient } = require('./client');
const { pool } = require('../../config/database');

class WhatsAppService {
  constructor(companyId, phoneIndex) {
    this.companyId = companyId;
    this.phoneIndex = phoneIndex;
    this.config = null;
  }

  /**
   * Load phone config from database
   */
  async load() {
    const r = await pool.query(
      'SELECT * FROM phone_configs WHERE company_id = $1 AND phone_index = $2',
      [this.companyId, this.phoneIndex]
    );
    this.config = r.rows[0];
  }

  /**
   * Check if using official API (360dialog)
   * @returns {boolean}
   */
  isOfficial() {
    return this.config?.connection_type === 'official';
  }

  /**
   * Check if using Meta Direct API
   * @returns {boolean}
   */
  isMetaDirect() {
    return this.config?.connection_type === 'meta_direct';
  }

  /**
   * Check if using wwebjs
   * @returns {boolean}
   */
  isWwebjs() {
    return !this.config || this.config.connection_type === 'wwebjs';
  }

  /**
   * Send text message
   * @param {string} chatId - Chat ID
   * @param {string} text - Message text
   * @param {object} opts - Options
   * @returns {Promise<object>} - Send result
   */
  async sendText(chatId, text, opts = {}) {
    if (!this.config) await this.load();

    if (this.isMetaDirect()) {
      return metaDirect.sendText(this.companyId, this.phoneIndex, chatId, text);
    }

    if (this.isOfficial()) {
      return dialog360.sendText(this.companyId, this.phoneIndex, chatId, text);
    }

    const client = getClient(this.companyId, this.phoneIndex);
    if (!client) throw new Error('WhatsApp client not found');
    const result = await client.sendMessage(chatId, text, opts);
    return { id: result.id._serialized, provider: 'wwebjs' };
  }

  /**
   * Send media message
   * @param {string} chatId - Chat ID
   * @param {string} type - Media type
   * @param {string|object} media - Media URL or MessageMedia object
   * @param {string} caption - Optional caption
   * @param {object} opts - Options
   * @returns {Promise<object>} - Send result
   */
  async sendMedia(chatId, type, media, caption, opts = {}) {
    if (!this.config) await this.load();

    if (this.isMetaDirect()) {
      const url = typeof media === 'string' ? media : media.url;
      return metaDirect.sendMedia(this.companyId, this.phoneIndex, chatId, type, url, caption);
    }

    if (this.isOfficial()) {
      const url = typeof media === 'string' ? media : media.url;
      return dialog360.sendMedia(this.companyId, this.phoneIndex, chatId, type, url, caption);
    }

    const client = getClient(this.companyId, this.phoneIndex);
    if (!client) throw new Error('WhatsApp client not found');

    const { MessageMedia } = require('whatsapp-web.js');
    let mediaObj = media;
    if (typeof media === 'string') {
      mediaObj = await MessageMedia.fromUrl(media);
    }
    const result = await client.sendMessage(chatId, mediaObj, { caption, ...opts });
    return { id: result.id._serialized, provider: 'wwebjs' };
  }

  /**
   * Send template message (official API only)
   * @param {string} chatId - Chat ID
   * @param {string} name - Template name
   * @param {string} lang - Language code
   * @param {array} components - Template components
   * @returns {Promise<object>} - Send result
   */
  async sendTemplate(chatId, name, lang, components = []) {
    if (!this.config) await this.load();

    if (this.isMetaDirect()) {
      return metaDirect.sendTemplate(this.companyId, this.phoneIndex, chatId, name, lang, components);
    }

    if (this.isOfficial()) {
      return dialog360.sendTemplate(this.companyId, this.phoneIndex, chatId, name, lang, components);
    }

    throw new Error('Templates are only supported on official WhatsApp API');
  }

  /**
   * Send interactive message (official API only)
   * @param {string} chatId - Chat ID
   * @param {object} interactive - Interactive object
   * @returns {Promise<object>} - Send result
   */
  async sendInteractive(chatId, interactive) {
    if (!this.config) await this.load();

    if (this.isMetaDirect()) {
      return metaDirect.sendInteractive(this.companyId, this.phoneIndex, chatId, interactive);
    }

    if (this.isOfficial()) {
      return dialog360.sendInteractive(this.companyId, this.phoneIndex, chatId, interactive);
    }

    // For wwebjs, convert to buttons if possible
    const client = getClient(this.companyId, this.phoneIndex);
    if (!client) throw new Error('WhatsApp client not found');

    if (interactive.type === 'button') {
      const { Buttons } = require('whatsapp-web.js');
      const buttons = new Buttons(
        interactive.body?.text || '',
        interactive.action?.buttons?.map(b => ({ body: b.reply?.title })) || [],
        interactive.header?.text,
        interactive.footer?.text
      );
      const result = await client.sendMessage(chatId, buttons);
      return { id: result.id._serialized, provider: 'wwebjs' };
    }

    throw new Error('This interactive type is not supported on wwebjs');
  }

  /**
   * Get chat by ID
   * @param {string} chatId - Chat ID
   * @returns {Promise<object>} - Chat object
   */
  async getChat(chatId) {
    if (!this.config) await this.load();

    if (this.isMetaDirect() || this.isOfficial()) {
      // Official API doesn't have chat objects
      return { id: chatId, isGroup: chatId.includes('@g.us') };
    }

    const client = getClient(this.companyId, this.phoneIndex);
    if (!client) throw new Error('WhatsApp client not found');
    return client.getChatById(chatId);
  }

  /**
   * Get contact by ID
   * @param {string} contactId - Contact ID
   * @returns {Promise<object>} - Contact object
   */
  async getContact(contactId) {
    if (!this.config) await this.load();

    if (this.isMetaDirect() || this.isOfficial()) {
      // Official API doesn't have contact objects
      const phone = contactId.replace(/@.+/, '');
      return { id: contactId, number: phone };
    }

    const client = getClient(this.companyId, this.phoneIndex);
    if (!client) throw new Error('WhatsApp client not found');
    return client.getContactById(contactId);
  }

  /**
   * Get connection status
   * @returns {Promise<string>} - Status
   */
  async getStatus() {
    if (!this.config) await this.load();

    if (this.isMetaDirect() || this.isOfficial()) {
      return this.config?.status || 'unknown';
    }

    const client = getClient(this.companyId, this.phoneIndex);
    if (!client) return 'disconnected';
    if (client.info?.wid) return 'ready';
    return 'connecting';
  }
}

/**
 * Get WhatsApp service instance (factory function)
 * @param {string} companyId - Company ID
 * @param {number} phoneIndex - Phone index
 * @returns {Promise<WhatsAppService>} - Service instance
 */
async function getService(companyId, phoneIndex = 0) {
  const svc = new WhatsAppService(companyId, phoneIndex);
  await svc.load();
  return svc;
}

module.exports = { WhatsAppService, getService };
