const fetch = require('node-fetch');
const { google } = require('googleapis');
const moment = require('moment-timezone');
const axios = require('axios');
const admin = require('../firebase.js');
const db = admin.firestore();
const OpenAI = require('openai');
const openai = new OpenAI({
  apiKey: process.env.OPENAIKEY,
  assistantId: process.env.OPENAI_ASSISTANT_ID
});
const FormData = require('form-data');

class BookingCarCareGroup {
  constructor(botMap) {
    this.botName = '0255';
    this.apiUrl = 'http://localhost:8443';
    this.ghlConfig = {};
    this.botMap = botMap;
  }

  formatPhoneNumber(phone) {
    let cleaned = phone.replace(/\D/g, '');
    
    if (cleaned.startsWith('0')) {
        cleaned = '60' + cleaned.slice(1);
    }

    if (!cleaned.startsWith('60')) {
        cleaned = '60' + cleaned;
    }
    
    return cleaned;
  }

  async handleBookingCarCareCreateGroup(req, res) {
    console.log('Booking Car Care Lead Create Group');
    const data = req.body;
    console.log(data);

    const botData = this.botMap.get(this.botName);
    if (!botData || !botData[0].client) {
      console.log(`WhatsApp client not found for bot ${this.botName}`);
      return;
    }
    const client = botData[0].client;

    const customerPhone = this.formatPhoneNumber(data.lead_phone || '');
    const customerName = data.lead_name || '';
    const customerEmail = data.lead_email || '';
    const staffName = data.member_company_name || '';
    const staffEmail = data.member_email || '';
    const staffPhone = this.formatPhoneNumber(data.member_phone_number || '');
    const staffCode = data.utoken || '';
    const carPlate = data.car_no_plate || '';
    const carModel = data.car_model || '';
    const carBrand = data.car_brand || '';
    const carYear = data.car_made_year || '';
    const paint = data.paint_values_stringify || '';
    const serviceCategory = data.sub_name || '';
    const serviceDetail = data.sub_sub_name || '';
    const customerMessage = data.lead_message || '';

    const appointmentDateTime = data.appointment_date_time || '';
    let appointmentDate = '';
    let appointmentTime = '';

    if (appointmentDateTime) {
      const [datePart, timePart] = appointmentDateTime.split(' ');
      appointmentDate = datePart;
      appointmentTime = `${timePart} ${appointmentDateTime.split(' ')[2]}`;
    }

    const phoneWithPlus = staffPhone.startsWith('+') ? staffPhone : '+' + staffPhone;
    const phoneWithoutPlus = staffPhone.startsWith('+')? staffPhone.slice(1) : staffPhone;

    try {
      const merchantRef = db.collection('companies').doc(this.botName).collection('merchants').doc(staffEmail);
      let merchantIndex = 1;
      let requestIndex = 1;

      await db.runTransaction(async (transaction) => {
        const staffDoc = await transaction.get(merchantRef);
        
        if (!staffDoc.exists) {
          transaction.set(merchantRef, {
            bookingIndex: 1,
            requestIndex: 1,
            name: staffName,
            email: staffEmail,
            phone: phoneWithPlus,
            shopCode: staffCode,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          });
        } else {
          const staffData = staffDoc.data();
          
          // Check if last update was on a different day
          const now = moment().tz('Asia/Kuala_Lumpur');
          const lastUpdated = staffData.lastUpdated ? 
            moment(staffData.lastUpdated.toDate()).tz('Asia/Kuala_Lumpur') : 
            null;
          
          // Reset index to 1 if it's a new day or lastUpdated doesn't exist
          if (!lastUpdated || !lastUpdated.isSame(now, 'day')) {
            merchantIndex = 1;
            requestIndex = 1;
          } else {
            merchantIndex = (staffData.bookingIndex || 0) + 1;
            requestIndex = (staffData.requestIndex || 0) + 1;
          }
          
          transaction.update(merchantRef, { 
            bookingIndex: merchantIndex,
            requestIndex: requestIndex,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      });

      // Format current date as YYYYMMDD for document name
      const currentDate = moment().tz('Asia/Kuala_Lumpur').format('YYYYMMDD');
      const bookingRef = merchantRef.collection('bookings').doc(`${currentDate}-bookingIndex-${requestIndex}`);
      
      const bookingData = {
        requestIndex,
        customerPhone,
        customerName,
        customerEmail,
        staffName,
        staffEmail,
        staffPhone: phoneWithPlus,
        carPlate,
        carModel,
        carBrand,
        carYear,
        paint,
        serviceCategory,
        serviceDetail,
        customerMessage,
        appointmentDate,
        appointmentTime,
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await bookingRef.set(bookingData);

      const bookingRequestMessage = `BOOKING REQUEST -${requestIndex} | PENDING SHOP APPROVAL | ${customerName} | ${staffName} 

- Booking Status :  Pending Approval by the SHOP (${staffName}).
- Below is a copy of the recently submitted proposed Booking Schedule:-

- Customer Name : ${customerName}
- Customer Email : ${customerEmail}
- Customer Mobile : ${customerPhone}
- Car Number Plate : ${carPlate}
- Car Brand : ${carBrand}
- Car Model : ${carModel}
- Paint : ${paint}
- Car Made Year : ${carYear}
- Service Category : ${serviceCategory}
- Service Detail : ${serviceDetail}
- Service Date : ${appointmentDate}
- Service Time : ${appointmentTime}
- Customer Message : ${customerMessage}

Quote this message and reply with either 
'Accept'
'Decline'
'Reschedule'`;

      const staffWhatsAppId = `${phoneWithoutPlus.replace(/\D/g, '')}@c.us`;

      const msg = await client.sendMessage(staffWhatsAppId, bookingRequestMessage);
      await this.addMessagetoFirebase(msg, phoneWithPlus);
      let existingContact = await this.getContactDataFromDatabaseByPhone(phoneWithPlus);
      const contactRef = db.collection('companies').doc(this.botName).collection('contacts').doc(phoneWithPlus);

      if (!existingContact) {
        const newContact = {
          additionalEmails: [],
          address1: null,
          assignedTo: null,
          businessId: null,
          chat: {
            contact_id: phoneWithPlus,
            id: msg.to,
            name: msg.to.split('@')[0],
            not_spam: true,
            tags: [],
            timestamp: Math.floor(Date.now() / 1000),
            type: 'contact',
            unreadCount: 0,
          },
          chat_id: msg.to,
          city: null,
          companyName: null,
          contactName: msg.to.split('@')[0],
          createdAt: admin.firestore.Timestamp.now(),
          id: phoneWithPlus,
          name: staffName,
          email: staffEmail,
          calendarID: staffEmail,
          not_spam: false,
          phone: phoneWithPlus,
          phoneIndex: 0,
          pinned: false,
          profilePicUrl: '',
          tags: [],
          threadid: '',
          timestamp: 0,
          type: '',
          unreadCount: 0
        };

        await contactRef.set(newContact);
        existingContact = newContact;
      }

      if (existingContact.threadid) {
        await this.handleOpenAIMyMessage(msg.body, existingContact.threadid);
      } else {
        try {
          const thread = await this.createThread();
          const threadID = thread.id;
          await contactRef.update({ threadid: threadID });
          await this.handleOpenAIMyMessage(msg.body, threadID);
        } catch (error) {
          console.error('Error creating AI thread:', error);
        }
      }

      res.status(200).json({ message: 'Booking request sent to merchant' });
    } catch (error) {
      console.error('Error sending booking request:', error);
      res.status(500).json({ error: 'Failed to send booking request' });
    }
  }

  async handleIncomingMessage(msg, staffPhone, client) {
    if (msg.hasQuotedMsg) {
        console.log('handleIncomingMessage for bookingCarCareGroup');
        const quotedMsg = await msg.getQuotedMessage();
        const bookingDetails = this.parseBookingDetails(quotedMsg.body);

        if (bookingDetails) {
            if (msg.body.toLowerCase().startsWith('accept')) {
                await this.handleAcceptedBooking(bookingDetails, staffPhone, client);
            } else if (msg.body.toLowerCase().startsWith('decline')) {
                await this.handleDeclinedBooking(bookingDetails, staffPhone, client);
            } else if (msg.body.toLowerCase().startsWith('reschedule')) {
                await this.handleRescheduledBooking(bookingDetails, staffPhone, client);
            } else {
                console.log('Invalid response from staff');
            }
        } else {
            console.log('Quoted message does not contain valid booking details');
        }
    } else {
        console.log('Message does not have a quoted message with booking details');
    }
  }

  parseBookingDetails(quotedMessageBody) {
    const details = {};
    const lines = quotedMessageBody.split('\n');

    const titleLine = lines[0];

    const bookingIndexMatch = titleLine.match(/(?:BOOKING REQUEST|BOOKING RESCHEDULE REQUEST) -(\d+)/);
    const requestIndex = bookingIndexMatch ? bookingIndexMatch[1] : null;

    const merchantNameMatch = titleLine.match(/\|([^|]+)\|([^|]+)$/);
    const merchantName = merchantNameMatch ? merchantNameMatch[2].trim() : null;

    for (const line of lines) {
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim();
        if (key && value) {
            const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/^_+|_+$/g, '').trim();
            details[normalizedKey] = value;
        }
    }

    const keyMapping = {
        'customer_name': ['customer_name', 'name'],
        'customer_email': ['customer_email', 'email'],
        'customer_mobile': ['customer_mobile', 'mobile', 'phone'],
        'car_number_plate': ['car_number_plate', 'car_plate', 'plate'],
        'car_brand': ['car_brand', 'brand'],
        'car_model': ['car_model', 'model'],
        'paint': ['paint'],
        'car_made_year': ['car_made_year', 'year'],
        'service_category': ['service_category', 'category'],
        'service_detail': ['service_detail', 'detail'],
        'service_date': ['service_date', 'date'],
        'service_time': ['service_time', 'time'],
        'customer_message': ['customer_message', 'message']
    };

    const result = {};
    for (const [expectedKey, possibleKeys] of Object.entries(keyMapping)) {
        const matchedKey = possibleKeys.find(key => key in details);
        if (matchedKey) {
            result[expectedKey] = details[matchedKey];
        } else {
            console.log(`Missing required field: ${expectedKey}`);
        }
    }

    if (Object.keys(result).length === Object.keys(keyMapping).length) {
        return {
            requestIndex: requestIndex,
            merchantName: merchantName,
            customerName: result.customer_name,
            customerEmail: result.customer_email,
            customerPhone: result.customer_mobile,
            carPlate: result.car_number_plate,
            carBrand: result.car_brand,
            carModel: result.car_model,
            paint: result.paint,
            carYear: result.car_made_year,
            serviceCategory: result.service_category,
            serviceDetail: result.service_detail,
            appointmentDate: result.service_date,
            appointmentTime: result.service_time,
            customerMessage: result.customer_message
        };
    } else {
        return null;
    }
  }

  async handleAcceptedBooking(bookingRequest, staffPhone, client) {
    const { merchantName, customerName, customerEmail, customerPhone, carPlate, carBrand, carModel, paint, carYear, serviceCategory, serviceDetail, appointmentDate, appointmentTime, customerMessage } = bookingRequest;

    const merchantsRef = db.collection('companies').doc(this.botName).collection('merchants');
    const merchantsSnapshot = await merchantsRef.where('name', '==', merchantName).limit(1).get();
    
    if (merchantsSnapshot.empty) {
      console.error(`No merchant found with name: ${merchantName}`);
      throw new Error(`Merchant not found: ${merchantName}`);
    }
    
    const merchantDoc = merchantsSnapshot.docs[0];
    const merchantRef = merchantDoc.ref;
    let queueIndex = 1;
    let staffData = {};
    let staffCalendarID = '';

    await db.runTransaction(async (transaction) => {
      const staffDoc = await transaction.get(merchantRef);
      if (!staffDoc.exists) {
        throw new Error(`Merchant document does not exist: ${merchantRef.path}`);
      }
      
      staffData = staffDoc.data();
      staffCalendarID = staffData.calendarID;
      
      // Check if last update was on a different day
      const now = moment().tz('Asia/Kuala_Lumpur');
      const lastUpdated = staffData.lastUpdated ? 
        moment(staffData.lastUpdated.toDate()).tz('Asia/Kuala_Lumpur') : 
        null;
      
      // Reset index to 1 if it's a new day or lastUpdated doesn't exist
      if (!lastUpdated || !lastUpdated.isSame(now, 'day')) {
        queueIndex = 1;
      } else {
        queueIndex = (staffData.bookingIndex || 0) + 1;
      }
      
      transaction.update(merchantRef, { 
        bookingIndex: queueIndex,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    const bookingConfirmationMessage = `BOOKING CONFIRMED -${staffData.shopCode}-${queueIndex} | ${customerName} | ${merchantName}

- Customer Name : ${customerName}
- Customer Email : ${customerEmail}
- Customer Mobile : ${customerPhone}
- Car Number Plate : ${carPlate}
- Car Brand : ${carBrand}
- Car Model : ${carModel}
- Paint : ${paint}
- Car Made Year : ${carYear}
- Service Category : ${serviceCategory}
- Service Detail : ${serviceDetail}
- Service Date : ${appointmentDate}
- Service Time : ${appointmentTime}
- Customer Message : ${customerMessage}
    
IMPORTANT NOTE 

* Kindly be early 10-15 minutes prior BOOKED date & time to Avoid disappointment that your CONFIRMED BOOKING being CANCELLED & RESCHEDULE.
Thanks for your kind understanding & continuous support.`;

    const customerWhatsAppId = `${customerPhone.replace(/\D/g, '')}@c.us`;
    const staffWhatsAppId = `${staffPhone.replace(/\D/g, '')}@c.us`;

    const groupName = `BOOKING -${queueIndex} | ${customerName} | ${merchantName}`;
    const newGroup = await client.createGroup(groupName, [customerWhatsAppId, staffWhatsAppId]);

    console.log(`Group created: ${newGroup.gid._serialized}`);

    await client.sendMessage(newGroup.gid._serialized, bookingConfirmationMessage);
    const phoneWithPlus = `+${staffPhone.replace(/\D/g, '')}`;
    //const staffCalendarID = await this.getStaffCalendarID(phoneWithPlus);
    console.log('Staff Calendar ID:', staffCalendarID);
    await this.bookInCalendar(newGroup.gid._serialized, bookingRequest, staffCalendarID);

    // Schedule reminder messages
    await this.scheduleReminderMessages(newGroup.gid._serialized, bookingRequest, this.botName);
  }

  async scheduleReminderMessages(groupId, bookingRequest, botName) {
      const { appointmentDate, appointmentTime } = bookingRequest;
      const appointmentDateTime = moment(`${appointmentDate} ${appointmentTime}`, 'YYYY-MM-DD HH:mm');
      const now = moment();

      const reminders = [
          { 
              days: 3,
              minutes: 4320, 
              keyword: '3_days_before',
              template: `🗓 Appointment Reminder (3 Days)
Your appointment is in 3 days:

📅 ${appointmentDate}
⏰ ${appointmentTime}

Please arrive 5-10 minutes early.
If you need to reschedule, please contact us as soon as possible.`
          },
          { 
              days: 1,
              minutes: 1440, 
              keyword: '24_hours_before',
              template: `🗓 Appointment Reminder (24 Hours)
Your appointment is in 24 Hours:

📅 ${appointmentDate}
⏰ ${appointmentTime}

Please arrive 5-10 minutes early.
If you need to reschedule, please contact us as soon as possible.`
          },
          { 
              days: 0,
              minutes: 60, 
              keyword: '1_hour_before',
              template: `🗓 Appointment Reminder (1 Hour)
Your appointment is in 1 Hour:

📅 ${appointmentDate}
⏰ ${appointmentTime}

Please arrive 5-10 minutes early.
If you need to reschedule, please contact us as soon as possible.`
          }
      ];

      for (const reminder of reminders) {
          const reminderTime = appointmentDateTime.clone().subtract(reminder.minutes, 'minutes');
          
          if (reminderTime.isBefore(now)) {
              console.log(`Skipping ${reminder.keyword} reminder as it's in the past`);
              continue;
          }

          try {
              const scheduledMessageData = {
                  chatIds: [groupId],
                  message: reminder.template,
                  messages: [{
                      chatId: groupId,
                      message: reminder.template,
                      delay: 0
                  }],
                  batchQuantity: 1,
                  companyId: botName,
                  createdAt: {
                      seconds: Math.floor(Date.now() / 1000),
                      nanoseconds: 0
                  },
                  scheduledTime: {
                      seconds: Math.floor(reminderTime.valueOf() / 1000),
                      nanoseconds: 0
                  },
                  status: "scheduled",
                  messageFormat: "single",
                  hasAdditionalMessages: false,
                  infiniteLoop: false,
                  v2: true,
                  metadata: {
                      type: 'booking_reminder',
                      keyword: reminder.keyword
                  }
              };

              try {
                  const response = await axios.post(
                      `http://localhost:8443/api/schedule-message/${botName}`,
                      scheduledMessageData
                  );
                  console.log(`Scheduled reminder for ${reminder.keyword} at ${reminderTime.format()}`);
                  console.log('Schedule response:', response.data);
              } catch (error) {
                  console.error(`Error scheduling reminder for ${reminder.keyword}:`, error.message);
                  if (error.response) {
                      console.error('Response status:', error.response.status);
                      console.error('Response data:', error.response.data);
                  }
                  console.error('Scheduled message data:', JSON.stringify(scheduledMessageData, null, 2));
              }
          } catch (error) {
              console.error(`Error scheduling reminder for ${reminder.keyword}:`, error);
              if (error.response) {
                  console.error('Response status:', error.response.status);
                  console.error('Response data:', error.response.data);
              }
          }
      }
  }

  async handleDeclinedBooking(bookingRequest, staffPhone, client) {
    const { requestIndex, merchantName, customerName, customerPhone } = bookingRequest;

    const bookingDeclineMessage = `BOOKING DECLINED -${requestIndex} | ${customerName} | ${merchantName}

    Your Booking Request has been declined by the merchant.
    We sincerely apologize for the inconvenience caused.

    Please try again later`;

    const customerWhatsAppId = `${customerPhone.replace(/\D/g, '')}@c.us`;
    const msg = await client.sendMessage(customerWhatsAppId, bookingDeclineMessage);
    await this.addMessagetoFirebase(msg, this.botName, customerPhone);
  }

  async handleRescheduledBooking(bookingRequest, staffPhone, client) {
    const { requestIndex, merchantName, customerName, customerPhone } = bookingRequest;

    const rescheduleMessage = `BOOKING RESCHEDULED -${requestIndex} | ${customerName} | ${merchantName}

The SHOP requested to change the booking date and time.

Could you let me know what is your new preferred date & time?`;

    const customerWhatsAppId = `${customerPhone.replace(/\D/g, '')}@c.us`;
    const msg = await client.sendMessage(customerWhatsAppId, rescheduleMessage);
    
    const firebaseCustomerPhone = `+${customerPhone.replace(/\D/g, '')}`;
    await this.addMessagetoFirebase(msg, firebaseCustomerPhone);
    let existingContact = await this.getContactDataFromDatabaseByPhone(firebaseCustomerPhone, this.botName);
    const contactRef = db.collection('companies').doc(this.botName).collection('contacts').doc(firebaseCustomerPhone);
    const contactDoc = await contactRef.get();

    const newDetails = {
      bookingDetails: bookingRequest,
      requestIndex: requestIndex,
      merhcantPhone: staffPhone,
      merchantName: merchantName,
    };

    await contactRef.set(newDetails, { merge: true });

    if (existingContact.threadid) {
        await this.handleOpenAIMyMessage(msg.body, existingContact.threadid);
    }else {
        try {
            const thread = await this.createThread();
            const threadID = thread.id;
            await contactRef.update({ threadid: threadID });
            await this.handleOpenAIMyMessage(msg.body, threadID);
        } catch (error) {
            console.error('Error creating AI thread:', error);
        }
    }
  }

  async getStaffCalendarID(staffPhone) {
    const contactsRef = db.collection('companies').doc(this.botName).collection('contacts');
    const querySnapshot = await contactsRef.where('phone', '==', staffPhone).get();
    if (querySnapshot.empty) {
        console.error('No contact found for staff:', staffPhone);
        return null;
    } else {
        const doc = querySnapshot.docs[0];
        const contactData = doc.data();
        return contactData.calendarID;
    }
  }

  async bookInCalendar(groupChatId, bookingRequest, calendarID) {
    console.log('Booking in Google Calendar...');
    try {
      if (!calendarID) {
        console.error('No Google Calendar ID found in config');
        return { error: 'No Google Calendar ID configured' };
      }
  
      const { customerName, customerEmail, customerPhone, carPlate, carBrand, carModel, paint, carYear, serviceCategory, serviceDetail, appointmentDate, appointmentTime, customerMessage } = bookingRequest;

      console.log('Appointment Date:', appointmentDate);
      console.log('Appointment Time:', appointmentTime);

      // Parse the date
      let year, month, day;
      if (appointmentDate.includes('-')) {
        // Format: "2025-02-24"
        [year, month, day] = appointmentDate.split('-');
      } else {
        // Format: "02/24/2025"
        [month, day, year] = appointmentDate.split('/');
      }
      const formattedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

      let time24 = appointmentTime;
      if (appointmentTime.includes(':')) {
        const [hours, minutes] = appointmentTime.split(':');
        let hour24 = parseInt(hours, 10);

        if (appointmentTime.toLowerCase().includes('am') || appointmentTime.toLowerCase().includes('pm')) {
          // 12-hour format: "04:00 PM"
          const period = appointmentTime.slice(-2).toLowerCase();
          if (period === 'pm' && hour24 !== 12) {
            hour24 += 12;
          } else if (period === 'am' && hour24 === 12) {
            hour24 = 0;
          }
          time24 = `${hour24.toString().padStart(2, '0')}:${minutes.slice(0, 2)}`;
        } else {
          // 24-hour format: "14:00"
          time24 = `${hour24.toString().padStart(2, '0')}:${minutes.slice(0, 2)}`;
        }
      } else {
        console.error('Invalid time format:', appointmentTime);
        throw new Error('Invalid time format');
      }

      const startDateTime = new Date(`${formattedDate}T${time24}`);
      console.log('Start Date Time:', startDateTime);

      if (isNaN(startDateTime.getTime())) {
        throw new Error('Invalid start date time');
      }

      const slotDuration = 60;
      const roundedStart = new Date(Math.ceil(startDateTime.getTime() / (slotDuration * 60 * 1000)) * (slotDuration * 60 * 1000));
      console.log('Rounded Start:', roundedStart);

      const appointmentDuration = 60;
      const end = new Date(roundedStart.getTime() + appointmentDuration * 60 * 1000);
      console.log('End:', end);

      const formattedTitle = `${customerPhone} - ${serviceCategory}`;
      const formattedDesc = `BOOKING CONFIRMED

    - Customer Name : ${customerName}
    - Customer Email : ${customerEmail}
    - Customer Mobile : ${customerPhone}
    - Car No. plate : ${carPlate}
    - Car Brand : ${carBrand}
    - Car Model : ${carModel}
    - Car Made Year : ${carYear}
    - Paint : ${paint}
    - Service Category : ${serviceCategory}
    - Service Detail : ${serviceDetail}
    - Service Date : ${appointmentDate}
    - Service Time : ${appointmentTime}
    - Customer Message : ${customerMessage}
    - Group Chat ID : ${groupChatId}`;

      const auth = new google.auth.GoogleAuth({
        keyFile: './service_account.json',
        scopes: ['https://www.googleapis.com/auth/calendar'],
      });
  
      const calendar = google.calendar({ version: 'v3', auth });
  
      const event = {
        summary: formattedTitle,
        description: formattedDesc,
        start: {
          dateTime: roundedStart.toISOString(),
          timeZone: 'Asia/Kuala_Lumpur',
        },
        end: {
          dateTime: end.toISOString(),
          timeZone: 'Asia/Kuala_Lumpur',
        },
      };
  
      const createdEvent = await calendar.events.insert({
        calendarId: calendarID,
        resource: event,
      });
  
      console.log('Event created: %s', createdEvent.data.htmlLink);  
    } catch (error) {
      console.error('Error in bookInCalendar:', error);
    }
  }

  async getContactDataFromDatabaseByPhone(phoneNumber) {
    try {
        if (!phoneNumber) {
            throw new Error("Phone number is undefined or null");
        }
  
        let threadID;
        let contactName;
        let bot_status;
        const contactsRef = db.collection('companies').doc(this.botName).collection('contacts');
        const querySnapshot = await contactsRef.where('phone', '==', phoneNumber).get();
  
        if (querySnapshot.empty) {
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
        throw error;
    }
  }

  async addMessagetoFirebase(msg, extractedNumber) {
    console.log('Adding message to Firebase');
    console.log('idSubstring:', this.botName);
    console.log('extractedNumber:', extractedNumber);

    if (!extractedNumber) {
        console.error('Invalid extractedNumber for Firebase document path:', extractedNumber);
        return;
    }

    let messageBody = msg.body;
    let audioData = null;
    let type = '';
    if(msg.type == 'chat'){
        type ='text'
    }else if(msg.type == 'e2e_notification' || msg.type == 'notification_template'){
        return;
    }else{
        type = msg.type;
    }
    
    if (msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt')) {
        console.log('Voice message detected');
        const media = await msg.downloadMedia();
        const transcription = await this.transcribeAudio(media.data);
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

    if(msg.hasQuotedMsg){
        const quotedMsg = await msg.getQuotedMessage();
        // Initialize the context and quoted_content structure
        messageData.text.context = {
            quoted_content: {
            body: quotedMsg.body
            }
        };
        const authorNumber = '+'+(quotedMsg.from).split('@')[0];
        const authorData = await this.getContactDataFromDatabaseByPhone(authorNumber);
        messageData.text.context.quoted_author = authorData ? authorData.contactName : authorNumber;
    }

    if((msg.from).includes('@g.us')){
        const authorNumber = '+'+(msg.author).split('@')[0];

        const authorData = await this.getContactDataFromDatabaseByPhone(authorNumber);
        if(authorData){
            messageData.author = authorData.contactName;
        }else{
            messageData.author = msg.author;
        }
    }

    if (msg.type === 'audio' || msg.type === 'ptt') {
        messageData.audio = {
            mimetype: 'audio/ogg; codecs=opus', // Default mimetype for WhatsApp voice messages
            data: audioData // This is the base64 encoded audio data
        };
    }

    if (msg.hasMedia &&  (msg.type !== 'audio' || msg.type !== 'ptt')) {
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

    const contactRef = db.collection('companies').doc(this.botName).collection('contacts').doc(extractedNumber);
    const messagesRef = contactRef.collection('messages');

    const messageDoc = messagesRef.doc(msg.id._serialized);
    await messageDoc.set(messageData, { merge: true });
    console.log(messageData);
    return messageData;
  }

  async handleOpenAIMyMessage(message, threadId) {
    query = `You sent this to the user: ${message}. Please remember this for the next interaction. Do not re-send this query to the user, this is only for you to remember the interaction.`;
    await this.addMessageAssistant(threadId, query);
  }

  async addMessageAssistant(threadId, message) {
    const response = await openai.beta.threads.messages.create(
        threadId,
        {
            role: "user",
            content: message
        }
    );
    return response;
  }
  
  async createThread() {
    const thread = await openai.beta.threads.create();
    return thread;
  }

  async transcribeAudio(audioData) {
      try {
          const formData = new FormData();
          
          // Check if audioData is already a Buffer, if not, convert it
          const audioBuffer = Buffer.isBuffer(audioData) ? audioData : Buffer.from(audioData, 'base64');
          
          formData.append('file', audioBuffer, {
              filename: 'audio.ogg',
              contentType: 'audio/ogg; codecs=opus',
          });
          formData.append('model', 'whisper-1');
          formData.append('response_format', 'json');
  
          const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
              headers: {
                  ...formData.getHeaders(),
                  'Authorization': `Bearer ${process.env.OPENAIKEY}`,
              },
          });
  
          if (!response.data || !response.data.text) {
              throw new Error('Transcription response is missing or invalid');
          }
  
          return response.data.text;
      } catch (error) {
          console.error('Error transcribing audio:', error);
          return 'Audio transcription failed. Please try again.';
      }
  }
}

module.exports = BookingCarCareGroup;