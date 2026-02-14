const { pool } = require('./db');

module.exports = {
  getStats: async (companyId) => {
    console.log(`[AUTO-REPLY] getStats called for company ${companyId}`);
    try {
      const client = await pool.connect();
      try {
        // Get total unreplied count
        const unrepliedResult = await client.query(`
          WITH last_messages AS (
            SELECT contact_id, from_me, timestamp,
              ROW_NUMBER() OVER (PARTITION BY contact_id ORDER BY timestamp DESC) as rn
            FROM messages WHERE company_id = $1 AND timestamp >= NOW() - INTERVAL '24 hours'
          )
          SELECT COUNT(*) as count FROM last_messages WHERE rn = 1 AND from_me = false
        `, [companyId]);

        // Get auto-reply log count
        const repliedResult = await client.query(`
          SELECT COUNT(*) as count FROM auto_reply_log
          WHERE company_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'
        `, [companyId]);

        // Get last check time
        const lastCheckResult = await client.query(`
          SELECT MAX(created_at) as last_check FROM auto_reply_log WHERE company_id = $1
        `, [companyId]);

        return {
          totalChecked: parseInt(unrepliedResult.rows[0].count) || 0,
          totalReplied: parseInt(repliedResult.rows[0].count) || 0,
          lastCheck: lastCheckResult.rows[0]?.last_check || null,
          message: 'Stats retrieved successfully'
        };
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('[AUTO-REPLY] Error getting stats:', error);
      return { totalChecked: 0, totalReplied: 0, lastCheck: null, message: 'Error fetching stats' };
    }
  },

  checkUnrepliedMessages: async (companyId, hoursThreshold) => {
    console.log(`[AUTO-REPLY] checkUnrepliedMessages called for company ${companyId} with ${hoursThreshold} hours threshold`);
    try {
      const client = await pool.connect();
      try {
        const result = await client.query(`
          WITH last_messages AS (
            SELECT contact_id, from_me, timestamp,
              ROW_NUMBER() OVER (PARTITION BY contact_id ORDER BY timestamp DESC) as rn
            FROM messages WHERE company_id = $1
              AND timestamp >= NOW() - INTERVAL '${parseInt(hoursThreshold)} hours'
          )
          SELECT COUNT(*) as count FROM last_messages WHERE rn = 1 AND from_me = false
        `, [companyId]);

        const count = parseInt(result.rows[0].count) || 0;
        return {
          success: true,
          message: `Found ${count} unreplied contacts within ${hoursThreshold} hours`,
          checked: count,
          replied: 0,
          errors: []
        };
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('[AUTO-REPLY] Error checking unreplied:', error);
      return { success: false, message: error.message, checked: 0, replied: 0, errors: [error.message] };
    }
  },

  testAutoReply: async (companyId, phoneNumber, hoursThreshold, botMap, handleNewMessagesTemplateWweb) => {
    console.log(`[AUTO-REPLY] testAutoReply called for company ${companyId}, phone ${phoneNumber} with ${hoursThreshold} hours threshold`);
    try {
      const client = await pool.connect();
      try {
        // Normalize phone number - strip + for contact_id lookup
        const normalizedPhone = phoneNumber.replace(/^\+/, '');
        const contactId = companyId + '-' + normalizedPhone;

        // Find this contact's last messages
        const result = await client.query(`
          SELECT message_id, content, from_me, timestamp, contact_id
          FROM messages
          WHERE company_id = $1 AND contact_id = $2
            AND timestamp >= NOW() - INTERVAL '${parseInt(hoursThreshold)} hours'
          ORDER BY timestamp DESC
          LIMIT 10
        `, [companyId, contactId]);

        if (result.rows.length === 0) {
          return {
            success: true,
            message: `No messages found for ${phoneNumber} in the last ${hoursThreshold} hours`,
            phoneNumber,
            wouldReply: false,
            reason: 'no_messages',
            details: { messagesFound: 0 }
          };
        }

        const messages = result.rows;
        const latestMessage = messages[0];

        // Check if latest message is from customer (not from_me)
        if (latestMessage.from_me) {
          return {
            success: true,
            message: `Already replied to ${phoneNumber}. Last message was from bot.`,
            phoneNumber,
            wouldReply: false,
            reason: 'already_replied',
            details: {
              messagesFound: messages.length,
              lastMessageFrom: 'bot',
              lastMessageTime: latestMessage.timestamp,
              lastMessageContent: latestMessage.content?.substring(0, 100)
            }
          };
        }

        // Find when the last bot reply was
        const lastBotReply = messages.find(m => m.from_me);
        const customerMessages = messages.filter(m => !m.from_me);

        // Actually send the auto-reply using the same logic as setupMessageHandler
        if (botMap && handleNewMessagesTemplateWweb) {
          console.log(`[AUTO-REPLY] Attempting to send actual reply to ${phoneNumber}`);
          
          // Check if this is a Meta Direct company first
          const { Pool } = require('pg');
          const sqlPool = new Pool({ connectionString: process.env.NEON_DB_URL, ssl: { rejectUnauthorized: false } });
          
          let isMetaDirect = false;
          let phoneIndexToUse = 0;
          
          try {
            const phoneConfigResult = await sqlPool.query(
              'SELECT connection_type, phone_index FROM phone_configs WHERE company_id = $1 LIMIT 1',
              [companyId]
            );
            
            console.log(`[AUTO-REPLY] Phone config query result:`, phoneConfigResult.rows);
            
            if (phoneConfigResult.rows.length > 0) {
              const connectionType = phoneConfigResult.rows[0].connection_type;
              phoneIndexToUse = phoneConfigResult.rows[0].phone_index || 0;
              isMetaDirect = ['meta_direct', 'meta_embedded', '360dialog'].includes(connectionType);
              console.log(`[AUTO-REPLY] Company ${companyId} connection type: ${connectionType}, phoneIndex: ${phoneIndexToUse}, isMetaDirect: ${isMetaDirect}`);
            } else {
              console.log(`[AUTO-REPLY] No phone_configs found for company ${companyId}, assuming wwebjs`);
            }
          } catch (error) {
            console.error(`[AUTO-REPLY] Error checking connection type:`, error);
          }
          
          // For Meta Direct companies, we can proceed without a wwebjs client
          // For regular wwebjs, we need to check the botMap
          let whatsappClient = null;
          
          if (!isMetaDirect) {
            console.log(`[AUTO-REPLY] Checking botMap for wwebjs client...`);
            // Get the bot client for wwebjs
            const botData = botMap.get(companyId);
            if (!botData || !botData[0] || !botData[0].client) {
              console.log(`[AUTO-REPLY] No wwebjs client found in botMap for ${companyId}`);
              // Don't immediately fail - the bot might be Meta Direct but not detected
              // Let handleNewMessagesTemplateWweb decide if it can send via Meta API
              console.log(`[AUTO-REPLY] Will attempt to send via Meta Direct API as fallback`);
              isMetaDirect = true; // Treat as Meta Direct to proceed
              whatsappClient = null;
            } else {
              whatsappClient = botData[0].client;
              console.log(`[AUTO-REPLY] Found wwebjs client for ${companyId}`);
            }
          } else {
            console.log(`[AUTO-REPLY] Meta Direct bot detected for ${companyId}, skipping botMap check`);
          }

          const phoneIndex = phoneIndexToUse;

          // Create a mock message object that mimics what WhatsApp sends
          const mockMessage = {
            from: phoneNumber.includes('@') ? phoneNumber : `${normalizedPhone}@c.us`,
            body: latestMessage.content || '',
            fromMe: false,
            timestamp: Math.floor(new Date(latestMessage.timestamp).getTime() / 1000),
            type: 'chat',
            id: {
              _serialized: latestMessage.message_id || `mock_${Date.now()}`
            }
          };

          console.log(`[AUTO-REPLY] Sending message through handleNewMessagesTemplateWweb`, mockMessage);

          // For Meta Direct bots, send directly via Meta API instead of handleNewMessagesTemplateWweb
          // because handleNewMessagesTemplateWweb requires a valid wwebjs client for initial processing
          if (isMetaDirect) {
            console.log(`[AUTO-REPLY] Using Meta Direct API to send auto-reply`);
            try {
              const metaDirectModule = require('./src/services/whatsapp/metaDirect');
              const OpenAI = require('openai');
              
              // Get assistant ID for this company
              const assistantResult = await client.query(
                'SELECT assistant_ids FROM companies WHERE company_id = $1',
                [companyId]
              );
              
              if (!assistantResult.rows.length) {
                console.log(`[AUTO-REPLY] Company ${companyId} not found`);
                return {
                  success: false,
                  message: `Company ${companyId} not found`,
                  phoneNumber,
                  wouldReply: false,
                  reason: 'company_not_found'
                };
              }
              
              // Parse assistant_ids (can be array or JSON string)
              const assistantIds = assistantResult.rows[0].assistant_ids;
              let assistantId;
              if (Array.isArray(assistantIds)) {
                assistantId = assistantIds[phoneIndexToUse] || assistantIds[0];
              } else if (typeof assistantIds === 'string') {
                try {
                  const parsed = JSON.parse(assistantIds);
                  assistantId = Array.isArray(parsed) ? (parsed[phoneIndexToUse] || parsed[0]) : parsed;
                } catch {
                  assistantId = assistantIds;
                }
              }
              
              if (!assistantId) {
                console.log(`[AUTO-REPLY] No assistant ID found for ${companyId}`);
                return {
                  success: false,
                  message: `No AI assistant configured for company ${companyId}`,
                  phoneNumber,
                  wouldReply: false,
                  reason: 'no_assistant'
                };
              }
              
              console.log(`[AUTO-REPLY] Using assistant ID ${assistantId} for ${companyId}`);
              const openai = new OpenAI({ apiKey: process.env.OPENAIKEY });
              
              // Create a simple auto-reply message using OpenAI
              const thread = await openai.beta.threads.create();
              await openai.beta.threads.messages.create(thread.id, {
                role: 'user',
                content: latestMessage.content || 'hi'
              });
              
              const run = await openai.beta.threads.runs.create(thread.id, {
                assistant_id: assistantId
              });
              
              // Wait for completion
              let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
              let attempts = 0;
              while (runStatus.status !== 'completed' && attempts < 30) {
                if (runStatus.status === 'failed' || runStatus.status === 'cancelled' || runStatus.status === 'expired') {
                  throw new Error(`OpenAI run ${runStatus.status}`);
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
                runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
                attempts++;
              }
              
              if (runStatus.status !== 'completed') {
                throw new Error('OpenAI timeout');
              }
              
              // Get the response
              const messagesResponse = await openai.beta.threads.messages.list(thread.id);
              const aiMessages = messagesResponse.data.filter(m => m.role === 'assistant');
              
              if (aiMessages.length === 0) {
                throw new Error('No AI response');
              }
              
              const aiResponse = aiMessages[0].content[0].text.value;
              
              // Send via Meta Direct API
              const normalizedPhone = phoneNumber.replace(/^\+/, '').replace(/[^0-9]/g, '');
              const sendResult = await metaDirectModule.sendText(companyId, phoneIndexToUse, normalizedPhone, aiResponse, true);
              
              console.log(`[AUTO-REPLY] Successfully sent Meta Direct auto-reply to ${phoneNumber}`);
              
              // Save the bot's reply to messages table (same structure as handleMessagesTemplateWweb)
              const messageId = sendResult.id || `auto_reply_${Date.now()}`;
              const chatId = `${normalizedPhone}@c.us`;
              const timestamp = new Date();
              
              // Insert the outbound message with full structure like handleMessagesTemplateWweb
              await client.query(`
                INSERT INTO public.messages (
                  message_id, company_id, contact_id, thread_id, customer_phone,
                  content, message_type, media_url, timestamp, direction,
                  status, from_me, chat_id, author, quoted_message, media_data, media_metadata, phone_index
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                ON CONFLICT (message_id, company_id) DO NOTHING
              `, [
                messageId,
                companyId,
                contactId,
                chatId,
                phoneNumber,
                aiResponse,
                'chat',
                null,
                timestamp,
                'outbound',
                'delivered',
                true,
                chatId,
                contactId,
                null,
                null,
                null,
                phoneIndexToUse
              ]);
              
              // Update contact's last_message
              await client.query(`
                UPDATE public.contacts 
                SET last_message = $1, last_updated = CURRENT_TIMESTAMP
                WHERE contact_id = $2 AND company_id = $3
              `, [
                JSON.stringify({
                  chat_id: chatId,
                  from: chatId,
                  from_me: true,
                  id: messageId,
                  status: 'delivered',
                  text: { body: aiResponse },
                  timestamp: Math.floor(timestamp.getTime() / 1000),
                  type: 'chat',
                  phoneIndex: phoneIndexToUse
                }),
                contactId,
                companyId
              ]);
              
              // Log to auto_reply_log table
              await client.query(`
                INSERT INTO auto_reply_log (company_id, contact_id, phone_number, message_content, status, created_at)
                VALUES ($1, $2, $3, $4, 'sent', NOW())
              `, [companyId, contactId, phoneNumber, aiResponse]);
              
              console.log(`[AUTO-REPLY] Saved bot reply to messages, contacts, and auto_reply_log tables for ${phoneNumber}`);
              
              return {
                success: true,
                message: `✅ Auto-reply sent to ${phoneNumber} via Meta Direct`,
                phoneNumber,
                wouldReply: true,
                reason: 'reply_sent',
                details: {
                  messagesFound: messages.length,
                  unrepliedCount: customerMessages.length,
                  lastCustomerMessage: latestMessage.content?.substring(0, 100),
                  lastCustomerMessageTime: latestMessage.timestamp,
                  lastBotReplyTime: lastBotReply?.timestamp || null,
                  lastBotReplyContent: lastBotReply?.content?.substring(0, 100) || null,
                  aiResponse: aiResponse.substring(0, 100)
                }
              };
            } catch (metaError) {
              console.error(`[AUTO-REPLY] Meta Direct send failed:`, metaError);
              return {
                success: false,
                message: `Failed to send via Meta Direct: ${metaError.message}`,
                phoneNumber,
                wouldReply: true,
                reason: 'meta_send_failed',
                error: metaError.message
              };
            }
          }

          // For wwebjs bots, process the message through the AI assistant
          await handleNewMessagesTemplateWweb(whatsappClient, mockMessage, companyId, phoneIndex);

          return {
            success: true,
            message: `✅ Auto-reply sent to ${phoneNumber}`,
            phoneNumber,
            wouldReply: true,
            reason: 'reply_sent',
            details: {
              messagesFound: messages.length,
              unrepliedCount: customerMessages.length,
              lastCustomerMessage: latestMessage.content?.substring(0, 100),
              lastCustomerMessageTime: latestMessage.timestamp,
              lastBotReplyTime: lastBotReply?.timestamp || null,
              lastBotReplyContent: lastBotReply?.content?.substring(0, 100) || null
            }
          };
        }

        // Fallback if botMap or handler not provided (just check mode)
        return {
          success: true,
          message: `${phoneNumber} has ${customerMessages.length} unreplied message(s). Would trigger auto-reply.`,
          phoneNumber,
          wouldReply: true,
          reason: 'unreplied',
          details: {
            messagesFound: messages.length,
            unrepliedCount: customerMessages.length,
            lastCustomerMessage: latestMessage.content?.substring(0, 100),
            lastCustomerMessageTime: latestMessage.timestamp,
            lastBotReplyTime: lastBotReply?.timestamp || null,
            lastBotReplyContent: lastBotReply?.content?.substring(0, 100) || null
          }
        };
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('[AUTO-REPLY] Error testing auto-reply:', error);
      return {
        success: false,
        message: `Error testing auto-reply: ${error.message}`,
        phoneNumber,
        wouldReply: false,
        error: error.message
      };
    }
  },

  getUnrepliedMessages: async (companyId, hoursThreshold) => {
    console.log(`[AUTO-REPLY] getUnrepliedMessages called for company ${companyId} with ${hoursThreshold} hours threshold`);

    try {
      const client = await pool.connect();
      try {
        // Find contacts whose last message was from them (not from us) within the threshold
        const result = await client.query(`
          WITH last_messages AS (
            SELECT
              contact_id,
              message_id,
              content,
              from_me,
              timestamp,
              ROW_NUMBER() OVER (PARTITION BY contact_id ORDER BY timestamp DESC) as rn
            FROM messages
            WHERE company_id = $1
              AND timestamp >= NOW() - INTERVAL '${parseInt(hoursThreshold)} hours'
          )
          SELECT
            lm.contact_id,
            lm.message_id,
            lm.content,
            lm.timestamp,
            c.phone,
            c.name
          FROM last_messages lm
          LEFT JOIN contacts c ON c.contact_id = lm.contact_id AND c.company_id = $1
          WHERE lm.rn = 1
            AND lm.from_me = false
          ORDER BY lm.timestamp DESC
        `, [companyId]);

        const messages = result.rows.map(row => ({
          contactId: row.contact_id,
          messageId: row.message_id,
          content: row.content,
          timestamp: row.timestamp,
          phone: row.phone,
          name: row.name
        }));

        return {
          success: true,
          data: {
            messages,
            count: messages.length,
            hoursThreshold: parseInt(hoursThreshold)
          }
        };
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('[AUTO-REPLY] Error getting unreplied messages:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
};
