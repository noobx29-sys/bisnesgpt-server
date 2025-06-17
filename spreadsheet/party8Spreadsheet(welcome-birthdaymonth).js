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

class party8SpreadsheetWBM {
  constructor(botMap) {
    this.botName = '0108';
    this.spreadsheetId = '1eKd-hwUbPGNEiDjDO5sCjAEKgivuWjZTMOezbi70h5U';
    this.dynamicSheetName = 'Sheet1';
    this.processedSheetName = 'processed_data';
    this.dynamicRange = `${this.dynamicSheetName}!A:C`;
    this.processedRange = `${this.processedSheetName}!A:C`;
    this.DATA_FOLDER = path.join(__dirname, 'spreadsheetdata');
    this.LAST_PROCESSED_ROW_FILE = path.join(this.DATA_FOLDER, `last_processed_row_${this.sheetName}.json`);
    this.botMap = botMap;

    this.auth = new google.auth.GoogleAuth({
      keyFile: './service_account.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
  }

  async checkAndProcessNewRows() {
    try {
      console.log(`Starting to check for new rows for bot ${this.botName}`);

      // Get data from the dynamic sheet
      const dynamicResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: this.dynamicRange,
      });

      const dynamicRows = dynamicResponse.data.values || [];

      if (dynamicRows.length === 0) {
        console.log('No data found in the dynamic spreadsheet.');
        return;
      }

      // Get data from the processed sheet
      const processedResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: this.processedRange,
      });

      const processedRows = processedResponse.data.values || [];

      // Find new rows
      const newRows = this.findNewRows(dynamicRows, processedRows);

      console.log(`Found ${newRows.length} new rows to process.`);

      // Process new rows
      for (const row of newRows) {
        await this.processRow(row);
      }

      // Add processed rows to the processed sheet
      if (newRows.length > 0) {
        await this.appendToProcessedSheet(newRows);
      }

    } catch (error) {
      console.error('Error processing spreadsheet:', error);
    }
  }

  findNewRows(dynamicRows, processedRows) {
    if (dynamicRows.length <= 1) {
        return []; // No data to process if dynamic sheet is empty or only has header
    }

    // Get the last processed mobile number and normalize it
    const lastProcessedMobile = processedRows.length > 0 ? this.normalizePhoneNumber(processedRows[processedRows.length - 1][0]) : null;

    const newRows = [];
    for (let i = 1; i < dynamicRows.length; i++) { // Start from 1 to skip header
        const mobile = this.normalizePhoneNumber(dynamicRows[i][0]);
        if (mobile !== lastProcessedMobile) {
            newRows.push(dynamicRows[i]);
        } else {
            break; // Stop processing once we reach the last processed mobile
        }
    }

    return newRows;
  }

  normalizePhoneNumber(phoneNumber) {
    // Remove any leading '+' and ensure it starts with '60'
    if (phoneNumber.startsWith('+')) {
      phoneNumber = phoneNumber.slice(1);
    }
    if (!phoneNumber.startsWith('60')) {
      phoneNumber = '60' + phoneNumber;
    }
    return phoneNumber;
  }

  async appendToProcessedSheet(rows) {
    // Reverse the order of the rows
    const reversedRows = rows.reverse();
  
    // Append the reversed rows to the processed sheet
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: this.processedRange,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: reversedRows
      }
    });
  
    console.log(`Appended ${rows.length} rows to the processed sheet.`);
  }

  async checkAndProcessBirthdaysForCurrentMonth() {
    try {
      console.log(`Checking birthdays for the current month for bot ${this.botName}`);

      const currentDate = moment().format('YYYY-MM');
      console.log(`Current month: ${currentDate}`);

      // Get data from the processed sheet
      const processedResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: this.processedRange,
      });

      const processedRows = processedResponse.data.values || [];

      if (processedRows.length === 0) {
        console.log('No data found in the processed spreadsheet.');
        return;
      }

      // Skip the header row
      for (let i = 1; i < processedRows.length; i++) {
        const row = processedRows[i];
        const [Mobile, Name, Dob] = row;

        if (Dob && Dob.startsWith(currentDate)) {
          console.log(`Found birthday match: ${Name} (${Mobile})`);
          await this.processRow(row);
        }
      }

      console.log('Finished processing birthdays for the current month.');
    } catch (error) {
      console.error('Error processing birthdays for the current month:', error);
    }
  }

  async processRow(row) {
    const [
      Mobile,
      Name,
      Dob,
    ] = row;

    const message = `Hi ${Name},

Welcome to the Party8 family! 🎊 We're thrilled to have you on board. Explore our innovative product range, including:

•        Vitamin Stick: The world's first hangover relief stick, available in refreshing flavors like Pink Lemonade and Watermelon Ice.
•        Hangover Recovery Aid: Perfect for faster recovery and staying refreshed after a great night out!

🌟 Why Party8?

•        Nicotine-Free & Alcohol-Free
•        Packed with natural ingredients for wellness and energy
* A healthier alternative to smoking and vaping

Your healthier lifestyle journey starts now. Don't forget to check out our exclusive offers on www.party8.my!

Feel free to reach out if you need any assistance. We're here to help!

Cheers,
Team Party8`;

  
    console.log(`Processing row: ${Name} (${Mobile})`);
    const thread = await this.createThread();
    let threadID = thread.id;
    await this.saveThreadIDFirebase(Mobile, threadID, this.botName)
    const formattedNumber = Mobile.slice(1);
    const data = {
      additionalEmails: [],
      address1: null,
      assignedTo: null,
      businessId: null,
      phone: Mobile,
      tags: ['blasted'],
      chat: {
          contact_id: Mobile,
          id: formattedNumber + '@c.us',
          name: Name || Mobile,
          not_spam: true,
          tags: ['blasted'],
          timestamp: Date.now(),
          type: 'contact',
          unreadCount: 0,
          last_message: {
              chat_id: path.formattedNumber +'@c.us',
              from: "",
              from_me: true,
              id: "",
              source: "",
              status: "delivered",
              text: {
                  body: message ?? ""
              },
              timestamp: Date.now(),
              type:'text',
          },
      },
      chat_id: formattedNumber + '@c.us',
      city: null,
      companyName: null,
      contactName: Name || Mobile,
      unreadCount: 0,
      threadid: threadID ?? "",
      phoneIndex: 0,
      last_message: {
          chat_id: formattedNumber + '@c.us',
          from: "",
          from_me: true,
          id: "",
          source: "",
          status: "delivered",
          text: {
              body: message ?? ""
          },
          timestamp: Date.now() ?? 0,
          type: 'text',
      },
  };
  await db.collection('companies').doc(this.botName).collection('contacts').doc(Mobile).set(data, {merge: true});    

    const botData = this.botMap.get(this.botName);
    if (!botData || !botData[0].client) {
      console.log(`WhatsApp client not found for bot ${this.botName}`);
      return;
    }
    const client = botData[0].client;
  
    // Construct the message
  
    // Send the message to the phone number from the row
    try {
      const sentMessage = await client.sendMessage(`${formattedNumber}@c.us`, message);
      console.log(`Message sent to ${Name} (${Mobile})`);
      await this.addMessagetoFirebase(sentMessage, this.botName, Mobile);
    } catch (error) {
      console.error(`Error sending message to ${Name} (${Mobile}):`, error);
    }
  }

  async getContactDataFromDatabaseByPhone(phoneNumber, idSubstring) {
    try {
        // Check if phoneNumber is defined
        if (!phoneNumber) {
            throw new Error("Phone number is undefined or null");
        }

        // Initial fetch of config
        //await fetchConfigFromDatabase(idSubstring);

        let threadID;
        let contactName;
        let bot_status;
        const contactsRef = db.collection('companies').doc(idSubstring).collection('contacts');
        const querySnapshot = await contactsRef.where('phone', '==', phoneNumber).get();

        if (querySnapshot.empty) {
            console.log('No matching documents.');
            return null;
        } else {
            const doc = querySnapshot.docs[0];
            const contactData = doc.data();
            contactName = contactData.name;
            threadID = contactData.thread_id;
            bot_status = contactData.bot_status;
            return { ...contactData};
        }
    } catch (error) {
        console.error('Error fetching or updating document:', error);
        throw error;
    }
  }

  async saveThreadIDFirebase(contactID, threadID, idSubstring) {
      
    // Construct the Firestore document path
    const docPath = `companies/${idSubstring}/contacts/${contactID}`;

    try {
        await db.doc(docPath).set({
            threadid: threadID
        }, { merge: true }); // merge: true ensures we don't overwrite the document, just update it
        console.log(`Thread ID saved to Firestore at ${docPath}`);
    } catch (error) {
        console.error('Error saving Thread ID to Firestore:', error);
    }
  }
  async addMessagetoFirebase(msg, idSubstring, extractedNumber){
    console.log('Adding message to Firebase');
    console.log('idSubstring:', idSubstring);
    console.log('extractedNumber:', extractedNumber);

    if (!extractedNumber) {
        console.error('Invalid extractedNumber for Firebase document path:', extractedNumber);
        return;
    }

    if (!idSubstring) {
        console.error('Invalid idSubstring for Firebase document path');
        return;
    }
    let messageBody = msg.body;
    let audioData = null;
    let type = '';
    if(msg.type === 'chat'){
        type ='text'
      }else{
        type = msg.type;
      }
    if (msg.hasMedia && msg.type === 'audio') {
        console.log('Voice message detected');
        const media = await msg.downloadMedia();
        const transcription = await transcribeAudio(media.data);
        console.log('Transcription:', transcription);
                
        messageBody = transcription;
        audioData = media.data;
        console.log(msg);
    }
    const messageData = {
        chat_id: msg.from,
        from: msg.from ?? "",
        from_me: msg.fromMe ?? false,
        id: msg.id._serialized ?? "",
        status: "delivered",
        text: {
            body: messageBody ?? ""
        },
        timestamp: msg.timestamp ?? 0,
        type: type,
    };

    if((msg.from).includes('@g.us')){
        const authorNumber = '+'+(msg.author).split('@')[0];

        const authorData = await getContactDataFromDatabaseByPhone(authorNumber, idSubstring);
        if(authorData){
            messageData.author = authorData.contactName;
        }else{
            messageData.author = msg.author;
        }
    }

    if (msg.type === 'audio') {
        messageData.audio = {
            mimetype: 'audio/ogg; codecs=opus', // Default mimetype for WhatsApp voice messages
            data: audioData // This is the base64 encoded audio data
        };
    }

    if (msg.hasMedia &&  msg.type !== 'audio') {
        try {
            const media = await msg.downloadMedia();
            if (media) {
              if (msg.type === 'image') {
                messageData.image = {
                    mimetype: media.mimetype,
                    data: media.data,  // This is the base64-encoded data
                    filename: msg._data.filename || "",
                    caption: msg._data.caption || "",
                };
                // Add width and height if available
                if (msg._data.width) messageData.image.width = msg._data.width;
                if (msg._data.height) messageData.image.height = msg._data.height;
              } else if (msg.type === 'document') {
                  messageData.document = {
                      mimetype: media.mimetype,
                      data: media.data,  // This is the base64-encoded data
                      filename: msg._data.filename || "",
                      caption: msg._data.caption || "",
                      pageCount: msg._data.pageCount,
                      fileSize: msg._data.size,
                  };
              }else if (msg.type === 'video') {
                    messageData.video = {
                        mimetype: media.mimetype,
                        filename: msg._data.filename || "",
                        caption: msg._data.caption || "",
                    };
                    // Store video data separately or use a cloud storage solution
                    const videoUrl = await storeVideoData(media.data, msg._data.filename);
                    messageData.video.link = videoUrl;
              } else {
                  messageData[msg.type] = {
                      mimetype: media.mimetype,
                      data: media.data,
                      filename: msg._data.filename || "",
                      caption: msg._data.caption || "",
                  };
              }

              // Add thumbnail information if available
              if (msg._data.thumbnailHeight && msg._data.thumbnailWidth) {
                  messageData[msg.type].thumbnail = {
                      height: msg._data.thumbnailHeight,
                      width: msg._data.thumbnailWidth,
                  };
              }

              // Add media key if available
              if (msg.mediaKey) {
                  messageData[msg.type].mediaKey = msg.mediaKey;
              }

              
            }  else {
                console.log(`Failed to download media for message: ${msg.id._serialized}`);
                messageData.text = { body: "Media not available" };
            }
        } catch (error) {
            console.error(`Error handling media for message ${msg.id._serialized}:`, error);
            messageData.text = { body: "Error handling media" };
        }
    }
    const contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber);
    const messagesRef = contactRef.collection('messages');

    const messageDoc = messagesRef.doc(msg.id._serialized);
    await messageDoc.set(messageData, { merge: true });
    console.log(messageData);  
  }

  async createThread() {
    console.log('Creating a new thread...');
    const thread = await openai.beta.threads.create();
    return thread;
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

    // Schedule regular checks
    this.scheduleCheck('*/15 * * * *');

    // Schedule monthly birthday check (runs on the 1st day of each month at 00:00)
    cron.schedule('0 0 1 * *', async () => {
      console.log('Running monthly birthday check...');
      await this.checkAndProcessBirthdaysForCurrentMonth();
    });
  }
}

module.exports = party8SpreadsheetWBM;