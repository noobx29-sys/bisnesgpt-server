const admin = require('firebase-admin');
const db = admin.firestore();
const fetch = require('node-fetch');
const cron = require('node-cron');

class appointmentWatcher {
  constructor() {
    // Empty constructor is fine
  }

  async scheduleAppointmentReminder(appointment, userEmail) {
    try {
      console.log(`Scheduling reminders for appointment ${appointment.id} for user ${userEmail}`);
      
      let enabledReminders = [];
      
      // Try to fetch reminder configuration from Firebase
      const userDoc = await db.collection('user').doc(userEmail).get();
      const userData = userDoc.data();
      const companyId = userData.companyId;

      if (!companyId) {
        throw new Error(`No companyId found for user ${userEmail}`);
      }

      // Update the path to look for reminders under the company's config
      const reminderConfigDoc = await db.collection('companies').doc(companyId).collection('config').doc('reminders').get();
      console.log('Reminder config document:', {
        exists: reminderConfigDoc.exists,
        data: reminderConfigDoc.exists ? reminderConfigDoc.data() : null,
        path: reminderConfigDoc.ref.path
      });
      
      if (reminderConfigDoc.exists) {
        const reminderConfig = reminderConfigDoc.data().reminders || [];
        console.log('Found reminder configuration:', reminderConfig);
        enabledReminders = reminderConfig.filter(reminder => reminder.enabled);
        console.log('Enabled reminders:', enabledReminders);
      }

      // If no enabled reminders found or document doesn't exist, use fallback
      if (enabledReminders.length === 0) {
        console.log('No enabled reminders found in configuration, using fallback configuration');
        enabledReminders = [
          {
            enabled: true,
            message: "🗓️ Appointment Reminder\nHello {name},\nYour appointment is tomorrow at {time} on {when}.\nLocation: {location}\nDetails: {details}\n{meetLink}\nPlease join 5-10 minutes early. If you need to reschedule, please contact us as soon as possible.",
            time: 24,
            timeUnit: "hours",
            type: "before"
          },
          {
            enabled: true,
            message: "🗓️ Appointment Reminder\nHello {name},\nThis is a reminder that your appointment is in 1 hour at {time} today.\nLocation: {location}\nDetails: {details}\n{meetLink}\nPlease join 5-10 minutes early. If you need to reschedule, please contact us as soon as possible.",
            time: 1,
            timeUnit: "hours",
            type: "before"
          }
        ];
      }

      const appointmentTime = new Date(appointment.startTime);
      const formattedDate = appointmentTime.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const formattedTime = appointmentTime.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      const contactPhone = appointment.contacts[0]?.id;
      console.log('\n=== Appointment Contact Details ===');
      console.log('Raw contact phone:', contactPhone);
      console.log('Full contact:', appointment.contacts[0]);
      
      if (!contactPhone) {
        throw new Error('No contact phone found for appointment');
      }

      const createMessage = (reminderConfig, appointmentTime) => {
        // Replace placeholders in the message with actual values
        return reminderConfig.message
          .replace('{when}', formattedDate)
          .replace('{time}', formattedTime)
          .replace('{name}', appointment.contacts[0]?.name || 'there')
          .replace('{location}', appointment.address || 'Not specified')
          .replace('{details}', appointment.details || 'Not specified')
          .replace('{meetLink}', appointment.meetLink || '');
      };

      // Format phone number to ensure it has country code and proper format
      const formatPhoneNumber = (phone) => {
        console.log('\n=== Phone Number Formatting ===');
        console.log('Input phone:', phone);
        
        // If this is already a WhatsApp ID format, return as is
        if (phone.includes('@c.us')) {
          console.log('Already in WhatsApp format:', phone);
          return phone;
        }
        
        // Remove the '+' if present and any other non-digit characters
        let cleaned = phone.replace(/^\+/, '').replace(/\D/g, '');
        console.log('Cleaned number:', cleaned);
        
        // For Malaysian numbers:
        // If starts with '60', use as is
        // If starts with '0', replace with '60'
        // Otherwise, add '60'
        if (!cleaned.startsWith('60')) {
          cleaned = cleaned.startsWith('0') 
            ? '60' + cleaned.slice(1)
            : '60' + cleaned;
        }
        
        console.log('Final number:', cleaned);
        return cleaned + '@c.us'; // Add WhatsApp suffix
      };

      // Add validation before sending
      const validatePhoneNumber = (phone) => {
        try {
          console.log('\n=== Phone Validation Start ===');
          console.log('Validating phone:', phone);
          
          // Remove the '+' if present and any other non-digit characters
          let cleaned = phone.replace(/^\+/, '').replace(/\D/g, '');
          
          // For Malaysian numbers:
          // If starts with '60', use as is
          // If starts with '0', replace with '60'
          // Otherwise, add '60'
          if (!cleaned.startsWith('60')) {
            cleaned = cleaned.startsWith('0') 
              ? '60' + cleaned.slice(1)
              : '60' + cleaned;
          }
          
          // Validate the number format (should be 11-12 digits starting with 60)
          if (!/^60\d{9,10}$/.test(cleaned)) {
            console.log('❌ Validation failed for:', cleaned);
            throw new Error(`Invalid phone number format: ${cleaned}`);
          }
          
          console.log('✅ Validation passed:', cleaned);
          console.log('=== Phone Validation End ===\n');
          
          return cleaned + '@c.us';
        } catch (error) {
          console.error('❌ Phone validation failed:', error);
          throw error;
        }
      };

      // Schedule reminders based on configuration
      const messageIds = [];
      for (const reminder of enabledReminders) {
        const reminderTime = new Date(appointment.startTime);
        if (reminder.type === 'before') {
          if (reminder.timeUnit === 'hours') {
            reminderTime.setHours(reminderTime.getHours() - reminder.time);
          } else if (reminder.timeUnit === 'minutes') {
            reminderTime.setMinutes(reminderTime.getMinutes() - reminder.time);
          } else if (reminder.timeUnit === 'days') {
            reminderTime.setDate(reminderTime.getDate() - reminder.time);
          }
        }
        // Add support for 'after' type
        else if (reminder.type === 'after') {
          if (reminder.timeUnit === 'hours') {
            reminderTime.setHours(reminderTime.getHours() + reminder.time);
          } else if (reminder.timeUnit === 'minutes') {
            reminderTime.setMinutes(reminderTime.getMinutes() + reminder.time);
          } else if (reminder.timeUnit === 'days') {
            reminderTime.setDate(reminderTime.getDate() + reminder.time);
          }
        }

        const scheduledMessage = {
          companyId,
          scheduledTime: {
            seconds: Math.floor(reminderTime.getTime() / 1000),
            nanoseconds: 0
          },
          message: createMessage(reminder, reminderTime),
          chatIds: [],
          batchQuantity: 1,
          repeatInterval: 0,
          repeatUnit: 'minutes',
          v2: true,
          minDelay: 0,
          maxDelay: 1,
          phoneIndex: 0,
          type: 'appointment_reminder',
          appointmentId: appointment.id,
          metadata: {
            appointmentTime: appointment.startTime,
            contactName: appointment.contacts[0]?.name || '',
            userEmail,
            reminderType: `${reminder.time} ${reminder.timeUnit}`
          }
        };

        try {
          const validatedPhone = validatePhoneNumber(contactPhone);
          console.log('Using validated phone number:', validatedPhone);
          scheduledMessage.chatIds = [validatedPhone];
          
          console.log('\n=== Scheduled Message Details ===');
          console.log('Message chatIds:', scheduledMessage.chatIds);
        } catch (error) {
          console.error(`Invalid phone number format for appointment ${appointment.id}:`, error);
          throw error;
        }

        const response = await fetch(`http://localhost:${process.env.PORT}/api/schedule-message/${companyId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(scheduledMessage)
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          throw new Error(`Failed to schedule ${reminder.time} ${reminder.timeUnit} reminder: ${response.statusText}${errorData ? ` - ${JSON.stringify(errorData)}` : ''}`);
        }

        const result = await response.json();
        console.log(`${reminder.time} ${reminder.timeUnit} reminder scheduled successfully for appointment ${appointment.id}`, result);
        messageIds.push(result.id);

        // Update appointment status to reminder_sent
        await appointment._ref.update({
          appointmentStatus: 'reminder_sent',
          dateUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`Updated appointment ${appointment.id} status to reminder_sent`);
      }

      return messageIds;

    } catch (error) {
      console.error('Error scheduling appointment reminders:', error);
      throw error;
    }
  }

  async checkForNewAppointments(retryCount = 0) {
    try {
      console.log('🔍 Checking for new future appointments...', new Date().toISOString());
      const now = new Date();
      const appointmentsRef = db.collectionGroup('appointments');
      
      try {
        // Add exponential backoff delay if this is a retry
        if (retryCount > 0) {
          const delay = Math.min(1000 * Math.pow(2, retryCount), 60000); // Max 1 minute delay
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        const snapshot = await appointmentsRef
          .where('appointmentStatus', 'in', ['new', null])
          .where('startTime', '>', now.toISOString())
          .get();

        console.log(`Found ${snapshot.size} new future appointments`);

        if (!snapshot.empty) {
          snapshot.forEach(async (doc) => {
            const appointment = {
              id: doc.id,
              _ref: doc.ref,
              ...doc.data()
            };

            if (!appointment.startTime) return;

            try {
              const pathParts = doc.ref.path.split('/');
              const userEmail = pathParts[1];
              
              console.log(`Processing appointment: ${appointment.id} for user ${userEmail}`);
              
              const messageIds = await this.scheduleAppointmentReminder(appointment, userEmail);
              
              await doc.ref.update({
                appointmentStatus: 'reminder_scheduled',
                scheduledMessageIds: messageIds,
                dateUpdated: admin.firestore.FieldValue.serverTimestamp()
              });

              console.log(`✅ Successfully scheduled reminders for appointment ${appointment.id}`);
            } catch (error) {
              console.error(`❌ Failed to process appointment ${appointment.id}:`, error);
              await doc.ref.update({
                appointmentStatus: 'reminder_failed',
                dateUpdated: admin.firestore.FieldValue.serverTimestamp()
              });
            }
          });
        }
      } catch (error) {
        if (error.code === 8 && error.details === 'Quota exceeded' && retryCount < 5) {
          console.log(`Quota exceeded, retrying in a moment... (attempt ${retryCount + 1}/5)`);
          return this.checkForNewAppointments(retryCount + 1);
        }
        
        if (error.code === 'FAILED_PRECONDITION' && error.message.includes('requires an index')) {
          const indexUrl = error.message.match(/https:\/\/console\.firebase\.google\.com[^\s]*/)?.[0];
          console.error(`
🚨 Missing Required Firestore Index
This query requires a composite index to be created in Firebase.
1. Visit: ${indexUrl}
2. Click "Create Index" on the Firebase Console
3. Wait a few minutes for the index to be created
The system will continue to retry automatically once the index is ready.`);
          return;
        }
        throw error;
      }
    } catch (error) {
      console.error('Error in appointment check:', error);
    }
  }

  async initialize() {
    console.log('🚀 Initializing appointment watcher system...');
    
    // Set up the cron job for periodic checks every 10 minutes
    cron.schedule('*/10 * * * *', async () => {
      try {
        await this.checkForNewAppointments();
      } catch (error) {
        console.error('Error in scheduled appointment check:', error);
      }
    });
    
    console.log('✅ Appointment watcher system initialized with 10-minute interval checks');
  }
}

module.exports = appointmentWatcher; 