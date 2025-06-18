const { google } = require('googleapis');
const path = require('path');
const { Client } = require('whatsapp-web.js');
const util = require('util');
const moment = require('moment-timezone');
const fs = require('fs');
const cron = require('node-cron');
const OpenAI = require('openai');
const { v4: uuidv4 } = require('uuid');

const { URLSearchParams } = require('url');
const admin = require('../firebase.js');
const db = admin.firestore();

const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);

const openai = new OpenAI({
  apiKey: process.env.OPENAIKEY,
});

class constantcoSpreadsheet {
  constructor(botMap) {
    this.botName = '0148';
    this.spreadsheetId = '1zKAD7mAmBBOBn35wjMgFbnizMr9YOmARV4thbIW2ILU';
    this.botMap = botMap;
    
    // Define sheet configurations with starting rows
    this.sheetConfigs = {
      googleAds: {
        name: 'Google Ads sheet',
        range: 'Google Ads sheet!A14:C',  // Start from row 14
        mapping: {
          name: 0,
          phone: 1,
          email: 2,
          location:4,
          goal:5
        },
        startRow: 12
      },
      tikTokAds: {
        name: 'Tik Tok Ads 7 Weeks',
        range: 'Tik Tok Ads 7 Weeks!A33:E',  // Start from row 24
        mapping: {
          name: 0,
          email: 1,
          phone: 2,
          date: 3,
          location: 4,
          goal:8
        },
        startRow: 33
      },
      leadsFunnel: {
        name: '7 Weeks (LF)',
        range: '7 Weeks (LF)!A345:D',  // Start from row 289
        mapping: {
          name: 0,
          email: 1,
          phone: 2,
          date: 3,
          location:4,
          goal:6
        },
        startRow: 345
      }
    };

    this.DATA_FOLDER = path.join(__dirname, 'spreadsheetdata');
    if (!fs.existsSync(this.DATA_FOLDER)) {
      fs.mkdirSync(this.DATA_FOLDER);
    }

    this.auth = new google.auth.GoogleAuth({
      keyFile: './service_account.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
  }

  async checkAndProcessNewRows() {
    try {
      console.log(`Starting to check for new rows for bot ${this.botName}`);

      // Process each sheet
      for (const [sheetKey, sheetConfig] of Object.entries(this.sheetConfigs)) {
        console.log(`Processing sheet: ${sheetConfig.name}`);
        
        const response = await this.sheets.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range: sheetConfig.range,
        });

        const rows = response.data.values || [];
        if (rows.length <= 1) {
          console.log(`No data found in ${sheetConfig.name}`);
          continue;
        }

        // Get last processed row for this sheet from Firebase
        const lastProcessed = await this.getLastProcessedRow(sheetKey);
        const newRows = this.findNewRows(rows, lastProcessed, sheetConfig.mapping);

        console.log(`Found ${newRows.length} new rows in ${sheetConfig.name}`);

        // Process new rows
        for (const row of newRows) {
          await this.processRow(row, sheetKey);
        }

        // Update last processed row
        if (newRows.length > 0) {
          await this.updateLastProcessedRow(sheetKey, rows[rows.length - 1]);
        }
      }
    } catch (error) {
      console.error('Error processing spreadsheet:', error);
    }
  }

  async getLastProcessedRow(sheetKey) {
    try {
      const doc = await db.collection('spreadsheet_tracking')
        .doc(this.botName)
        .collection('sheets')
        .doc(sheetKey)
        .get();

      return doc.exists ? doc.data().lastRow : null;
    } catch (error) {
      console.error(`Error getting last processed row for ${sheetKey}:`, error);
      return null;
    }
  }

  async updateLastProcessedRow(sheetKey, row) {
    try {
      await db.collection('spreadsheet_tracking')
        .doc(this.botName)
        .collection('sheets')
        .doc(sheetKey)
        .set({
          lastRow: row,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
      console.error(`Error updating last processed row for ${sheetKey}:`, error);
    }
  }

  findNewRows(rows, lastProcessed, mapping) {
    if (!lastProcessed) {
      // If no last processed row, return all rows
      return rows;
    }

    const lastProcessedPhone = this.normalizePhoneNumber(lastProcessed[mapping.phone]);
    const newRows = [];
    
    // Start from bottom of sheet and work up until we find the last processed row
    for (let i = rows.length - 1; i >= 0; i--) {
      const currentPhone = this.normalizePhoneNumber(rows[i][mapping.phone]);
      if (currentPhone === lastProcessedPhone) {
        break;
      }
      newRows.unshift(rows[i]);
    }

    return newRows;
  }

  normalizePhoneNumber(phoneNumber) {
    if (!phoneNumber) return '';
    
    // Convert to string and remove any non-numeric characters
    let cleaned = phoneNumber.toString().replace(/\D/g, '');
    
    // Remove any leading '+' and ensure it starts with '60'
    if (cleaned.startsWith('60')) {
      return cleaned;
    } else if (cleaned.startsWith('0')) {
      return '60' + cleaned.substring(1);
    } else {
      return '60' + cleaned;
    }
  }
  async processRow(row, sheetKey) {
    const mapping = this.sheetConfigs[sheetKey].mapping;
    const phone = this.normalizePhoneNumber(row[mapping.phone]);
    const phoneWithPlus = '+' + phone;  // Add plus for storage
    const name = row[mapping.name];
    const email = row[mapping.email];
    const location = row[mapping.location] || null;
    const goal = row[mapping.goal] || null;
    // Add debug logging
    console.log('Processing row data:', {
      sheetKey,
      rowData: row,
      mapping,
      extractedData: { name, phoneWithPlus, email, location, goal }
    });

    // Create thread for the contact
    const thread = await this.createThread();
    const threadID = thread.id;
    await this.saveThreadIDFirebase(phone, threadID, this.botName);

    const formattedNumber = phone;

    // Create contact data
    const data = {
      additionalEmails: [email],
      address1: null,
      assignedTo: null,
      businessId: null,
      phone: phoneWithPlus,  // Store with plus
      tags: ['Lead'],
      chat: {
        contact_id: phone,  // No plus in chat fields
        id: `${phone}@c.us`,  // No plus in chat ID
        name: name || phoneWithPlus,
        not_spam: true,
        tags: ['Lead'],
        timestamp: Date.now(),
        type: 'contact',
        unreadCount: 0
      },
      chat_id: `${phone}@c.us`,  // No plus in chat ID
      city: null,
      companyName: null,
      contactName: name || phoneWithPlus,
      email: email,
      location: location,
      goal: goal,
      source: this.sheetConfigs[sheetKey].name,
      threadid: threadID,
      phoneIndex: 0,
      unreadCount: 0
    };

    // Save to Firebase with all fields
    await db.collection('companies')
    .doc(this.botName)
    .collection('contacts')
    .doc(phoneWithPlus)  // Use phone with plus but without additional plus
    .set({
      ...data,
      contactName: name,
      location: location,
      goal: goal,
      chat: {
        ...data.chat,
        name: name
      }
    }, { merge: true });

    console.log('Debug - Saved contact data:', {
      phone,
      name,
      location,
      goal,
      contactName: data.contactName,
      chatName: data.chat.name
    });
    // Send initial message
    try {
      const message = `Hi ${name}, Just wanted to check in and see how you're feeling lately. If you're still looking to find your journey to be pain free, stronger and better fitness, our team is here to help. 😊 What is your goal ya?`;
      
      // Get bot data array from map
      const botData = this.botMap.get(this.botName);
      if (!botData || !botData[0].client) {
        console.log(`WhatsApp client not found for bot ${this.botName}`);
        return;
      }
      const client = botData[0].client;

      await client.sendMessage(`${formattedNumber}@c.us`, message);
      console.log(`Sent initial message to ${name} (${phone})`);
    } catch (error) {
      console.error('Error sending initial message:', error);
    }

    // Trigger follow-up sequence
    try {
      const response = await fetch('https://mighty-dane-newly.ngrok-free.app/api/tag/followup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestType: 'startTemplate',
          phone: phone,
          first_name: name || phone,
          phoneIndex: 0,
          templateId: 'Mtl3jEqmmcD3RlHgI5Z1',
          idSubstring: this.botName
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      console.log(`Triggered follow-up sequence for ${name} (${phone})`);
    } catch (error) {
      console.error('Error triggering follow-up sequence:', error);
    }

    console.log(`Saved contact to Firebase: ${name} (${phone})`);
  }

  async createThread() {
    console.log('Creating a new thread...');
    const thread = await openai.beta.threads.create();
    return thread;
  }

  async saveThreadIDFirebase(contactID, threadID, idSubstring) {
    const docPath = `companies/${idSubstring}/contacts/${contactID}`;
    
    try {
      await db.doc(docPath).set({
        threadid: threadID
      }, { merge: true });
      console.log(`Thread ID saved to Firestore at ${docPath}`);
    } catch (error) {
      console.error('Error saving Thread ID to Firestore:', error);
    }
  }

  scheduleCheck(cronExpression) {
    cron.schedule(cronExpression, async () => {
      console.log(`Checking for new rows for bot ${this.botName}...`);
      await this.checkAndProcessNewRows();
    });
  }

  initialize() {
    // Run the check immediately when initialized
    this.checkAndProcessNewRows();

    // Schedule regular checks every 15 minutes
    this.scheduleCheck('*/15 * * * *');
  }
}

module.exports = constantcoSpreadsheet; 