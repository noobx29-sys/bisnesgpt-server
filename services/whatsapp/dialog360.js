const axios = require('axios');
const crypto = require('crypto');
const { pool } = require('../../db');

const API_BASE = 'https://waba-v2.360dialog.io';
const HUB_API = 'https://hub.360dialog.io/api/v2';

class Dialog360 {
  constructor() {
    this.partnerId = process.env.DIALOG360_PARTNER_ID;
    this.partnerToken = process.env.DIALOG360_PARTNER_TOKEN;
  }

  /**
   * Save onboarding data from frontend callback
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
        status = 'pending',
        connection_type = 'official',
        updated_at = NOW()
    `, [companyId, phoneIndex]);

    console.log(`[360dialog] Onboarded channel ${channelId} for company ${companyId}`);
    return { success: true };
  }

  /**
   * Handle webhook from 360dialog
   */
  async handleWebhook(body) {
    // Channel lifecycle events
    if (body.type === 'channel_created' || body.type === 'channel_updated') {
      await this.handleChannelEvent(body.data);
    }

    // Incoming messages
    if (body.messages) {
      await this.handleMessages(body);
    }

    // Message status updates
    if (body.statuses) {
      await this.handleStatuses(body);
    }
  }

  /**
   * Handle channel_created/channel_updated events
   */
  async handleChannelEvent(data) {
    const { channel_id, status, phone_number } = data;

    const config = await pool.query(
      'SELECT company_id, phone_index FROM phone_configs WHERE dialog360_channel_id = $1',
      [channel_id]
    );

    if (!config.rows[0]) {
      console.warn(`[360dialog] Unknown channel: ${channel_id}`);
      return;
    }

    const { company_id, phone_index } = config.rows[0];

    if (status === 'running') {
      console.log(`[360dialog] Channel ${channel_id} is running, generating API key...`);

      // Generate API key via Partner Hub
      const apiKey = await this.generateApiKey(channel_id);
      const encrypted = this.encrypt(apiKey);

      await pool.query(`
        UPDATE phone_configs SET
          api_key_encrypted = $1,
          display_phone_number = $2,
          status = 'ready',
          updated_at = NOW()
        WHERE company_id = $3 AND phone_index = $4
      `, [encrypted, phone_number, company_id, phone_index]);

      await pool.query(`
        UPDATE phone_status SET
          status = 'ready',
          details = $1,
          updated_at = NOW()
        WHERE company_id = $2 AND phone_index = $3
      `, [JSON.stringify({ displayPhoneNumber: phone_number }), company_id, phone_index]);

      // Broadcast to WebSocket clients
      if (typeof broadcastAuthStatus !== 'undefined') {
        broadcastAuthStatus(company_id, 'ready', null, phone_index, {
          connectionType: 'official',
          displayPhoneNumber: phone_number,
        });
      }

      console.log(`[360dialog] Channel ${channel_id} ready: ${phone_number}`);
    }
  }

  /**
   * Generate API key for a channel
   */
  async generateApiKey(channelId) {
    try {
      const res = await axios.post(
        `${HUB_API}/partners/${this.partnerId}/channels/${channelId}/api_keys`,
        {},
        {
          headers: {
            Authorization: `Bearer ${this.partnerToken}`,
          },
        }
      );
      return res.data.api_key;
    } catch (error) {
      console.error('[360dialog] Failed to generate API key:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Handle incoming messages from webhook
   */
  async handleMessages(body) {
    const { messages, contacts, metadata } = body;

    const config = await pool.query(
      'SELECT company_id, phone_index FROM phone_configs WHERE dialog360_channel_id = $1',
      [metadata?.phone_number_id]
    );

    if (!config.rows[0]) {
      console.warn('[360dialog] Unknown phone_number_id in webhook');
      return;
    }

    const { company_id, phone_index } = config.rows[0];

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
        content: msg.text?.body || msg[msg.type],
        contactName: contact?.profile?.name,
      };

      // Save to database using existing function
      if (typeof addMessageToPostgres !== 'undefined') {
        await addMessageToPostgres(messageData, company_id, msg.from, contact?.profile?.name, phone_index);
      }

      // Broadcast via WebSocket
      if (typeof broadcastNewMessageToCompany !== 'undefined') {
        broadcastNewMessageToCompany(company_id, messageData);
      }

      console.log(`[360dialog] Message received from ${msg.from}`);
    }
  }

  /**
   * Handle message status updates
   */
  async handleStatuses(body) {
    for (const status of body.statuses) {
      await pool.query(
        'UPDATE messages SET status = $1 WHERE external_id = $2',
        [status.status, status.id]
      );
      console.log(`[360dialog] Message ${status.id} status: ${status.status}`);
    }
  }

  /**
   * Send text message
   */
  async sendText(companyId, phoneIndex, to, text) {
    const config = await this.getConfig(companyId, phoneIndex);
    if (!config) throw new Error('Phone config not found');

    const apiKey = this.decrypt(config.api_key_encrypted);
    const phone = to.replace(/@.+/, '');

    try {
      const res = await axios.post(`${API_BASE}/messages`, {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: text },
      }, {
        headers: {
          'D360-API-KEY': apiKey,
          'Content-Type': 'application/json'
        },
      });

      return { id: res.data.messages[0].id, provider: 'official' };
    } catch (error) {
      console.error('[360dialog] Send text error:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Send media message
   */
  async sendMedia(companyId, phoneIndex, to, type, url, caption) {
    const config = await this.getConfig(companyId, phoneIndex);
    if (!config) throw new Error('Phone config not found');

    const apiKey = this.decrypt(config.api_key_encrypted);
    const phone = to.replace(/@.+/, '');

    const body = {
      messaging_product: 'whatsapp',
      to: phone,
      type,
      [type]: { link: url },
    };
    if (caption && ['image', 'video', 'document'].includes(type)) {
      body[type].caption = caption;
    }

    try {
      const res = await axios.post(`${API_BASE}/messages`, body, {
        headers: {
          'D360-API-KEY': apiKey,
          'Content-Type': 'application/json'
        },
      });

      return { id: res.data.messages[0].id, provider: 'official' };
    } catch (error) {
      console.error('[360dialog] Send media error:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Send template message
   */
  async sendTemplate(companyId, phoneIndex, to, name, lang, components = []) {
    const config = await this.getConfig(companyId, phoneIndex);
    if (!config) throw new Error('Phone config not found');

    const apiKey = this.decrypt(config.api_key_encrypted);
    const phone = to.replace(/@.+/, '');

    try {
      const res = await axios.post(`${API_BASE}/messages`, {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name,
          language: { code: lang },
          components
        },
      }, {
        headers: {
          'D360-API-KEY': apiKey,
          'Content-Type': 'application/json'
        },
      });

      return { id: res.data.messages[0].id, provider: 'official' };
    } catch (error) {
      console.error('[360dialog] Send template error:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get config from database
   */
  async getConfig(companyId, phoneIndex) {
    const result = await pool.query(
      'SELECT * FROM phone_configs WHERE company_id = $1 AND phone_index = $2',
      [companyId, phoneIndex]
    );
    return result.rows[0];
  }

  /**
   * Encrypt API key
   */
  encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      Buffer.from(process.env.ENCRYPTION_KEY, 'hex'),
      iv
    );
    const encrypted = cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${tag}:${encrypted}`;
  }

  /**
   * Decrypt API key
   */
  decrypt(data) {
    const [iv, tag, enc] = data.split(':');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(process.env.ENCRYPTION_KEY, 'hex'),
      Buffer.from(iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return decipher.update(enc, 'hex', 'utf8') + decipher.final('utf8');
  }
}

module.exports = new Dialog360();
