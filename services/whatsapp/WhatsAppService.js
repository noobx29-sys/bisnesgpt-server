const dialog360 = require('./dialog360');
const { pool } = require('../../db');

class WhatsAppService {
  constructor(companyId, phoneIndex) {
    this.companyId = companyId;
    this.phoneIndex = phoneIndex;
    this.config = null;
  }

  /**
   * Load config from database
   */
  async load() {
    const result = await pool.query(
      'SELECT * FROM phone_configs WHERE company_id = $1 AND phone_index = $2',
      [this.companyId, this.phoneIndex]
    );
    this.config = result.rows[0];
    return this.config;
  }

  /**
   * Check if using official API
   */
  isOfficial() {
    return this.config?.connection_type === 'official';
  }

  /**
   * Send text message (routes to correct provider)
   */
  async sendText(chatId, text, opts = {}) {
    if (!this.config) await this.load();

    if (this.isOfficial()) {
      return dialog360.sendText(this.companyId, this.phoneIndex, chatId, text);
    }

    // Use existing wwebjs
    const client = global.botMap?.[this.companyId]?.[this.phoneIndex];
    if (!client) throw new Error('WhatsApp client not found');
    return client.sendMessage(chatId, text, opts);
  }

  /**
   * Send media message (routes to correct provider)
   */
  async sendMedia(chatId, type, url, caption, opts = {}) {
    if (!this.config) await this.load();

    if (this.isOfficial()) {
      return dialog360.sendMedia(this.companyId, this.phoneIndex, chatId, type, url, caption);
    }

    // Use existing wwebjs
    const client = global.botMap?.[this.companyId]?.[this.phoneIndex];
    if (!client) throw new Error('WhatsApp client not found');

    const { MessageMedia } = require('whatsapp-web.js');
    const media = await MessageMedia.fromUrl(url);
    return client.sendMessage(chatId, media, { caption, ...opts });
  }

  /**
   * Send template message (official API only)
   */
  async sendTemplate(chatId, name, lang, components = []) {
    if (!this.config) await this.load();

    if (this.isOfficial()) {
      return dialog360.sendTemplate(this.companyId, this.phoneIndex, chatId, name, lang, components);
    }

    throw new Error('Templates are not supported on wwebjs');
  }
}

/**
 * Factory function to create and load WhatsAppService
 */
async function getWhatsAppService(companyId, phoneIndex) {
  const service = new WhatsAppService(companyId, phoneIndex);
  await service.load();
  return service;
}

module.exports = { WhatsAppService, getWhatsAppService };
