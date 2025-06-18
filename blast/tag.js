const fetch = require("node-fetch");
const admin = require("../firebase.js");
const db = admin.firestore();
const OpenAI = require("openai");
const moment = require("moment-timezone");

let ghlConfig = {};
const openai = new OpenAI({
  apiKey: process.env.OPENAIKEY,
});
async function fetchConfigFromDatabase(idSubstring) {
  try {
    const docRef = db.collection("companies").doc(idSubstring);
    const doc = await docRef.get();
    if (!doc.exists) {
      console.log("No such document!");
      return;
    }
    ghlConfig = doc.data();
  } catch (error) {
    console.error("Error fetching config:", error);
    throw error;
  }
}

const axios = require("axios");

async function scheduleFollowUpFromTemplate(chatId, idSubstring, customerName, template, phoneIndex) {
  try {
    if (!template || !template.id) {
      throw new Error("Invalid template: template.id is required");
    }

    console.log("Starting template scheduling with:", {
      templateId: template.id,
      templateName: template.name,
      createdAt: template.createdAt?.toDate(),
      startTime: template.startTime?.toDate(),
      isCustomStartTime: template.isCustomStartTime,
    });

    let baseScheduledTime;
    if (template.isCustomStartTime) {
      baseScheduledTime = moment(template.startTime.toDate());
    } else {
      const createdAt = moment(template.createdAt.toDate());
      const startTime = moment(template.startTime.toDate());
      const initialDelay = startTime.diff(createdAt, "hours");
      baseScheduledTime = moment().add(initialDelay, "hours");
    }

    console.log("Initial base scheduled time:", baseScheduledTime.format());

    const lastMessageTimeByDay = {};

    const messagesRef = db
      .collection("companies")
      .doc(idSubstring)
      .collection("followUpTemplates")
      .doc(template.id)
      .collection("messages");

    const messagesSnapshot = await messagesRef
      .where("status", "==", "active")
      .orderBy("dayNumber")
      .orderBy("sequence")
      .get();

    if (messagesSnapshot.empty) {
      console.log("No active messages found in template");
      return;
    }

    const messagesByDay = {};
    messagesSnapshot.forEach((doc) => {
      const message = doc.data();
      message.id = doc.id;
      if (typeof message.dayNumber !== "number") {
        console.warn(`Message ${doc.id} has invalid dayNumber:`, message.dayNumber);
        return;
      }
      const dayNumber = message.dayNumber.toString();
      if (!messagesByDay[dayNumber]) {
        messagesByDay[dayNumber] = [];
      }
      messagesByDay[dayNumber].push(message);
    });

    const DELAY_BETWEEN_MESSAGES = 60000;

    let daysToAdd = 0;
    for (const dayNumber of Object.keys(messagesByDay).sort()) {
      const messages = messagesByDay[dayNumber];
      console.log(`Processing day ${dayNumber} with ${messages.length} messages`);

      for (const message of messages) {
        if (message.useScheduledTime && message.scheduledTime) {
          const [hours, minutes] = message.scheduledTime.split(":").map(Number);
          let testTime = baseScheduledTime
            .clone()
            .add(parseInt(dayNumber) - 1, "days")
            .hour(hours)
            .minute(minutes)
            .second(0);

          if (testTime.isBefore(moment())) {
            const newDaysToAdd = Math.ceil(moment().diff(testTime, "days", true));
            daysToAdd = Math.max(daysToAdd, newDaysToAdd);
          }
        }
      }
    }

    if (daysToAdd > 0) {
      baseScheduledTime.add(daysToAdd, "days");
      console.log(`Pushing all scheduled times forward by ${daysToAdd} days`);
    }

    for (const dayNumber of Object.keys(messagesByDay).sort()) {
      const messages = messagesByDay[dayNumber];

      const dayBaseTime = baseScheduledTime.clone().add(parseInt(dayNumber) - 1, "days");
      lastMessageTimeByDay[dayNumber] = dayBaseTime.clone();

      for (const message of messages) {
        let scheduledTime;

        if (message.useScheduledTime && message.scheduledTime) {
          const [hours, minutes] = message.scheduledTime.split(":").map(Number);
          scheduledTime = dayBaseTime.clone().hour(hours).minute(minutes).second(0);

          console.log(`Scheduling message for day ${dayNumber} at specific time:`, {
            messageTime: message.scheduledTime,
            calculatedTime: scheduledTime.format("YYYY-MM-DD HH:mm:ss"),
            dayNumber: message.dayNumber,
          });

          if (scheduledTime.isBefore(moment())) {
            scheduledTime.add(1, "day");
            console.log("Time has passed, pushed to:", scheduledTime.format("YYYY-MM-DD HH:mm:ss"));
          }
        } else {
          if (message === messages[0]) {
            if (dayNumber === "1" && message === messages[0] && message.delayAfter) {
              scheduledTime = dayBaseTime.clone();
              
              if (message.delayAfter.isInstantaneous) {
                scheduledTime.add(DELAY_BETWEEN_MESSAGES, "milliseconds");
              } else {
                scheduledTime.add(message.delayAfter.value, message.delayAfter.unit);
              }
              
              console.log(`First message of template with delay:`, {
                delay: `${message.delayAfter.value} ${message.delayAfter.unit}`,
                scheduledTime: scheduledTime.format("YYYY-MM-DD HH:mm:ss")
              });
            } else {
              scheduledTime = dayBaseTime.clone();
            }
          } else {
            if (message.delayAfter?.isInstantaneous) {
              scheduledTime = lastMessageTimeByDay[dayNumber].clone().add(DELAY_BETWEEN_MESSAGES, "milliseconds");
            } else if (message.delayAfter) {
              scheduledTime = lastMessageTimeByDay[dayNumber]
                .clone()
                .add(message.delayAfter.value, message.delayAfter.unit)
                .add(DELAY_BETWEEN_MESSAGES, "milliseconds");
            } else {
              scheduledTime = lastMessageTimeByDay[dayNumber]
                .clone()
                .add(5, "minutes")
                .add(DELAY_BETWEEN_MESSAGES, "milliseconds");
            }
          }
        }

        console.log(`Final scheduled time for message:`, {
          id: message.id,
          dayNumber: message.dayNumber,
          sequence: message.sequence,
          scheduledTime: scheduledTime.format("YYYY-MM-DD HH:mm:ss"),
          useScheduledTime: message.useScheduledTime,
          specificTime: message.scheduledTime,
          delayAfter: message.delayAfter ? 
            `${message.delayAfter.value} ${message.delayAfter.unit} (isInstantaneous: ${!!message.delayAfter.isInstantaneous})` : 
            'none'
        });

        let recipientIds = [chatId];

        if (message.specificNumbers?.enabled && message.specificNumbers.numbers?.length > 0) {
          console.log("Message has specific numbers:", message.specificNumbers.numbers);
          recipientIds = message.specificNumbers.numbers.map((number) => {
            return number.includes("@c.us") ? number : `${number}@c.us`;
          });
        }

        for (let i = 0; i < recipientIds.length; i++) {
          const recipientId = recipientIds[i];
          const recipientDelay = i * DELAY_BETWEEN_MESSAGES;
          const recipientScheduledTime = scheduledTime.clone().add(recipientDelay, "milliseconds");

          if (message.image) {
            await scheduleImageMessage(
              message.image,
              message.message || "",
              recipientScheduledTime.toDate(),
              recipientId,
              idSubstring,
              template.name,
              phoneIndex
            );
          } else if (message.document) {
            continue;
          } else {
            let finalMessage = message.message;
            if (customerName && !/\d/.test(customerName)) {
              finalMessage = finalMessage.replace("{customerName}", customerName);
            } else {
              finalMessage = finalMessage.replace("{customerName}", "");
            }
            await scheduleReminderMessage(
              finalMessage,
              recipientScheduledTime.toDate(),
              recipientId,
              idSubstring,
              template.name,
              phoneIndex
            );
          }
        }

        lastMessageTimeByDay[dayNumber] = scheduledTime;
        await customWait(1000);
      }
    }

    console.log("Template scheduling completed successfully");
  } catch (error) {
    console.error("Error scheduling template messages:", error);
    throw error;
  }
}

async function handleTagFollowUp(req, res) {
  console.log("TAGFOLLOWUP webhook");
  console.log(req.body);
  const idSubstring = req.body.idSubstring;

  await fetchConfigFromDatabase(idSubstring);
  const { requestType, phone, first_name, phoneIndex: requestedPhoneIndex, templateId } = req.body;
  const phoneIndex = requestedPhoneIndex !== undefined ? parseInt(requestedPhoneIndex) : 0;

  if (!phone || !first_name) {
    return res.status(400).json({ error: "Phone number and name are required" });
  }

  if (!templateId) {
    return res.status(400).json({ error: "Template ID is required" });
  }

  let phoneWithPlus = phone.replace(/\s+|-/g, "");
  if (!phoneWithPlus.startsWith("+")) {
    phoneWithPlus = "+" + phoneWithPlus;
  }
  const phoneWithoutPlus = phoneWithPlus.replace("+", "");
  const chatId = `${phoneWithoutPlus}@c.us`;

  try {
    const templateRef = db.collection("companies").doc(idSubstring).collection("followUpTemplates").doc(templateId);
    const templateDoc = await templateRef.get();

    if (!templateDoc.exists) {
      return res.status(404).json({ error: "Template not found" });
    }

    const template = {
      ...templateDoc.data(),
      id: templateId,
    };

    switch (requestType) {
      case "startTemplate":
        await scheduleFollowUpFromTemplate(chatId, idSubstring, first_name, template, phoneIndex);
        break;
      case "pauseTemplate":
        await pauseFollowUpMessages(chatId, idSubstring, template);
        break;
      case "resumeTemplate":
        await resumeFollowUpMessages(chatId, idSubstring, template);
        break;
      case "removeTemplate":
        await removeScheduledMessages(chatId, idSubstring, template);
        break;
      default:
        return res.status(400).json({
          error: "Invalid request type. Must be one of: startTemplate, pauseTemplate, resumeTemplate, removeTemplate",
        });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      phone: phoneWithPlus,
      first_name,
      success: false,
      error: error.message,
    });
  }
}

async function pauseFollowUpMessages(chatId, idSubstring, template) {
  try {
    console.log(`Pausing template messages for chat ${chatId}`);

    const scheduledMessagesRef = db.collection("companies").doc(idSubstring).collection("scheduledMessages");

    // First, pause messages for the main chatId
    const snapshot = await scheduledMessagesRef
      .where("chatIds", "array-contains", chatId)
      .where("status", "!=", "completed")
      .where("type", "==", template.name)
      .get();

    if (snapshot.empty) {
      console.log("No scheduled messages found to pause.");
      return;
    }

    for (const doc of snapshot.docs) {
      await pauseMessage(doc, idSubstring, chatId);
    }

    console.log(`Paused ${snapshot.size} scheduled messages for chat ${chatId}`);

    // Then, fetch messages from template to check for specific numbers
    const messagesSnapshot = await db
      .collection("companies")
      .doc(idSubstring)
      .collection("followUpTemplates")
      .doc(template.id)
      .collection("messages")
      .where("status", "==", "active")
      .where("specificNumbers.enabled", "==", true)
      .get();

    // Process each message with specific numbers
    for (const messageDoc of messagesSnapshot.docs) {
      const message = messageDoc.data();
      if (message.specificNumbers?.numbers?.length > 0) {
        // For each specific number, pause their messages
        for (const specificNumber of message.specificNumbers.numbers) {
          const specificChatId = `${specificNumber}@c.us`;
          const specificSnapshot = await scheduledMessagesRef
            .where("chatIds", "array-contains", specificChatId)
            .where("status", "!=", "completed")
            .where("type", "==", template.name)
            .get();

          for (const doc of specificSnapshot.docs) {
            await pauseMessage(doc, idSubstring, specificNumber);
          }

          console.log(`Paused ${specificSnapshot.size} messages for specific number: ${specificNumber}`);
        }
      }
    }
  } catch (error) {
    console.error("Error pausing template messages:", error);
    throw error;
  }
}

async function pauseMessage(doc, idSubstring, chatId) {
  const messageId = doc.id;
  const messageData = doc.data();

  // Prepare the updated message data
  const updatedMessage = {
    ...messageData,
    status: "paused",
  };

  // Ensure scheduledTime is properly formatted
  if (updatedMessage.scheduledTime && typeof updatedMessage.scheduledTime === "object") {
    updatedMessage.scheduledTime = {
      seconds: Math.floor(updatedMessage.scheduledTime.seconds),
      nanoseconds: updatedMessage.scheduledTime.nanoseconds || 0,
    };
  } else {
    // If scheduledTime is missing or invalid, use the current time
    updatedMessage.scheduledTime = {
      seconds: Math.floor(Date.now() / 1000),
      nanoseconds: 0,
    };
  }

  // Call the API to update the message
  try {
    await axios.put(`http://localhost:8443/api/schedule-message/${idSubstring}/${messageId}`, updatedMessage);
    console.log(`Paused scheduled message ${messageId} for chatId: ${chatId}`);
  } catch (error) {
    console.error(
      `Error pausing scheduled message ${messageId}:`,
      error.response ? error.response.data : error.message
    );
  }
}

async function resumeFollowUpMessages(chatId, idSubstring, template) {
  try {
    console.log(`Resuming template messages for chat ${chatId}`);

    const scheduledMessagesRef = db.collection("companies").doc(idSubstring).collection("scheduledMessages");

    // First, handle main chatId messages
    const snapshot = await scheduledMessagesRef
      .where("chatIds", "array-contains", chatId)
      .where("status", "==", "paused")
      .where("type", "==", template.name)
      .orderBy("scheduledTime", "asc")
      .get();

    if (!snapshot.empty) {
      await resumeMessagesGroup(snapshot.docs, idSubstring, chatId);
      console.log(`Resumed ${snapshot.size} messages for main chat ${chatId}`);
    } else {
      console.log("No paused messages found for main chat.");
    }

    // Then, handle specific numbers from template messages
    const messagesSnapshot = await db
      .collection("companies")
      .doc(idSubstring)
      .collection("followUpTemplates")
      .doc(template.id)
      .collection("messages")
      .where("status", "==", "active")
      .where("specificNumbers.enabled", "==", true)
      .get();

    // Process each message with specific numbers
    for (const messageDoc of messagesSnapshot.docs) {
      const message = messageDoc.data();
      if (message.specificNumbers?.numbers?.length > 0) {
        // For each specific number, resume their messages
        for (const specificNumber of message.specificNumbers.numbers) {
          const specificChatId = `${specificNumber}@c.us`;

          const specificSnapshot = await scheduledMessagesRef
            .where("chatIds", "array-contains", specificChatId)
            .where("status", "==", "paused")
            .where("type", "==", template.name)
            .orderBy("scheduledTime", "asc")
            .get();

          if (!specificSnapshot.empty) {
            await resumeMessagesGroup(specificSnapshot.docs, idSubstring, specificNumber);
            console.log(`Resumed ${specificSnapshot.size} messages for specific number: ${specificNumber}`);
          }
        }
      }
    }
  } catch (error) {
    console.error("Error resuming template messages:", error);
    throw error;
  }
}

// Helper function to resume a group of messages
async function resumeMessagesGroup(docs, idSubstring, chatId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Set to start of day

  const messages = docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const firstScheduledTime = messages[0].scheduledTime.toDate();
  const timeDifference = today.getTime() - firstScheduledTime.getTime();

  for (const message of messages) {
    const originalTime = message.scheduledTime.toDate();
    const newScheduledTime = new Date(originalTime.getTime() + timeDifference);

    const updatedMessage = {
      ...message,
      messages: message.chatIds.map((chatId) => ({
        chatId,
        message: message.message,
      })),
      scheduledTime: {
        seconds: Math.floor(newScheduledTime.getTime() / 1000),
        nanoseconds: (newScheduledTime.getTime() % 1000) * 1e6,
      },
      status: "scheduled",
    };

    try {
      await axios.put(`http://localhost:8443/api/schedule-message/${idSubstring}/${message.id}`, updatedMessage);
      console.log(`Resumed and rescheduled message ${message.id} for chatId: ${chatId}`);
    } catch (error) {
      console.error(
        `Error resuming and rescheduling message ${message.id}:`,
        error.response ? error.response.data : error.message
      );
    }
  }
}

async function customWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function scheduleImageMessage(imageUrl, caption, scheduledTime, chatId, idSubstring, type, phoneIndex) {
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
    type: type,
    messages: [
      {
        chatId: chatId,
        message: caption,
      },
    ],
    mimeType: "image/jpeg",
    repeatInterval: 0,
    repeatUnit: "days",
    scheduledTime: {
      seconds: scheduledTimeSeconds,
      nanoseconds: 0,
    },
    status: "scheduled",
    v2: true,
    whapiToken: null,
    phoneIndex: phoneIndex,
  };

  try {
    const response = await axios.post(`http://localhost:8443/api/schedule-message/${idSubstring}`, scheduledMessage);
    console.log("Image message scheduled successfully:", response.data);
  } catch (error) {
    console.error("Error scheduling image message:", error.response ? error.response.data : error.message);
  }
}

async function scheduleReminderMessage(eventSummary, startDateTime, chatId, idSubstring, type, phoneIndex) {
  const scheduledTimeSeconds = Math.floor(startDateTime.getTime() / 1000);

  console.log("Scheduling reminder for:", moment(startDateTime).format());
  console.log("Scheduled time in seconds:", scheduledTimeSeconds);

  const scheduledMessage = {
    activateSleep: false,
    activeHours: { start: "09:00", end: "17:00" },
    batchQuantity: 1,
    chatIds: [chatId],
    companyId: idSubstring,
    createdAt: admin.firestore.Timestamp.now(),
    documentUrl: "",
    fileName: "",
    infiniteLoop: false,
    maxDelay: 2,
    mediaUrl: "",
    message: eventSummary,
    messageDelays: [],
    messages: [],
    mimeType: "",
    minDelay: 1,
    numberOfBatches: 1,
    phoneIndex: phoneIndex,
    repeatInterval: 0,
    repeatUnit: "days",
    scheduledTime: {
      seconds: scheduledTimeSeconds,
      nanoseconds: 0,
    },
    sleepAfterMessages: null,
    sleepDuration: null,
    status: "scheduled",
    v2: true,
    whapiToken: null,
  };

  try {
    console.log("Sending schedule request:", JSON.stringify(scheduledMessage));
    const response = await axios.post(`http://localhost:8443/api/schedule-message/${idSubstring}`, scheduledMessage);
    console.log("Reminder scheduled successfully:", response.data);
  } catch (error) {
    console.error("Error scheduling reminder:", error.response ? error.response.data : error.message);
    if (error.response && error.response.data) {
      console.error("Server response:", error.response.data);
    }
  }
}

async function removeScheduledMessages(chatId, idSubstring, template) {
  try {
    console.log(`Removing template messages for chat ${chatId}`);
    const scheduledMessagesRef = db.collection("companies").doc(idSubstring).collection("scheduledMessages");

    // First, remove messages for main chatId
    const snapshot = await scheduledMessagesRef
      .where("chatIds", "array-contains", chatId)
      .where("v2", "==", true)
      .get();

    console.log(`Found ${snapshot.size} messages to delete for ${chatId}`);

    // Log the found messages for debugging
    snapshot.docs.forEach((doc) => {
      console.log("Message to delete:", {
        id: doc.id,
        chatIds: doc.data().chatIds,
        status: doc.data().status,
        type: doc.data().type,
      });
    });

    await removeMessagesGroup(snapshot.docs, idSubstring, chatId);
    console.log(`Deleted ${snapshot.size} messages for main chat ${chatId}`);

    // Also check for messages where chatId is a single string instead of array
    const singleChatSnapshot = await scheduledMessagesRef.where("chatId", "==", chatId).where("v2", "==", true).get();

    if (!singleChatSnapshot.empty) {
      console.log(`Found ${singleChatSnapshot.size} additional messages with single chatId`);
      await removeMessagesGroup(singleChatSnapshot.docs, idSubstring, chatId);
    }

    // Then, handle specific numbers from template messages if they exist
    if (template.messages) {
      for (const message of template.messages) {
        if (message.specificNumbers?.enabled && message.specificNumbers.numbers?.length > 0) {
          console.log("Processing specific numbers:", message.specificNumbers.numbers);
          for (const number of message.specificNumbers.numbers) {
            const specificChatId = number.includes("@c.us") ? number : `${number}@c.us`;
            const specificSnapshot = await scheduledMessagesRef
              .where("chatIds", "array-contains", specificChatId)
              .where("v2", "==", true)
              .get();

            if (!specificSnapshot.empty) {
              await removeMessagesGroup(specificSnapshot.docs, idSubstring, specificChatId);
              console.log(`Deleted ${specificSnapshot.size} messages for specific number: ${specificChatId}`);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error("Error removing template messages:", error);
    throw error;
  }
}

// Helper function to remove a group of messages
async function removeMessagesGroup(docs, idSubstring, chatId) {
  for (const doc of docs) {
    const messageId = doc.id;

    try {
      // Add retry logic
      let retries = 3;
      while (retries > 0) {
        try {
          const response = await axios.delete(`http://localhost:8443/api/schedule-message/${idSubstring}/${messageId}`);
          console.log(`Successfully deleted message ${messageId} for ${chatId}:`, response.data);
          break;
        } catch (error) {
          retries--;
          if (retries === 0) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    } catch (error) {
      console.error(
        `Failed to delete message ${messageId} for ${chatId}:`,
        error.response ? error.response.data : error.message
      );
      // Continue with other messages even if one fails
    }
  }
}

module.exports = { handleTagFollowUp };