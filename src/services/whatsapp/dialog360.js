/**
 * 360dialog WhatsApp Business API service
 */

const axios = require('axios');
const crypto = require('crypto');
const { pool } = require('../../config/database');
const broadcast = require('../../utils/broadcast');
const { handleNewMessagesTemplateWweb } = require('../../../bots/handleMessagesFiraz');

const API_BASE = 'https://waba-v2.360dialog.io';
const HUB_API = 'https://hub.360dialog.io/api/v2';

class Dialog360 {
  /**
   * Save onboarding data from 360dialog Connect
   * @param {string} companyId - Company ID
   * @param {number} phoneIndex - Phone index
   * @param {string} clientId - 360dialog client ID
   * @param {string} channelId - 360dialog channel ID
   * @returns {Promise<{success: boolean}>}
   */
  async onboard(companyId, phoneIndex, clientId, channelId) {
    await pool.query(`
      INSERT INTO phone_configs (company_id, phone_index, connection_type, dialog360_client_id, dialog360_channel_id, status)
      VALUES ($1, $2, 'official', $3, $4, 'pending')
      ON CONFLICT (company_id, phone_index) DO UPDATE SET
        connection_type = 'official',
        dialog360_client_id = $3,
        dialog360_channel_id = $4,
        status = 'pending',
        updated_at = NOW()
    `, [companyId, phoneIndex, clientId, channelId]);

    await pool.query(`
      INSERT INTO phone_status (company_id, phone_index, status, connection_type)
      VALUES ($1, $2, 'pending', 'official')
      ON CONFLICT (company_id, phone_index) DO UPDATE SET
        status = 'pending', connection_type = 'official', updated_at = NOW()
    `, [companyId, phoneIndex]);

    return { success: true };
  }

  /**
   * Handle incoming webhook from 360dialog
   * @param {object} body - Webhook body
   */
  async handleWebhook(body) {
    // Channel events (from Partner Hub)
    if (body.type === 'channel_created' || body.type === 'channel_updated') {
      await this.handleChannelEvent(body.data);
      return;
    }

    // WhatsApp Cloud API format messages
    if (body.entry) {
      for (const entry of body.entry) {
        for (const change of entry.changes || []) {
          if (change.value?.messages) {
            await this.handleMessages(change.value);
          }
          if (change.value?.statuses) {
            await this.handleStatuses(change.value);
          }
        }
      }
      return;
    }

    // Direct format messages
    if (body.messages) {
      await this.handleMessages(body);
    }

    // Status updates
    if (body.statuses) {
      await this.handleStatuses(body);
    }
  }

  /**
   * Handle channel events (created/updated)
   * @param {object} data - Channel data
   */
  async handleChannelEvent(data) {
    const { channel_id, status, phone_number } = data;

    const config = await pool.query(
      'SELECT company_id, phone_index FROM phone_configs WHERE dialog360_channel_id = $1',
      [channel_id]
    );

    if (!config.rows[0]) return;

    const { company_id, phone_index } = config.rows[0];

    if (status === 'running') {
      // Generate API key for the channel
      const apiKey = await this.generateApiKey(channel_id);
      const encrypted = this.encrypt(apiKey);

      await pool.query(`
        UPDATE phone_configs SET api_key_encrypted = $1, display_phone_number = $2, status = 'ready', updated_at = NOW()
        WHERE company_id = $3 AND phone_index = $4
      `, [encrypted, phone_number, company_id, phone_index]);

      await pool.query(`
        UPDATE phone_status SET status = 'ready', details = $1, updated_at = NOW()
        WHERE company_id = $2 AND phone_index = $3
      `, [JSON.stringify({ displayPhoneNumber: phone_number }), company_id, phone_index]);

      // Broadcast via WebSocket
      broadcast.authStatus(company_id, 'ready', null, phone_index, {
        connectionType: 'official',
        displayPhoneNumber: phone_number,
      });
    }
  }

  /**
   * Generate API key for a channel via Partner Hub
   * @param {string} channelId - Channel ID
   * @returns {Promise<string>} - API key
   */
  async generateApiKey(channelId) {
    const res = await axios.post(
      `${HUB_API}/partners/${process.env.DIALOG360_PARTNER_ID}/channels/${channelId}/api_keys`,
      {},
      { headers: { Authorization: `Bearer ${process.env.DIALOG360_PARTNER_TOKEN}` } }
    );
    return res.data.api_key;
  }

  /**
   * Handle incoming messages
   * @param {object} body - Message payload
   */
  async handleMessages(body) {
    const { messages, contacts, metadata } = body;

    // Find config by phone number ID or channel ID
    const phoneNumberId = metadata?.phone_number_id;
    const config = await pool.query(
      'SELECT company_id, phone_index, display_phone_number FROM phone_configs WHERE dialog360_channel_id = $1 OR display_phone_number = $2',
      [phoneNumberId, phoneNumberId]
    );

    if (!config.rows[0]) {
      console.log('No config found for phone_number_id:', phoneNumberId);
      return;
    }

    const { company_id, phone_index, display_phone_number } = config.rows[0];

    for (const msg of messages) {
      const contact = contacts?.find(c => c.wa_id === msg.from);

      const messageData = {
        externalId: msg.id,
        provider: 'official',
        chatId: `${msg.from}@c.us`,
        from: msg.from,
        fromMe: false,
        timestamp: parseInt(msg.timestamp),
        type: msg.type,
        content: this.extractContent(msg),
        contactName: contact?.profile?.name,
      };

      // Save message to database (import from your existing message handler)
      // await addMessageToPostgres(messageData, company_id, msg.from, contact?.profile?.name, phone_index);

      // Broadcast to frontend
      broadcast.newMessage(company_id, messageData);

      // Create a wwebjs-compatible message object for bot handler
      const wwebjsCompatibleMsg = {
        id: { _serialized: msg.id, id: msg.id },
        from: `${msg.from}@c.us`,
        to: `${display_phone_number}@c.us`,
        body: msg.type === 'text' ? msg.text?.body : '',
        type: msg.type,
        timestamp: parseInt(msg.timestamp),
        hasMedia: ['image', 'video', 'audio', 'document'].includes(msg.type),
        _data: msg,
      };

      // Create mock client for 360dialog (bot handlers expect wwebjs client)
      const mockClient = {
        info: { wid: { _serialized: `${display_phone_number}@c.us` } },
        sendMessage: async (chatId, content, options = {}) => {
          // Route through 360dialog sendText
          if (typeof content === 'string') {
            return await this.sendText(company_id, phone_index, chatId, content);
          }
          return { id: { _serialized: 'mock_id' } };
        },
        getContactById: async (contactId) => ({
          id: { _serialized: contactId },
          number: contactId.replace(/@.+/, ''),
          pushname: contact?.profile?.name || '',
        }),
        getChatById: async (chatId) => ({
          id: { _serialized: chatId },
          name: contact?.profile?.name || chatId.replace(/@.+/, ''),
        }),
      };

      // Call bot handler for AI auto-reply
      try {
        const botName = company_id;
        await handleNewMessagesTemplateWweb(mockClient, wwebjsCompatibleMsg, botName, phone_index);
      } catch (error) {
        console.error('Error in 360dialog bot handler:', error);
        // Don't fail the webhook if bot handler fails
      }
    }
  }

  /**
   * Extract content from message based on type
   * @param {object} msg - Message object
   * @returns {string|object} - Extracted content
   */
  extractContent(msg) {
    switch (msg.type) {
      case 'text':
        return msg.text?.body || '';
      case 'image':
      case 'video':
      case 'audio':
      case 'document':
        return msg[msg.type];
      case 'location':
        return msg.location;
      case 'contacts':
        return msg.contacts;
      default:
        return msg[msg.type] || '';
    }
  }

  /**
   * Handle message status updates
   * @param {object} body - Status payload
   */
  async handleStatuses(body) {
    for (const s of body.statuses || []) {
      await pool.query(
        'UPDATE messages SET status = $1 WHERE external_id = $2',
        [s.status, s.id]
      );
    }
  }

  /**
   * Send text message
   * @param {string} companyId - Company ID
   * @param {number} phoneIndex - Phone index
   * @param {string} to - Recipient (WhatsApp ID or phone number)
   * @param {string} text - Message text
   * @returns {Promise<{id: string, provider: string}>}
   */
  async sendText(companyId, phoneIndex, to, text) {
    const config = await this.getConfig(companyId, phoneIndex);
    const apiKey = this.decrypt(config.api_key_encrypted);
    const phone = to.replace(/@.+/, '');

    const res = await axios.post(`${API_BASE}/messages`, {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: text },
    }, {
      headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' },
    });

    return { id: res.data.messages[0].id, provider: 'official' };
  }

  /**
   * Send media message
   * @param {string} companyId - Company ID
   * @param {number} phoneIndex - Phone index
   * @param {string} to - Recipient
   * @param {string} type - Media type (image, video, audio, document)
   * @param {string} url - Media URL
   * @param {string} caption - Optional caption
   * @returns {Promise<{id: string, provider: string}>}
   */
  async sendMedia(companyId, phoneIndex, to, type, url, caption) {
    const config = await this.getConfig(companyId, phoneIndex);
    const apiKey = this.decrypt(config.api_key_encrypted);
    const phone = to.replace(/@.+/, '');

    const body = {
      messaging_product: 'whatsapp',
      to: phone,
      type,
      [type]: { link: url },
    };
    if (caption) body[type].caption = caption;

    const res = await axios.post(`${API_BASE}/messages`, body, {
      headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' },
    });

    return { id: res.data.messages[0].id, provider: 'official' };
  }

  /**
   * Send template message
   * @param {string} companyId - Company ID
   * @param {number} phoneIndex - Phone index
   * @param {string} to - Recipient
   * @param {string} name - Template name
   * @param {string} lang - Language code
   * @param {array} components - Template components
   * @returns {Promise<{id: string, provider: string}>}
   */
  async sendTemplate(companyId, phoneIndex, to, name, lang, components = []) {
    const config = await this.getConfig(companyId, phoneIndex);
    const apiKey = this.decrypt(config.api_key_encrypted);
    const phone = to.replace(/@.+/, '');

    const res = await axios.post(`${API_BASE}/messages`, {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: { name, language: { code: lang }, components },
    }, {
      headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' },
    });

    return { id: res.data.messages[0].id, provider: 'official' };
  }

  /**
   * Send interactive message (buttons, list)
   * @param {string} companyId - Company ID
   * @param {number} phoneIndex - Phone index
   * @param {string} to - Recipient
   * @param {object} interactive - Interactive object
   * @returns {Promise<{id: string, provider: string}>}
   */
  async sendInteractive(companyId, phoneIndex, to, interactive) {
    const config = await this.getConfig(companyId, phoneIndex);
    const apiKey = this.decrypt(config.api_key_encrypted);
    const phone = to.replace(/@.+/, '');

    const res = await axios.post(`${API_BASE}/messages`, {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'interactive',
      interactive,
    }, {
      headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' },
    });

    return { id: res.data.messages[0].id, provider: 'official' };
  }

  /**
   * Mark message as read
   * @param {string} companyId - Company ID
   * @param {number} phoneIndex - Phone index
   * @param {string} messageId - Message ID to mark as read
   */
  async markAsRead(companyId, phoneIndex, messageId) {
    const config = await this.getConfig(companyId, phoneIndex);
    const apiKey = this.decrypt(config.api_key_encrypted);

    await axios.post(`${API_BASE}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    }, {
      headers: { 'D360-API-KEY': apiKey, 'Content-Type': 'application/json' },
    });
  }

  /**
   * Get phone config from database
   * @param {string} companyId - Company ID
   * @param {number} phoneIndex - Phone index
   * @returns {Promise<object>} - Phone config
   */
  async getConfig(companyId, phoneIndex) {
    const r = await pool.query(
      'SELECT * FROM phone_configs WHERE company_id = $1 AND phone_index = $2',
      [companyId, phoneIndex]
    );
    if (!r.rows[0]) {
      throw new Error(`No phone config found for ${companyId}:${phoneIndex}`);
    }
    return r.rows[0];
  }

  /**
   * Encrypt text using AES-256-GCM
   * @param {string} text - Text to encrypt
   * @returns {string} - Encrypted string (iv:tag:ciphertext)
   */
  encrypt(text) {
    const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
    return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt text using AES-256-GCM
   * @param {string} data - Encrypted string (iv:tag:ciphertext)
   * @returns {string} - Decrypted text
   */
  decrypt(data) {
    const [iv, tag, enc] = data.split(':');
    const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return decipher.update(enc, 'hex', 'utf8') + decipher.final('utf8');
  }
}

module.exports = new Dialog360();
