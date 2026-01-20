const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

/**
 * ContactSyncService - Handles syncing WhatsApp contacts to Google Sheets
 * Fetches all contacts with message statistics from the database
 */
class ContactSyncService {
  constructor(companyId, botMap) {
    this.companyId = companyId;
    this.botMap = botMap;

    // Initialize database pool
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    console.log(`ContactSyncService initialized for company: ${companyId}`);
  }

  /**
   * Get all contacts for the company with message statistics
   * @returns {Array} Array of contact objects with statistics
   */
  async getAllContactsWithStats() {
    console.log(`Fetching all contacts for company: ${this.companyId}`);

    try {
      const query = `
        SELECT
          c.contact_id,
          c.phone,
          c.name,
          c.contact_name,
          c.tags,
          c.profile,
          c.created_at,
          c.last_updated,
          COUNT(m.id) as total_messages,
          MAX(m.timestamp) as last_message_date,
          MIN(m.timestamp) as first_contact_date,
          COUNT(DISTINCT DATE(m.timestamp)) as conversation_count
        FROM contacts c
        LEFT JOIN messages m ON c.contact_id = m.contact_id AND c.company_id = m.company_id
        WHERE c.company_id = $1
        GROUP BY c.contact_id, c.phone, c.name, c.contact_name, c.tags, c.profile, c.created_at, c.last_updated
        ORDER BY c.last_updated DESC
      `;

      const result = await this.pool.query(query, [this.companyId]);
      console.log(`Found ${result.rows.length} contacts for company ${this.companyId}`);

      return result.rows;
    } catch (error) {
      console.error('Error fetching contacts with stats:', error);
      throw error;
    }
  }

  /**
   * Get WhatsApp client from botMap
   * @returns {Object} WhatsApp client instance
   */
  getWhatsAppClient() {
    const botData = this.botMap.get(this.companyId);

    if (!botData || !botData[0] || !botData[0].client) {
      throw new Error(`WhatsApp client not found for company ${this.companyId}`);
    }

    return botData[0].client;
  }

  /**
   * Fetch profile picture URL for a contact
   * @param {Object} client - WhatsApp client
   * @param {String} phoneNumber - Phone number with @c.us format
   * @returns {String} Profile picture URL or empty string
   */
  async getProfilePicUrl(client, phoneNumber) {
    try {
      // Format phone number to WhatsApp ID format
      const chatId = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;

      // Get profile picture URL
      const profilePicUrl = await client.getProfilePicUrl(chatId);
      return profilePicUrl || '';
    } catch (error) {
      // Profile picture might not be available for all contacts
      console.log(`No profile picture for ${phoneNumber}`);
      return '';
    }
  }

  /**
   * Check if contact is a business account
   * @param {Object} client - WhatsApp client
   * @param {String} phoneNumber - Phone number
   * @returns {Boolean} True if business account
   */
  async isBusinessAccount(client, phoneNumber) {
    try {
      const chatId = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;
      const contact = await client.getContactById(chatId);
      return contact.isBusiness || false;
    } catch (error) {
      console.log(`Error checking business status for ${phoneNumber}:`, error.message);
      return false;
    }
  }

  /**
   * Format contacts data for Google Sheets
   * @param {Array} contacts - Array of contact objects from database
   * @returns {Array} Formatted data for sheets
   */
  async formatContactsForSheets(contacts) {
    console.log('Formatting contacts for Google Sheets...');

    const formattedContacts = [];
    let client;

    try {
      // Try to get WhatsApp client for profile picture and business info
      client = this.getWhatsAppClient();
    } catch (error) {
      console.warn('WhatsApp client not available, skipping profile pics and business flags');
    }

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];

      // Extract phone number without country code prefix for WhatsApp ID
      let whatsappId = contact.phone;
      if (whatsappId.startsWith('+')) {
        whatsappId = whatsappId.slice(1);
      }

      let profilePicUrl = '';
      let isBusiness = false;

      // Try to get profile picture and business status if client is available
      if (client) {
        try {
          profilePicUrl = await this.getProfilePicUrl(client, whatsappId);
          isBusiness = await this.isBusinessAccount(client, whatsappId);
        } catch (error) {
          console.log(`Skipping WhatsApp metadata for ${contact.phone}: ${error.message}`);
        }
      }

      // Format tags as comma-separated string
      let tagsString = '';
      if (contact.tags && Array.isArray(contact.tags)) {
        tagsString = contact.tags.join(', ');
      }

      // Format dates
      const lastMessageDate = contact.last_message_date
        ? new Date(contact.last_message_date).toISOString()
        : '';
      const firstContactDate = contact.first_contact_date
        ? new Date(contact.first_contact_date).toISOString()
        : '';
      const createdAt = contact.created_at
        ? new Date(contact.created_at).toISOString()
        : '';
      const lastSynced = new Date().toISOString();

      formattedContacts.push({
        phoneNumber: contact.phone,
        name: contact.contact_name || contact.name || '',
        profilePicUrl,
        isBusiness: isBusiness ? 'Yes' : 'No',
        labels: tagsString,
        totalMessages: parseInt(contact.total_messages) || 0,
        lastMessageDate,
        firstContactDate,
        conversationCount: parseInt(contact.conversation_count) || 0,
        lastSynced,
        createdAt,
      });

      // Log progress every 50 contacts
      if ((i + 1) % 50 === 0) {
        console.log(`Processed ${i + 1}/${contacts.length} contacts`);
      }
    }

    console.log(`Formatted ${formattedContacts.length} contacts for sheets`);
    return formattedContacts;
  }

  /**
   * Main sync function - orchestrates the entire sync process
   * @param {Object} sheetsHandler - Google Sheets handler instance
   * @returns {Object} Sync results with statistics
   */
  async syncToSheets(sheetsHandler) {
    console.log('Starting contact sync to Google Sheets...');

    const startTime = Date.now();
    const results = {
      success: false,
      totalContacts: 0,
      syncedContacts: 0,
      updatedContacts: 0,
      newContacts: 0,
      errors: [],
      duration: 0
    };

    try {
      // Step 1: Fetch all contacts with statistics
      const contacts = await this.getAllContactsWithStats();
      results.totalContacts = contacts.length;

      if (contacts.length === 0) {
        console.log('No contacts found to sync');
        results.success = true;
        results.duration = Date.now() - startTime;
        return results;
      }

      // Step 2: Format contacts for sheets
      const formattedContacts = await this.formatContactsForSheets(contacts);

      // Step 3: Sync to Google Sheets
      const syncResult = await sheetsHandler.syncContacts(formattedContacts);

      results.syncedContacts = syncResult.syncedCount || formattedContacts.length;
      results.updatedContacts = syncResult.updatedCount || 0;
      results.newContacts = syncResult.newCount || 0;
      results.success = true;

      console.log('Contact sync completed successfully');
      console.log(`Total: ${results.totalContacts}, Synced: ${results.syncedContacts}, Updated: ${results.updatedContacts}, New: ${results.newContacts}`);

    } catch (error) {
      console.error('Error during contact sync:', error);
      results.errors.push(error.message);
      results.success = false;
    }

    results.duration = Date.now() - startTime;
    return results;
  }

  /**
   * Close database connections
   */
  async close() {
    await this.pool.end();
    console.log('ContactSyncService closed');
  }
}

module.exports = ContactSyncService;
