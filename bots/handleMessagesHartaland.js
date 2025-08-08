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
            topic: '001' // Specify the topic here
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
        console.log(`FCM notification sent to topic '001'`);

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
//         companyId: "001", // Assuming this is the correct company ID
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
//       const response = await axios.post(`http://localhost:8443/api/schedule-message/001`, scheduledMessage);
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
const MESSAGE_BUFFER_TIME = 1000; // 1 minute in milliseconds
const messageBuffers = new Map();

async function handleNewMessagesHartaland(client, msg, botName, phoneIndex) {
    console.log('Handling new Messages '+botName);

    const idSubstring = botName;
    const chatId = msg.from;
 // Process the message immediately for Firebase and notifications
 await processImmediateActions(client, msg, botName, phoneIndex);
 
    // Initialize or update the message buffer for this chat
    if (!messageBuffers.has(chatId)) {
        messageBuffers.set(chatId, {
            messages: [],
            timer: null
        });
    }
    const buffer = messageBuffers.get(chatId);

    // Add the new message to the buffer
    buffer.messages.push(msg);

    // Clear any existing timer
    if (buffer.timer) {
        clearTimeout(buffer.timer);
    }

    // Set a new timer
    buffer.timer = setTimeout(() => processBufferedMessages(client, chatId, botName, phoneIndex), MESSAGE_BUFFER_TIME);
}

async function processImmediateActions(client, msg, botName, phoneIndex) {
    const idSubstring = botName;
    const chatId = msg.from;
   console.log('processImmediateActions');

    try {
         // Initial fetch of config
         await fetchConfigFromDatabase(idSubstring,phoneIndex);
         const sender = {
             to: msg.from,
             name: msg.notifyName,
         };
 
         const extractedNumber = '+'+(sender.to).split('@')[0];
 
       
       
         let contactID;
         let contactName;
         let threadID;
         let query;
         let answer;
         let parts;
         let currentStep;
         const chat = await msg.getChat();
         const contactData = await getContactDataFromDatabaseByPhone(extractedNumber, idSubstring);
         let unreadCount = 0;
         let stopTag = contactData?.tags || [];
         const contact = await chat.getContact();
 
         console.log(contactData);
         if (contactData !== null) {
             if(contactData.tags){
                 stopTag = contactData.tags;
                 console.log(stopTag);
                 unreadCount = contactData.unreadCount ?? 0;
                 contactID = extractedNumber;
                 contactName = contactData.contactName ?? contact.pushname ?? extractedNumber;
             
                 if (contactData.threadid) {
                     threadID = contactData.threadid;
                 } else {
                     const thread = await createThread();
                     threadID = thread.id;
                     await saveThreadIDFirebase(contactID, threadID, idSubstring)
                 }
             } else {
                 contactID = extractedNumber;
                 contactName = contactData.contactName ?? msg.pushname ?? extractedNumber;
                 if (contactData.threadid) {
                     threadID = contactData.threadid;
                 } else {
                     const thread = await createThread();
                     threadID = thread.id;
                     await saveThreadIDFirebase(contactID, threadID, idSubstring)
                 } 
             }
         } else {
             await customWait(2500); 
 
             contactID = extractedNumber;
             contactName = contact.pushname || contact.name || extractedNumber;
 
             const thread = await createThread();
             threadID = thread.id;
             console.log(threadID);
             await saveThreadIDFirebase(contactID, threadID, idSubstring)
             console.log('sent new contact to create new contact');
         } 
         if (msg.fromMe){  
         if(threadID){
       
                await handleOpenAIMyMessage(msg.body,threadID);
                return;
          
         }else{
            contactID = extractedNumber;
            contactName = contact.pushname || contact.name || extractedNumber;

            const thread = await createThread();
            threadID = thread.id;
            console.log(threadID);
            await saveThreadIDFirebase(contactID, threadID, idSubstring)
            await handleOpenAIMyMessage(msg.body,threadID);
            return;
         }  }
        
         let firebaseTags = ['']
         if (contactData) {
             firebaseTags = contactData.tags ?? [];
             // Remove 'snooze' tag if present
             if(firebaseTags.includes('snooze')){
                 firebaseTags = firebaseTags.filter(tag => tag !== 'snooze');
             }
         } 
 
         if(firebaseTags.includes('replied') && firebaseTags.includes('fb')){
             // Schedule removal of 'replied' tag after 1 hour
             // scheduleRepliedTagRemoval(idSubstring, extractedNumber, msg.from);
         }
 
         let type = 'text';
         if(msg.type == 'e2e_notification' || msg.type == 'notification_template'){
             return;
         } else if (msg.type != 'chat') {
             type = msg.type;
         }
             
         if(extractedNumber.includes('status')){
             return;
         }
 
         // Use combinedMessage instead of looping through messages
         let messageBody = msg.body;
         let audioData = null;
 
         const data = {
             additionalEmails: [],
             address1: null,
             assignedTo: null,
             businessId: null,
             phone: extractedNumber,
             tags: firebaseTags,
             chat: {
                 contact_id: extractedNumber,
                 id: msg.from,
                 name: contactName || contact.name || contact.pushname || extractedNumber,
                 not_spam: true,
                 tags: firebaseTags,
                 timestamp: chat.timestamp || Date.now(),
                 type: 'contact',
                 unreadCount: 0,
                 last_message: {
                     chat_id: msg.from,
                     from: msg.from ?? "",
                     from_me: msg.fromMe ?? false,
                     id: msg.id._serialized ?? "",
                     source: chat.deviceType ?? "",
                     status: "delivered",
                     text: {
                         body: messageBody ?? ""
                     },
                     timestamp: msg.timestamp ?? 0,
                     type: type,
                 },
             },
             chat_id: msg.from,
             city: null,
             companyName: contact.companyName || null,
             contactName: contactName || contact.name || contact.pushname || extractedNumber,
             unreadCount: unreadCount + 1,
             threadid: threadID ?? "",
             phoneIndex: phoneIndex,
             last_message: {
                 chat_id: msg.from,
                 from: msg.from ?? "",
                 from_me: msg.fromMe ?? false,
                 id: msg.id._serialized ?? "",
                 source: chat.deviceType ?? "",
                 status: "delivered",
                 text: {
                     body: messageBody ?? ""
                 },
                 timestamp: msg.timestamp ?? 0,
                 type: type,
             },
         };
 
         // Only add createdAt if it's a new contact
         if (!contactData) {
             data.createdAt = admin.firestore.Timestamp.now();
         }
 
         let profilePicUrl = "";
         if (contact.getProfilePicUrl()) {
             try {
                 profilePicUrl = await contact.getProfilePicUrl() || "";
             } catch (error) {
                 console.error(`Error getting profile picture URL for ${contact.id.user}:`, error);
             }
         }
         data.profilePicUrl = profilePicUrl;
 
         const messageData = {
             chat_id: msg.from,
             from: msg.from ?? "",
             from_me: msg.fromMe ?? false,
             id: msg.id._serialized ?? "",
             source: chat.deviceType ?? "",
             status: "delivered",
             text: {
                 body: messageBody ?? ""
             },
             timestamp: msg.timestamp ?? 0,
             type: type,
             phoneIndex: phoneIndex,
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
           const authorData = await getContactDataFromDatabaseByPhone(authorNumber, idSubstring);
           messageData.text.context.quoted_author = authorData ? authorData.contactName : authorNumber;
       }

         if((sender.to).includes('@g.us')){
             const authorNumber = '+'+(msg.author).split('@')[0];
 
             const authorData = await getContactDataFromDatabaseByPhone(authorNumber, idSubstring);
             if(authorData){
                 messageData.author = authorData.contactName;
             }else{
                 messageData.author = authorNumber;
             }
         }
         if (msg.type === 'audio' || msg.type === 'ptt') {
            chat.sendStateRecording();
             messageData.audio = {
                 mimetype: 'audio/ogg; codecs=opus', // Default mimetype for WhatsApp voice messages
                 data: audioData // This is the base64 encoded audio data
             };
         }else{
            chat.sendStateTyping();
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
         console.log(msg);
         await addNotificationToUser(idSubstring, messageData, contactName);
        
        // Add the data to Firestore
        await db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber).set(data, {merge: true}); 
          //reset bot command
          if (msg.body.includes('/resetbot')) {
            const thread = await createThread();
            threadID = thread.id;
            await saveThreadIDFirebase(contactID, threadID, idSubstring)
            client.sendMessage(msg.from, 'Bot is now restarting with new thread.');
            return;
        }

        //test bot command
        if (msg.body.includes('/hello')) {
            client.sendMessage(msg.from, 'tested.');
            try {
                // Read the image file
                const imageBuffer = fs.readFileSync('./media/juta/juta.png');
                const base64Image = imageBuffer.toString('base64');
        
                // Create a MessageMedia instance for the product image
                const product = new MessageMedia('image/jpeg', base64Image, 'product.jpg');
        
                // Send the product message
                await client.sendMessage(msg.from, product, {
                    caption: 'View this item on WhatsApp: https://wa.me/p/24571882625791055/60189688525\n\nAI Automation System\n\nAutomate Your Business Using A.I On WhatsApp\n\nCustom Automations Integrations\nAutomated Texts (WhatsApp, SMS)\nAutomated Appointment Setter\nAutomated Social Media Messaging\nAnalytics Tools\nMobile App Version\n\nPrice: MYR 688/month\n\nFor more info: https://jutasoftware.co/',
                    sendMediaAsSticker: false,
                    sendAudioAsVoice: false,
                    sendVideoAsGif: false,
                    isViewOnce: false,
                    productId: '24571882625791055',
                    businessOwnerJid: '60189688525@s.whatsapp.net',
                    title: 'AI Automation System',
                    description: 'Automate Your Business Using A.I On WhatsApp',
                    currencyCode: 'MYR',
                    priceAmount1000: 5000000,
                    productImageCount: 1,
                    url: 'https://jutasoftware.co/'
                });
        
                console.log('Product message sent successfully');
            } catch (error) {
                console.error('Error sending product message:', error);
            }
        
            return;
        }
        if(ghlConfig.stopbot){
            if(ghlConfig.stopbot == true){
                console.log('bot stop all');
                return;
            }
        }
        console.log('Message processed immediately:', msg.id._serialized);
    } catch (error) {
        console.error('Error in immediate processing:', error);
    }
}
async function generateAudioFromText(text) {
    const mp3 = await openai.audio.speech.create({
        model: "tts-1",
        voice: "nova",
        input: text,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    const mp3FileName = `speech_${Date.now()}.mp3`;
    const mp3FilePath = path.join(os.tmpdir(), mp3FileName);
    const mp4FileName = `speech_${Date.now()}.mp4`;
    const mp4FilePath = path.join(os.tmpdir(), mp4FileName);
    
    await fs.promises.writeFile(mp3FilePath, buffer);
    // Convert MP3 to OGG/Opus
    await execPromise(`${ffmpeg} -i ${mp3FilePath} -c:a aac -b:a 128k ${mp4FilePath}`);

    // Remove the temporary MP3 file
    await fs.promises.unlink(mp3FilePath);
    
    return mp4FilePath;
}
async function processBufferedMessages(client, chatId, botName, phoneIndex) {
    const buffer = messageBuffers.get(chatId);
    if (!buffer || buffer.messages.length === 0) return;

    const messages = buffer.messages;
    messageBuffers.delete(chatId); // Clear the buffer

    // Combine all message bodies
    const combinedMessage = messages.map(m => m.body).join(' ');

    // Process the combined message
    await processMessage(client, messages[0], botName, phoneIndex, combinedMessage);
}

async function processMessage(client, msg, botName, phoneIndex, combinedMessage) {
    console.log('Processing buffered messages for '+botName);

    const idSubstring = botName;
    const chatId = msg.from;
    
    try {
        // Initial fetch of config
        await fetchConfigFromDatabase(idSubstring,phoneIndex);
        if(ghlConfig.stopbot){
            if(ghlConfig.stopbot == true){
                console.log('bot stop all');
                return;
            }
        }
        // Set up the daily report schedule
        await checkAndScheduleDailyReport(client, idSubstring);

        const sender = {
            to: msg.from,
            name: msg.notifyName,
        };

        const extractedNumber = '+'+(sender.to).split('@')[0];

        if (msg.fromMe){
            console.log(msg);
            return;
        }
            
        let contactID;
        let contactName;
        let threadID;
        let query;
        let answer;
        let parts;
        let currentStep;
        const chat = await msg.getChat();
        const contactData = await getContactDataFromDatabaseByPhone(extractedNumber, idSubstring);
        let unreadCount = 0;
        let stopTag = contactData?.tags || [];
        const contact = await chat.getContact();


   
        if (msg.fromMe){
            if(stopTag.includes('idle')){
            }
            return;
        }


      
        if ((msg.from).includes('120363178065670386')) {
            console.log('detected message from group juta')
            console.log(combinedMessage)
            if ((combinedMessage).startsWith('<Confirmed Appointment>')) {
                console.log('detected <CONFIRMED APPOINTMENT>')
                await handleConfirmedAppointment(client, msg);
                return;
            }
        } if (contactData.threadid) {
            threadID = contactData.threadid;
        } else {
            const thread = await createThread();
            threadID = thread.id;
            await saveThreadIDFirebase(contactID, threadID, idSubstring)
        }
        if (msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt')) {

            console.log('Voice message detected');
            const media = await msg.downloadMedia();
            const transcription = await transcribeAudio(media.data);
            console.log('Transcription:', transcription);
            
            if (transcription && transcription.trim() !== '' && transcription !== 'Audio transcription failed. Please try again.') {
                messageBody = transcription;
            } else {
                messageBody = "[Voice message]"; // Default message if transcription fails or is empty
            }
            audioData = media.data;
            combinedMessage = messageBody;
            console.log(msg);   
        }else{
 
        }
        currentStep = userState.get(sender.to) || steps.START;
        switch (currentStep) {
            case steps.START:
                var context = "";

                query = `${combinedMessage}`;
                if(!(sender.to.includes('@g.us')) || (combinedMessage.toLowerCase().startsWith('@juta') && phoneIndex == 0)){
                    answer = await handleOpenAIAssistant(query, threadID, stopTag, extractedNumber, idSubstring, client,contactData.contactName);
                    console.log(answer);
                    parts = answer.split(/\s*\|\|\s*/);
                    
                    for (let i = 0; i < parts.length; i++) {
                        const part = parts[i].trim();   
                        const check = part.toLowerCase();
                        if (part) {
                            if (part) {
                                if (part) {
                                    const sentMessage = await client.sendMessage(msg.from, part);

                                    // Save the message to Firebase
                                    const sentMessageData = {
                                        chat_id: sentMessage.from,
                                        from: sentMessage.from ?? "",
                                        from_me: true,
                                        id: sentMessage.id._serialized ?? "",
                                        source: sentMessage.deviceType ?? "",
                                        status: "delivered",
                                        text: {
                                            body: part
                                        },
                                        timestamp: sentMessage.timestamp ?? 0,
                                        type: 'text',
                                        ack: sentMessage.ack ?? 0,
                                    };
        
                                    const contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber);
                                    const messagesRef = contactRef.collection('messages');
                            
                                    const messageDoc = messagesRef.doc(sentMessage.id._serialized);
        
                                    await messageDoc.set(sentMessageData, { merge: true });
                                    if (check.includes('patience')) {
                                    } 
                                    if(check.includes('get back to you as soon as possible')){
                                        console.log('check includes');
                                    
                                       await callWebhook("https://hook.us1.make.com/qoq6221v2t26u0m6o37ftj1tnl0anyut",check,threadID);
                                    }
                                }
                            }
                        }
                    }
                }
                await chat.markUnread();
                console.log('Response sent.');
                userState.set(sender.to, steps.START);
                break;
            default:
                // Handle unrecognized step
                console.error('Unrecognized step:', currentStep);
                break;
        }
        // Implement rate limiting
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
    } catch (e) {
        console.error('Error:', e.message);
        return(e.message);
    }
}
function formatPhoneNumber(phoneNumber) {
  console.log('Formatting phone number:', phoneNumber);
  // Remove all non-digit characters
  let cleaned = phoneNumber.replace(/\D/g, '');
  
  // Remove the leading '60' if present
  if (cleaned.startsWith('60')) {
    cleaned = cleaned.slice(2);
  }
  
  // Ensure the number starts with '+60'
  cleaned = '+60' + cleaned;
  
  console.log('Formatted phone number:', cleaned);
  return cleaned;
}
function extractAppointmentInfo(messageBody) {
    const lines = messageBody.split('\n');
    const info = {};

    lines.forEach(line => {
        if (line.includes('Date:')) info.date = line.split('Date:')[1].trim();
        if (line.includes('Time:')) info.time = line.split('Time:')[1].trim();
        if (line.includes('Senior Inspector:')) info.inspectorName = line.split('Senior Inspector:')[1].trim();
        if (line.includes('Contact Direct:')) info.inspectorPhone = line.split('Contact Direct:')[1].trim().replace('wa.me/', '');
        if (line.includes('Vehicle No Plate:')) info.vehiclePlate = line.split('Vehicle No Plate:')[1].trim();
        if (line.includes('Client:')) info.clientName = line.split('Client:')[1].trim();
        if (line.includes('Contact:')) info.clientPhone = line.split('Contact:')[1].trim().replace('wa.me/', '');
        if (line.includes('Site Add:')) {
            info.siteAddress = line.split('Site Add:')[1].trim();
            // Capture multi-line address
            let i = lines.indexOf(line) + 1;
            while (i < lines.length && !lines[i].includes('Email')) {
                info.siteAddress += ' ' + lines[i].trim();
                i++;
            }
        }
    });

    return info;
}
async function addAppointmentToSpreadsheet(appointmentInfo) {
    const spreadsheetId = '1sQRyU0nTuUSnVWOJ44SAyWJXC0a_PbubttpRR_l0Uco';
    const sheetName = '08.2024';
    const range = `${sheetName}!A:S`; // Expanded range to include all columns

    const auth = new google.auth.GoogleAuth({
        keyFile: './service_account.json',
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const values = [
        [
            '', // No. (auto-increment in spreadsheet)
            appointmentInfo.date,
            appointmentInfo.time,
            appointmentInfo.clientPhone,
            appointmentInfo.clientName,
            '', // Assuming the client is always the owner
            appointmentInfo.siteAddress,
            '', // Waze link (can be added later if available)
            '', // Email (can be added later if available)
            appointmentInfo.issue || '', // If you have this information
            '', // WhatsApp group (can be filled later)
            '', // 9x9 Pictures
            '', // Hand written quotation
            '', // Draft quotation photos
            '', // Typed draft quotation
            '', // sent
            '', // detailed quotation
            '', // sent
            ''  // payment
        ]
    ];

    try {
        const response = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: { values },
        });

        console.log(`${response.data.updates.updatedCells} cells appended.`);
    } catch (error) {
        console.error('Error adding appointment to spreadsheet:', error);
    }
}

async function addContactToFirebase(groupId, groupTitle, idSubstring) {
    const extractedNumber = groupId.split('@')[0];
    const data = {
        additionalEmails: [],
        address1: null,
        assignedTo: null,
        businessId: null,
        phone: extractedNumber,
        tags: [''],
        chat: {
            contact_id: extractedNumber,
            id: groupId,
            name: groupTitle,
            not_spam: true,
            tags: [''],
            timestamp: Date.now(),
            type: 'group',
            unreadCount: 0,
            last_message: {
                chat_id: groupId,
                from: groupId,
                from_me: true,
                id: "",
                source: "",
                status: "",
                text: {
                    body: ""
                },
                timestamp: Date.now(),
                type: 'text',
            },
        },
        chat_id: groupId,
        city: null,
        companyName: null,
        contactName: groupTitle,
        unreadCount: 0,
        threadid: "",
        phoneIndex: 0,
        last_message: {
            chat_id: groupId,
            from: groupId,
            from_me: true,
            id: Date.now().toString(),
            source: "",
            status: "",
            text: {
                body: ""
            },
            timestamp: Date.now(),
            type: 'text',
        },
        createdAt: admin.firestore.Timestamp.now(),
        profilePicUrl: "",
    };

    try {
        await db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber).set(data);
        console.log('Group added to Firebase:', groupId);
    } catch (error) {
        console.error('Error adding group to Firebase:', error);
    }
}


async function handleConfirmedAppointment(client, msg) {
    // Extract information from the message
    const appointmentInfo = extractAppointmentInfo(msg.body);

    await addAppointmentToSpreadsheet(appointmentInfo);

    // Create a new group
    const groupTitle = `${appointmentInfo.clientPhone}  ${appointmentInfo.clientName}`;
    const participants = [(appointmentInfo.clientPhone+'@c.us'), '60126029909@c.us', '601121677522@c.us'];

    try {
        const result = await client.createGroup(groupTitle, participants);
        console.log('Group created:', result);

        await addContactToFirebase(result.gid._serialized, groupTitle, '001');

        // Send appointment details to the new group
        // Send the initial message
        const initialMessage = `Hi 👋, Im Mr Kelvern(wa.me/601111393111)
        \nfrom BINA Pasifik Sdn Bhd (Office No: 03-2770 9111)
        \nAnd I've conducted the site inspection at your house that day.
        \nThis group has been created specifically to manage your house roofing case.
        \n\nBelow is our BINA group's department personnel:
        
        \n\n1. Operation/ Job Arrangement (Ms Sheue Lih - 60186688766)
        \n2. Manager (Mr Lim - 60193868776)
        
        \n\nThe functions of this group are to provide:
        \n* Quotations, Invoices, Receipts, Warranty Certificate & Job arrangement
        
        \n\n* Send pictures of job updates from time to time
        
        \n\n* Or if you have any confirmation/bank slip or feedbacks/complaints you may speak out in this group also
        \n\n⬇Our Facebook page⬇
        \nhttps://www.facebook.com/BINApasifik
        
        \n\n⬇Our Website⬇
        \nwww.BINApasifik.com
        
        \n\nWe are committed to providing you with our very best services 😃
        
        \n\nThank you.`;
        const message = await client.sendMessage(result.gid._serialized, initialMessage)
        await addMessagetoFirebase(message, '001','+'+((result.gid._serialized).split('@')[0]), groupTitle);
        
        const documentUrl = 'https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/kelven.jpg?alt=media&token=baef675f-43e3-4f56-b2ba-19db0a6ddbf5';
        const media = await MessageMedia.fromUrl(documentUrl);
        const documentMessage = await client.sendMessage(result.gid._serialized, media);
        await addMessagetoFirebase(documentMessage, '001','+'+((result.gid._serialized).split('@')[0]), groupTitle);

        const documentUrl2 = `https://firebasestorage.googleapis.com/v0/b/onboarding-a5fcb.appspot.com/o/Your%20Roofing's%20Doctor.pdf?alt=media&token=7c72f8e4-72cd-4da1-bb3d-387ffeb8ab91`;
        const media2 = await MessageMedia.fromUrl(documentUrl2);
        const documentMessage2 = await client.sendMessage(result.gid._serialized, media2);
        await addMessagetoFirebase(documentMessage2, '001','+'+((result.gid._serialized).split('@')[0]), groupTitle);

        const finalMessage = `Your detail quotation will be prepared and sent out to this group in 3 to 5 working days ya 👌`;
        const message2 = await client.sendMessage(result.gid._serialized, finalMessage)
        await addMessagetoFirebase(message2, '001','+'+((result.gid._serialized).split('@')[0]), groupTitle);
    } catch (error) {
        console.error('Error creating group:', error);
    }
}

async function sendMessage(client, phoneNumber, message, idSubstring) {
    console.log('Sending message to:', phoneNumber);
    console.log('Message content:', message);
    console.log('idSubstring:', idSubstring);
  
    try {
      // Format the phone number for WhatsApp
      const formattedNumberForWhatsApp = formatPhoneNumber(phoneNumber).slice(1) + '@c.us'; // Remove '+' and add '@c.us'
      console.log('Formatted number for WhatsApp:', formattedNumberForWhatsApp);
  
      // Format the phone number for Firebase
      const formattedNumberForFirebase = formatPhoneNumber(phoneNumber);
      console.log('Formatted number for Firebase:', formattedNumberForFirebase);
  
      if (!formattedNumberForWhatsApp || !formattedNumberForFirebase) {
        throw new Error('Invalid phone number');
      }
  
      // Send the message
      const sent = await client.sendMessage(formattedNumberForWhatsApp, message);
      console.log('Message sent:', sent);
  
      // Prepare the messageData for Firebase
      const messageData = {
        chat_id: formattedNumberForWhatsApp,
        from: client.info.wid._serialized,
        from_me: true,
        id: sent.id._serialized,
        source: "web",
        status: "sent",
        text: {
          body: message
        },
        timestamp: sent.timestamp,
        type: 'text',
      };
      console.log('Message data:', messageData);
  
      // Add the message to Firebase
     
  
      // Prepare the response
      const response = {
        status: 'success',
        message: 'Message sent successfully and added to Firebase',
        messageId: sent.id._serialized,
        timestamp: sent.timestamp,
      };
  
      return JSON.stringify(response);
    } catch (error) {
      console.error('Error in sendMessage:', error);
      return JSON.stringify({ 
        status: 'error',
        error: 'Failed to send message or add to Firebase',
        details: error.message 
      });
    }
  }
  async function listContactsWithTag(idSubstring, tag, limit = 10) {
    try {
      const contactsRef = db.collection('companies').doc(idSubstring).collection('contacts');
      const snapshot = await contactsRef.get();
  
      const lowercaseSearchTag = tag.toLowerCase();
      const contacts = snapshot.docs
        .filter(doc => {
          const tags = (doc.data().tags || []).map(t => t.toLowerCase());
          return tags.some(t => t.includes(lowercaseSearchTag));
        })
        .slice(0, limit)
        .map(doc => ({
          phoneNumber: doc.id,
          contactName: doc.data().contactName,
          tags: doc.data().tags
        }));
  
      return JSON.stringify(contacts);
    } catch (error) {
      console.error('Error listing contacts with tag:', error);
      return JSON.stringify({ error: 'Failed to list contacts with tag' });
    }
  }
async function addMessagetoFirebase(msg, idSubstring, extractedNumber, contactName){
    console.log('Adding message to Firebase');
    console.log('idSubstring:', idSubstring);
    console.log('extractedNumber:', extractedNumber);

    if (!extractedNumber || !extractedNumber.startsWith('+60')) {
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
      if (msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt')) {
        console.log('Voice message detected');
        const media = await msg.downloadMedia();
        const transcription = await transcribeAudio(media.data);
        console.log('Transcription:', transcription);
        
        if (transcription && transcription !== 'Audio transcription failed. Please try again.') {
            messageBody = transcription;
        } else {
            messageBody = "I couldn't transcribe the audio. Could you please type your message instead?";
        }
        audioData = media.data;
        combinedMessage = messageBody;
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

    const contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(extractedNumber);
    const messagesRef = contactRef.collection('messages');

    const messageDoc = messagesRef.doc(msg.id._serialized);
    await messageDoc.set(messageData, { merge: true });
    console.log(messageData);
    await addNotificationToUser(idSubstring, messageData, contactName);
}
async function removeTagBookedGHL(contactID, tag) {
    const options = {
        method: 'DELETE',
        url: `https://services.leadconnectorhq.com/contacts/${contactID}/tags`,
        headers: {
            Authorization: `Bearer ${ghlConfig.ghl_accessToken}`,
            Version: '2021-07-28',
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        data: {
            tags: [tag],
        }
    };

    try {
        const response = await axios.request(options);
    } catch (error) {
        console.error('Error removing tag from contact:', error);
    }
}
async function testDailyReminders(client, idSubstring) {
  console.log('Testing daily reminders...');
  
  // Send the contact report
  await sendDailyContactReport(client, idSubstring);
  
  // Send the task reminder
  await sendDailyTaskReminder(client, idSubstring);
  
  return JSON.stringify({ message: "Daily reminders sent successfully for testing." });
}
async function getContactById(contactId) {
    const options = {
        method: 'GET',
        url: `https://services.leadconnectorhq.com/contacts/${contactId}`,
        headers: {
            Authorization: `Bearer ${ghlConfig.ghl_accessToken}`,
            Version: '2021-07-28',
            Accept: 'application/json'
        }
    };

    try {
        const response = await axios.request(options);
        return response.data.contact;
    } catch (error) {
        console.error(error);
    }
}

async function addtagbookedGHL(contactID, tag) {
    const contact = await getContactById(contactID);
    const previousTags = contact.tags || [];
    const options = {
        method: 'PUT',
        url: `https://services.leadconnectorhq.com/contacts/${contactID}`,
        headers: {
            Authorization: `Bearer ${ghlConfig.ghl_accessToken}`,
            Version: '2021-07-28',
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        data: {
            tags: [...new Set([...previousTags, tag])]
        }
    };

    try {
        await axios.request(options);
    } catch (error) {
        console.error('Error adding tag to contact:', error);
    }
}

async function createThread() {
    console.log('Creating a new thread...');
    const thread = await openai.beta.threads.create();
    return thread;
}

async function addMessage(threadId, message) {
    const response = await openai.beta.threads.messages.create(
        threadId,
        {
            role: "user",
            content: message
        }
    );
    return response;
}

// Updated checkAvailableTimeSlots function
async function checkAvailableTimeSlots(daysAhead = 7) {
    const currentDateTime = getTodayDate(); // Get current date and time
    const today = moment().tz('Asia/Kuala_Lumpur').format('YYYY-MM-DD'); // Get today's date
    const availableSlots = [];
    const slotDuration = 60 * 60 * 1000; // Fixed duration of 1 hour in milliseconds

    // Create an auth client for Google Calendar
    const auth = new google.auth.GoogleAuth({
        keyFile: './service_account.json', // Update this path
        scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });

    const calendar = google.calendar({ version: 'v3', auth });

    // Loop through the next 'daysAhead' days
    for (let dayOffset = 0; dayOffset <= daysAhead; dayOffset++) {
        const dateToCheck = moment(today).add(dayOffset, 'days').format('YYYY-MM-DD');
        const startOfDay = moment(dateToCheck).startOf('day').toISOString();
        const endOfDay = moment(dateToCheck).endOf('day').toISOString();

        // Fetch events for the day
        const eventsResponse = await calendar.events.list({
            calendarId: 'faeezree@gmail.com', // Use the appropriate calendar ID
            timeMin: startOfDay,
            timeMax: endOfDay,
            singleEvents: true,
            orderBy: 'startTime',
        });

        const events = eventsResponse.data.items;
        const bookedSlots = events.map(event => ({
            startTime: new Date(event.start.dateTime || event.start.date).getTime(),
            endTime: new Date(event.end.dateTime || event.end.date).getTime(),
        }));

        // Check for available slots in the day
        for (let hour = 0; hour < 24; hour++) { // Check all hours in the day
            const startTime = moment(dateToCheck).set({ hour, minute: 0 }).toDate().getTime();
            const endTime = startTime + slotDuration;

            // Only consider future time slots
            if (startTime < new Date().getTime()) {
                continue; // Skip if the start time is in the past
            }

            // Check if the slot is booked
            const isBooked = bookedSlots.some(slot => {
                return (startTime < slot.endTime && endTime > slot.startTime);
            });

            if (!isBooked) {
                availableSlots.push({
                    startTime: new Date(startTime),
                    endTime: new Date(endTime),
                });
            }
        }
    }

    // Return all available slots but only provide three at a time
    return availableSlots.length > 0 ? availableSlots : 'No available time slots for the next few days.';
}
async function callWebhook(webhook,senderText,thread) {
    console.log('calling webhook')
    const webhookUrl = webhook;
    const body = JSON.stringify({ senderText,thread}); // Include sender's text in the request body
    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: body
    });  let responseData =""
    if(response.status === 200){
        responseData= await response.text(); // Dapatkan respons sebagai teks
    }else{
        responseData = 'stop'
    }
 return responseData;
}

// Add this function to count contacts created today
async function countContactsCreatedToday(idSubstring) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const contactsRef = db.collection('companies').doc(idSubstring).collection('contacts');
    const snapshot = await contactsRef
        .where('createdAt', '>=', today)
        .get();

    return snapshot.size;
}

// Add this function to send the daily report
async function sendDailyContactReport(client, idSubstring) {
    const count = await countContactsCreatedToday(idSubstring);
    const message = `Daily Report: ${count} new lead(s) today.`;
    
    // Replace with the actual group chat ID where you want to send the report
    const groupChatId = '120363178065670386@g.us';
    
    await client.sendMessage(groupChatId, message);
}


async function getContactDataFromDatabaseByPhone(phoneNumber, idSubstring) {
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

async function checkingStatus(threadId, runId) {
    const runObject = await openai.beta.threads.runs.retrieve(
        threadId,
        runId
    );
    const status = runObject.status; 
    if(status == 'completed') {
        try{
            const messagesList = await openai.beta.threads.messages.list(threadId);
            const latestMessage = messagesList.body.data[0].content;

            console.log("Latest Message:");
            console.log(latestMessage[0].text.value);
            const answer = latestMessage[0].text.value;
            return answer;
        } catch(error){
            console.log("error from handleNewMessagesJuta2: "+error)
            throw error;
        }
    }
    return null; // Return null if not completed
}

// Modify the waitForCompletion function to handle tool calls
async function waitForCompletion(threadId, runId, idSubstring, client, depth = 0,phoneNumber,name) {
    const maxDepth = 5; // Maximum recursion depth
    const maxAttempts = 30;
    const pollingInterval = 2000; // 2 seconds
  
    console.log(`Waiting for completion (depth: ${depth}, runId: ${runId})...`);
  
    if (depth >= maxDepth) {
      console.error(`Max recursion depth reached for runId: ${runId}`);
      return "I apologize, but I'm having trouble completing this task. Could you please try rephrasing your request?";
    }
  
    for (let attempts = 0; attempts < maxAttempts; attempts++) {
      try {
        const runObject = await openai.beta.threads.runs.retrieve(threadId, runId);
        console.log(`Run status: ${runObject.status} (attempt ${attempts + 1})`);
  
        if (runObject.status === 'completed') {
          const messagesList = await openai.beta.threads.messages.list(threadId);
          const latestMessage = messagesList.data[0].content[0].text.value;
          return latestMessage;
        } else if (runObject.status === 'requires_action') {
          console.log('Run requires action, handling tool calls...');
          const toolCalls = runObject.required_action.submit_tool_outputs.tool_calls;
          const toolOutputs = await handleToolCalls(toolCalls, idSubstring, client,phoneNumber,name);
          console.log('Submitting tool outputs...');
          await openai.beta.threads.runs.submitToolOutputs(threadId, runId, { tool_outputs: toolOutputs });
          console.log('Tool outputs submitted, restarting wait for completion...');
          return await waitForCompletion(threadId, runId, idSubstring, client, depth + 1,phoneNumber,name);
        } else if (['failed', 'cancelled', 'expired'].includes(runObject.status)) {
          console.error(`Run ${runId} ended with status: ${runObject.status}`);
          return `I encountered an error (${runObject.status}). Please try your request again.`;
        }
  
        await new Promise(resolve => setTimeout(resolve, pollingInterval));
      } catch (error) {
        console.error(`Error in waitForCompletion (depth: ${depth}, runId: ${runId}): ${error}`);
        return "I'm sorry, but I encountered an error while processing your request. Please try again.";
      }
    }
  
    console.error(`Timeout: Assistant did not complete in time (depth: ${depth}, runId: ${runId})`);
    return "I'm sorry, but it's taking longer than expected to process your request. Please try again or rephrase your question.";
  }


// Modify the runAssistant function to handle tool calls
async function runAssistant(assistantID, threadId, tools,idSubstring,client,phoneNumber,name) {
    console.log('Running assistant for thread: ' + threadId);
    const response = await openai.beta.threads.runs.create(
      threadId,
      {
        assistant_id: assistantID,
        tools: tools,
      }
    );
  
    const runId = response.id;
  
    const answer = await waitForCompletion(threadId, runId,idSubstring,client, 0,phoneNumber,name);
    return answer;
  }
  async function fetchMultipleContactsData(phoneNumbers, idSubstring) {
    try {
      const contactsData = await Promise.all(phoneNumbers.map(async (phoneNumber) => {
        const contactData = await getContactDataFromDatabaseByPhone(phoneNumber, idSubstring);
        return { phoneNumber, ...contactData };
      }));
      return JSON.stringify(contactsData);
    } catch (error) {
      console.error('Error fetching multiple contacts data:', error);
      return JSON.stringify({ error: 'Failed to fetch contacts data' });
    }
  }
  
  async function listContacts(idSubstring, limit = 10, offset = 0) {
    try {
      const contactsRef = db.collection('companies').doc(idSubstring).collection('contacts');
      const snapshot = await contactsRef.orderBy('contactName').offset(offset).limit(limit).get();
      const contacts = snapshot.docs.map(doc => ({
        phoneNumber: doc.id,
        contactName: doc.data().contactName,
        phone: doc.data().phone
      }));
      return JSON.stringify(contacts);
    } catch (error) {
      console.error('Error listing contacts:', error);
      return JSON.stringify({ error: 'Failed to list contacts' });
    }
  }
  async function searchContacts(idSubstring, searchTerm) {
    try {
      console.log(`Searching for contacts with term: "${searchTerm}"`);
      const contactsRef = db.collection('companies').doc(idSubstring).collection('contacts');
      const searchTermLower = searchTerm.toLowerCase();
  
      // Perform the search
      const snapshot = await contactsRef.get();
      
      const matchingContacts = snapshot.docs
        .filter(doc => {
          const data = doc.data();
          console.log(`Checking contact: ${JSON.stringify(data)}`);
          const nameMatch = data.contactName && data.contactName.toLowerCase().includes(searchTermLower);
          const phoneMatch = data.phone && data.phone.includes(searchTerm);
          const tagMatch = data.tags && data.tags.some(tag => tag.toLowerCase().includes(searchTermLower));
          const match = nameMatch || phoneMatch || tagMatch;
          console.log(`Match result for ${data.contactName}: ${match}`);
          return match;
        })
        .map(doc => ({
          phoneNumber: doc.id,
          contactName: doc.data().contactName || 'Unknown',
          phone: doc.data().phone || '',
          tags: doc.data().tags || []
        }));
  
      console.log(`Found ${matchingContacts.length} matching contacts`);
  
      if (matchingContacts.length === 0) {
        return JSON.stringify({ message: 'No matching contacts found.' });
      }
  
      return JSON.stringify({
        matchingContacts,
        totalMatches: matchingContacts.length
      });
    } catch (error) {
      console.error('Error searching contacts:', error);
      return JSON.stringify({ error: 'Failed to search contacts', details: error.message });
    }
  }

  async function tagContact(idSubstring, phoneNumber, tag) {
    try {
      // Fetch contact data using the existing function
      const contactDataJson = await fetchContactData(phoneNumber, idSubstring);
      const contactData = JSON.parse(contactDataJson);
  
      if (contactData.error) {
        console.log(`No contact found for number: ${phoneNumber}`);
        return JSON.stringify({ 
          error: 'Contact not found', 
          details: `No contact found for number: ${phoneNumber}. Please check the number and try again.`
        });
      }
  
      // Contact found, proceed with tagging
      const contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(phoneNumber);
      const currentTags = contactData.tags || [];
      const newTags = [...new Set([...currentTags, tag])]; // Ensure uniqueness
  
      await contactRef.update({ tags: newTags });
  
      return JSON.stringify({ 
        success: true, 
        message: `Contact ${phoneNumber} tagged with "${tag}"`,
        updatedTags: newTags
      });
    } catch (error) {
      console.error('Error tagging contact:', error);
      return JSON.stringify({ error: 'Failed to tag contact', details: error.message });
    }
  }
  async function addPointsForBottlesBought(phoneNumber, idSubstring, bottlesBought) {
    try {
        const contactRef = db.collection('companies').doc(idSubstring).collection('contacts').doc(phoneNumber);
        const doc = await contactRef.get();

        if (!doc.exists) {
            return JSON.stringify({ error: 'Contact not found' });
        }

        const contactData = doc.data();
        const currentPoints = contactData.points || 0;
        const newPoints = currentPoints + (bottlesBought * 5);

        await contactRef.update({ points: newPoints });

        return JSON.stringify({ 
            success: true, 
            message: `Added ${bottlesBought * 5} points for ${bottlesBought} bottles bought.`,
            newPoints: newPoints
        });
    } catch (error) {
        console.error('Error adding points for bottles bought:', error);
        return JSON.stringify({ error: 'Failed to add points for bottles bought' });
    }
}
  // Modify the handleToolCalls function to include the new tool
async function handleToolCalls(toolCalls, idSubstring, client,phoneNumber,name) {
    console.log('Handling tool calls...');
    const toolOutputs = [];
    for (const toolCall of toolCalls) {
        console.log(`Processing tool call: ${toolCall.function.name}`);
        switch (toolCall.function.name) {
            case 'sendImage':
                try {
                  console.log('Sending image...');
                  const args = JSON.parse(toolCall.function.arguments);
                  const result = await sendImage(client, phoneNumber, args.imageUrl, args.caption, idSubstring);
                  toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output: result,
                  });
                } catch (error) {
                  console.error('Error in handleToolCalls for sendImage:', error);
                  toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output: JSON.stringify({ error: error.message }),
                  });
                }
                break;
                case 'addPointsForBottlesBought':
    try {
        console.log('Adding points for bottles bought...');
        const args = JSON.parse(toolCall.function.arguments);
        
        // Ensure all required fields are provided
        if ( !args.bottlesBought) {
            throw new Error('Missing required fields for adding points');
        }

        const result = await addPointsForBottlesBought(phoneNumber, "001", args.bottlesBought);
        toolOutputs.push({
            tool_call_id: toolCall.id,
            output: result,
        });
    } catch (error) {
        console.error('Error in handleToolCalls for addPointsForBottlesBought:', error);
        toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
        });
    }
    break;
            case 'registerUser':
                try {
                    console.log('Registering user...');
                    const args = JSON.parse(toolCall.function.arguments);
                    
                    // Ensure all required fields are provided
                    if (!args.phoneNumber || !args.email || !args.username || !args.companyName || !args.password) {
                        throw new Error('Missing required fields for user registration');
                    }
            
                    const result = await registerUser(args.phoneNumber, args.email, args.username, args.companyName, args.password);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify(result),
                    });
                } catch (error) {
                    console.error('Error in handleToolCalls for registerUser:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message }),
                    });
                }
                break;
          case 'testDailyReminders':
            try {
                console.log('Testing daily reminders...');
                const result = await testDailyReminders(client, idSubstring);
                toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output: result,
                });
            } catch (error) {
                console.error('Error in handleToolCalls for testDailyReminders:', error);
                toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output: JSON.stringify({ error: error.message }),
                });
            }
            break;
          case 'deleteTask':
            try {
                console.log('Deleting task...');
                const args = JSON.parse(toolCall.function.arguments);
                const result = await deleteTask(idSubstring, args.taskIndex);
                toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output: result,
                });
            } catch (error) {
                console.error('Error in handleToolCalls for deleteTask:', error);
                toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output: JSON.stringify({ error: error.message }),
                });
            }
            break;

        case 'editTask':
            try {
                console.log('Editing task...');
                const args = JSON.parse(toolCall.function.arguments);
                const result = await editTask(idSubstring, args.taskIndex, args.newTaskString, args.newAssignee, args.newDueDate);
                toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output: result,
                });
            } catch (error) {
                console.error('Error in handleToolCalls for editTask:', error);
                toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output: JSON.stringify({ error: error.message }),
                });
            }
            break;
          case 'listAssignedTasks':
                try {
                    console.log('Listing assigned tasks...');
                    const args = JSON.parse(toolCall.function.arguments);
                    const result = await listAssignedTasks(idSubstring, args.assignee);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: result,
                    });
                } catch (error) {
                    console.error('Error in handleToolCalls for listAssignedTasks:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message }),
                    });
                }
                break;
            case 'searchContacts':
                try {
                    console.log('Searching contacts...');
                    const args = JSON.parse(toolCall.function.arguments);
                    const searchResults = await searchContacts(idSubstring, args.searchTerm);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: searchResults,
                    });
                } catch (error) {
                    console.error('Error in handleToolCalls for searchContacts:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message }),
                    });
                }
                break;
            case 'tagContact':
                try {
                    console.log('Tagging contact...');
                    const args = JSON.parse(toolCall.function.arguments);
                    const result = await tagContact(idSubstring, args.phoneNumber, args.tag);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: result,
                    });
                } catch (error) {
                    console.error('Error in handleToolCalls for tagContact:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message }),
                    });
                }
                break;
            case 'getContactsAddedToday':
                try {
                    console.log('Getting contacts added today...');
                    const result = await getContactsAddedToday(idSubstring);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify(result),
                    });
                } catch (error) {
                    console.error('Error in handleToolCalls for getContactsAddedToday:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message }),
                    });
                }
                break;
            case 'listAssignedContacts':
                try {
                    console.log('Listing assigned contacts...');
                    const args = JSON.parse(toolCall.function.arguments);
                    const result = await listAssignedContacts(idSubstring, args.assigneeName, args.limit);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: result,
                    });
                } catch (error) {
                    console.error('Error in handleToolCalls for listAssignedContacts:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message }),
                    });
                }
                break;
            case 'listContactsWithTag':
                try {
                    console.log('Listing contacts with tag...');
                    const args = JSON.parse(toolCall.function.arguments);
                    const result = await listContactsWithTag(idSubstring, args.tag, args.limit);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: result,
                    });
                } catch (error) {
                    console.error('Error in handleToolCalls for listContactsWithTag:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message }),
                    });
                }
                break;
            case 'sendMessage':
                try {
                    console.log('Sending message...');
                    const args = JSON.parse(toolCall.function.arguments);
                    const result = await sendMessage(client, args.phoneNumber, args.message, idSubstring);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: result,
                    });
                } catch (error) {
                    console.error('Error in handleToolCalls for sendMessage:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message }),
                    });
                }
                break;
            case 'searchWeb':
                try {
                    console.log('Searching the web...');
                    const args = JSON.parse(toolCall.function.arguments);
                    const searchResults = await searchWeb(args.query);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: searchResults,
                    });
                } catch (error) {
                    console.error('Error in handleToolCalls for searchWeb:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message }),
                    });
                }
                break;
                case 'checkAvailableTimeSlots':
    try {
        console.log('Parsing arguments for checkAvailableTimeSlots...');
        const args = JSON.parse(toolCall.function.arguments);
        console.log('Arguments:', args);
        
        console.log('Calling checkAvailableTimeSlots...');
        const result = await checkAvailableTimeSlots(); // No arguments needed since duration is fixed to 1 hour
        
        if (Array.isArray(result) && result.length > 0) {
            console.log('Available time slots found, preparing tool output...');
            toolOutputs.push({
                tool_call_id: toolCall.id,
                output: JSON.stringify({
                    success: true,
                    availableSlots: result,
                }),
            });
        } else {
            console.log('No available time slots found.');
            toolOutputs.push({
                tool_call_id: toolCall.id,
                output: JSON.stringify({
                    success: false,
                    message: result, // This will be the 'No available time slots for today.' message
                }),
            });
        }
    } catch (error) {
        console.error('Error in handleToolCalls for checkAvailableTimeSlots:');
        console.error(error);
        toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: error.message }),
        });
    }
    break;
                case 'createCalendarEvent':
                    try {
                        console.log('Parsing arguments for createCalendarEvent...');
                        const args = JSON.parse(toolCall.function.arguments);
                        console.log('Arguments:', args);
                        
                        console.log('Calling createCalendarEvent...');
                        const result = await createCalendarEvent(
                            args.summary, 
                            args.description, 
                            args.startDateTime, 
                            args.endDateTime,
                            phoneNumber,
                            name
                        );
                        
                        if (result.error) {
                            if (result.error === 'Scheduling conflict detected') {
                                console.log('Scheduling conflict detected, preparing conflict information...');
                                toolOutputs.push({
                                    tool_call_id: toolCall.id,
                                    output: JSON.stringify({
                                        error: result.error,
                                        conflictingAppointments: result.conflictingAppointments
                                    }),
                                });
                            } else {
                                console.error('Error creating event:', result.error);
                                toolOutputs.push({
                                    tool_call_id: toolCall.id,
                                    output: JSON.stringify({ error: result.error }),
                                });
                            }
                        } else {
                            console.log('Event created successfully, preparing tool output...');
                            toolOutputs.push({
                                tool_call_id: toolCall.id,
                                output: JSON.stringify(result),
                            });
                        }
                    } catch (error) {
                        console.error('Error in handleToolCalls for createCalendarEvent:');
                        console.error(error);
                        toolOutputs.push({
                            tool_call_id: toolCall.id,
                            output: JSON.stringify({ error: error.message }),
                        });
                    }      
                    break;
            case 'getTodayDate':
                console.log('Getting today\'s date...');
                const todayDate = getTodayDate();
                toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output: JSON.stringify({ date: todayDate }),
                });
                break;
            case 'fetchContactData':
                try {
                    console.log('Fetching contact data...');
                    const args = JSON.parse(toolCall.function.arguments);
                    const contactData = await fetchContactData(args.phoneNumber, idSubstring);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: contactData,
                    });
                } catch (error) {
                    console.error('Error in handleToolCalls for fetchContactData:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message }),
                    });
                }
                break;
            case 'getTotalContacts':
                try {
                    console.log('Getting total contacts...');
                    const totalContacts = await getTotalContacts(idSubstring);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ totalContacts }),
                    });
                } catch (error) {
                    console.error('Error in handleToolCalls for getTotalContacts:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message }),
                    });
                }
                break;
            case 'addTask':
                try {
                    console.log('Adding task...');
                    const args = JSON.parse(toolCall.function.arguments);
                    const result = await addTask(idSubstring, args.taskString, args.assignee, args.dueDate);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: result,
                    });
                } catch (error) {
                    console.error('Error in handleToolCalls for addTask:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message }),
                    });
                }
                break;
            case 'listTasks':
                try {
                    console.log('Listing tasks...');
                    const result = await listTasks(idSubstring);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: result,
                    });
                } catch (error) {
                    console.error('Error in handleToolCalls for listTasks:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message }),
                    });
                }
                break;
            case 'updateTaskStatus':
                try {
                    console.log('Updating task status...');
                    const args = JSON.parse(toolCall.function.arguments);
                    const result = await updateTaskStatus(idSubstring, args.taskIndex, args.newStatus);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: result,
                    });
                } catch (error) {
                    console.error('Error in handleToolCalls for updateTaskStatus:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message }),
                    });
                }
                break;
            case 'fetchMultipleContactsData':
                try {
                    console.log('Fetching multiple contacts data...');
                    const args = JSON.parse(toolCall.function.arguments);
                    const contactsData = await fetchMultipleContactsData(args.phoneNumbers, idSubstring);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: contactsData,
                    });
                } catch (error) {
                    console.error('Error in handleToolCalls for fetchMultipleContactsData:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message }),
                    });
                }
                break;
            case 'listContacts':
                try {
                    console.log('Listing contacts...');
                    const args = JSON.parse(toolCall.function.arguments);
                    const contactsList = await listContacts(idSubstring, args.limit, args.offset);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: contactsList,
                    });
                } catch (error) {
                    console.error('Error in handleToolCalls for listContacts:', error);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({ error: error.message }),
                    });
                }
                break;
            default:
                console.warn(`Unknown function called: ${toolCall.function.name}`);
        }
    }
    console.log('Finished handling tool calls');
    return toolOutputs;
}

async function analyzeAndSetLeadTemperature(phoneNumber, threadId) {
    try {
        console.log('Analyzing chat history for lead temperature...', phoneNumber);
        const idSubstring = '001'
        const chatHistory = await fetchRecentChatHistory(threadId);
        const analysis = await analyzeChatsWithAI(chatHistory);
        const temperature = determineLeadTemperature(analysis);
        await setLeadTemperature(idSubstring, phoneNumber, temperature);
        
        // Return a simple confirmation without details
        return JSON.stringify({
            success: true,
            message: "Lead temperature updated"
        });
    } catch (error) {
        console.error('Error in analyzeAndSetLeadTemperature:', error);
        return JSON.stringify({ error: 'Internal process completed' });
    }
}

async function fetchRecentChatHistory(threadId) {
    try {
        const messages = await openai.beta.threads.messages.list(threadId, {
            limit: 20,
            order: 'desc'
        });

        return messages.data.map(message => ({
            role: message.role,
            content: message.content[0].text.value,
            timestamp: message.created_at
        }));
    } catch (error) {
        console.error('Error fetching chat history from OpenAI:', error);
        return [];
    }
}

async function analyzeChatsWithAI(chatHistory) {
    const prompt = `Analyze the following chat history and determine the lead's interest level. 
                    Consider factors such as engagement, questions asked, and expressions of interest. Finally, your final answer should be a string that categorizes their interest level into three categories: high interest, moderate interest, or low interest.
                    Chat history: ${JSON.stringify(chatHistory)}`;

    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
    });

    return response.choices[0].message.content;
}

function determineLeadTemperature(analysis) {
    const lowercaseAnalysis = analysis.toLowerCase();
    console.log(lowercaseAnalysis)
    if (lowercaseAnalysis.includes('high interest') || lowercaseAnalysis.includes('very engaged')) {
        return 'hot';
    } else if (lowercaseAnalysis.includes('moderate interest') || lowercaseAnalysis.includes('somewhat engaged')) {
        return 'medium';
    } else {
        return 'cold';
    }
}

async function addtagbookedFirebase(contactID, tag, idSubstring) {
    const docPath = `companies/${idSubstring}/contacts/${contactID}`;
    const contactRef = db.doc(docPath);

    try {
        // Get the current document
        const doc = await contactRef.get();
        let currentTags = [];

        if (doc.exists) {
            currentTags = doc.data().tags || [];
        }

        // Add the new tag if it doesn't already exist
        if (!currentTags.includes(tag)) {
            currentTags.push(tag);

            // Update the document with the new tags
            await contactRef.set({
                tags: currentTags
            }, { merge: true });

            console.log(`Tag "${tag}" added to contact ${contactID} in Firebase`);
        } else {
            console.log(`Tag "${tag}" already exists for contact ${contactID} in Firebase`);
        }
    } catch (error) {
        console.error('Error adding tag to Firebase:', error);
    }
}

async function setLeadTemperature(idSubstring, phoneNumber, temperature) {
    console.log('adding tag ' + temperature + ' to ' + phoneNumber);

    // Define the possible lead temperature tags
    const leadTemperatureTags = ['cold', 'medium', 'hot'];

    // Fetch the current tags for the contact
    const docPath = `companies/${idSubstring}/contacts/${phoneNumber}`;
    const contactRef = db.doc(docPath);
    const doc = await contactRef.get();
    let currentTags = [];

    if (doc.exists) {
        currentTags = doc.data().tags || [];
    }

    // Remove any existing lead temperature tags
    const updatedTags = currentTags.filter(tag => !leadTemperatureTags.includes(tag));

    // Add the new lead temperature tag
    updatedTags.push(temperature);

    // Update the document with the new tags
    await contactRef.set({
        tags: updatedTags
    }, { merge: true });

    console.log(`Tag "${temperature}" added to contact ${phoneNumber} in Firebase`);
}

// Modify the handleOpenAIAssistant function to include the new tool
async function handleOpenAIAssistant(message, threadID, tags, phoneNumber, idSubstring, client,name) {
    console.log(ghlConfig.assistantId);
    let assistantId = ghlConfig.assistantId;
    if (tags !== undefined && tags.includes('team')) { 
        assistantId = ghlConfig.assistantIdTeam;
    } else if (tags !== undefined && tags.includes('demo')) {
        const contactData = await getContactDataFromDatabaseByPhone(phoneNumber, idSubstring);
        if (contactData && contactData.assistantId) {
            assistantId = contactData.assistantId;
        } else {
            console.warn(`Demo assistant not found for company: ${contactData?.companyName}`);
            // Fallback to default assistant if no matching demo assistant is found
            assistantId = ghlConfig.assistantIdTeam;
        }
    }
   
    await addMessage(threadID, message);
    // Periodically analyze and set lead temperature (e.g., every 5 messages)
    const messageCount = await getMessageCount(threadID);
    
    analyzeAndSetLeadTemperature(phoneNumber, threadID).catch(error => 
        console.error('Error in background lead temperature analysis:', error)
    );


    const tools = [
        {
            type: "function",
            function: {
              name: "sendImage",
              description: "Send an image to a WhatsApp contact",
              parameters: {
                type: "object",
                properties: {
                  phoneNumber: {
                    type: "string",
                    description: "The phone number of the recipient"
                  },
                  imageUrl: {
                    type: "string",
                    description: "The URL of the image to send"
                  },
                  caption: {
                    type: "string",
                    description: "The caption for the image"
                  }
                },
              
              }
            }
          },
        {
            type: "function",
            function: {
                name: "registerUser",
                description: "Register a new user with their details and create a new company",
                parameters: {
                    type: "object",
                    properties: {
                        phoneNumber: {
                            type: "string",
                            description: "The phone number of the user to register"
                        },
                        email: {
                            type: "string",
                            description: "The email address of the user"
                        },
                        password: {
                            type: "string",
                            description: "The password for the new user"
                        },
                        username: {
                            type: "string",
                            description: "The username for the new user"
                        },
                        companyName: {
                            type: "string",
                            description: "The name of the company to create"
                        }
                    },
                    required: ["phoneNumber", "email", "password", "username", "companyName"]
                },
            },
        },
      {
        type: "function",
        function: {
            name: "testDailyReminders",
            description: "Test the daily reminders by sending them immediately",
            parameters: {
                type: "object",
                properties: {},
                required: [],
            },
        },
    },
      {
        type: "function",
        function: {
            name: "deleteTask",
            description: "Delete a task from the company's task list",
            parameters: {
                type: "object",
                properties: {
                    taskIndex: { type: "number", description: "Index of the task to delete" },
                },
                required: ["taskIndex"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "editTask",
            description: "Edit an existing task in the company's task list",
            parameters: {
                type: "object",
                properties: {
                    taskIndex: { type: "number", description: "Index of the task to edit" },
                    newTaskString: { type: "string", description: "New task description (optional)" },
                    newAssignee: { type: "string", description: "New person assigned to the task (optional)" },
                    newDueDate: { type: "string", description: "New due date for the task (YYYY-MM-DD format, optional)" },
                },
                required: ["taskIndex"],
            },
        },
    },
      {
        type: "function",
        function: {
            name: "listAssignedTasks",
            description: "List tasks assigned to a specific person",
            parameters: {
                type: "object",
                properties: {
                    assignee: { type: "string", description: "Name of the person assigned to the tasks" },
                },
                required: ["assignee"],
            },
        },
    },
        {
            type: "function",
            function: {
                name: "searchContacts",
                description: "Search for contacts based on name, phone number, or tags",
                parameters: {
                    type: "object",
                    properties: {
                        idSubstring: { 
                            type: "string", 
                            description: "ID substring for the company" 
                        },
                        searchTerm: { 
                            type: "string", 
                            description: "Term to search for in contact names, phone numbers, or tags" 
                        }
                    },
                    required: ["idSubstring", "searchTerm"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "tagContact",
                description: "Tag or assign a contact. Assigning a contact is done by tagging them with the assignee's name.",
                parameters: {
                    type: "object",
                    properties: {
                        idSubstring: { 
                            type: "string", 
                            description: "ID substring for the company" 
                        },
                        phoneNumber: { 
                            type: "string", 
                            description: "Phone number of the contact to tag or assign" 
                        },
                        tag: { 
                            type: "string", 
                            description: "Tag to add to the contact. For assignments, use the assignee's name as the tag." 
                        }
                    },
                    required: ["idSubstring", "phoneNumber", "tag"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "getContactsAddedToday",
                description: "Get the number and details of contacts added today",
                parameters: {
                    type: "object",
                    properties: {
                        idSubstring: { type: "string", description: "ID substring for the company" },
                    },
                    required: ["idSubstring"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "listAssignedContacts",
                description: "List contacts that are assigned to a specific person (assignment is represented by a tag with the assignee's name)",
                parameters: {
                    type: "object",
                    properties: {
                        assigneeName: { 
                            type: "string",
                            description: "The name of the person to whom contacts are assigned" 
                        },
                        limit: {
                            type: "number",
                            description: "Maximum number of contacts to return (default 10)"
                        }
                    },
                    required: ["assigneeName"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "listContactsWithTag",
                description: "List contacts that have a specific tag",
                parameters: {
                    type: "object",
                    properties: {
                        tag: { 
                            type: "string",
                            description: "The tag to search for" 
                        },
                        limit: {
                            type: "number",
                            description: "Maximum number of contacts to return (default 10)"
                        }
                    },
                    required: ["tag"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "sendMessage",
                description: "Send a WhatsApp message to a specified phone number",
                parameters: {
                    type: "object",
                    properties: {
                        phoneNumber: { 
                            type: "string",
                            description: "The phone number to send the message to (with country code, e.g., +1234567890)" 
                        },
                        message: {
                            type: "string",
                            description: "The message to send"
                        }
                    },
                    required: ["phoneNumber", "message"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "searchWeb",
                description: "Search the web for information",
                parameters: {
                    type: "object",
                    properties: {
                        query: { 
                            type: "string",
                            description: "The search query" 
                        },
                    },
                    required: ["query"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "fetchMultipleContactsData",
                description: "Fetch data for multiple contacts given their phone numbers",
                parameters: {
                    type: "object",
                    properties: {
                        phoneNumbers: { 
                            type: "array", 
                            items: { type: "string" },
                            description: "Array of phone numbers to fetch data for" 
                        },
                    },
                    required: ["phoneNumbers"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "listContacts",
                description: "List contacts with pagination",
                parameters: {
                    type: "object",
                    properties: {
                        idSubstring: { type: "string", description: "ID substring for the company" },
                        limit: { type: "number", description: "Number of contacts to return (default 10)" },
                        offset: { type: "number", description: "Number of contacts to skip (default 0)" },
                    },
                    required: ["idSubstring"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "checkAvailableTimeSlots",
                description: "Check for available time slots in Google Calendar for the next specified number of days. Always call getCurrentDateTime first to get the current date and time as a reference before checking for available time slots. Returns all available time slots, but only provides three at a time, each with a duration of 1 hour, and only suggests slots that are after the current time.",                parameters: {
                    type: "object",
                    properties: {},
                    required: [],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "createCalendarEvent",
                description: "Schedule a meeting in Calendar. Always getTodayDate first to get the current date as a reference.The contact name should be included in the title of the event.",
                parameters: {
                    type: "object",
                    properties: {
                        summary: { type: "string", description: "Title of the event include the contact name" },
                        description: { type: "string", description: "Description of the event" },
                        startDateTime: { type: "string", description: "Start date and time in ISO 8601 format in Asia/Kuala Lumpur Timezone" },
                        endDateTime: { type: "string", description: "End date and time in ISO 8601 format in Asia/Kuala Lumpur Timezone" },
                        contactName: { type: "string", description: "Name of the contact" },
                        phoneNumber: { type: "string", description: "Phone number of the contact" },
                    },
                    required: ["summary", "startDateTime", "endDateTime","contactName"],
                },
            },
        },
        {   
            type: "function",
            function: {
                name: "getTodayDate",
                "description": "Always call this first when handling time-related queries, such as when a user asks for today, next week, tomorrow, yesterday, etc. Retrieves today's date in YYYY-MM-DD HH:mm:ss format.",
                parameters: {
                    type: "object",
                    properties: {},
                },
            },
        },
        {
            type: "function",
            function: {
                name: "fetchContactData",
                description: "Fetch contact data for a given phone number",
                parameters: {
                    type: "object",
                    properties: {
                        phoneNumber: { type: "string", description: "Phone number of the contact" },
                        idSubstring: { type: "string", description: "ID substring for the company" },
                    },
                    required: ["phoneNumber", "idSubstring"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "getTotalContacts",
                description: "Get the total number of contacts for a company",
                parameters: {
                    type: "object",
                    properties: {
                        idSubstring: { type: "string", description: "ID substring for the company" },
                    },
                    required: ["idSubstring"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "addTask",
                description: "Add a new task for the company",
                parameters: {
                    type: "object",
                    properties: {
                        taskString: { type: "string", description: "Task description" },
                        assignee: { type: "string", description: "Person assigned to the task" },
                        dueDate: { type: "string", description: "Due date for the task (YYYY-MM-DD format)" },
                    },
                    required: ["taskString", "assignee", "dueDate"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "listTasks",
                description: "List all tasks for the company",
                parameters: {
                    type: "object",
                    properties: {},
                },
            },
        },
        {
            type: "function",
            function: {
                name: "updateTaskStatus",
                description: "Update the status of a task",
                parameters: {
                    type: "object",
                    properties: {
                        taskIndex: { type: "number", description: "Index of the task to update" },
                        newStatus: { type: "string", description: "New status for the task" },
                    },
                    required: ["taskIndex", "newStatus"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "addPointsForBottlesBought",
                description: "Add points to a contact for bottles bought",
                parameters: {
                    type: "object",
                    properties: {
                        bottlesBought: { type: "number", description: "Number of bottles bought" },
                    },
                    required: [ "bottlesBought"],
                },
            },
        },
    ];
  
    const answer = await runAssistant(assistantId, threadID, tools, idSubstring, client,phoneNumber,name);
    return answer;
}

async function sendWhapiRequest(endpoint, params = {}, method = 'POST') {
    console.log('Sending request to Whapi.Cloud...');
    const options = {
        method: method,
        headers: {
            Authorization: `Bearer ${ghlConfig.whapiToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(params)
    };
    const url = `https://gate.whapi.cloud/${endpoint}`;
    const response = await fetch(url, options);
    const jsonResponse = await response.json();
    return jsonResponse;
}

async function getMessageCount(threadID) {
    try {
        const messagesRef = db.collection('threads').doc(threadID).collection('messages');
        const snapshot = await messagesRef.count().get();
        return snapshot.data().count;
    } catch (error) {
        console.error('Error getting message count:', error);
        return 0; // Return 0 if there's an error, to avoid breaking the main function
    }
}

async function saveThreadIDGHL(contactID, threadID) {
    const options = {
        method: 'PUT',
        url: `https://services.leadconnectorhq.com/contacts/${contactID}`,
        headers: {
            Authorization: `Bearer ${ghlConfig.ghl_accessToken}`,
            Version: '2021-07-28',
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        data: {
            customFields: [
                { key: 'threadid', field_value: threadID }
            ],
        }
    };

    try {
        await axios.request(options);
    } catch (error) {
        console.error(error);
    }
}

async function searchWeb(query) {
    try {
        const response = await axios.post('https://google.serper.dev/search', {
            q: query
        }, {
            headers: {
                'X-API-KEY': process.env.SERPER_API_KEY,
                'Content-Type': 'application/json'
            }
        });
    
        // Extract and format the search results
        const results = response.data.organic.slice(0, 3).map(result => ({
            title: result.title,
            snippet: result.snippet,
            link: result.link
        }));
    
        return JSON.stringify(results);
    } catch (error) {
        console.error('Error searching the web:', error);
        return JSON.stringify({ error: 'Failed to search the web' });
    }
}

async function saveThreadIDFirebase(contactID, threadID, idSubstring) {
    
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

async function createContact(name, number) {
    const options = {
        method: 'POST',
        url: 'https://services.leadconnectorhq.com/contacts/',
        headers: {
            Authorization: `Bearer ${ghlConfig.ghl_accessToken}`,
            Version: '2021-07-28',
            'Content-Type': 'application/json',
            Accept: 'application/json'
        },
        data: {
            firstName: name,
            name: name,
            locationId: ghlConfig.ghl_location,
            phone: number,
        }
    };

    try {
        await axios.request(options);
    } catch (error) {
        console.error(error);
    }
}

async function getContact(number) {
    const options = {
        method: 'GET',
        url: 'https://services.leadconnectorhq.com/contacts/search/duplicate',
        params: {
            locationId: ghlConfig.ghl_location,
            number: number
        },
        headers: {
            Authorization: `Bearer ${ghlConfig.ghl_accessToken}`,
            Version: '2021-07-28',
            Accept: 'application/json'
        }
    };
  
    try {
        const response = await axios.request(options);
        return (response.data.contact);
    } catch (error) {
        console.error(error);
    }
}


async function fetchConfigFromDatabase(idSubstring, phoneIndex) {
    try {
        const docRef = db.collection('companies').doc(idSubstring);
        const doc = await docRef.get();
        if (!doc.exists) {
            console.log('No such document!');
            return;
        }
        ghlConfig = doc.data();
        console.log('Initial ghlConfig:', ghlConfig);

        // Determine the assistantId based on phoneIndex
        if (phoneIndex > 0) {
            const assistantIdKey = `assistantId${phoneIndex + 1}`;
            if (ghlConfig[assistantIdKey]) {
                ghlConfig.assistantId = ghlConfig[assistantIdKey];
                console.log(`Using ${assistantIdKey}: ${ghlConfig.assistantId}`);
            } else {
                console.log(`${assistantIdKey} not found, using default assistantId`);
            }
        }

        console.log('Final ghlConfig:', ghlConfig);
    } catch (error) {
        console.error('Error fetching config:', error);
        throw error;
    }
}

const FormData = require('form-data');
async function transcribeAudio(audioData) {
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

module.exports = { handleNewMessagesHartaland };