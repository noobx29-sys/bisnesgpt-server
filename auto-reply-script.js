const { pool } = require('./db');

module.exports = {
  getStats: (companyId) => {
    console.log(`[AUTO-REPLY] getStats called for company ${companyId}`);
    return {
      totalChecked: 0,
      totalReplied: 0,
      lastCheck: null,
      message: 'Stats not yet implemented'
    };
  },

  checkUnrepliedMessages: async (companyId, hoursThreshold) => {
    console.log(`[AUTO-REPLY] checkUnrepliedMessages called for company ${companyId} with ${hoursThreshold} hours threshold`);
    return {
      success: false,
      message: 'Auto-reply functionality not yet implemented',
      checked: 0,
      replied: 0,
      errors: []
    };
  },

  testAutoReply: async (companyId, phoneNumber, hoursThreshold) => {
    console.log(`[AUTO-REPLY] testAutoReply called for company ${companyId}, phone ${phoneNumber} with ${hoursThreshold} hours threshold`);
    return {
      success: false,
      message: 'Auto-reply test functionality not yet implemented',
      phoneNumber,
      wouldReply: false
    };
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
