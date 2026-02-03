/**
 * Meta Direct WhatsApp Business Cloud API service
 * Direct integration with Meta's Graph API (no 360dialog middleman)
 */

const axios = require('axios');
const crypto = require('crypto');
const { pool } = require('../../config/database');
const broadcast = require('../../utils/broadcast');
const { handleNewMessagesTemplateWweb } = require('../../../bots/handleMessagesTemplateWweb');
// Note: templatesService is loaded lazily to avoid circular dependency

const GRAPH_API_VERSION = 'v24.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * Standalone decrypt function to avoid circular dependency issues
 * @param {string} data - Encrypted string (iv:tag:ciphertext)
 * @returns {string} - Decrypted text
 */
function decrypt(data) {
  const [iv, tag, enc] = data.split(':');
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return decipher.update(enc, 'hex', 'utf8') + decipher.final('utf8');
}

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

      // Update companies table to set v2 = true (Meta Cloud API)
      await pool.query(`
        UPDATE companies SET v2 = true, updated_at = NOW()
        WHERE company_id = $1
      `, [companyId]);

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
    console.log('🔔 [META DIRECT] Webhook received');

    // WhatsApp Cloud API format messages
    if (body.entry) {
      for (const entry of body.entry) {
        console.log('🔔 [META DIRECT] Processing entry:', entry.id);
        for (const change of entry.changes || []) {
          const field = change.field;
          const value = change.value;
          console.log('🔔 [META DIRECT] Change field:', field, 'has messages:', !!value?.messages, 'has statuses:', !!value?.statuses);

          // Standard messages webhook
          if (field === 'messages' || value?.messages) {
            console.log('🔔 [META DIRECT] Routing to handleMessages');
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

          const extractedContent = this.extractContent(msg);
          const textBody = msg.type === 'text' ? msg.text?.body : (typeof extractedContent === 'string' ? extractedContent : '');
          const isFromMe = msg.from !== contactId;

          const messageData = {
            // Core identifiers
            messageId: msg.id,
            externalId: msg.id,
            chat_id: `${contactId}@c.us`,
            chatId: `${contactId}@c.us`,

            // Message content
            message: textBody,
            messageContent: textBody,
            content: extractedContent,
            messageType: msg.type,
            type: msg.type,

            // Sender info
            from: msg.from,
            to: msg.to,
            phone: contactId,
            extractedNumber: contactId,
            fromMe: isFromMe,
            contactName: contactId,
            from_name: contactId,

            // Timestamps
            timestamp: parseInt(msg.timestamp) * 1000,

            // Provider info
            provider: 'meta_direct_history',
            phoneIndex: phone_index,
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

    const { company_id, phone_index = 0, display_phone_number } = config.rows[0];

    for (const msg of message_echoes || []) {
      const extractedContent = this.extractContent(msg);
      const textBody = msg.type === 'text' ? msg.text?.body : (typeof extractedContent === 'string' ? extractedContent : '');

      const messageData = {
        // Core identifiers
        messageId: msg.id,
        externalId: msg.id,
        chat_id: `${msg.to}@c.us`,
        chatId: `${msg.to}@c.us`,

        // Message content
        message: textBody,
        messageContent: textBody,
        content: extractedContent,
        messageType: msg.type,
        type: msg.type,

        // Sender info
        from: msg.from,
        to: msg.to,
        phone: msg.to,
        extractedNumber: msg.to,
        fromMe: true, // Messages echoed from WA Business App are always from the business
        contactName: msg.to,
        from_name: display_phone_number,

        // Timestamps
        timestamp: parseInt(msg.timestamp) * 1000,

        // Provider info
        provider: 'meta_direct_echo',
        phoneIndex: phone_index,
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
    console.log('📩 [META DIRECT] handleMessages called with body:', JSON.stringify(body, null, 2).slice(0, 500));

    const { messages, contacts, metadata } = body;

    if (!messages || messages.length === 0) {
      console.log('📩 [META DIRECT] No messages in body');
      return;
    }

    // Find config by phone number ID
    const phoneNumberId = metadata?.phone_number_id;
    console.log('📩 [META DIRECT] Looking for config with phone_number_id:', phoneNumberId);

    const config = await pool.query(
      'SELECT company_id, phone_index, display_phone_number FROM phone_configs WHERE meta_phone_number_id = $1',
      [phoneNumberId]
    );

    if (!config.rows[0]) {
      console.log('❌ [META DIRECT] No config found for meta phone_number_id:', phoneNumberId);
      // Log all configs for debugging
      const allConfigs = await pool.query('SELECT company_id, meta_phone_number_id, display_phone_number FROM phone_configs');
      console.log('📋 [META DIRECT] All configs:', allConfigs.rows);
      return;
    }

    const { company_id, phone_index, display_phone_number } = config.rows[0];
    console.log('✅ [META DIRECT] Found config - company:', company_id, 'phone_index:', phone_index);

    for (const msg of messages) {
      const contact = contacts?.find(c => c.wa_id === msg.from);
      
      // Update session window - customer has messaged, 24h window is now open
      try {
        const templatesService = require('./templatesService');
        await templatesService.updateCustomerSession(company_id, phone_index, msg.from);
        console.log('✅ [META DIRECT] Updated 24h session for:', msg.from);
      } catch (sessionError) {
        console.error('❌ [META DIRECT] Error updating session:', sessionError.message);
      }
      
      const extractedContent = this.extractContent(msg);
      const textBody = msg.type === 'text' ? msg.text?.body : (typeof extractedContent === 'string' ? extractedContent : '');

      const messageData = {
        // Core identifiers
        messageId: msg.id,
        externalId: msg.id,
        chat_id: `${msg.from}@c.us`,
        chatId: `${msg.from}@c.us`,

        // Message content (dc-crm expects these field names)
        message: textBody,
        messageContent: textBody,
        content: extractedContent,
        messageType: msg.type,
        type: msg.type,

        // Sender info
        from: msg.from,
        phone: msg.from,
        extractedNumber: msg.from,
        fromMe: false,
        contactName: contact?.profile?.name || msg.from,
        from_name: contact?.profile?.name || msg.from,

        // Timestamps
        timestamp: parseInt(msg.timestamp) * 1000, // Convert to milliseconds for JS

        // Provider info
        provider: 'meta_direct',
        phoneIndex: phone_index,
      };

      // Save message to database (import from your existing message handler)
      // await addMessageToPostgres(messageData, company_id, msg.from, contact?.profile?.name, phone_index);

      // Broadcast to frontend
      broadcast.newMessage(company_id, messageData);

      // Create a wwebjs-compatible message object for bot handler
      const chatId = `${msg.from}@c.us`;
      const contactName = contact?.profile?.name || msg.from;

      const wwebjsCompatibleMsg = {
        id: { _serialized: msg.id, id: msg.id },
        from: chatId,
        to: `${display_phone_number}@c.us`,
        body: msg.type === 'text' ? msg.text?.body : '',
        type: msg.type,
        timestamp: parseInt(msg.timestamp),
        hasMedia: ['image', 'video', 'audio', 'document', 'sticker'].includes(msg.type),
        _data: msg,
        // Mock getChat method (required by bot handler)
        getChat: async () => ({
          id: { _serialized: chatId },
          name: contactName,
          isGroup: false,
          sendStateTyping: async () => {},
          clearState: async () => {},
          markUnread: async () => {},
          sendSeen: async () => {},
        }),
        // Mock getContact method
        getContact: async () => ({
          id: { _serialized: chatId },
          number: msg.from,
          pushname: contactName,
          name: contactName,
          getProfilePicUrl: async () => '',
        }),
        // Mock reply method
        reply: async (content) => {
          // This will be handled by sendMessage in the client
          return { id: { _serialized: 'reply_' + Date.now() } };
        },
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
      const phoneNumberClean = display_phone_number.replace(/\D/g, ''); // Remove non-digits
      const mockClient = {
        info: {
          wid: {
            _serialized: `${phoneNumberClean}@c.us`,
            user: phoneNumberClean,
          }
        },
        sendMessage: async (chatId, content, options = {}) => {
          // Route through Meta Direct sendText or sendMedia
          if (typeof content === 'string') {
            const result = await self.sendText(company_id, phone_index, chatId, content);
            
            // Save the outgoing message to database and broadcast to frontend
            const recipientPhone = chatId.replace(/@.+/, '');
            const recipientPhoneWithPlus = recipientPhone.startsWith('+') ? recipientPhone : '+' + recipientPhone;
            const contactID = `${company_id}-${recipientPhone}`;
            
            const outgoingMessageData = {
              // Core identifiers
              messageId: result.id,
              externalId: result.id,
              chat_id: chatId,
              chatId: chatId,

              // Message content
              message: content,
              messageContent: content,
              content: content,
              messageType: 'text',
              type: 'text',

              // Sender info (fromMe = true for bot replies)
              from: display_phone_number,
              to: recipientPhone,
              phone: recipientPhoneWithPlus,
              extractedNumber: recipientPhoneWithPlus,
              fromMe: true,
              contactName: contact?.profile?.name || recipientPhone,
              from_name: display_phone_number,

              // Timestamps
              timestamp: Date.now(),

              // Provider info
              provider: 'meta_direct',
              phoneIndex: phone_index,
            };

            // Save to database
            try {
              await pool.query(`
                INSERT INTO messages (
                  company_id, contact_id, message_id, 
                  content, message_type, from_me, 
                  timestamp, phone_index
                ) VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7/1000.0), $8)
                ON CONFLICT (message_id, company_id) DO NOTHING
              `, [
                company_id,
                contactID,
                result.id,
                content,
                'text',
                true,
                Date.now(),
                phone_index
              ]);
              console.log('✅ [META DIRECT] Outgoing message saved to database');
            } catch (dbError) {
              console.error('❌ [META DIRECT] Error saving outgoing message to database:', dbError);
            }

            // Broadcast to frontend
            broadcast.newMessage(company_id, outgoingMessageData);

            return { id: { _serialized: result.id } };
          }
          // Handle MessageMedia objects (from MessageMedia.fromUrl)
          if (content && content.mimetype && content.data) {
            const mediaType = content.mimetype.startsWith('image/') ? 'image' :
                            content.mimetype.startsWith('video/') ? 'video' :
                            content.mimetype.startsWith('audio/') ? 'audio' : 'document';
            
            // If the MessageMedia has a URL property (set by bot handlers), use it directly
            if (content.url) {
              try {
                const caption = options.caption || '';
                const filename = content.filename || options.filename;
                const result = await self.sendMedia(company_id, phone_index, chatId, mediaType, content.url, caption, filename);
                
                // Save to database and broadcast
                const recipientPhone = chatId.replace(/@.+/, '');
                const recipientPhoneWithPlus = recipientPhone.startsWith('+') ? recipientPhone : '+' + recipientPhone;
                const contactID = `${company_id}-${recipientPhone}`;
                
                const outgoingMessageData = {
                  messageId: result.id,
                  externalId: result.id,
                  chat_id: chatId,
                  chatId: chatId,
                  message: caption || `[${mediaType}]`,
                  messageContent: caption || `[${mediaType}]`,
                  content: caption || `[${mediaType}]`,
                  messageType: mediaType,
                  type: mediaType,
                  from: display_phone_number,
                  to: recipientPhone,
                  phone: recipientPhoneWithPlus,
                  extractedNumber: recipientPhoneWithPlus,
                  fromMe: true,
                  contactName: contact?.profile?.name || recipientPhone,
                  from_name: display_phone_number,
                  timestamp: Date.now(),
                  provider: 'meta_direct',
                  phoneIndex: phone_index,
                  mediaUrl: content.url,
                };
                
                try {
                  await pool.query(`
                    INSERT INTO messages (
                      company_id, contact_id, message_id, 
                      content, message_type, from_me, 
                      timestamp, phone_index, media_url,
                      direction, status, chat_id, author, customer_phone
                    ) VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7/1000.0), $8, $9, $10, $11, $12, $13, $14)
                    ON CONFLICT (message_id, company_id) DO NOTHING
                  `, [
                    company_id,
                    contactID,
                    result.id,
                    caption || '',
                    mediaType,
                    true,
                    Date.now(),
                    phone_index,
                    content.url,
                    'outbound',
                    'delivered',
                    chatId,
                    contactID,
                    recipientPhoneWithPlus
                  ]);
                  console.log('✅ [META DIRECT] Outgoing media message saved to database:', result.id);
                } catch (dbError) {
                  console.error('❌ [META DIRECT] Error saving outgoing media message to database:', dbError);
                }
                
                broadcast.newMessage(company_id, outgoingMessageData);
                return { id: { _serialized: result.id } };
              } catch (mediaError) {
                console.error('❌ [META DIRECT] Error sending media via URL:', mediaError);
                throw mediaError;
              }
            }
            
            // Fallback: if only base64 data (no URL), we need to upload first
            // Meta API doesn't support base64 directly, so we need a URL
            console.error('❌ [META DIRECT] Media has no URL property. Meta API requires a publicly accessible URL.');
            console.error('❌ [META DIRECT] MessageMedia object received:', { 
              hasData: !!content.data, 
              mimetype: content.mimetype, 
              hasUrl: !!content.url,
              filename: content.filename 
            });
            throw new Error('Meta API requires a publicly accessible URL for media. Base64 upload not supported.');
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
        console.log('🤖 [META DIRECT] Calling bot handler with botName:', botName, 'phoneIndex:', phone_index);
        console.log('🤖 [META DIRECT] Message body:', wwebjsCompatibleMsg.body);
        await handleNewMessagesTemplateWweb(mockClient, wwebjsCompatibleMsg, botName, phone_index);
        console.log('🤖 [META DIRECT] Bot handler completed');
      } catch (error) {
        console.error('❌ [META DIRECT] Error in bot handler:', error.message);
        console.error('❌ [META DIRECT] Error stack:', error.stack);
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
   * @param {boolean} skipSessionCheck - Skip 24h window check (for bot auto-replies within session)
   * @returns {Promise<{id: string, provider: string}>}
   */
  async sendText(companyId, phoneIndex, to, text, skipSessionCheck = false) {
    const config = await this.getConfig(companyId, phoneIndex);
    const accessToken = this.decrypt(config.meta_access_token_encrypted);
    const phone = to.replace(/@.+/, '');

    // Check 24-hour session window (can be skipped for bot auto-replies)
    if (!skipSessionCheck) {
      const templatesService = require('./templatesService');
      const sessionWindow = await templatesService.checkSessionWindow(companyId, phoneIndex, phone);
      if (sessionWindow.requiresTemplate) {
        const error = new Error('TEMPLATE_REQUIRED');
        error.code = 'TEMPLATE_REQUIRED';
        error.details = {
          message: '24-hour messaging window has expired. You must use a message template to re-engage this contact.',
          lastCustomerMessage: sessionWindow.lastCustomerMessage,
          hoursExpired: sessionWindow.hoursRemaining < 0 ? Math.abs(sessionWindow.hoursRemaining) : 0
        };
        throw error;
      }
    }

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

    // Update business session timestamp
    try {
      const templatesService = require('./templatesService');
      await templatesService.updateBusinessSession(companyId, phoneIndex, phone);
    } catch (e) {
      console.warn('Warning: Could not update business session:', e.message);
    }

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
   * @param {string} filename - Optional filename (for documents)
   * @returns {Promise<{id: string, provider: string}>}
   */
  async sendMedia(companyId, phoneIndex, to, type, url, caption, filename) {
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
    if (filename && type === 'document') body[type].filename = filename;

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
    return decrypt(data); // Use standalone function
  }
}

// Export instance with standalone decrypt attached for circular dependency resolution
const metaDirectInstance = new MetaDirect();
metaDirectInstance.decrypt = decrypt; // Ensure decrypt is always available
module.exports = metaDirectInstance;
