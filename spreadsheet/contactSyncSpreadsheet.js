const { google } = require('googleapis');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

/**
 * ContactSyncSpreadsheet - Handles Google Sheets operations for contact sync
 * Manages upsert operations (insert or update) for contact data
 */
class ContactSyncSpreadsheet {
  constructor(spreadsheetId = null, sheetName = null) {
    this.spreadsheetId = spreadsheetId || process.env.CONTACTS_SHEET_ID;
    this.sheetName = sheetName || process.env.CONTACTS_SHEET_NAME || 'Contacts';

    if (!this.spreadsheetId) {
      throw new Error('CONTACTS_SHEET_ID is required. Set it in .env or pass as parameter.');
    }

    // Initialize Google Sheets API
    this.auth = new google.auth.GoogleAuth({
      keyFile: path.join(__dirname, '../service_account.json'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth: this.auth });

    console.log(`ContactSyncSpreadsheet initialized: ${this.spreadsheetId} / ${this.sheetName}`);
  }

  /**
   * Initialize or verify the sheet structure
   * Creates headers if sheet doesn't exist or is empty
   */
  async initializeSheet() {
    console.log('Initializing sheet structure...');

    try {
      // Check if sheet exists
      const spreadsheet = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });

      const sheet = spreadsheet.data.sheets.find(
        s => s.properties.title === this.sheetName
      );

      // If sheet doesn't exist, create it
      if (!sheet) {
        console.log(`Sheet "${this.sheetName}" not found, creating...`);
        await this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          resource: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: this.sheetName,
                  },
                },
              },
            ],
          },
        });
      }

      // Get current data to check if headers exist
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A1:L1`,
      });

      // If no headers, add them
      if (!response.data.values || response.data.values.length === 0) {
        console.log('Adding headers to sheet...');
        await this.addHeaders();
      } else {
        console.log('Sheet headers already exist');
      }

      return true;
    } catch (error) {
      console.error('Error initializing sheet:', error);
      throw error;
    }
  }

  /**
   * Add header row to the sheet
   */
  async addHeaders() {
    const headers = [
      'Phone Number',
      'Name',
      'Profile Pic URL',
      'Is Business',
      'Labels',
      'Total Messages',
      'Last Message Date',
      'First Contact Date',
      'Conversation Count',
      'Last Synced',
      'Created At',
      'Updated At'
    ];

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${this.sheetName}!A1:L1`,
      valueInputOption: 'RAW',
      resource: {
        values: [headers],
      },
    });

    // Format header row (bold, background color)
    const sheetId = await this.getSheetId();
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      resource: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true },
                  backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
                },
              },
              fields: 'userEnteredFormat(textFormat,backgroundColor)',
            },
          },
        ],
      },
    });

    console.log('Headers added successfully');
  }

  /**
   * Get sheet ID by sheet name
   */
  async getSheetId() {
    const spreadsheet = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
    });

    const sheet = spreadsheet.data.sheets.find(
      s => s.properties.title === this.sheetName
    );

    return sheet ? sheet.properties.sheetId : null;
  }

  /**
   * Get all existing contacts from the sheet
   * Returns a map of phone number to row index
   */
  async getExistingContacts() {
    console.log('Fetching existing contacts from sheet...');

    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A:A`,
      });

      const rows = response.data.values || [];
      const contactMap = new Map();

      // Skip header row (index 0)
      for (let i = 1; i < rows.length; i++) {
        const phoneNumber = rows[i][0];
        if (phoneNumber) {
          contactMap.set(phoneNumber, i + 1); // +1 because sheets are 1-indexed
        }
      }

      console.log(`Found ${contactMap.size} existing contacts in sheet`);
      return contactMap;
    } catch (error) {
      console.error('Error fetching existing contacts:', error);
      return new Map();
    }
  }

  /**
   * Convert contact object to row array
   */
  contactToRow(contact) {
    return [
      contact.phoneNumber,
      contact.name,
      contact.profilePicUrl,
      contact.isBusiness,
      contact.labels,
      contact.totalMessages,
      contact.lastMessageDate,
      contact.firstContactDate,
      contact.conversationCount,
      contact.lastSynced,
      contact.createdAt,
      new Date().toISOString() // Updated At
    ];
  }

  /**
   * Sync contacts to Google Sheets with upsert logic
   * @param {Array} contacts - Array of formatted contact objects
   * @returns {Object} Sync results
   */
  async syncContacts(contacts) {
    console.log(`Syncing ${contacts.length} contacts to Google Sheets...`);

    const results = {
      syncedCount: 0,
      updatedCount: 0,
      newCount: 0,
      errors: []
    };

    try {
      // Initialize sheet if needed
      await this.initializeSheet();

      // Get existing contacts
      const existingContacts = await this.getExistingContacts();

      // Prepare batch updates
      const updates = [];
      const newRows = [];

      for (const contact of contacts) {
        const phoneNumber = contact.phoneNumber;
        const rowData = this.contactToRow(contact);

        if (existingContacts.has(phoneNumber)) {
          // Update existing row
          const rowIndex = existingContacts.get(phoneNumber);
          updates.push({
            range: `${this.sheetName}!A${rowIndex}:L${rowIndex}`,
            values: [rowData],
          });
          results.updatedCount++;
        } else {
          // Add new row
          newRows.push(rowData);
          results.newCount++;
        }
      }

      // Execute batch updates for existing rows
      if (updates.length > 0) {
        console.log(`Updating ${updates.length} existing contacts...`);
        await this.batchUpdate(updates);
      }

      // Append new rows
      if (newRows.length > 0) {
        console.log(`Adding ${newRows.length} new contacts...`);
        await this.appendRows(newRows);
      }

      results.syncedCount = contacts.length;
      console.log('Contact sync to sheets completed successfully');

      return results;
    } catch (error) {
      console.error('Error syncing contacts to sheets:', error);
      results.errors.push(error.message);
      throw error;
    }
  }

  /**
   * Batch update multiple rows
   * @param {Array} updates - Array of update objects with range and values
   */
  async batchUpdate(updates) {
    const BATCH_SIZE = 100; // Google Sheets API limit

    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);

      try {
        await this.sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          resource: {
            valueInputOption: 'RAW',
            data: batch,
          },
        });

        console.log(`Batch updated ${Math.min(i + BATCH_SIZE, updates.length)}/${updates.length} contacts`);

        // Rate limiting - wait between batches
        if (i + BATCH_SIZE < updates.length) {
          await this.sleep(1000); // 1 second delay
        }
      } catch (error) {
        console.error(`Error in batch update (${i}-${i + BATCH_SIZE}):`, error);
        throw error;
      }
    }
  }

  /**
   * Append new rows to the sheet
   * @param {Array} rows - Array of row arrays
   */
  async appendRows(rows) {
    const BATCH_SIZE = 500; // Append can handle larger batches

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);

      try {
        await this.sheets.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
          range: `${this.sheetName}!A:L`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          resource: {
            values: batch,
          },
        });

        console.log(`Appended ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length} new contacts`);

        // Rate limiting
        if (i + BATCH_SIZE < rows.length) {
          await this.sleep(1000);
        }
      } catch (error) {
        console.error(`Error appending rows (${i}-${i + BATCH_SIZE}):`, error);
        throw error;
      }
    }
  }

  /**
   * Helper function to sleep/delay
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear all data from the sheet (except headers)
   */
  async clearSheet() {
    console.log('Clearing sheet data...');

    try {
      await this.sheets.spreadsheets.values.clear({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A2:L`,
      });

      console.log('Sheet cleared successfully');
      return true;
    } catch (error) {
      console.error('Error clearing sheet:', error);
      throw error;
    }
  }

  /**
   * Get sheet statistics
   */
  async getStats() {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A:A`,
      });

      const rows = response.data.values || [];
      const totalContacts = rows.length > 0 ? rows.length - 1 : 0; // Exclude header

      return {
        totalContacts,
        sheetName: this.sheetName,
        spreadsheetId: this.spreadsheetId
      };
    } catch (error) {
      console.error('Error getting sheet stats:', error);
      return {
        totalContacts: 0,
        error: error.message
      };
    }
  }
}

module.exports = ContactSyncSpreadsheet;
