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

class applyRadarSpreadsheetLPAPUPK {
  constructor(botMap) {
    this.botName = '062';
    this.spreadsheetId = '11OH6bQCBlWiW_8Qb2aTehwgD_i5Oyfddri1jZxhXdpE';
    this.sheetName = 'Tactical LP - APU PK';
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
      name,
      email,
      phoneNumber,
      city,
      qualificationLevel,
      chooseADomain,
      preferredLevelOfStudy,
      preferredProgramme,
      perSemesterFeeBudget,
      leadSource,
      utmSource,
      utmMedium,
      utmName,
      utmTerm,
      utmContent,
      waSent
    ] = row;

    if (waSent === 'Sent') {
      console.log(`Row already processed. Skipping.`);
      return;
    }

    const message = `Hello ${name}, Greetings from ApplyRadar\n\nThank you for your interest in choosing Malaysia as your Study Abroad Destination.\n\nI am your study abroad counsellor, ready to assist you in your edcuation journey to Malaysia.`;
    const message2 = `May I know what your current qualification is?\n\n1. SSC or O'Levels\n2.HSSC or A'Levels\n3.Diploma or equivalent\n4.Bachelor's Degree\n5.Master's Degree`;

  
    console.log(`Processing row: ${name} (${phoneNumber})`);
    const thread = await this.createThread();
    let threadID = thread.id;
    const extractedNumber = '+'+(phoneNumber);
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
          id: phoneNumber + '@c.us',
          name: name || extractedNumber,
          not_spam: true,
          tags: ['blasted'],
          timestamp: Date.now(),
          type: 'contact',
          unreadCount: 0,
          last_message: {
              chat_id: phoneNumber +'@c.us',
              from: "",
              from_me: true,
              id: "",
              source: "",
              status: "delivered",
              text: {
                  body: message2 ?? ""
              },
              timestamp: Date.now(),
              type:'text',
          },
      },
      chat_id: phoneNumber + '@c.us',
      city: null,
      companyName: null,
      contactName: name || extractedNumber,
      unreadCount: 0,
      threadid: threadID ?? "",
      phoneIndex: 0,
      last_message: {
          chat_id: phoneNumber + '@c.us',
          from: "",
          from_me: true,
          id: "",
          source: "",
          status: "delivered",
          text: {
              body: message2 ?? ""
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
      const sentMessage = await client.sendMessage(`${phoneNumber}@c.us`, message);
      console.log(`Message sent to ${name} (${phoneNumber})`);
      await this.addMessagetoFirebase(sentMessage, this.botName, extractedNumber);
      const sentMessage2 = await client.sendMessage(`${phoneNumber}@c.us`, message2);
      console.log(`Message 2 sent to ${name} (${phoneNumber})`);
      await this.addMessagetoFirebase(sentMessage2, this.botName, extractedNumber);

      // Mark the row as sent
      await this.markRowAsSent(rowIndex);
    } catch (error) {
      console.error(`Error sending message to ${name} (${phoneNumber}):`, error);
    }
  }
  
  async markRowAsSent(rowIndex) {
    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!Q${rowIndex}`, // Column Q is for "WA Sent"
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
        range: `${this.sheetName}!Q${rowIndex}`, // Column Q is for "WA Sent"
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

  async createThread() {
    console.log('Creating a new thread...');
    const thread = await openai.beta.threads.create();
    return thread;
}

  initialize() {
    // Run the check immediately when initialized
    this.checkAndProcessNewRows();

    // Schedule regular checks
    this.scheduleCheck('*/5 * * * *');
  }
}

module.exports = applyRadarSpreadsheetLPAPUPK;