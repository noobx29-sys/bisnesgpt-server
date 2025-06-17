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


class MTDCReport {
  constructor(botMap) {
    this.botName = '0380';
    this.spreadsheetId = '1bW-KOpZ0lUDVNT4A6GZzzsIrne6MTBeBszrbOMyzoLI';
    this.sheetName = 'Submissions';
    this.range = `${this.sheetName}!A2:I`;
    this.botMap = botMap;

    this.auth = new google.auth.GoogleAuth({
      keyFile: './service_account.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
    this.remindersFile = path.join(__dirname, 'sentMTDCReminders.json');
    this.sentReminders = {};
    this.weeklyReportSchedule = null;
    this.lastProcessedTimestamp = null;
    this.loadProcessedEntries();
  }

  async loadProcessedEntries() {
    try {
      if (fs.existsSync(this.remindersFile)) {
        const data = await readFileAsync(this.remindersFile, 'utf8');
        this.sentReminders = JSON.parse(data);
      } else {
        this.sentReminders = {};
        await this.saveProcessedEntries();
      }
    } catch (error) {
      console.error('Error loading processed entries:', error);
      this.sentReminders = {};
    }
  }

  async saveProcessedEntries() {
    try {
      await writeFileAsync(this.remindersFile, JSON.stringify(this.sentReminders, null, 2), 'utf8');
    } catch (error) {
      console.error('Error saving processed entries:', error);
    }
  }

  async loadLastProcessedTimestamp() {
    try {
      const timestampFile = path.join(__dirname, 'lastMTDCTimestamp.json');
      
      if (fs.existsSync(timestampFile)) {
        const data = await readFileAsync(timestampFile, 'utf8');
        const timestampData = JSON.parse(data);
        this.lastProcessedTimestamp = timestampData.timestamp;
        console.log(`Loaded last processed timestamp: ${this.lastProcessedTimestamp}`);
      } else {
        this.lastProcessedTimestamp = null;
        console.log('No previous timestamp found, will process all entries');
      }
    } catch (error) {
      console.error('Error loading last processed timestamp:', error);
      this.lastProcessedTimestamp = null;
    }
  }

  async saveLastProcessedTimestamp(timestamp) {
    try {
      const timestampFile = path.join(__dirname, 'lastMTDCTimestamp.json');
      const timestampData = { timestamp };
      await writeFileAsync(timestampFile, JSON.stringify(timestampData, null, 2), 'utf8');
      console.log(`Saved last processed timestamp: ${timestamp}`);
    } catch (error) {
      console.error('Error saving last processed timestamp:', error);
    }
  }

  async readMTDCSheet(){
    try {      
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: this.range,
      });
      
      const rows = response.data.values;
      
      if (rows.length > 0) {
        return rows;
      } else {
        console.log('No data found.');
        return [];
      }
    } catch (error) {
      console.error('Error reading MTDC sheet:', error);
      return [];
    }
  }

  async checkForNewEntries() {
    try {
      const rows = await this.readMTDCSheet();
      if (!rows.length) return;

      let latestTimestamp = this.lastProcessedTimestamp;
      let processedAnyRows = false;

      const sortedRows = [...rows].sort((a, b) => {
        const dateA = moment(a[0], 'DD/MM/YYYY HH:mm:ss');
        const dateB = moment(b[0], 'DD/MM/YYYY HH:mm:ss');
        return dateA.valueOf() - dateB.valueOf();
      });

      for (const row of sortedRows) {
        const [submissionDate, fullName, company, phone, email, programName, programDateTime, rsvpStatus, attendanceStatus] = row;
        
        if (this.lastProcessedTimestamp) {
          const rowDate = moment(submissionDate, 'DD/MM/YYYY HH:mm:ss');
          const lastProcessedDate = moment(this.lastProcessedTimestamp, 'DD/MM/YYYY HH:mm:ss');
          
          if (rowDate.isSameOrBefore(lastProcessedDate)) {
            continue;
          }
        }
        
        const entryId = `${phone}-${programName}-${programDateTime}`.replace(/\s+/g, '');
        
        if (this.sentReminders[entryId]) {
          console.log(`Skipping already processed entry ID ${entryId} for ${fullName}`);
          continue;
        }
        
        console.log(`Found new entry: ${fullName} for program ${programName} on ${programDateTime}`);
        
        await this.scheduleReminders(entryId, row);
        
        this.sentReminders[entryId] = {
          processed: true,
          scheduledAt: new Date().toISOString(),
          reminders: []
        };

        if (!latestTimestamp || moment(submissionDate, 'DD/MM/YYYY HH:mm:ss').isAfter(moment(latestTimestamp, 'DD/MM/YYYY HH:mm:ss'))) {
          latestTimestamp = submissionDate;
        }
        
        processedAnyRows = true;
      }
      
      await this.saveProcessedEntries();
      
      if (processedAnyRows && latestTimestamp) {
        this.lastProcessedTimestamp = latestTimestamp;
        await this.saveLastProcessedTimestamp(latestTimestamp);
      }
      
    } catch (error) {
      console.error('Error checking for new entries:', error);
    }
  }

  async scheduleReminders(entryId, rowData) {
    try {
      const [submissionDate, fullName, company, phone, email, programName, programDateTime, rsvpStatus] = rowData;
      
      const programDate = moment(programDateTime, 'DD/MM/YYYY HH:mm');
      
      if (!programDate.isValid()) {
        console.error(`Invalid program date format for ${fullName}: ${programDateTime}`);
        return;
      }
      
      const reminderDays = [5, 4, 1];
      
      for (const days of reminderDays) {
        const reminderDate = moment(programDate).subtract(days, 'days');
        const now = moment();
        
        if (reminderDate.isBefore(now)) {
          console.log(`Skipping past reminder for ${fullName}, ${days} days before event`);
          continue;
        }
        
        const reminder = {
          entryId,
          fullName,
          phone,
          programName,
          programDateTime,
          reminderDays: days,
          scheduledFor: reminderDate.toISOString()
        };
        
        if (!this.sentReminders[entryId]) {
          this.sentReminders[entryId] = {
            processed: true,
            scheduledAt: new Date().toISOString(),
            reminders: []
          };
        }
        
        this.sentReminders[entryId].reminders.push(reminder);
        
        await this.scheduleReminderMessages(reminder);
        
        console.log(`Scheduled reminder for ${fullName} ${days} days before ${programName} on ${reminderDate.format('DD/MM/YYYY HH:mm')}`);
      }
    } catch (error) {
      console.error(`Error scheduling reminders for entry ${entryId}:`, error);
    }
  }

  async scheduleReminderMessages(reminder) {
    try {
      const reminderDate = new Date(reminder.scheduledFor);
      
      let messageContent = '';
      switch (reminder.reminderDays) {
        case 5:
          messageContent = `Hi ${reminder.fullName}, this is a reminder that you have registered for ${reminder.programName} which will be held on ${reminder.programDateTime}. We look forward to seeing you there!`;
          break;
        case 4:
          messageContent = `Hello ${reminder.fullName}, just to confirm that you are attending the ${reminder.programName} coming up in 4 days on ${reminder.programDateTime}. Will you be attending the event?`;
          break;
        case 1:
          messageContent = `Hello ${reminder.fullName}, tomorrow is the big day! ${reminder.programName} will be held on ${reminder.programDateTime}. We can't wait to see you there!`;
          break;
      }
      
      const scheduledTimeSeconds = Math.floor(reminderDate.getTime() / 1000);
      
      console.log('Scheduling reminder for:', moment(reminderDate).format());
      console.log('Scheduled time in seconds:', scheduledTimeSeconds);
      
      const chatId = this.formatPhone(reminder.phone);
      
      const scheduledMessage = {
        batchQuantity: 1,
        chatIds: [chatId],
        companyId: this.botName,
        createdAt: admin.firestore.Timestamp.now(),
        documentUrl: "",
        fileName: "",
        mediaUrl: "",
        message: messageContent,
        messages: [
          {
            chatId: chatId,
            message: messageContent
          }
        ],
        mimeType: "",
        repeatInterval: 0,
        repeatUnit: "days",
        scheduledTime: {
          seconds: scheduledTimeSeconds,
          nanoseconds: 0
        },
        status: "scheduled",
        v2: true,
        whapiToken: null
      };
      
      try {
        console.log('Sending schedule request:', JSON.stringify(scheduledMessage));
        const response = await axios.post(`http://localhost:8443/api/schedule-message/${this.botName}`, scheduledMessage);
        console.log('Reminder scheduled successfully:', response.data);        
      } catch (error) {
        console.error('Error scheduling reminder:', error.response ? error.response.data : error.message);
        if (error.response && error.response.data) {
          console.error('Server response:', error.response.data);
        }
      }
      
    } catch (error) {
      console.error('Error scheduling reminder message:', error);
    }
  }

  async formatPhone(phone) {
    let formattedPhone = phone.replace(/\D/g, '');
    
    if (formattedPhone.startsWith('60')) {
      formattedPhone = `${formattedPhone}@c.us`;
    } else if (formattedPhone.startsWith('0')) {
      formattedPhone = `6${formattedPhone}@c.us`;
    } else {
      formattedPhone = `60${formattedPhone}@c.us`;
    }
    
    return formattedPhone;
  }

  async sendRSVPStatusReports() {
    try {
      console.log('Generating RSVP status reports for upcoming programs...');
      
      const rows = await this.readMTDCSheet();
      if (!rows.length) return;
      
      const programGroups = {};
      
      for (const row of rows) {
        const [submissionDate, fullName, company, phone, email, programName, programDateTime, rsvpStatus, attendanceStatus] = row;
        
        const programDate = moment(programDateTime, 'DD/MM/YYYY HH:mm');
        
        if (!programDate.isValid()) {
          console.log(`Skipping entry with invalid date format: ${programDateTime}`);
          continue;
        }
        
        const today = moment().startOf('day');
        const programDay = programDate.clone().startOf('day');
        const daysUntilProgram = programDay.diff(today, 'days');
        
        if (daysUntilProgram === 3) {
          const programKey = `${programName}-${programDate.format('YYYY-MM-DD')}`;
          
          if (!programGroups[programKey]) {
            programGroups[programKey] = {
              programName,
              programDateTime,
              entries: []
            };
          }
          
          programGroups[programKey].entries.push({
            fullName,
            company,
            phone,
            email,
            rsvpStatus: rsvpStatus || 'Awaiting Response'
          });
        }
      }
      
      for (const programKey in programGroups) {
        const program = programGroups[programKey];
        
        if (program.entries.length > 0) {
          await this.generateAndSendRSVPReport(program);
        }
      }
      
    } catch (error) {
      console.error('Error sending RSVP status reports:', error);
    }
  }
  
  async generateAndSendRSVPReport(program) {
    try {
      const programDate = moment(program.programDateTime, 'DD/MM/YYYY HH:mm');
      const formattedDate = programDate.format('DD MMM YYYY');
      const formattedTime = programDate.format('h:mm A');
      
      let reportContent = `*RSVP STATUS REPORT*\n\n`;
      reportContent += `*Program:* ${program.programName}\n`;
      reportContent += `*Date:* ${formattedDate}\n`;
      reportContent += `*Time:* ${formattedTime}\n`;
      reportContent += `*Days Remaining:* 3 days\n\n`;
      
      const statusCounts = {
        'Accepted': 0,
        'Declined': 0,
        'Awaiting Response': 0
      };
      
      program.entries.forEach(entry => {
        const status = entry.rsvpStatus || 'Awaiting Response';
        
        if (statusCounts[status] !== undefined) {
          statusCounts[status]++;
        } else {
          statusCounts['Awaiting Response']++;
        }
      });
      
      reportContent += `*RSVP Summary:*\n`;
      reportContent += `Total Registrations: ${program.entries.length}\n`;
      reportContent += `Confirmed (Accepted): ${statusCounts['Accepted']}\n`;
      reportContent += `Declined: ${statusCounts['Declined']}\n`;
      reportContent += `Awaiting Response: ${statusCounts['Awaiting Response']}\n\n`;
      
      reportContent += `*Participant List:*\n\n`;
      
      const statusGroups = {
        'Accepted': [],
        'Declined': [],
        'Awaiting Response': []
      };
      
      program.entries.forEach(entry => {
        const status = entry.rsvpStatus || 'Awaiting Response';
        
        if (statusGroups[status] !== undefined) {
          statusGroups[status].push({...entry, rsvpStatus: status});
        } else {
          statusGroups['Awaiting Response'].push({...entry, rsvpStatus: 'Awaiting Response'});
        }
      });
      
      const statusOrder = ['Accepted', 'Awaiting Response', 'Declined'];
      
      statusOrder.forEach(status => {
        if (statusGroups[status].length > 0) {
          reportContent += `*${status}:*\n`;
          
          statusGroups[status].forEach((entry, index) => {
            reportContent += `${index + 1}. ${entry.fullName} (${entry.company})\n`;
            reportContent += `   📱 ${entry.phone}\n`;
            reportContent += `   📧 ${entry.email}\n\n`;
          });
        }
      });
      
      let reportStaffId = "120363386875697540@g.us";
      
      const client = this.botMap.get(this.botName);
      
      if (!client) {
        console.error(`Whatsapp client for ${this.botName} not found`);
        return;
      }
      
      await client.sendMessage(reportStaffId, reportContent);
      
      console.log(`RSVP status report sent for ${program.programName} on ${formattedDate}`);
      
    } catch (error) {
      console.error('Error generating and sending RSVP report:', error);
    }
  }

  async initialize(){
    const cronConfig = {
      timezone: "Asia/Kuala_Lumpur",
      scheduled: true,
      runOnInit: true
    };

    await this.loadLastProcessedTimestamp();

    cron.schedule('*/10 * * * *', async () => {
      console.log('Checking for new MTDC entries at', moment().format('YYYY-MM-DD HH:mm:ss'));
      await this.checkForNewEntries();
    }, cronConfig);

    cron.schedule('0 9 * * *', async () => {
      console.log('Checking for upcoming programs to send RSVP reports at', moment().format('YYYY-MM-DD HH:mm:ss'));
      await this.sendRSVPStatusReports();
    }, cronConfig);
  }
}

module.exports = MTDCReport;