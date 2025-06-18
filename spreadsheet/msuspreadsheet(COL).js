const OpenAI = require('openai');
const axios = require('axios');
const { google } = require('googleapis');
const path = require('path');
const { Client } = require('whatsapp-web.js');
const util = require('util');
const moment = require('moment-timezone');
const fs = require('fs');
const cron = require('node-cron');

const { v4: uuidv4 } = require('uuid');

const { URLSearchParams } = require('url');
const admin = require('../firebase.js');
const db = admin.firestore();

const openai = new OpenAI({
  apiKey: process.env.OPENAIKEY,
});

const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);

class msuSpreadsheetCOL {
  constructor(botMap) {
    this.botName = '066';
    this.spreadsheetId = '1pptzODIrK_uDZZxyKdbGjG-T2zNXOWTriGy03RD_AKg';
    this.sheetName = 'COL Issued';
    this.range = `${this.sheetName}!A:S`; // Update this line
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
      const { lastProcessedRow } = await this.loadLastProcessedRow();
      console.log(`Last processed row: ${lastProcessedRow}`);

      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: this.range,
      });

      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        console.log('No data found in the spreadsheet.');
        return;
      }

      console.log(`Total rows in spreadsheet: ${rows.length}`);

      let newLastProcessedRow = lastProcessedRow;

      // Process new rows
      for (let i = lastProcessedRow + 1; i < rows.length; i++) {
        const row = rows[i];
        console.log("current row: ", row);
        await this.processRow(row, i + 1);
        newLastProcessedRow = i;
      }

      // Update the last processed row
      await this.saveLastProcessedRow(newLastProcessedRow);
      console.log(`Updated last processed row to ${newLastProcessedRow}`);
    } catch (error) {
      console.error('Error processing spreadsheet:', error);
    }
  }

  async processRow(row, rowIndex) {
    const [
      timestamp,
      leadSource,
      name,
      email,
      phoneNumber,
      icNumber,
      programme,
      colAttachment,
      status,
      waSent
    ] = row;

    if (waSent === 'Sent') {
      console.log(`Row already processed. Skipping.`);
      return;
    }
    if (phoneNumber === undefined || phoneNumber === '') {
      console.log(`Skipping row ${rowIndex} due to missing phone number.`);
      return;
    }

    
    const message = `Greetings from Management Science University (MSU) 🏆, one of Malaysia's top University with a 99% employability rate. 😎\n\nThank you for your interest, ${name}, we've received your enquiry.\n\nWe can't wait for you to be part of the #MSUrians.`;
    const message2 = `How would you prefer our counsellor to reach out to you?`;
    const message3 = `Would WhatsApp or a phone call be more convenient for you?`;

    // Create initial instructions for the assistant
    const initialInstructions = `
    - You will reply the user in english unless the user replied in Bahasa Melayu 

    - You have already sent this to the user: ${message},${message2},${message3}

    - Replace the [conditional offer letter link] to this link : ${colAttachment}

    - Use only the ### Conditional Offer Letter FLOW not the ### Brochure Flow for this user
    - Use only the ### Conditional Offer Letter FLOW not the ### Brochure Flow for this user
    - Use only the ### Conditional Offer Letter FLOW not the ### Brochure Flow for this user
  `;
    
    const extractedNumber = await this.formatPhoneNumber(phoneNumber);
    const extractedNumberNoPlus = extractedNumber.startsWith('+') ? extractedNumber.slice(1) : extractedNumber;
    

  
    console.log(`Processing row: ${name} (${phoneNumber})`);
    const thread = await this.createThread(initialInstructions);
    let threadID = thread.id;
    console.log('threadID created: ', threadID);
    const contactData = await this.getContactDataFromDatabaseByPhone(extractedNumber, this.botName);
    if(contactData){
      console.log('Contact already exists in database');
      await this.markRowAsDuplicate(rowIndex);
      return;
    }    
    await this.saveThreadIDFirebase(extractedNumber, threadID, this.botName)
    const data = {
      additionalEmails: [],
      address1: null,
      assignedTo: null,
      businessId: null,
      phone: extractedNumber,
      tags: ['blasted'],
      chat: {
          contact_id: extractedNumber,
          id: extractedNumberNoPlus + '@c.us',
          name: name || extractedNumber,
          not_spam: true,
          tags: ['blasted'],
          timestamp: Date.now(),
          type: 'contact',
          unreadCount: 0,
          last_message: {
              chat_id: extractedNumberNoPlus +'@c.us',
              from: "",
              from_me: true,
              id: "",
              source: "",
              status: "delivered",
              text: {
                  body: message3 ?? ""
              },
              timestamp: Date.now(),
              type:'text',
          },
      },
      chat_id: extractedNumberNoPlus+ '@c.us',
      city: null,
      companyName: null,
      contactName: name || extractedNumber,
      unreadCount: 0,
      threadid: threadID ?? "",
      phoneIndex: 0,
      last_message: {
          chat_id: extractedNumberNoPlus + '@c.us',
          from: "",
          from_me: true,
          id: "",
          source: "",
          status: "delivered",
          text: {
              body: message3 ?? ""
          },
          timestamp: Date.now() ?? 0,
          type: 'text',
      },
  };
  await db.collection('companies').doc(this.botName).collection('contacts').doc(extractedNumber).set(data, {merge: true});    

    const botData = this.botMap.get(this.botName);
    if (!botData || !botData[0].client) {
      console.log(`WhatsApp client not found for bot ${this.botName}`);
      return;
    }
    const client = botData[0].client;
  
    // Construct the message
  
    // Send the message to the phone number from the row
    try {
      const sentMessage = await client.sendMessage(`${extractedNumberNoPlus}@c.us`, message);
      console.log(`Message sent to ${name} (${extractedNumberNoPlus})`);
      await this.addMessagetoFirebase(sentMessage, this.botName, extractedNumber);
      const sentMessage2 = await client.sendMessage(`${extractedNumberNoPlus}@c.us`, message2);
      console.log(`Message 2 sent to ${name} (${extractedNumberNoPlus})`);
      await this.addMessagetoFirebase(sentMessage2, this.botName, extractedNumber);
      const sentMessage3 = await client.sendMessage(`${extractedNumberNoPlus}@c.us`, message3);
      console.log(`Message 3 sent to ${name} (${extractedNumberNoPlus})`);
      await this.addMessagetoFirebase(sentMessage3, this.botName, extractedNumber);

      // Mark the row as sent
      await this.markRowAsSent(rowIndex);
    } catch (error) {
      console.error(`Error sending message to ${name} (${phoneNumber}):`, error);
    }
  }
  async formatPhoneNumber(phoneNumber) {
    phoneNumber = phoneNumber.replace(/-/g, '');

    

    if (phoneNumber.startsWith('+')) {
      return phoneNumber;
    }
  
    if (phoneNumber.startsWith('60')) {
      return '+' + phoneNumber;
    }else {
      return '+60' + phoneNumber;
    }
  
    
  
   
  
    // Default case: if we can't determine the country, just add a '+' prefix
    return '+' + phoneNumber;
  }
  async checkPhoneNumberDuplicate(phoneNumber) {
    try {
      const currentSheetRange = `${this.sheetName}!E:E`; // "Phone No." is in column E
      const otherSheetName = 'COL Issued'; // Replace with the actual name of the other sheet
      const otherSheetRange = `${otherSheetName}!E:E`; // "Phone No." is also in column E in the other sheet
  
      const [currentSheetResponse, otherSheetResponse] = await Promise.all([
        this.sheets.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range: currentSheetRange,
        }),
        this.sheets.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range: otherSheetRange,
        })
      ]);
  
      const currentSheetPhoneNumbers = currentSheetResponse.data.values?.flat() || [];
      const otherSheetPhoneNumbers = otherSheetResponse.data.values?.flat() || [];
  
      // Combine phone numbers from both sheets and check for duplicates
      const allPhoneNumbers = [...currentSheetPhoneNumbers, ...otherSheetPhoneNumbers];
      return allPhoneNumbers.filter(num => num === phoneNumber).length > 1;
    } catch (error) {
      console.error('Error checking for phone number duplicates:', error);
      return false;
    }
  }
  async markRowAsSent(rowIndex) {
    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!J${rowIndex}`, // Column J is for "WA Sent"
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [['Sent']]
        }
      });
      console.log(`Marked row ${rowIndex} as sent in "WA Sent" column`);
    } catch (error) {
      console.error(`Error marking row ${rowIndex} as sent:`, error);
    }
  }

  async markRowAsDuplicate(rowIndex) {
    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!J${rowIndex}`, // Column Q is for "WA Sent"
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [['Duplicate']]
        }
      });
      console.log(`Marked row ${rowIndex} as sent in "WA Sent" column`);
    } catch (error) {
      console.error(`Error marking row ${rowIndex} as sent:`, error);
    }
  }

  async addMessage(threadId, message) {
    const response = await openai.beta.threads.messages.create(
        threadId,
        {
            role: "user",
            content: message
        }
    );
    return response;
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

async loadLastProcessedRow() {
  try {
    await fs.promises.mkdir(this.DATA_FOLDER, { recursive: true });
    const data = await readFileAsync(this.LAST_PROCESSED_ROW_FILE, 'utf8');
    const parsedData = JSON.parse(data);
    console.log(`Loaded last processed row: ${parsedData.lastProcessedRow}`);
    return parsedData;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No saved state found, starting from the beginning.');
      return { lastProcessedRow: 0 };
    }
    console.error('Error loading last processed row:', error);
    throw error;
  }
}

async saveLastProcessedRow(lastProcessedRow) {
  try {
    await fs.promises.mkdir(this.DATA_FOLDER, { recursive: true });
    const data = JSON.stringify({ lastProcessedRow });
    await writeFileAsync(this.LAST_PROCESSED_ROW_FILE, data, 'utf8');
    console.log(`Saved last processed row: ${lastProcessedRow}`);
  } catch (error) {
    console.error('Error saving last processed row:', error);
    throw error;
  }
}


  scheduleCheck(cronExpression) {
    cron.schedule(cronExpression, async () => {
      console.log(`Checking for new rows for bot ${this.botName}...`);
      await this.checkAndProcessNewRows();
    });
  }

  async createThread(initialInstructions) {
    console.log('Creating a new thread with initial instructions...');
    const thread = await openai.beta.threads.create();
    
    // Add the initial message to the thread
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: initialInstructions
    });
  
    return thread;
  }

  initialize() {
    // Run the check immediately when initialized
    this.checkAndProcessNewRows();

    // Schedule regular checks
    this.scheduleCheck('*/5 * * * *');
  }
}

module.exports = msuSpreadsheetCOL;