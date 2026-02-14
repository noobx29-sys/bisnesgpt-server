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
          
          // Get the bot client
          const botData = botMap.get(companyId);
          if (!botData || !botData[0] || !botData[0].client) {
            console.log(`[AUTO-REPLY] No active bot client found for ${companyId}`);
            return {
              success: false,
              message: `Bot not ready for ${companyId}. Cannot send reply.`,
              phoneNumber,
              wouldReply: true,
              reason: 'bot_not_ready',
              details: {
                messagesFound: messages.length,
                unrepliedCount: customerMessages.length,
                lastCustomerMessage: latestMessage.content?.substring(0, 100),
                lastCustomerMessageTime: latestMessage.timestamp
              }
            };
          }

          const whatsappClient = botData[0].client;
          const phoneIndex = 0; // Default to first phone

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

          // Process the message through the AI assistant
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
