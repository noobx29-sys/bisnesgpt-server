// handleMessagesTemplateWweb.js

//STEP BY STEP GUIDE
//1. CHANGE all handleMessagesTemplate to -> handleMessages<YourBotName>
//2. CHANGE all idSubstring to firebase collection name
//3. CHANGE all <assistant> to openai assistant id
//4. CHANGE all Template to your <YourBotName>
const os = require('os');
const OpenAI = require('openai');
const axios = require('axios');
const { google } = require('googleapis');
const { MessageMedia } = require('whatsapp-web.js');
const path = require('path');
const { Client } = require('whatsapp-web.js');
const util = require('util');
const moment = require('moment-timezone');
const fs = require('fs');
const cron = require('node-cron');
const schedule = require('node-schedule');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const execPromise = util.promisify(exec);
const { URLSearchParams } = require('url');
const admin = require('../firebase.js');
const db = admin.firestore();
const { doc, collection, query, where, getDocs } = db;

let ghlConfig = {};
const MEDIA_DIR = path.join(__dirname, 'public', 'media');
// Schedule the task to run every 12 hours

const openai = new OpenAI({
    apiKey: process.env.OPENAIKEY,
});

const steps = {
    START: 'start',
};
const userState = new Map();

// Add this object to store tasks
const userTasks = new Map();

// Function to add a task
async function addTask(idSubstring, taskString, assignee, dueDate) {
  if (!assignee || !dueDate) {
      return JSON.stringify({ 
          prompt: !assignee && !dueDate ? "Please provide an assignee and due date for the task." :
                  !assignee ? "Please provide an assignee for the task." :
                  "Please provide a due date for the task.",
          taskString: taskString,
          assignee: assignee,
          dueDate: dueDate
      });
  }

  const companyRef = db.collection('companies').doc(idSubstring);
  const newTask = {
      text: taskString || 'Untitled Task',
      status: 'In Progress',
      assignee: assignee,
      dueDate: dueDate,
      createdAt: new Date().toISOString() // Use a regular Date object
  };
  
  await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(companyRef);
      let tasks = [];
      if (doc.exists) {
          tasks = doc.data().tasks || [];
      }
      tasks.push(newTask);
      
      transaction.set(companyRef, { 
          tasks: tasks,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp() // This is fine as it's not in an array
      }, { merge: true });
  });

  return JSON.stringify({ 
      message: `Task added: ${newTask.text}, assigned to ${newTask.assignee}, due on ${newTask.dueDate}` 
  });
}
async function registerUser(phoneNumber, email, username, companyName, password) {
    try {
        // Check if the contact already exists
        const companiesSnapshot = await admin.firestore().collection('companies').get();
        let existingContact = null;
        let existingCompanyId = null;

        for (const doc of companiesSnapshot.docs) {
            const contactsSnapshot = await doc.ref.collection('contacts').where('phone', '==', phoneNumber).get();
            if (!contactsSnapshot.empty) {
                existingContact = contactsSnapshot.docs[0].data();
                existingCompanyId = doc.id;
                break;
            }
        }

        let companyId;
        if (existingCompanyId) {
            companyId = existingCompanyId;
        } else {
            // Generate new company ID
            const companyCount = companiesSnapshot.size;
            companyId = `0${companyCount + 1}`;

            // Create a new company
            await admin.firestore().collection('companies').doc(companyId).set({
                id: companyId,
                name: companyName,
                whapiToken: ""
            });
        }

        // Create a new user in Firebase Authentication
        const userRecord = await admin.auth().createUser({
            email: email,
            phoneNumber: phoneNumber,
            password: password,
            displayName: username,
        });

        // Save user data to Firestore
        await admin.firestore().collection('user').doc(email).set({
            name: username,
            email: email,
            phone: phoneNumber,
            company: companyName,
            role: "1",
            companyId: companyId,
        });

        // Save user data under the company's employee collection
        await admin.firestore().collection(`companies/${companyId}/employee`).doc(userRecord.uid).set({
            name: username,
            email: email,
            role: "1",
            phone: phoneNumber
        });

        // Create channel (if needed)
        const response = await axios.post(`https://juta-dev.ngrok.dev/api/channel/create/${companyId}`);
        console.log(response.data);

        return { success: true, userId: userRecord.uid, companyId: companyId };
    } catch (error) {
        console.error('Error registering user:', error);
        return { success: false, error: error.message };
    }
}
async function listAssignedTasks(idSubstring, assignee) {
  const companyRef = db.collection('companies').doc(idSubstring);
  const doc = await companyRef.get();
  if (!doc.exists || !doc.data().tasks) {
      return JSON.stringify({ message: "No tasks found for this company." });
  }
  const assignedTasks = doc.data().tasks.filter(task => 
      task.assignee.toLowerCase() === assignee.toLowerCase()
  );
  if (assignedTasks.length === 0) {
      return JSON.stringify({ message: `No tasks assigned to ${assignee}.` });
  }
  const tasks = assignedTasks.map((task, index) => 
      `${index + 1}. [${task.status}] ${task.text} (Due: ${task.dueDate})`
  ).join('\n');
  return JSON.stringify({ tasks });
}
async function listTasks(idSubstring) {
    const companyRef = db.collection('companies').doc(idSubstring);
    const doc = await companyRef.get();
    if (!doc.exists || !doc.data().tasks || doc.data().tasks.length === 0) {
        return JSON.stringify({ message: "There are no tasks for this company." });
    }
    const tasks = doc.data().tasks.map((task, index) => 
        `${index + 1}. [${task.status}] ${task.text} (Assigned to: ${task.assignee}, Due: ${task.dueDate})`
    ).join('\n');
    return JSON.stringify({ tasks });
}

async function updateTaskStatus(idSubstring, taskIndex, newStatus) {
    const companyRef = db.collection('companies').doc(idSubstring);
    const doc = await companyRef.get();
    if (!doc.exists || !doc.data().tasks || taskIndex < 0 || taskIndex >= doc.data().tasks.length) {
        return JSON.stringify({ message: "Invalid task number." });
    }
    const tasks = doc.data().tasks;
    tasks[taskIndex].status = newStatus;
    await companyRef.update({ 
        tasks: tasks,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    return JSON.stringify({ message: `Task "${tasks[taskIndex].text}" status updated to ${newStatus}.` });
}

// Function to send task reminders (only for In Progress tasks)
async function sendTaskReminders(client) {
    const taskSnapshot = await db.collection('tasks').get();
    for (const doc of taskSnapshot.docs) {
        const userId = doc.id;
        const tasks = doc.data().tasks || [];
        const inProgressTasks = tasks.filter(task => task.status === 'In Progress');
        if (inProgressTasks.length > 0) {
            const reminderMessage = "Reminder of your in-progress tasks:\n" + 
                inProgressTasks.map((task, index) => `${index + 1}. ${task.text}`).join('\n');
            await client.sendMessage(userId, reminderMessage);
        }
    }
}

// Schedule task reminders
function scheduleTaskReminders(client) {
    // Schedule for 9 AM and 3 PM Kuala Lumpur time
    cron.schedule('0 9,15 * * *', () => {
        sendTaskReminders(client);
    }, {
        timezone: "Asia/Kuala_Lumpur"
    });
}

async function customWait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function addNotificationToUser(companyId, message, contactName) {
    console.log('Adding notification and sending FCM');
    try {
        // Find the user with the specified companyId
        const usersRef = db.collection('user');
        const querySnapshot = await usersRef.where('companyId', '==', companyId).get();

        if (querySnapshot.empty) {
            console.log('No matching documents.');
            return;
        }

        // Filter out undefined values and reserved keys from the message object
        const cleanMessage = Object.fromEntries(
            Object.entries(message)
                .filter(([key, value]) => value !== undefined && !['from', 'notification', 'data'].includes(key))
                .map(([key, value]) => {
                    if (key === 'text' && typeof value === 'string') {
                        return [key, { body: value }];
                    }
                    return [key, typeof value === 'object' ? JSON.stringify(value) : String(value)];
                })
        );

        // Add sender information to cleanMessage
        cleanMessage.senderName = contactName;
     // Filter out undefined values from the message object
     const cleanMessage2 = Object.fromEntries(
        Object.entries(message).filter(([_, value]) => value !== undefined)
    );  
        let text;
        if(cleanMessage2.hasMedia){
            text = "Media"
        }
        text = cleanMessage2.text?.body || 'New message received';
        // Prepare the FCM message
        const fcmMessage = {
            notification: {
                title: `${contactName}`,
                body: cleanMessage2.text?.body || 'New message received'
            },
            data: {
                ...cleanMessage,
                text: JSON.stringify(cleanMessage.text), // Stringify the text object for FCM
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
                sound: 'default'
            },
            topic: '079' // Specify the topic here
        };

        // Add the new message to Firestore for each user
        const promises = querySnapshot.docs.map(async (doc) => {
            const userRef = doc.ref;
            const notificationsRef = userRef.collection('notifications');
            const updatedMessage = { ...cleanMessage2, read: false, from: contactName };
        
            await notificationsRef.add(updatedMessage);
            console.log(`Notification added to Firestore for user with companyId: ${companyId}`);
            console.log('Notification content:');
        });

        await Promise.all(promises);

        // Send FCM message to the topic
        await admin.messaging().send(fcmMessage);
        console.log(`FCM notification sent to topic '079'`);

    } catch (error) {
        console.error('Error adding notification or sending FCM: ', error);
    }
}


async function getChatMetadata(chatId,) {
    const url = `https://gate.whapi.cloud/chats/${chatId}`;
    const headers = {
        'Authorization': `Bearer ${ghlConfig.whapiToken}`,
        'Accept': 'application/json'
    };

    try {
        const response = await axios.get(url, { headers });
        return response.data;
    } catch (error) {
        console.error('Error fetching chat metadata:', error.response.data);
        throw error;
    }
}
const messageQueue = new Map();
const processingQueue = new Map();
const MAX_QUEUE_SIZE = 5;
const RATE_LIMIT_DELAY = 5000; // 5 seconds

// Add this new function to check for scheduling conflicts
async function checkScheduleConflicts(startDateTime, endDateTime) {
    const conflictResult = {
        conflict: false,
        conflictingAppointments: [],
    };

    // Convert input to timestamps if they aren't already
    const startTimestamp = new Date(startDateTime).getTime();
    const endTimestamp = new Date(endDateTime).getTime();

    // Convert milliseconds to ISO strings for Google Calendar API
    const timeMin = new Date(startTimestamp).toISOString();
    const timeMax = new Date(endTimestamp).toISOString();

    try {
        // **1. Check Firestore for Conflicts**
        console.log('Checking for scheduling conflicts in Firestore...');
        
        const userRef = db.collection('user').doc('faeezree@gmail.com');
        const appointmentsCollectionRef = userRef.collection('appointments');
    
        const conflictingAppointmentsFirestore = await appointmentsCollectionRef
              .where('startTime', '<', endTimestamp)
              .where('endTime', '>', startTimestamp)
              .get();
      
        if (!conflictingAppointmentsFirestore.empty) {
            console.log('Scheduling conflict found in Firestore');
            conflictResult.conflict = true;
            // Format Firestore conflicts to match expected structure
            const firestoreConflicts = conflictingAppointmentsFirestore.docs.map(doc => ({
                source: 'Firestore',
                id: doc.id,
                title: doc.data().title,
                startTime: doc.data().startTime,
                endTime: doc.data().endTime,
                description: doc.data().address || "",
                // Add other relevant fields if necessary
            }));
            conflictResult.conflictingAppointments.push(...firestoreConflicts);
        } else {
            console.log('No scheduling conflicts found in Firestore');
        }

        // **2. Check Google Calendar for Conflicts**
        console.log('Checking for scheduling conflicts in Google Calendar...');
        
        // Initialize Google Calendar client within the function
        const auth = new google.auth.GoogleAuth({
            keyFile: './service_account.json', // Ensure this path is correct
            scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
        });

        const calendar = google.calendar({ version: 'v3', auth });

        const eventsResponse = await calendar.events.list({
            calendarId: 'faeezree@gmail.com', // Use the appropriate calendar ID
            timeMin: timeMin,
            timeMax: timeMax,
            singleEvents: true,
            orderBy: 'startTime',
        });

        const events = eventsResponse.data.items;

        if (events && events.length > 0) {
            console.log('Scheduling conflict found in Google Calendar');
            conflictResult.conflict = true;
            // Format Google Calendar conflicts to match expected structure
            const calendarConflicts = events.map(event => ({
                source: 'Google Calendar',
                id: event.id,
                title: event.summary,
                startTime: new Date(event.start.dateTime || event.start.date).getTime(),
                endTime: new Date(event.end.dateTime || event.end.date).getTime(),
                description: event.description || "",
                // Add other relevant fields if necessary
            }));
            conflictResult.conflictingAppointments.push(...calendarConflicts);
        } else {
            console.log('No scheduling conflicts found in Google Calendar');
        }

        return conflictResult;

    } catch (error) {
        console.error('Error checking for scheduling conflicts:', error);
        return { conflict: true, error: error.message };
    }
}

async function createCalendarEvent(summary, description, startDateTime, endDateTime, contactPhone, contactName) {
    try {
      console.log('Checking for conflicts before creating appointment...');
      const conflictCheck = await checkScheduleConflicts(startDateTime, endDateTime);
  
      if (conflictCheck.conflict) {
        if (conflictCheck.error) {
          return { error: `Failed to check for conflicts: ${conflictCheck.error}` };
        }
        return { 
          error: 'Scheduling conflict detected', 
          conflictingAppointments: conflictCheck.conflictingAppointments 
        };
      }
  
      console.log('Creating appointment...');

      const userRef = db.collection('user').doc('faeezree@gmail.com');
      const appointmentsCollectionRef = userRef.collection('appointments');
      const newAppointmentRef = appointmentsCollectionRef.doc(); 
  
      const newAppointment = {
        id: newAppointmentRef.id,
        title: summary,
        startTime: startDateTime,
        endTime: endDateTime,
        address: description || "",
        appointmentStatus: 'new',
        staff: ["firaz"],
        color: "#1F3A8A", // Default color
        packageId: "ja872PCc3kd7uQ4tQxB3",
        dateAdded: new Date().toISOString(),
        contacts: contactPhone && contactName ? [{
          id: contactPhone,
          name: contactName,
          session: null
        }] : [],
      };
  
      await newAppointmentRef.set(newAppointment);
  
      console.log('Appointment created successfully:', newAppointment);

      console.log('Appointment created successfully in Firebase:', newAppointment);

        // Create event in Google Calendar
        const auth = new google.auth.GoogleAuth({
            keyFile: './service_account.json', // Update this path
            scopes: ['https://www.googleapis.com/auth/calendar'],
        });

        const calendar = google.calendar({ version: 'v3', auth });

        const event = {
            summary: summary,
            description: `${description}\n\nContact: ${contactName} (${contactPhone})`,
            start: {
                dateTime: startDateTime,
                timeZone: 'Asia/Kuala_Lumpur', // Adjust timezone as needed
            },
            end: {
                dateTime: endDateTime,
                timeZone: 'Asia/Kuala_Lumpur', // Adjust timezone as needed
            },
        };

        const calendarResponse = calendar.events.insert({
            calendarId: 'faeezree@gmail.com', // Use 'primary' for the user's primary calendar
            resource: event,
        });
console.log(calendarResponse);
        // Format the date and time for better readability
        const startDate = new Date(startDateTime).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const startTime = new Date(startDateTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const endTime = new Date(endDateTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        return {
        success: true,
        message: 'Appointment created successfully',
        appointmentDetails: {
            title: summary,
            date: startDate,
            time: `${startTime} - ${endTime}`,
            description: description + `\n\nContact: ${contactName || 'Unknown'} (${phoneNumber || 'No phone number found'})`,
            contact: `${contactName || 'Unknown'} (${phoneNumber || 'No phone number found'})`,
            staff: newAppointment.staff.join(", ")
        }
        };
    } catch (error) {
      console.error('Error in createCalendarEvent:', error);
      return { error: `Failed to create appointment: ${error.message}` };
    }
  }
  async function deleteTask(idSubstring, taskIndex) {
    const companyRef = db.collection('companies').doc(idSubstring);
    const doc = await companyRef.get();
    if (!doc.exists || !doc.data().tasks || taskIndex < 0 || taskIndex >= doc.data().tasks.length) {
        return JSON.stringify({ message: "Invalid task number." });
    }
    const tasks = doc.data().tasks;
    const deletedTask = tasks.splice(taskIndex, 1)[0];
    await companyRef.update({ 
        tasks: tasks,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    return JSON.stringify({ message: `Task "${deletedTask.text}" has been deleted.` });
}

async function editTask(idSubstring, taskIndex, newTaskString, newAssignee, newDueDate) {
    const companyRef = db.collection('companies').doc(idSubstring);
    const doc = await companyRef.get();
    if (!doc.exists || !doc.data().tasks || taskIndex < 0 || taskIndex >= doc.data().tasks.length) {
        return JSON.stringify({ message: "Invalid task number." });
    }
    const tasks = doc.data().tasks;
    tasks[taskIndex] = {
        ...tasks[taskIndex],
        text: newTaskString || tasks[taskIndex].text,
        assignee: newAssignee || tasks[taskIndex].assignee,
        dueDate: newDueDate || tasks[taskIndex].dueDate,
    };
    await companyRef.update({ 
        tasks: tasks,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    return JSON.stringify({ message: `Task has been updated.` });
}
async function sendDailyTaskReminder(client, idSubstring) {
  const companyRef = db.collection('companies').doc(idSubstring);
  const doc = await companyRef.get();
  if (!doc.exists || !doc.data().tasks || doc.data().tasks.length === 0) {
      return;
  }
  const tasks = doc.data().tasks;
  const taskList = tasks.map((task, index) => 
      `${index + 1}. [${task.status}] ${task.text} (Assigned to: ${task.assignee}, Due: ${task.dueDate})`
  ).join('\n');
  const reminderMessage = `Please update the tasks accordingly\n\nDaily Task Reminder:\n\n${taskList}\n.`;
  
  // Replace with the actual group chat ID where you want to send the reminder
  const groupChatId = '120363178065670386@g.us';
  
  await client.sendMessage(groupChatId, reminderMessage);
}

// Modify the scheduleDailyReport function to include the task reminder
async function scheduleDailyReport(client, idSubstring) {

  cron.schedule('0 21 * * *', async () => {
      await sendDailyContactReport(client, idSubstring);
  }, {
      timezone: "Asia/Kuala_Lumpur"
  });

  cron.schedule('0 17 * * *', async () => {
      await sendDailyTaskReminder(client, idSubstring);
  }, {
      timezone: "Asia/Kuala_Lumpur"
  });

  console.log('Daily report and task reminder scheduled');
}
//   async function scheduleReminderMessage(eventSummary, startDateTime, chatId) {
//     const reminderTime = moment(startDateTime).subtract(15, 'minutes');
//     const reminderMessage = `Reminder: "${eventSummary}" is starting in 15 minutes.`;
  
//     // Convert to seconds and ensure it's an integer
//     const scheduledTimeSeconds = Math.floor(reminderTime.valueOf() / 1000);
  
//     console.log('Scheduling reminder for:', reminderTime.format());
//     console.log('Scheduled time in seconds:', scheduledTimeSeconds);
    
//       const scheduledMessage = {
//         batchQuantity: 1,
//         chatIds: [chatId],
//         companyId: "079", // Assuming this is the correct company ID
//         createdAt: admin.firestore.Timestamp.now(),
//         documentUrl: "",
//         fileName: null,
//         mediaUrl: "",
//         message: reminderMessage,
//         mimeType: null,
//         repeatInterval: 0,
//         repeatUnit: "days",
//         scheduledTime: {
//             seconds: scheduledTimeSeconds,
//             nanoseconds: 0
//           },
//         status: "scheduled",
//         v2: true,
//         whapiToken: null
//       };
  
//     try {
//       console.log('Sending schedule request:', JSON.stringify(scheduledMessage));
//       const response = await axios.post(`http://localhost:8443/api/schedule-message/079`, scheduledMessage);
//       console.log('Reminder scheduled successfully:', response.data);
//     } catch (error) {
//       console.error('Error scheduling reminder:', error.response ? error.response.data : error.message);
//       if (error.response && error.response.data) {
//         console.error('Server response:', error.response.data);
//       }
//     }
//   }

  function getTodayDate() {
    return moment().tz('Asia/Kuala_Lumpur').format('YYYY-MM-DD HH:mm:ss');
  }
async function saveMediaLocally(base64Data, mimeType, filename) {
    const writeFileAsync = util.promisify(fs.writeFile);
    const buffer = Buffer.from(base64Data, 'base64');
    const uniqueFilename = `${uuidv4()}_${filename}`;
    const filePath = path.join(MEDIA_DIR, uniqueFilename);
    
    await writeFileAsync(filePath, buffer);
  
    // Return the URL path to access this filez
    return `/media/${uniqueFilename}`;
  }
  
// Add this new function to fetch contact data
async function fetchContactData(phoneNumber, idSubstring) {
    try {
      const contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(phoneNumber);
      const doc = await contactRef.get();
  
      if (!doc.exists) {
        return JSON.stringify({ error: 'Contact not found' });
      }
  
      const contactData = doc.data();
      return JSON.stringify(contactData);
    } catch (error) {
      console.error('Error fetching contact data:', error);
      return JSON.stringify({ error: 'Failed to fetch contact data' });
    }
  }
  async function storeVideoData(videoData, filename) {
    const bucket = admin.storage().bucket();
    const uniqueFilename = `${uuidv4()}_${filename}`;
    const file = bucket.file(`videos/${uniqueFilename}`);

    await file.save(Buffer.from(videoData, 'base64'), {
        metadata: {
            contentType: 'video/mp4', // Adjust this based on the actual video type
        },
    });

    const [url] = await file.getSignedUrl({
        action: 'read',
        expires: '03-01-2500', // Adjust expiration as needed
    });

    return url;
}


async function getTotalContacts(idSubstring) {
    try {
      const contactsRef = db.collection('companies').doc(idSubstring).collection('contacts');
      const snapshot = await contactsRef.count().get();
      return snapshot.data().count;
    } catch (error) {
      console.error('Error fetching total contacts:', error);
      return 0;
    }
  }
  function scheduleRepliedTagRemoval(idSubstring, contactId, chatId) {
    const jobName = `remove_replied_${contactId}`;
    const jobTime = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    schedule.scheduleJob(jobName, jobTime, async function() {
        try {
            const contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(contactId);
            const contactDoc = await contactRef.get();

            if (contactDoc.exists) {
                const tags = contactDoc.data().tags || [];
                const updatedTags = tags.filter(tag => tag !== 'replied');

                await contactRef.update({
                    tags: updatedTags
                });

                console.log(`Removed 'replied' tag for contact ${contactId}`);
            }

            await rescheduleFollowUpMessages(idSubstring, chatId);
        } catch (error) {
            console.error(`Error removing 'replied' tag for contact ${contactId}:`, error);
        }

        schedule.cancelJob(jobName);
    });
}

  async function getContactsAddedToday(idSubstring) {
    try {
      const contactsRef = db.collection('companies').doc(idSubstring).collection('contacts');
      
      // Get today's date at midnight in the local timezone (assuming Asia/Kuala_Lumpur)
      const today = moment().tz('Asia/Kuala_Lumpur').startOf('day').toDate();
      
      const snapshot = await contactsRef
        .where('createdAt', '>=', today)
        .get();
  
      const contacts = snapshot.docs.map(doc => ({
        phoneNumber: doc.id,
        contactName: doc.data().contactName || 'Unknown',
        createdAt: doc.data().createdAt.toDate().toISOString(),
        tags: doc.data().tags || []
      }));
  
      return {
        count: contacts.length,
        contacts: contacts
      };
    } catch (error) {
      console.error('Error getting contacts added today:', error);
      return { count: 0, contacts: [], error: error.message };
    }
  }
  
  async function scheduleReminderMessage(eventSummary, startDateTime, chatId, idSubstring) {
    // Convert to seconds and ensure it's an integer
    const scheduledTimeSeconds = Math.floor(startDateTime.getTime() / 1000);
  
    console.log('Scheduling reminder for:', moment(startDateTime).format());
    console.log('Scheduled time in seconds:', scheduledTimeSeconds);
    
    const scheduledMessage = {
        batchQuantity: 1,
        chatIds: [chatId],
        companyId: idSubstring,
        createdAt: admin.firestore.Timestamp.now(),
        documentUrl: "",
        fileName: null,
        mediaUrl: "",
        message: eventSummary,
        messages: [
            {
              chatId: chatId,
              message: eventSummary
            }
          ],        
        mimeType: null,
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
      const response = await axios.post(`http://localhost:8443/api/schedule-message/${idSubstring}`, scheduledMessage);
      console.log('Reminder scheduled successfully:', response.data);
    } catch (error) {
      console.error('Error scheduling reminder:', error.response ? error.response.data : error.message);
      if (error.response && error.response.data) {
        console.error('Server response:', error.response.data);
      }
    }
  }

  async function scheduleImageMessage(imageUrl, caption, scheduledTime, chatId, idSubstring) {
    const scheduledTimeSeconds = Math.floor(scheduledTime.getTime() / 1000);
    
    const scheduledMessage = {
        batchQuantity: 1,
        chatIds: [chatId],
        companyId: idSubstring,
        createdAt: admin.firestore.Timestamp.now(),
        documentUrl: "",
        fileName: null,
        mediaUrl: imageUrl,
        message: caption,
        messages: [
            {
              chatId: chatId,
              message: caption
            }
          ],
        mimeType: "image/jpeg", // Adjust if needed
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
        const response = await axios.post(`http://localhost:8443/api/schedule-message/${idSubstring}`, scheduledMessage);
        console.log('Image message scheduled successfully:', response.data);
    } catch (error) {
        console.error('Error scheduling image message:', error.response ? error.response.data : error.message);
    }
}


  async function scheduleFollowUpMessages(chatId, idSubstring, customerName) {
    const dailyMessages = [
        [
            { type: 'image', url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/WhatsApp%20Image%202024-09-09%20at%2017.42.09_e25d8601.jpg?alt=media&token=e043d7eb-df18-451b-80cf-c212f69d601b', caption: "Good afternoon!" },
            "FREE Site Inspection Roofing, Slab Waterproofing with Senior Chinese Shifu & get a Quotation Immediately (For Klang Valley, KL, Seremban & JB areas only).",
            "Hi 😊 Snowy here from BINA Pasifik S/B. We specialized in Roofing & Waterproofing. Thank you for connecting us through Facebook.",
            "May I know which area are you from? How should I address you? 😊",
            "Any issues with your roof? Leaking while raining? Any photo?",
            "Is your house single or double-story? Is your roof roof tiles, metal roof, or concrete slab?"
        ],
        [
            { type: 'image', url: 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/WhatsApp%20Image%202024-09-09%20at%2017.42.09_e25d8601.jpg?alt=media&token=e043d7eb-df18-451b-80cf-c212f69d601b', caption: "Good afternoon!" },
            "Hi, FREE Site Inspection Roofing and slab Waterproofing with Senior Chinese Shifu & get Quotation Immediately (For Klang Valley, KL, Seremban & JB areas only).",
            "May I know the condition of your roof? Is your roof leaking or do you want to refurbish/repaint your roof?"
        ],
        [
            "That day you pm me about the water leakage problem",
            "Is there a leak in your home or shop??🧐"
        ],
        [
            "Good day,",
            "We'd like to schedule a 🆓 FREE inspection at your place. We're available on Tuesday, Wednesday, Saturday, or Sunday.",
            "Which day works best for you???🤔"
        ],
        [
            "Hi",
            "You may contact +60193668776",
            "My manager will personally address your technical questions about the roof.",
        ],
        [
            "Morning",
            "Have you contacted my manager??",
            "You can contact him directly by calling +60193668776 ☺️",
        ]
    ];

    for (let day = 0; day < 6; day++) {
        for (let i = 0; i < 6; i++) {
            // Schedule messages every 2 minutes
            const scheduledTime = moment().add((day * 6 + i) * 2, 'minutes');
            const message = dailyMessages[day][i];
            
            if (typeof message === 'object' && message.type === 'image') {
                await scheduleImageMessage(message.url, message.caption, scheduledTime.toDate(), chatId, idSubstring);
            } else {
                await scheduleReminderMessage(message, scheduledTime.toDate(), chatId, idSubstring);
            }
        }
    }

    // Schedule the staff reminder 2 minutes after the last message
    const scheduledTime = moment().add(6 * 6 * 2 + 2, 'minutes');
    const staffReminder = `Day 6 last follow up ${customerName}, ${chatId.split('@')[0]}`
    await scheduleReminderMessage(staffReminder, scheduledTime.toDate(), '60135186862@c.us', idSubstring);
}
async function sendImage(client, phoneNumber, imageUrl, caption, idSubstring) {
    console.log('Sending image to:', phoneNumber);
    console.log('Image URL:', imageUrl);
    console.log('Caption:', caption);
    console.log('idSubstring:', idSubstring);
  
    try {
      const formattedNumberForWhatsApp = formatPhoneNumber(phoneNumber).slice(1) + '@c.us';
      const formattedNumberForFirebase = formatPhoneNumber(phoneNumber);
  
      if (!formattedNumberForWhatsApp || !formattedNumberForFirebase) {
        throw new Error('Invalid phone number');
      }
  
      const media = await MessageMedia.fromUrl(imageUrl);
      const sent = await client.sendMessage(formattedNumberForWhatsApp, media, { caption: caption });
  
      const messageData = {
        chat_id: formattedNumberForWhatsApp,
        from: client.info.wid._serialized,
        from_me: true,
        id: sent.id._serialized,
        source: "web",
        status: "sent",
        image: {
          mimetype: media.mimetype,
          data: media.data,
          filename: media.filename,
          caption: caption
        },
        timestamp: sent.timestamp,
        type: 'image',
      };
  
      const contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(formattedNumberForFirebase);
      const messagesRef = contactRef.collection('messages');
      const messageDoc = messagesRef.doc(sent.id._serialized);
      await messageDoc.set(messageData, { merge: true });
  
      const response = {
        status: 'success',
        message: 'Image sent successfully and added to Firebase',
        messageId: sent.id._serialized,
        timestamp: sent.timestamp,
      };
  
      return JSON.stringify(response);
    } catch (error) {
      console.error('Error in sendImage:', error);
      return JSON.stringify({ 
        status: 'error',
        error: 'Failed to send image or add to Firebase',
        details: error.message 
      });
    }
  }

  async function listAssignedContacts(idSubstring, assigneeName, limit = 10) {
    try {
      const contactsRef = db.collection('companies').doc(idSubstring).collection('contacts');
      const snapshot = await contactsRef.get();
  
      const possibleNames = [
        assigneeName.toLowerCase(),
        assigneeName.charAt(0).toUpperCase() + assigneeName.slice(1).toLowerCase(),
        assigneeName.toUpperCase()
      ];
  
      const contacts = snapshot.docs
        .filter(doc => {
          const tags = (doc.data().tags || []).map(t => t.toLowerCase());
          return possibleNames.some(name => tags.includes(name.toLowerCase()));
        })
        .slice(0, limit)
        .map(doc => ({
          phoneNumber: doc.id,
          contactName: doc.data().contactName,
          tags: doc.data().tags
        }));
  
      return JSON.stringify(contacts);
    } catch (error) {
      console.error('Error listing assigned contacts:', error);
      return JSON.stringify({ error: 'Failed to list assigned contacts' });
    }
  }

  async function checkAndScheduleDailyReport(client, idSubstring) {
    const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format
    const configRef = db.collection('companies').doc(idSubstring);

    try {
        const doc = await configRef.get();
        const lastScheduledDate = doc.data().lastScheduledDate;

        if (lastScheduledDate !== today) {
            // Schedule the daily report
            await scheduleDailyReport(client, idSubstring);

            // Update the lastScheduledDate in Firebase
            await configRef.update({ lastScheduledDate: today });
            console.log(`Daily report scheduled for ${today}`);
        }
    } catch (error) {
        console.error('Error checking or scheduling daily report:', error);
    }
}

async function changeFollowUpStatus(idSubstring, chatId) {
    try {
        // 1. Fetch all scheduled follow-up messages for this chat
        const messageGroupsRef = db.collection('companies').doc(idSubstring)
            .collection('scheduledMessages');
        
        const querySnapshot = await messageGroupsRef
            .where('chatIds', 'array-contains', chatId)
            .where('tag', '==', 'followup')
            .where('status', '==', 'scheduled')
            .get();

        if (querySnapshot.empty) {
            console.log('No scheduled follow-up messages found for this chat.');
            return;
        }

        // 2. Update the status of all scheduled messages to 'delayed'
        for (const doc of querySnapshot.docs) {
            const messageGroupId = doc.id;
            const messageData = doc.data();

            // Update the status to 'delayed'
            await axios.put(`http://localhost:8443/api/schedule-message/${idSubstring}/${messageGroupId}`, {
                ...messageData,
                status: 'delayed'
            });
        }

        console.log(`Updated follow-up messages status to delayed for chat ${chatId}`);

        

    } catch (error) {
        console.error('Error handling customer reply:', error);
    }
}

async function rescheduleFollowUpMessages(idSubstring, chatId) {
    try {
        const messageGroupsRef = db.collection('companies').doc(idSubstring)
            .collection('scheduledMessages');
        
        const querySnapshot = await messageGroupsRef
            .where('chatIds', 'array-contains', chatId)
            .where('tag', '==', 'followup')
            .where('status', '==', 'delayed')
            .get();

        if (querySnapshot.empty) {
            console.log('No delayed follow-up messages found for rescheduling.');
            return;
        }

        const now = Date.now();
        for (const doc of querySnapshot.docs) {
            const messageGroupId = doc.id;
            const messageData = doc.data();

            // Calculate new scheduled times
            const updatedMessages = messageData.messages.map((msg, index) => {
                const newScheduledTime = new Date(now + (index + 1) * 24 * 60 * 60 * 1000); // Schedule for next days
                return {
                    ...msg,
                    scheduledTime: {
                        seconds: Math.floor(newScheduledTime.getTime() / 1000),
                        nanoseconds: 0
                    }
                };
            });

            // Update the message group with new scheduled times and status
            await axios.put(`http://localhost:8443/api/schedule-message/${idSubstring}/${messageGroupId}`, {
                ...messageData,
                messages: updatedMessages,
                status: 'scheduled'
            });
        }

        console.log(`Rescheduled follow-up messages for chat ${chatId}`);

    } catch (error) {
        console.error('Error rescheduling follow-up messages:', error);
    }
}

async function removeScheduledMessages(chatId, idSubstring) {
    try {
        const scheduledMessagesRef = db.collection('companies').doc(idSubstring).collection('scheduledMessages');
        
        const snapshot = await scheduledMessagesRef
            .where('chatIds', 'array-contains', chatId)
            .where('status', '!=', 'completed')
            .get();
        
        for (const doc of snapshot.docs) {
            const messageId = doc.id;
            const messageData = doc.data();
            
            // Prepare the updated message data
            const updatedMessage = {
                ...messageData,
                status: 'completed',
                chatIds: messageData.chatIds.filter(id => id !== chatId)
            };
            
            // Ensure scheduledTime is properly formatted
            if (updatedMessage.scheduledTime && typeof updatedMessage.scheduledTime === 'object') {
                updatedMessage.scheduledTime = {
                    seconds: Math.floor(updatedMessage.scheduledTime.seconds),
                    nanoseconds: updatedMessage.scheduledTime.nanoseconds || 0
                };
            } else {
                // If scheduledTime is missing or invalid, use the current time
                updatedMessage.scheduledTime = {
                    seconds: Math.floor(Date.now() / 1000),
                    nanoseconds: 0
                };
            }
            
            // Call the API to update the message
            try {
                await axios.put(`http://localhost:8443/api/schedule-message/${idSubstring}/${messageId}`, updatedMessage);
                console.log(`Updated scheduled message ${messageId} for chatId: ${chatId}`);
            } catch (error) {
                console.error(`Error updating scheduled message ${messageId}:`, error.response ? error.response.data : error.message);
            }
        }
        
        console.log(`Updated ${snapshot.size} scheduled messages for chatId: ${chatId}`);
    } catch (error) {
        console.error('Error removing scheduled messages:', error);
    }
}
async function handleOpenAIMyMessage(message, threadID) {
    console.log('messaging manual')
    query = `message`;
    await addMessageAssistant(threadID, query);
}
async function addMessageAssistant(threadId, message) {
    const response = await openai.beta.threads.messages.create(
        threadId,
        {
            role: "assistant",
            content: message
        }
    );
    console.log(response);
    return response;
}
const MESSAGE_BUFFER_TIME = 30000; // 1 minute in milliseconds
const messageBuffers = new Map();

async function handleNewMessagesNTRM(client, msg, botName, phoneIndex) {
    // Early return if the message is from company 079
    if (botName === '079') {
        console.log('Message from 079 - skipping processing');
        return;
    }

    console.log(`Message received for ${botName} - no action taken`);
}

// Export only the necessary function
module.exports = { handleNewMessagesNTRM };