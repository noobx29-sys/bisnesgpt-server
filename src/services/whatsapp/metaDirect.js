/**
 * Meta Direct WhatsApp Business Cloud API service
 * Direct integration with Meta's Graph API (no 360dialog middleman)
 */

const axios = require('axios');
const crypto = require('crypto');
const { pool } = require('../../config/database');
const broadcast = require('../../utils/broadcast');
const { handleNewMessagesTemplateWweb } = require('../../../bots/handleMessagesTemplateWweb');

const GRAPH_API_VERSION = 'v24.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

class MetaDirect {
  /**
   * Connect and verify Meta credentials
   * @param {string} companyId - Company ID
   * @param {number} phoneIndex - Phone index
   * @param {string} phoneNumberId - Meta phone number ID
   * @param {string} wabaId - WhatsApp Business Account ID
   * @param {string} accessToken - Permanent access token
   * @returns {Promise<{success: boolean, displayPhoneNumber: string}>}
   */
  async connect(companyId, phoneIndex, phoneNumberId, wabaId, accessToken) {
    try {
      // Verify credentials by fetching phone number info from Meta
      const phoneInfo = await this.verifyCredentials(phoneNumberId, accessToken);

      // Encrypt the access token
      const encrypted = this.encrypt(accessToken);

      // Save to database
      await pool.query(`
        INSERT INTO phone_configs (
          company_id, phone_index, connection_type,
          meta_phone_number_id, meta_waba_id, meta_access_token_encrypted,
          display_phone_number, status
        )
        VALUES ($1, $2, 'meta_direct', $3, $4, $5, $6, 'ready')
        ON CONFLICT (company_id, phone_index) DO UPDATE SET
          connection_type = 'meta_direct',
          meta_phone_number_id = $3,
          meta_waba_id = $4,
          meta_access_token_encrypted = $5,
          display_phone_number = $6,
          status = 'ready',
          updated_at = NOW()
      `, [companyId, phoneIndex, phoneNumberId, wabaId, encrypted, phoneInfo.display_phone_number]);

      // Update phone_status table
      await pool.query(`
        INSERT INTO phone_status (company_id, phone_index, status, connection_type)
        VALUES ($1, $2, 'ready', 'meta_direct')
        ON CONFLICT (company_id, phone_index) DO UPDATE SET
          status = 'ready', connection_type = 'meta_direct', updated_at = NOW()
      `, [companyId, phoneIndex]);

      // Broadcast via WebSocket
      broadcast.authStatus(companyId, 'ready', null, phoneIndex, {
        connectionType: 'meta_direct',
        displayPhoneNumber: phoneInfo.display_phone_number,
      });

      return {
        success: true,
        displayPhoneNumber: phoneInfo.display_phone_number,
        verifiedName: phoneInfo.verified_name,
      };
    } catch (error) {
      console.error('Meta Direct connect error:', error.response?.data || error.message);
      throw new Error(
        error.response?.data?.error?.message ||
        'Failed to verify credentials. Please check your Phone Number ID, WABA ID, and Access Token.'
      );
    }
  }

  /**
   * Verify credentials by fetching phone number info from Meta
   * @param {string} phoneNumberId - Phone number ID
   * @param {string} accessToken - Access token
   * @returns {Promise<{display_phone_number: string, verified_name: string}>}
   */
  async verifyCredentials(phoneNumberId, accessToken) {
    const res = await axios.get(
      `${GRAPH_API_BASE}/${phoneNumberId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { fields: 'display_phone_number,verified_name,quality_rating' },
      }
    );
    return res.data;
  }

  /**
   * Handle incoming webhook from Meta
   * @param {object} body - Webhook body (WhatsApp Cloud API format)
   */
  async handleWebhook(body) {
    // WhatsApp Cloud API format messages
    if (body.entry) {
      for (const entry of body.entry) {
        for (const change of entry.changes || []) {
          const field = change.field;
          const value = change.value;

          // Standard messages webhook
          if (field === 'messages' || value?.messages) {
            await this.handleMessages(value);
          }
          if (value?.statuses) {
            await this.handleStatuses(value);
          }

          // Coexistence webhooks (WhatsApp Business App onboarding)
          if (field === 'history') {
            await this.handleHistory(value);
          }
          if (field === 'smb_app_state_sync') {
            await this.handleSmbAppStateSync(value);
          }
          if (field === 'smb_message_echoes') {
            await this.handleSmbMessageEchoes(value);
          }
          if (field === 'account_update') {
            await this.handleAccountUpdate(value);
          }
        }
      }
      return;
    }

    // Direct format messages (fallback)
    if (body.messages) {
      await this.handleMessages(body);
    }

    // Status updates
    if (body.statuses) {
      await this.handleStatuses(body);
    }
  }

  /**
   * Handle history webhook (coexistence - message history sync)
   * @param {object} value - Webhook value
   */
  async handleHistory(value) {
    const { metadata, history } = value;
    const phoneNumberId = metadata?.phone_number_id;

    console.log('Received history webhook for phone:', phoneNumberId);

    // Find config by phone number ID
    const config = await pool.query(
      'SELECT company_id, phone_index FROM phone_configs WHERE meta_phone_number_id = $1',
      [phoneNumberId]
    );

    if (!config.rows[0]) {
      console.log('No config found for history webhook, phone_number_id:', phoneNumberId);
      return;
    }

    const { company_id, phone_index } = config.rows[0];

    for (const historyItem of history || []) {
      // Check for errors (e.g., business declined history sharing)
      if (historyItem.errors) {
        console.log('History sync error:', historyItem.errors);
        broadcast.newMessage(company_id, {
          type: 'system',
          content: `History sync: ${historyItem.errors[0]?.message || 'Error occurred'}`,
        });
        continue;
      }

      const { metadata: historyMeta, threads } = historyItem;
      console.log(`History sync phase ${historyMeta?.phase}, chunk ${historyMeta?.chunk_order}, progress ${historyMeta?.progress}%`);

      // Process each thread (conversation)
      for (const thread of threads || []) {
        const contactId = thread.id; // WhatsApp user phone number

        for (const msg of thread.messages || []) {
          // Skip media placeholders for now (separate webhook will have media details)
          if (msg.type === 'media_placeholder') continue;

          const messageData = {
            externalId: msg.id,
            provider: 'meta_direct_history',
            chatId: `${contactId}@c.us`,
            from: msg.from,
            to: msg.to,
            fromMe: msg.from !== contactId,
            timestamp: parseInt(msg.timestamp),
            type: msg.type,
            content: this.extractContent(msg),
            historyStatus: msg.history_context?.status,
          };

          // Broadcast to frontend for display
          broadcast.newMessage(company_id, messageData);
        }
      }

      // Notify progress
      if (historyMeta?.progress) {
        broadcast.newMessage(company_id, {
          type: 'system',
          content: `History sync: ${historyMeta.progress}% complete`,
        });
      }
    }
  }

  /**
   * Handle smb_app_state_sync webhook (coexistence - contacts sync)
   * @param {object} value - Webhook value
   */
  async handleSmbAppStateSync(value) {
    const { metadata, state_sync } = value;
    const phoneNumberId = metadata?.phone_number_id;

    console.log('Received smb_app_state_sync webhook for phone:', phoneNumberId);

    // Find config by phone number ID
    const config = await pool.query(
      'SELECT company_id, phone_index FROM phone_configs WHERE meta_phone_number_id = $1',
      [phoneNumberId]
    );

    if (!config.rows[0]) {
      console.log('No config found for state_sync webhook, phone_number_id:', phoneNumberId);
      return;
    }

    const { company_id } = config.rows[0];

    for (const syncItem of state_sync || []) {
      if (syncItem.type === 'contact') {
        const contact = syncItem.contact;
        const action = syncItem.action; // 'add' or 'remove'

        console.log(`Contact ${action}: ${contact?.full_name} (${contact?.phone_number})`);

        // Broadcast contact update to frontend
        broadcast.newMessage(company_id, {
          type: 'contact_sync',
          action,
          contact: {
            phoneNumber: contact?.phone_number,
            fullName: contact?.full_name,
            firstName: contact?.first_name,
          },
        });
      }
    }
  }

  /**
   * Handle smb_message_echoes webhook (messages sent via WhatsApp Business App)
   * @param {object} value - Webhook value
   */
  async handleSmbMessageEchoes(value) {
    const { metadata, message_echoes } = value;
    const phoneNumberId = metadata?.phone_number_id;

    console.log('Received smb_message_echoes webhook for phone:', phoneNumberId);

    // Find config by phone number ID
    const config = await pool.query(
      'SELECT company_id, phone_index, display_phone_number FROM phone_configs WHERE meta_phone_number_id = $1',
      [phoneNumberId]
    );

    if (!config.rows[0]) {
      console.log('No config found for message_echoes webhook, phone_number_id:', phoneNumberId);
      return;
    }

    const { company_id, display_phone_number } = config.rows[0];

    for (const msg of message_echoes || []) {
      const messageData = {
        externalId: msg.id,
        provider: 'meta_direct_echo',
        chatId: `${msg.to}@c.us`,
        from: msg.from,
        to: msg.to,
        fromMe: true, // Messages echoed from WA Business App are always from the business
        timestamp: parseInt(msg.timestamp),
        type: msg.type,
        content: this.extractContent(msg),
      };

      // Broadcast to frontend so the message shows in the conversation
      broadcast.newMessage(company_id, messageData);
    }
  }

  /**
   * Handle account_update webhook (e.g., partner removed)
   * @param {object} value - Webhook value
   */
  async handleAccountUpdate(value) {
    const { phone_number, event } = value;

    console.log('Received account_update webhook:', event, 'for phone:', phone_number);

    if (event === 'PARTNER_REMOVED') {
      // Business disconnected from Cloud API via WhatsApp Business App
      const config = await pool.query(
        'SELECT company_id, phone_index FROM phone_configs WHERE display_phone_number LIKE $1',
        [`%${phone_number}%`]
      );

      if (config.rows[0]) {
        const { company_id, phone_index } = config.rows[0];

        // Update status
        await pool.query(
          'UPDATE phone_configs SET status = $1 WHERE company_id = $2 AND phone_index = $3',
          ['disconnected', company_id, phone_index]
        );

        // Broadcast disconnection
        broadcast.authStatus(company_id, 'disconnected', null, phone_index, {
          reason: 'Business disconnected via WhatsApp Business App',
        });
      }
    }
  }

  /**
   * Handle incoming messages
   * @param {object} body - Message payload
   */
  async handleMessages(body) {
    const { messages, contacts, metadata } = body;

    // Find config by phone number ID
    const phoneNumberId = metadata?.phone_number_id;
    const config = await pool.query(
      'SELECT company_id, phone_index, display_phone_number FROM phone_configs WHERE meta_phone_number_id = $1',
      [phoneNumberId]
    );

    if (!config.rows[0]) {
      console.log('No config found for meta phone_number_id:', phoneNumberId);
      return;
    }

    const { company_id, phone_index, display_phone_number } = config.rows[0];

    for (const msg of messages) {
      const contact = contacts?.find(c => c.wa_id === msg.from);

      const messageData = {
        externalId: msg.id,
        provider: 'meta_direct',
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
        hasMedia: ['image', 'video', 'audio', 'document', 'sticker'].includes(msg.type),
        _data: msg,
        downloadMedia: async () => {
          // Download media from Meta API if message has media
          if (!wwebjsCompatibleMsg.hasMedia) return null;
          
          try {
            const mediaId = msg[msg.type]?.id;
            if (!mediaId) return null;

            // Get media URL from Meta
            const configData = await this.getConfig(company_id, phone_index);
            const accessToken = this.decrypt(configData.meta_access_token_encrypted);
            
            const mediaInfo = await axios.get(
              `${GRAPH_API_BASE}/${mediaId}`,
              { headers: { Authorization: `Bearer ${accessToken}` } }
            );

            const mediaUrl = mediaInfo.data.url;
            const mediaResponse = await axios.get(mediaUrl, {
              headers: { Authorization: `Bearer ${accessToken}` },
              responseType: 'arraybuffer',
            });

            return {
              data: Buffer.from(mediaResponse.data).toString('base64'),
              mimetype: mediaResponse.headers['content-type'],
              filename: msg[msg.type]?.filename || `media_${Date.now()}`,
            };
          } catch (error) {
            console.error('Error downloading media from Meta:', error);
            return null;
          }
        },
      };

      // Create mock client for Meta Direct (bot handlers expect wwebjs client)
      const self = this;
      const mockClient = {
        info: { wid: { _serialized: `${display_phone_number}@c.us` } },
        sendMessage: async (chatId, content, options = {}) => {
          // Route through Meta Direct sendText or sendMedia
          if (typeof content === 'string') {
            const result = await self.sendText(company_id, phone_index, chatId, content);
            return { id: { _serialized: result.id } };
          }
          // Handle MessageMedia objects
          if (content && content.mimetype && content.data) {
            const mediaType = content.mimetype.startsWith('image/') ? 'image' :
                            content.mimetype.startsWith('video/') ? 'video' :
                            content.mimetype.startsWith('audio/') ? 'audio' : 'document';
            
            // For now, we'll need to upload media to a URL first
            // This is a simplified version - you may need to implement media upload
            console.log('Media sending not fully implemented for Meta Direct yet');
            return { id: { _serialized: 'media_mock_id' } };
          }
          return { id: { _serialized: 'mock_id' } };
        },
        getContactById: async (contactId) => ({
          id: { _serialized: contactId },
          number: contactId.replace(/@.+/, ''),
          pushname: contact?.profile?.name || '',
          getProfilePicUrl: async () => '',
        }),
        getChatById: async (chatId) => ({
          id: { _serialized: chatId },
          name: contact?.profile?.name || chatId.replace(/@.+/, ''),
          sendStateTyping: async () => {},
          clearState: async () => {},
        }),
        pupPage: null, // Some bot functions check for this
      };

      // Call bot handler for AI auto-reply
      try {
        const botName = company_id; // Using company_id as bot identifier
        await handleNewMessagesTemplateWweb(mockClient, wwebjsCompatibleMsg, botName, phone_index);
      } catch (error) {
        console.error('Error in Meta Direct bot handler:', error);
        console.error('Error stack:', error.stack);
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
      case 'button':
        return msg.button?.text || '';
      case 'interactive':
        return msg.interactive;
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
    const accessToken = this.decrypt(config.meta_access_token_encrypted);
    const phone = to.replace(/@.+/, '');

    const res = await axios.post(
      `${GRAPH_API_BASE}/${config.meta_phone_number_id}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return { id: res.data.messages[0].id, provider: 'meta_direct' };
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
    const accessToken = this.decrypt(config.meta_access_token_encrypted);
    const phone = to.replace(/@.+/, '');

    const body = {
      messaging_product: 'whatsapp',
      to: phone,
      type,
      [type]: { link: url },
    };
    if (caption) body[type].caption = caption;

    const res = await axios.post(
      `${GRAPH_API_BASE}/${config.meta_phone_number_id}/messages`,
      body,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return { id: res.data.messages[0].id, provider: 'meta_direct' };
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
    const accessToken = this.decrypt(config.meta_access_token_encrypted);
    const phone = to.replace(/@.+/, '');

    const res = await axios.post(
      `${GRAPH_API_BASE}/${config.meta_phone_number_id}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: { name, language: { code: lang }, components },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return { id: res.data.messages[0].id, provider: 'meta_direct' };
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
    const accessToken = this.decrypt(config.meta_access_token_encrypted);
    const phone = to.replace(/@.+/, '');

    const res = await axios.post(
      `${GRAPH_API_BASE}/${config.meta_phone_number_id}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'interactive',
        interactive,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return { id: res.data.messages[0].id, provider: 'meta_direct' };
  }

  /**
   * Mark message as read
   * @param {string} companyId - Company ID
   * @param {number} phoneIndex - Phone index
   * @param {string} messageId - Message ID to mark as read
   */
  async markAsRead(companyId, phoneIndex, messageId) {
    const config = await this.getConfig(companyId, phoneIndex);
    const accessToken = this.decrypt(config.meta_access_token_encrypted);

    await axios.post(
      `${GRAPH_API_BASE}/${config.meta_phone_number_id}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
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

module.exports = new MetaDirect();
