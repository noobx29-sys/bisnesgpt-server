const { google } = require('googleapis');
const path = require('path');
const { Client } = require('whatsapp-web.js');
const util = require('util');
const moment = require('moment-timezone');
const fs = require('fs');
const cron = require('node-cron');
const OpenAI = require('openai');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

const { URLSearchParams } = require('url');
const admin = require('../firebase.js');
const db = admin.firestore();

const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);

const openai = new OpenAI({
  apiKey: process.env.OPENAIKEY,
  assistantId: process.env.OPENAI_ASSISTANT_ID
});

class SKCSpreadsheet {
  constructor(botMap) {
    this.botName = '0161';
    this.spreadsheetId = '1i23tzU2l48aLbCR2M9psJ2Sjmadzqj18bCYiFxmD3z4';
    this.dynamicSheetName = 'Form_Responses';
    this.dynamicRange = `${this.dynamicSheetName}!A:Y`;
    this.botMap = botMap;
    this.apiUrl = 'http://localhost:8443';

    this.auth = new google.auth.GoogleAuth({
      keyFile: './service_account.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
    this.processedRows = new Set();
  }

  // Add initialize method
  async initialize() {
    try {
      console.log('Initializing SKCSpreadsheet...');
      
      // Load processed rows first
      await this.loadProcessedRows();
      
      // Set up message listener for the bot
      if (this.botMap && this.botMap[this.botName]) {
        const bot = this.botMap[this.botName];
        
        bot.on('message', async (msg) => {
          console.log('\n=== New Message Event ===');
          console.log('Message received:', msg.body);
          
          // Process the message
          await this.processIncomingMessage(msg);
        });

        console.log('Message listener set up successfully');
      } else {
        console.error('Bot not found in botMap:', this.botName);
      }

      // Verify Google Sheets connection
      await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'A1:A1'
      });

      console.log('Successfully connected to Google Sheets');

      // Set up scheduled tasks
      this.setupScheduledTasks();
      console.log('Scheduled tasks initialized');

      return true;

    } catch (error) {
      console.error('Error initializing SKCSpreadsheet:', error);
      return false;
    }
  }

  setupScheduledTasks() {
    // Add a flag to prevent concurrent executions
    let isProcessing = false;
    // Add Set for processed message IDs
    const processedMessageIds = new Set();
    
    cron.schedule('*/4 * * * *', async () => {
      try {
        // Check if already processing
        if (isProcessing) {
          console.log('Previous check still in progress, skipping...');
          return;
        }
        
        isProcessing = true;
        
        // Generate a unique ID for this check (using timestamp)
        const checkId = Date.now().toString();
        if (processedMessageIds.has(checkId)) {
          console.log(`Check ${checkId} already processed, skipping...`);
          return;
        }
        
        processedMessageIds.add(checkId);
        
        // Clear old IDs periodically
        if (processedMessageIds.size > 100) {
          const oldestIds = Array.from(processedMessageIds).slice(0, 50);
          oldestIds.forEach(id => processedMessageIds.delete(id));
        }
        
        await this.checkAndProcessNewRows();
      } catch (error) {
        console.error('Error in scheduled task:', error);
      } finally {
        isProcessing = false;
      }
    });
  }

  async checkAndProcessNewRows() {
    try {
      console.log(`Checking rows for bot ${this.botName}`);

      // Get all data from the dynamic sheet
      const dynamicResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: this.dynamicRange,
      });

      const rows = dynamicResponse.data.values || [];

      if (rows.length === 0) {
        console.log('No data found in the spreadsheet.');
        return;
      }

      console.log(`Found ${rows.length} rows in spreadsheet`);

      const headers = rows[0];
      const triggerColumnIndex = headers.findIndex(header => 
        header.toLowerCase().includes('trigger') || 
        header.toLowerCase().includes('pass lead')
      );
      const assignmentDateIndex = headers.findIndex(header => header.toLowerCase() === 'assignmentdate');
      const statusIndex = headers.findIndex(header => header.toLowerCase() === 'status');
      const feedbackIndex = headers.findIndex(header => header.toLowerCase() === 'feedback');
      const ratingIndex = headers.findIndex(header => header.toLowerCase() === 'rating');
      const commentIndex = headers.findIndex(header => header.toLowerCase() === 'comment');

      console.log('Headers:', headers);
      console.log('Trigger column index:', triggerColumnIndex);
      console.log('Comment column index:', commentIndex);

      if (triggerColumnIndex === -1) {
        console.log('Trigger column not found in headers');
        return;
      }

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const trigger = row[triggerColumnIndex];
        const status = row[statusIndex] || '';

        // Create a unique identifier for this row
        const rowIdentifier = `${row[1]}`; // Using only SubmissionDate as unique identifier
        
        // Skip if we've already processed this row
        if (this.processedRows.has(rowIdentifier)) {
          console.log(`Skipping already processed row ${i} with identifier ${rowIdentifier}`);
          continue;
        }

        console.log(`Row ${i} trigger value:`, trigger);
        console.log(`Row ${i} status:`, status);

        if (trigger && trigger.toLowerCase() === 'pass lead to pic'.toLowerCase()) {
          console.log(`Processing new lead in row ${i}:`, row);

          const [
            No,
            SubmissionDate,
            ProcessedDate,
            Trigger,
            PICName,
            PICNumber,
            Greeting,
            EntryMode,
            Website,
            LeadName,
            HighestQualification,
            PhoneNumber,  // This is the lead's phone number
            YearsOfWorkExperience,
            Age,
            ProgramOfInterest,
            CurrentOccupation,
            CurrentIndustry,
            Source,
            Notes,
            AssignmentDate,
            StatusColumn,
            Feedback,
            Rating,
          ] = row;

          // Format phone numbers for Firebase
          const firebaseLeadNumber = PhoneNumber.startsWith('+') ? PhoneNumber.slice(1) : PhoneNumber;
          const firebasePicNumber = PICNumber.startsWith('+') ? PICNumber.slice(1) : PICNumber;

          // Save row index for both lead and PIC
          await this.saveThreadData(firebaseLeadNumber, i + 1);

          const assignmentDateNow = moment().tz('Asia/Kuala_Lumpur').format('DD/MM/YYYY HH:mm:ss');

          // Log assignment date and status
          await this.logAssignment(i + 1, assignmentDateNow);

          // Send initial messages to LEAD
          try {
            const messages = await this.constructMessages({
              greeting: Greeting,
              name: LeadName,
              program: ProgramOfInterest,
              entryMode: EntryMode,
              website: Website,
              picName: PICName,
              picNumber: PICNumber,
              source: Source,
              notes: Notes
            });

            // Send constructed messages to lead
            const botData = this.botMap.get(this.botName);
            if (botData && botData[0].client) {
              const client = botData[0].client;
              const formattedLeadNumber = PhoneNumber.startsWith('+') ? PhoneNumber.slice(1) : PhoneNumber;
              
              for (const messageText of messages) {
                try {
                  const sentMessage = await client.sendMessage(`${formattedLeadNumber}@c.us`, messageText);
                  await this.addMessagetoFirebaseSimple(sentMessage, this.botName, firebaseLeadNumber);
                  console.log(`Initial message sent to lead (${formattedLeadNumber})`);
                } catch (error) {
                  console.error('Error sending initial message to lead:', error);
                }
              }
            }
          } catch (error) {
            console.error('Error constructing or sending messages:', error);
          }

          // Send initial notification to PIC
          await this.notifyPICAssignation(PICNumber, LeadName, PhoneNumber, {
            picName: PICName,
            program: ProgramOfInterest,
            entryMode: EntryMode,
            source: Source,
            notes: Notes,
            qualification: HighestQualification,
            yearsOfWork: YearsOfWorkExperience,
            age: Age,
            occupation: CurrentOccupation,
            industry: CurrentIndustry,
            greeting: Greeting
            
          });

          // Schedule follow-ups for both LEAD and PIC
          this.scheduleFollowUps(i + 1, PhoneNumber, PICNumber, LeadName, PICName, {
            qualification: HighestQualification,
            yearsOfWork: YearsOfWorkExperience,
            age: Age,
            program: ProgramOfInterest,
            entryMode: EntryMode,
            source: Source,
            email: '',
            location: '',
            occupation: CurrentOccupation,
            industry: CurrentIndustry,
            notes: Notes,
            greeting: Greeting
          });

          // Update trigger to 'Processed' and add timestamp
          await this.updateTrigger(i + 1);
          console.log(`Updated trigger to 'Processed' for row ${i + 1}`);

          // After successful processing, add to processed set
          this.processedRows.add(rowIdentifier);
          
          // Periodically clean up old entries (keep last 1000 entries)
          if (this.processedRows.size > 1000) {
            const entries = Array.from(this.processedRows);
            this.processedRows = new Set(entries.slice(entries.length - 1000));
          }

          // Store processed rows in Firebase for persistence across restarts
          await db.collection('processedRows')
            .doc(this.botName)
            .set({
              [rowIdentifier]: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

        }

        // Additional processing for existing leads based on status
        if (status.toLowerCase() === 'yes') {
          // Handle feedback and rating logging if necessary
          // This can be expanded based on how feedback is received
        }

        if (status.toLowerCase() === 'idle') {
          // Handle idle status, possibly reassign PIC or notify admin
          // This can be expanded based on specific requirements
        }
      }

    } catch (error) {
      console.error('Error checking spreadsheet:', error);
    }
  }

  async updateTrigger(rowIndex) {
    try {
      const now = moment().tz('Asia/Kuala_Lumpur').format('DD/MM/YYYY HH:mm:ss');
      await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        resource: {
          valueInputOption: 'RAW',
          data: [
            {
              range: `${this.dynamicSheetName}!C${rowIndex}`, // ProcessedDate column
              values: [[now]]
            },
            {
              range: `${this.dynamicSheetName}!D${rowIndex}`, // Trigger column
              values: [['Processed']]
            }
          ]
        }
      });
      console.log(`Successfully updated trigger and timestamp for row ${rowIndex}`);
    } catch (error) {
      console.error('Error updating trigger and timestamp:', error);
      throw error; // Re-throw to handle in calling function
    }
  }

  async constructMessages({ greeting = 'Hi', name = '', program = '', entryMode = '', website = '', picName = '', picNumber = '', source = '', notes = '' }) {
    const messages = [];
    let messageKeyword;
    const sourceType = (source || '').toLowerCase();
    
    if (sourceType.includes('whatsapp')) {
        if (entryMode.toLowerCase().includes('apel') && (program.includes('MBA') || program.includes('Master of Management'))) {
            messageKeyword = 'whatsapp_apel_mba_mim';
        } else {
            messageKeyword = 'whatsapp_default';
        }
    } else if (['fb', 'facebook', 'ig', 'instagram', 'tiktok', 'google'].some(platform => sourceType.includes(platform))) {
        if (program.includes('MBA') || program.includes('Master of Management')) {
            messageKeyword = 'ads_mba_mim';
        }        
    } else {
        if (program.includes('Enabling')) {
            messageKeyword = 'enabling';
        } else {
          messageKeyword = 'whatsapp_default';
        }
    }
    
    const messageTemplate = await this.getMessageFromSheet(messageKeyword);
    const placeholders = {
      greeting,
      name,
      program,
      website,
      picName,
      picNumber,
      programFee: '',
      microcredentials: '',
      cmiText: ''
    };
    if (messageTemplate) {
      if (['fb', 'facebook', 'ig', 'instagram', 'tiktok', 'google'].some(platform => sourceType.includes(platform))) {
        if (program.includes('MBA')) {
          placeholders.programFee = 'RM15,900';
          placeholders.microcredentials = 'eleven';
          placeholders.cmiText = '';
        } else if (program.includes('Master of Management')) {
          placeholders.programFee = 'RM17,000';
          placeholders.microcredentials = 'six';
          placeholders.cmiText = '👉 Receive Level 7 qualification from Chartered Management Institute, UK (CMI)\n';
        }
      }

      let processedTemplate = messageTemplate.replace(/\${(\w+)}/g, (match, key) => {
        return placeholders.hasOwnProperty(key) ? placeholders[key] : match;
      });

      messages.push(processedTemplate);

      if (entryMode.toLowerCase().includes('apel') && ['fb', 'facebook', 'ig', 'instagram', 'tiktok', 'google'].some(platform => sourceType.includes(platform))) {
        const apelMessage = await  this.getMessageFromSheet('ads_apel');
        if (apelMessage) {
          messages.push(apelMessage);
        }
      }

      const footing = await this.getMessageFromSheet('footing');
      let processedFootingMessage = footing.replace(/\${(\w+)}/g, (match, key) => {
        return placeholders.hasOwnProperty(key) ? placeholders[key] : match;
      });
      messages.push(processedFootingMessage);
    } else {
      console.log('No template message found. Using default message.');
      const defaultMessage = await this.getMessageFromSheet('whatsapp_default');
      messages.push(defaultMessage);
    }

    return messages;
  }

  /**
   * Adds a message to Firebase.
   * @param {Message} msg - The message object from WhatsApp.
   * @param {string} idSubstring - Identifier substring for the company.
   * @param {string} extractedNumber - Extracted phone number from the message.
   */
  async addMessagetoFirebase(msg, idSubstring, extractedNumber) {
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

    if (msg.type === 'chat') {
      type = 'text';
    } else {
      type = msg.type;
    }

    // Handle audio messages
    if (msg.hasMedia && msg.type === 'audio') {
      console.log('Voice message detected');
      try {
        const media = await msg.downloadMedia();
        const transcription = await this.transcribeAudio(media.data);
        console.log('Transcription:', transcription);

        messageBody = transcription;
        audioData = media.data;
        console.log(msg);
      } catch (error) {
        console.error('Error downloading or transcribing audio:', error);
        messageBody = 'Error processing audio message.';
      }
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

    // Handle group messages
    if (msg.from.includes('@g.us')) {
      const authorNumber = '+' + (msg.author ? msg.author.split('@')[0] : '');
      const authorData = await getContactDataFromDatabaseByPhone(authorNumber, idSubstring);
      if (authorData) {
        messageData.author = authorData.contactName;
      } else {
        messageData.author = msg.author || 'Unknown Author';
      }
    }

    // Attach audio data if present
    if (msg.type === 'audio' && audioData) {
      messageData.audio = {
        mimetype: 'audio/ogg; codecs=opus',
        data: audioData
      };
    }

    // Handle other media types
    if (msg.hasMedia && msg.type !== 'audio') {
      try {
        const media = await msg.downloadMedia();
        if (media) {
          if (msg.type === 'image') {
            messageData.image = {
              mimetype: media.mimetype,
              data: media.data,
              filename: msg._data.filename || "",
              caption: msg._data.caption || "",
            };
            if (msg._data.width) messageData.image.width = msg._data.width;
            if (msg._data.height) messageData.image.height = msg._data.height;
          } else if (msg.type === 'document') {
            messageData.document = {
              mimetype: media.mimetype,
              data: media.data,
              filename: msg._data.filename || "",
              caption: msg._data.caption || "",
              pageCount: msg._data.pageCount,
              fileSize: msg._data.size,
            };
          } else if (msg.type === 'video') {
            messageData.video = {
              mimetype: media.mimetype,
              filename: msg._data.filename || "",
              caption: msg._data.caption || "",
            };
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
        } else {
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
    console.log('Message data added to Firebase:', messageData);
  }

  /**
   * Checks if the PIC has contacted the lead.
   * @param {string} picNumber - PIC's phone number.
   * @param {string} phoneNumber - Lead's phone number.
   * @returns {Object} - { contacted: boolean }
   */
  async checkPICContacted(picNumber, phoneNumber) {
    // Implement logic to check if PIC has contacted the lead
    // For example, check if any messages exist from PIC to lead in Firebase
    try {
      const messagesSnapshot = await db.collection('companies').doc(this.botName)
        .collection('contacts').doc(phoneNumber)
        .collection('messages').where('from', '==', picNumber).get();

      return { contacted: !messagesSnapshot.empty };
    } catch (error) {
      console.error('Error checking PIC contact status:', error);
      return { contacted: false };
    }
  }

  /**
   * Notifies the admin to assign a new PIC to the lead.
   * @param {string} leadName - Lead's name.
   * @param {string} phoneNumber - Lead's phone number.
   */
  async notifyAdminToAssignNewPIC(leadName, phoneNumber) {
    const adminNumber = process.env.ADMIN_WHATSAPP_NUMBER; // Ensure this is set in environment variables
    const message = `Admin Notification: Please assign a new PIC to the lead ${leadName} (${phoneNumber}) as the current PIC has not contacted the lead within the scheduled follow-ups.`;

    try {
      const botData = this.botMap.get(this.botName);
      if (!botData || !botData[0].client) {
        console.log(`WhatsApp client not found for bot ${this.botName}`);
        return;
      }
      const client = botData[0].client;
      const formattedAdminNumber = adminNumber.startsWith('+') ? adminNumber.slice(1) : adminNumber;
      const sentMessage = await client.sendMessage(`${formattedAdminNumber}@c.us`, message);
      await this.addMessagetoFirebase(sentMessage, this.botName, formattedAdminNumber);
      console.log(`Admin notified to assign a new PIC for lead ${leadName} (${phoneNumber})`);
    } catch (error) {
      console.error('Error notifying admin to assign new PIC:', error);
    }
  }

  /**
   * Updates the status of a lead in Google Sheets.
   * @param {number} rowIndex - The row number in Google Sheets.
   * @param {string} status - The new status to set.
   */
  async updateStatus(rowIndex, status) {
    try {
      await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        resource: {
          valueInputOption: 'RAW',
          data: [
            {
              range: `${this.dynamicSheetName}!U${rowIndex}`, // Status column
              values: [[status]]
            }
          ]
        }
      });
      console.log(`Updated Status for row ${rowIndex} to ${status}`);
    } catch (error) {
      console.error('Error updating Status:', error);
    }
  }

  async getMessageAndMinutes(keyword) {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Messages!B:D', // Columns B, C, and D for keyword, message, and minutes
      });

      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        console.log('No data found in Messages sheet');
        return null;
      }

      const messageRow = rows.find(row => {
        const rowKeyword = String(row[0] || '').toLowerCase();
        const searchKeyword = String(keyword).toLowerCase();
        return rowKeyword === searchKeyword;
      });

      if (messageRow) {
        return {
          message: messageRow[1],
          minutes: parseInt(messageRow[2]) || 0 // Convert minutes to number, default to 0 if invalid
        };
      }

      console.log(`No message found for keyword "${keyword}" in sheet`);
      return null;
    } catch (error) {
      console.error('Error fetching message and minutes from sheet:', error);
      return null;
    }
  }

  // Replace getMessageFromSheet with this updated version that uses getMessageAndMinutes
  async getMessageFromSheet(keyword) {
    const result = await this.getMessageAndMinutes(keyword);
    return result ? result.message : null;
  }

  /**
   * Logs the assignment date and initial status when a lead is assigned to a PIC.
   * @param {number} rowIndex - The row number in Google Sheets.
   * @param {string} assignmentDate - The date and time of assignment.
   * @param {string} status - The initial status, e.g., 'Assigned'.
   */
  async logAssignment(rowIndex, assignmentDate) {
    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${this.dynamicSheetName}!T${rowIndex}`, // AssignmentDate column only
        valueInputOption: 'RAW',
        resource: {
          values: [[assignmentDate]]
        }
      });
      console.log(`Logged assignment date for row ${rowIndex}`);
    } catch (error) {
      console.error('Error logging assignment:', error);
    }
  }

  // Update the scheduling code to use minutes from sheet
  async scheduleFollowUps(rowIndex, phoneNumber, picNumber, leadName, picName, {
    qualification,
    yearsOfWork,
    age,
    program,
    entryMode,
    source,
    email,
    location,
    occupation,
    industry,
    notes,
    greeting
  } = {}) {
    const followUpKeywords = [
      'lead_followup_1',
      'lead_followup_2',
      'lead_followup_3',
      'lead_followup_4',
      'lead_followup_5'
    ];

    for (const keyword of followUpKeywords) {
      const messageData = await this.getMessageAndMinutes(keyword);
      if (messageData && messageData.minutes) {
        const scheduledTime = new Date();
        scheduledTime.setMinutes(scheduledTime.getMinutes() + messageData.minutes);

        // Prepare message data for scheduling
        const messagePayload = {
          companyId: this.botName,
          scheduledTime: {
            seconds: Math.floor(scheduledTime.getTime() / 1000),
            nanoseconds: 0
          },
          message: messageData.message.replace(/\${(\w+)}/g, (match, key) => {
            const values = {
              leadName: leadName || 'N/A',
              picName: picName || 'N/A',
              phoneNumber: phoneNumber || 'N/A',
              qualification: qualification || 'N/A',
              yearsOfWork: yearsOfWork || 'N/A',
              age: age || 'N/A',
              program: program || 'N/A',
              entryMode: entryMode || 'N/A',
              source: source || 'N/A',
              email: email || 'N/A',
              location: location || 'N/A',
              occupation: occupation || 'N/A',
              industry: industry || 'N/A',
              notes: notes || 'N/A',
              greeting: greeting || 'Hi'
            };
            return values[key] || match;
          }),
          chatIds: [`${phoneNumber.startsWith('+') ? phoneNumber.slice(1) : phoneNumber}@c.us`],
          batchQuantity: 1,
          repeatInterval: 0,
          repeatUnit: 'minutes',
          v2: true,
          minDelay: 0,
          maxDelay: 1,
          type: 'lead_followup',
          metadata: {
            rowIndex,
            type: 'lead_followup',
            followUpNumber: keyword.slice(-1)
          }
        };

        try {
          // Schedule the message using the API
          const response = await axios.post(
            `${this.apiUrl}/api/schedule-message/${this.botName}`,
            messagePayload
          );
          console.log(`Scheduled ${keyword} message for lead ${leadName}:`, response.data);
        } catch (error) {
          console.error(`Error scheduling ${keyword} message:`, error);
          if (error.response) {
            console.error('Response data:', error.response.data);
          }
        }
      } else {
        console.log(`No message template or minutes found for ${keyword}`);
      }
    }
  }

  /**
   * Sends initial notification to PIC upon assignment.
   * @param {string} picNumber - PIC's phone number.
   * @param {string} leadName - Lead's name.
   * @param {string} phoneNumber - Lead's phone number.
   */
  async notifyPICAssignation(picNumber, leadName, phoneNumber, {
    picName,
    program,
    entryMode,
    source,
    notes,
    qualification,
    yearsOfWork,
    age,
    email,
    location,
    occupation,
    industry,
    greeting
  }) {
    let messages = [];
    let messageKeyword;

    // First message - program specific
    if (program.includes('MBA')) {
      messageKeyword = 'pic_mba';
    } else if (program.includes('Master in Management')) {
      messageKeyword = 'pic_master_in_management';
    } else if (program.includes('Enabling Program')) {
      messageKeyword = 'pic_enabling_program';
    }

    const messageTemplate = await this.getMessageFromSheet(messageKeyword);
    const footerTemplate = await this.getMessageFromSheet('pic_footer');

    if (messageTemplate) {
      const placeholders = {
        greeting: greeting || 'Hi',
        leadName,
        program: program || 'N/A',
        picName: picName || 'N/A',
        phoneNumber,
        qualification: qualification || 'N/A',
        yearsOfWork: yearsOfWork || 'N/A',
        age: age || 'N/A',
        entryMode: entryMode || 'N/A',
        source: source || 'N/A',
        email: email || 'N/A',
        location: location || 'N/A',
        occupation: occupation || 'N/A',
        industry: industry || 'N/A',
        notes: notes || 'N/A'
      };
  
      // Add program-specific message
      const message = messageTemplate.replace(/\$\{(\w+)\}/g, (match, key) => {
        return placeholders.hasOwnProperty(key) ? placeholders[key] : match;
      });
      messages.push(message);

      // Add footer message if available
      if (footerTemplate) {
        const footerMessage = footerTemplate.replace(/\$\{(\w+)\}/g, (match, key) => {
          return placeholders.hasOwnProperty(key) ? placeholders[key] : match;
        });
        messages.push(footerMessage);
      }
    } else {
      console.log(`Message template for ${messageKeyword} not found in sheet.`);
    }
  
    // Send messages to PIC
    const botData = this.botMap.get(this.botName);
    if (!botData || !botData[0].client) {
      console.log(`WhatsApp client not found for bot ${this.botName}`);
      return;
    }
    const client = botData[0].client;
    const formattedPicNumber = picNumber.startsWith('+') ? picNumber.slice(1) : picNumber;
    const firebasePicNumber = picNumber.startsWith('+') ? picNumber.slice(1) : picNumber;
  
    for (const message of messages) {
      try {
        const sentMessage = await client.sendMessage(`${formattedPicNumber}@c.us`, message);
        await this.addMessagetoFirebase(sentMessage, this.botName, firebasePicNumber);
        console.log(`Message sent to PIC ${picName} (${picNumber})`);
      } catch (error) {
        console.error('Error sending message to PIC:', error);
      }
    }
  }
  
  formatPhoneNumber(phoneNumber) {
    try {
      if (!phoneNumber) {
        console.log('Warning: Empty phone number provided to formatPhoneNumber');
        return '';
      }
      
      // Convert to string in case number is passed
      let cleaned = String(phoneNumber);
      cleaned = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
      cleaned = cleaned.replace(/\D/g, '');
      return cleaned;
    } catch (error) {
      console.error('Error formatting phone number:', error);
      console.error('Input phone number:', phoneNumber);
      return '';
    }
  }
  
  async findRowIndexByPhoneNumber(rows, leadPhone) {
    try {
      if (!rows || !leadPhone) {
        console.log('Warning: Missing rows or leadPhone in findRowIndexByPhoneNumber');
        return -1;
      }

      const formattedLeadPhone = this.formatPhoneNumber(leadPhone);
      if (!formattedLeadPhone) {
        console.log('Warning: Could not format lead phone number');
        return -1;
      }

      for (let i = 1; i < rows.length; i++) {
        // Check if row exists and has enough columns
        if (rows[i] && rows[i][11]) {
          const rowPhone = this.formatPhoneNumber(rows[i][11]);
          if (rowPhone === formattedLeadPhone) {
            return i;
          }
        }
      }
      return -1;
    } catch (error) {
      console.error('Error in findRowIndexByPhoneNumber:', error);
      return -1;
    }
  }

  async processIncomingMessage(msg) {
    try {
      console.log('\n=== Processing New Message ===');
      console.log('Message:', {
        body: msg.body,
        from: msg.from,
        timestamp: new Date(msg.timestamp * 1000)
      });
  
      const senderNumber = msg.from.split('@')[0];
      console.log('Processing message from:', senderNumber);
      const messageText = msg.body.toLowerCase().trim();

      // Handle "received" messages
      if (messageText.endsWith('received') || messageText.endsWith('received ')) {
        const threadData = await this.getThreadData(senderNumber);
        if (!threadData || !threadData.rowIndex) {
          console.log('No row data found for sender');
          return false;
        }

        const received = messageText.endsWith('received') ?
          msg.body.slice(0, -'received'.length).trim().toLowerCase() :
          msg.body.slice(0, -'received '.length).trim().toLowerCase();

        // Get headers to find 'Received' column index
        const headersResponse = await this.sheets.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range: `${this.dynamicSheetName}!A1:Y1`,
        });
        
        const headers = headersResponse.data.values[0];
        const receivedIndex = headers.findIndex(header => 
          header.toLowerCase() === 'received'
        );

        if (receivedIndex === -1) {
          console.log('Received column not found in headers');
          return false;
        }

        // Update received using the receivedIndex
        const columnLetter = String.fromCharCode(65 + receivedIndex); // Convert index to column letter (A=65, B=66, etc)
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `${this.dynamicSheetName}!${columnLetter}${threadData.rowIndex}`,
          valueInputOption: 'RAW',
          resource: {
            values: [[received]]
          }
        });
        console.log(`Successfully updated received in row ${threadData.rowIndex}, column ${columnLetter}`);

        if (received === 'yes') {
          // Get row data to access PIC and lead information
          const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `${this.dynamicSheetName}!A${threadData.rowIndex}:AE${threadData.rowIndex}`
          });
          const rowData = response.data.values[0];
          
          // Get and send the if_yes_received_lead message
          const ifYesReceivedMessage = await this.getMessageFromSheet('if_yes_received_lead');
          if (!ifYesReceivedMessage) {
            console.log('Warning: Could not find message template for if_yes_received_lead');
            return false;
          }

          // Get and send the if_yes_received_pic message
          const ifYesReceivedPicMessage = await this.getMessageFromSheet('if_yes_received_pic');
          if (!ifYesReceivedPicMessage) {
            console.log('Warning: Could not find message template for if_yes_received_pic');
            return false;
          }

          // Format PIC message with placeholders
          const picMessageData = {
            companyId: this.botName,
            scheduledTime: {
              seconds: Math.floor(Date.now() / 1000), // Send immediately
              nanoseconds: 0
            },
            message: ifYesReceivedPicMessage.replace(/\${(\w+)}/g, (match, key) => {
              const values = {
                picName,
                leadName,
                qualification: rowData[10] || 'N/A',
                phoneNumber: rowData[11] || 'N/A',
                yearsOfWork: rowData[12] || 'N/A',
                age: rowData[13] || 'N/A',
                program: rowData[14] || 'N/A',
                entryMode: rowData[7] || 'N/A',
                source: rowData[17] || 'N/A',
                email: 'N/A', // Add email column if available
                location: 'N/A', // Add location column if available
                occupation: rowData[15] || 'N/A',
                industry: rowData[16] || 'N/A',
                notes: rowData[18] || 'N/A',
                leadComment: rowData[commentIndex] || 'N/A' // Add comment from the commentIndex column
              };
              return values[key] || match;
            }),
            chatIds: [`${picNumber.startsWith('+') ? picNumber.slice(1) : picNumber}@c.us`],
            batchQuantity: 1,
            repeatInterval: 0,
            repeatUnit: 'minutes',
            v2: true,
            minDelay: 0,
            maxDelay: 1,
            type: 'pic_received_notification',
            metadata: {
              rowIndex: threadData.rowIndex,
              type: 'pic_received_notification'
            }
          };

          try {
            const picResponse = await axios.post(
              `${this.apiUrl}/api/schedule-message/${this.botName}`,
              picMessageData
            );
            console.log('PIC notification scheduled:', picResponse.data);
          } catch (error) {
            console.error('Error scheduling PIC notification:', error);
            if (error.response) {
              console.error('Response data:', error.response.data);
            }
          }
        }
        return true;
      }

      // Handle status update from lead (response to follow-up 1 or 2)
      if (messageText.startsWith('status') || messageText.startsWith('status ')) {
        const threadData = await this.getThreadData(senderNumber);
        if (!threadData || !threadData.rowIndex) {
          console.log('No row data found for sender');
          return false;
        }

        const status = messageText.startsWith('status') ?
          msg.body.substring('status'.length).trim().toLowerCase() :
          msg.body.substring('status '.length).trim().toLowerCase();

        console.log(`Updating status to '${status}' for row ${threadData.rowIndex}`);

        // Update status in column U using batchUpdate for better error handling
        try {
          await this.sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            resource: {
              valueInputOption: 'RAW',
              data: [{
                range: `${this.dynamicSheetName}!U${threadData.rowIndex}`,
                values: [[status]]
              }]
            }
          });
          console.log(`Successfully updated status to '${status}' for row ${threadData.rowIndex}`);

          // Get row data to access PIC and lead information
          const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `${this.dynamicSheetName}!A${threadData.rowIndex}:AE${threadData.rowIndex}`
          });
          const rowData = response.data.values[0];
          const picName = rowData[4];
          const picNumber = rowData[5];
          const leadName = rowData[9];
          const greeting = rowData[6]; // Get greeting from column G

          if (status === 'yes') {
            // Delete scheduled follow-ups 2-5
            try {
              const messagesToDelete = [
                'lead_followup_2',
                'lead_followup_3',
                'lead_followup_4',
                'lead_followup_5'
              ];
              
              for (const messageType of messagesToDelete) {
                await this.deleteScheduledMessages(senderNumber, {
                  type: 'lead_followup',
                  followUpNumber: messageType.slice(-1),
                  rowIndex: threadData.rowIndex
                });
                console.log(`Deleted scheduled ${messageType} for row ${threadData.rowIndex}`);
              }
            } catch (error) {
              console.error('Error deleting scheduled follow-ups:', error);
            }

            // Get message templates and schedule them
            const ratingMessage = await this.getMessageFromSheet('rating_message');
            const receivedMessage = await this.getMessageFromSheet('received_message');
            const feedbackMessage = await this.getMessageFromSheet('full_feedback_message');

            // Prepare the messages with variables
            const messagePayloads = [
              {
                message: ratingMessage?.replace(/\${(\w+)}/g, (match, key) => {
                  const values = {
                    picName,
                    leadName,
                    greeting: greeting || 'Hi'
                  };
                  return values[key] || match;
                }),
                type: 'rating'
              },
              {
                message: receivedMessage?.replace(/\${(\w+)}/g, (match, key) => {
                  const values = {
                    picName,
                    leadName,
                    greeting: greeting || 'Hi'
                  };
                  return values[key] || match;
                }),
                type: 'received'
              },
              {
                message: feedbackMessage?.replace(/\${(\w+)}/g, (match, key) => {
                  const values = {
                    picName,
                    leadName,
                    greeting: greeting || 'Hi'
                  };
                  return values[key] || match;
                }),
                type: 'feedback'
              }
            ];

            // Schedule each message
            for (const payload of messagePayloads) {
              if (payload.message) {
                try {
                  const schedulePayload = {
                    companyId: this.botName,
                    scheduledTime: {
                      seconds: Math.floor(Date.now() / 1000),
                      nanoseconds: 0
                    },
                    message: payload.message,
                    chatIds: [`${senderNumber}@c.us`],
                    batchQuantity: 1,
                    repeatInterval: 0,
                    repeatUnit: 'minutes',
                    v2: true,
                    minDelay: 0,
                    maxDelay: 1,
                    type: payload.type,
                    metadata: {
                      rowIndex: threadData.rowIndex,
                      type: payload.type
                    }
                  };

                  const response = await axios.post(
                    `${this.apiUrl}/api/schedule-message/${this.botName}`,
                    schedulePayload
                  );
                  console.log(`Scheduled ${payload.type} message:`, response.data);
                } catch (error) {
                  console.error(`Error scheduling ${payload.type} message:`, error);
                  if (error.response) {
                    console.error('Response data:', error.response.data);
                  }
                }
              }
            }
          } else if (status === 'no') {
            // Get lead message template
            const leadMessage = await this.getMessageFromSheet('lead_if_no_status');
            if (!leadMessage) {
              console.log('Warning: Could not find message template for lead_if_no_status');
              return false;
            }

            // Check if lead_followup_3 has been sent
            const messagesRef = db.collection('companies')
              .doc(this.botName)
              .collection('contacts')
              .doc(senderNumber)
              .collection('messages');

            const followup3Query = await messagesRef
              .where('type', '==', 'lead_followup')
              .where('metadata.followUpNumber', '==', '3')
              .get();

            if (!followup3Query.empty) {
              const formattedPicNumber = picNumber.startsWith('+') ? picNumber.slice(1) : picNumber;
            
              // Calculate time 5 minutes from now for lead message
              const fiveMinutesFromNow = new Date();
              fiveMinutesFromNow.setMinutes(fiveMinutesFromNow.getMinutes() + 5);
            
              // Create scheduled messages for both PIC and lead
              const scheduledMessages = [
                {
                  companyId: this.botName,
                  scheduledTime: {
                    seconds: Math.floor(Date.now() / 1000),
                    nanoseconds: 0
                  },
                  message: leadMessage,
                  chatIds: [`${senderNumber}@c.us`],
                  batchQuantity: 1,
                  repeatInterval: 0,
                  repeatUnit: 'minutes',
                  v2: true,
                  minDelay: 0,
                  maxDelay: 1,
                  type: 'lead_no_status_followup',
                  metadata: {
                    rowIndex: threadData.rowIndex,
                    type: 'lead_no_status_followup'
                  }
                },
                {
                  companyId: this.botName,
                  scheduledTime: {
                    seconds: Math.floor(fiveMinutesFromNow.getTime() / 1000),
                    nanoseconds: 0
                  },
                  message: leadMessage,
                  chatIds: [`${senderNumber}@c.us`],
                  batchQuantity: 1,
                  repeatInterval: 0,
                  repeatUnit: 'minutes',
                  v2: true,
                  minDelay: 0,
                  maxDelay: 1,
                  type: 'lead_no_status_followup',
                  metadata: {
                    rowIndex: threadData.rowIndex,
                    type: 'lead_no_status_followup'
                  }
                }
              ];

              try {
                // Schedule both messages
                for (const messageData of scheduledMessages) {
                  const response = await axios.post(
                    `${this.apiUrl}/api/schedule-message/${this.botName}`,
                    messageData
                  );
                  console.log('Schedule message response:', response.data);
                }
              } catch (error) {
                console.error('Error scheduling messages:', error);
                if (error.response) {
                  console.error('Response data:', error.response.data);
                }
              }
            } else {
              console.log('lead_followup_3 has not been sent yet, skipping lead_if_no_status message');
            }
          }
        } catch (error) {
          console.error('Error updating status in Google Sheet:', error);
          if (error.response) {
            console.error('Response data:', error.response.data);
          }
          return false;
        }

        return true;
      }

      // Handle rating response
      if (messageText.startsWith('rating') || messageText.startsWith('rating ')) {
        const threadData = await this.getThreadData(senderNumber);
        if (!threadData || !threadData.rowIndex) {
          console.log('No row data found for sender');
          return false;
        }

        const rating = messageText.startsWith('rating') ?
          msg.body.substring('rating'.length).trim() :
          msg.body.substring('rating '.length).trim();

        console.log(`Updating rating to '${rating}' for row ${threadData.rowIndex}`);

        try {
          await this.sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            resource: {
              valueInputOption: 'RAW',
              data: [{
                range: `${this.dynamicSheetName}!V${threadData.rowIndex}`,
                values: [[rating]]
              }]
            }
          });
          console.log(`Successfully updated rating for row ${threadData.rowIndex}`);
          return true;
        } catch (error) {
          console.error('Error updating rating in Google Sheet:', error);
          if (error.response) {
            console.error('Response data:', error.response.data);
          }
          return false;
        }
      }

      // Handle feedback from lead
      if (messageText.startsWith('feedback') || messageText.startsWith('feedback ')) {
        const threadData = await this.getThreadData(senderNumber);
        if (!threadData || !threadData.rowIndex) {
          console.log('No row data found for sender');
          return false;
        }

        const feedback = messageText.startsWith('feedback') ?
          msg.body.substring('feedback'.length).trim().toLowerCase() :
          msg.body.substring('feedback '.length).trim().toLowerCase();

        console.log(`Updating feedback to '${feedback}' for row ${threadData.rowIndex}`);

        try {
          await this.sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            resource: {
              valueInputOption: 'RAW',
              data: [{
                range: `${this.dynamicSheetName}!W${threadData.rowIndex}`,
                values: [[feedback]]
              }]
            }
          });
          console.log(`Successfully updated feedback for row ${threadData.rowIndex}`);

          // Rest of the feedback handling code (retain pic/change pic logic)
          // ... existing code ...
          return true;
        } catch (error) {
          console.error('Error updating feedback in Google Sheet:', error);
          if (error.response) {
            console.error('Response data:', error.response.data);
          }
          return false;
        }
      }

      // Handle comments from lead
      if (messageText.startsWith('comment') || messageText.startsWith('comment ')) {
        const threadData = await this.getThreadData(senderNumber);
        if (!threadData || !threadData.rowIndex) {
          console.log('No row data found for sender');
          return false;
        }

        const comment = messageText.startsWith('comment') ?
          msg.body.substring('comment'.length).trim() :
          msg.body.substring('comment '.length).trim();

        console.log(`Updating comment for row ${threadData.rowIndex}`);

        try {
          // Get headers to find comment column index
          const headersResponse = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: `${this.dynamicSheetName}!A1:Y1`,
          });
          
          const headers = headersResponse.data.values[0];
          const commentIndex = headers.findIndex(header => header.toLowerCase() === 'comment');

          if (commentIndex === -1) {
            console.log('Comment column not found in headers');
            return false;
          }

          const columnLetter = String.fromCharCode(65 + commentIndex);
          await this.sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            resource: {
              valueInputOption: 'RAW',
              data: [{
                range: `${this.dynamicSheetName}!${columnLetter}${threadData.rowIndex}`,
                values: [[comment]]
              }]
            }
          });
          console.log(`Successfully updated comment in row ${threadData.rowIndex}, column ${columnLetter}`);
          return true;
        } catch (error) {
          console.error('Error updating comment in Google Sheet:', error);
          if (error.response) {
            console.error('Response data:', error.response.data);
          }
          return false;
        }
      }

      return false;
    } catch (error) {
      console.error('Error processing message:', error);
      console.error('Stack trace:', error.stack);
      return false;
    }
  }

  async addMessagetoFirebaseSimple(msg, idSubstring, extractedNumber) {
    try {
      if (!extractedNumber) {
        console.error('Invalid extractedNumber for Firebase document path:', extractedNumber);
        return;
      }

      if (!idSubstring) {
        console.error('Invalid idSubstring for Firebase document path');
        return;
      }

      const messageData = {
        chat_id: msg.from,
        from: msg.from ?? "",
        from_me: msg.fromMe ?? false,
        id: msg.id._serialized ?? "",
        status: "delivered",
        text: {
          body: msg.body ?? ""
        },
        timestamp: msg.timestamp ?? 0,
        type: msg.type === 'chat' ? 'text' : msg.type,
      };

      const contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber);
      const messagesRef = contactRef.collection('messages');

      const messageDoc = messagesRef.doc(msg.id._serialized);
      await messageDoc.set(messageData, { merge: true });
      console.log('Message data added to Firebase:', messageData);
    } catch (error) {
      console.error('Error adding message to Firebase:', error);
    }
  }

  // Add new method to store thread data when lead is passed
  async saveThreadData(contactID, rowIndex) {
    try {
      const docPath = `companies/${this.botName}/contacts/${contactID}`;
      await db.doc(docPath).set({
        rowIndex: rowIndex
      }, { merge: true });
      console.log(`Thread data saved to Firestore at ${docPath}`);
    } catch (error) {
      console.error('Error saving thread data to Firestore:', error);
    }
  }

  // Add new method to retrieve thread data
  async getThreadData(contactID) {
    try {
      const docPath = `companies/${this.botName}/contacts/${contactID}`;
      const doc = await db.doc(docPath).get();
      if (doc.exists) {
        return doc.data();
      }
      return null;
    } catch (error) {
      console.error('Error getting thread data from Firestore:', error);
      return null;
    }
  }

  async deleteScheduledMessages(phoneNumber, metadata) {
    try {
      console.log(`Attempting to delete ${metadata.type} messages for ${phoneNumber}`);
      
      const messageType = metadata.followUpNumber ? 
        `${metadata.type}_${metadata.followUpNumber}` : 
        metadata.type;

      const cleanupRequest = {
        method: 'POST',
        url: `${this.apiUrl}/api/schedule-message/${this.botName}/cleanup`,
        data: {
          contactNumber: `${phoneNumber}@c.us`,
          messageType: messageType,
          companyId: this.botName,
          rowIndex: metadata.rowIndex
        }
      };

      console.log('Sending cleanup request:', cleanupRequest);
      const response = await axios(cleanupRequest);
      console.log('Cleanup response:', response);

      if (response.data.success) {
        console.log(`Deleted scheduled ${metadata.type}${metadata.followUpNumber ? '_' + metadata.followUpNumber : ''} for row ${metadata.rowIndex}`);
      } else {
        console.log('No messages found to delete. Current filters:', cleanupRequest.data);
      }
    } catch (error) {
      console.error('Error deleting scheduled messages:', error);
      if (error.response) {
        console.error('Response data:', error.response.data);
      }
    }
  }

  // Add method to load processed rows on startup
  async loadProcessedRows() {
    try {
        const doc = await db.collection('processedRows').doc(this.botName).get();
        if (doc.exists) {
            const data = doc.data();
            this.processedRows = new Set(Object.keys(data));
            console.log(`Loaded ${this.processedRows.size} processed rows from Firebase`);
        }
    } catch (error) {
        console.error('Error loading processed rows:', error);
    }
  }
}

module.exports = SKCSpreadsheet;