const fetch = require("node-fetch");
const moment = require("moment-timezone");
const path = require('path');
require("dotenv").config({ path: path.resolve(__dirname, '../.env') });
const axios = require("axios");
const { Pool } = require('pg');

const pool = new Pool({
  // Connection pooling
  connectionString: process.env.DATABASE_URL,
  max: 2000,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

async function handleTagFollowUp(req, res) {
  const idSubstring = req.body.idSubstring;
  const { requestType, phone, first_name, phoneIndex: requestedPhoneIndex, templateId } = req.body;
  const phoneIndex = requestedPhoneIndex !== undefined ? parseInt(requestedPhoneIndex) : 0;
  console.log(`Tagfollowup webhook triggered for ${idSubstring} with phone ${phone} and name ${first_name} at index ${phoneIndex} and template ID ${templateId}...`);

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
    // Get template from PostgreSQL
    const templateQuery = `
      SELECT * FROM followup_templates 
      WHERE template_id = $1 AND company_id = $2
    `;
    const templateResult = await pool.query(templateQuery, [templateId, idSubstring]);

    if (templateResult.rows.length === 0) {
      return res.status(404).json({ error: "Template not found" });
    }

    const template = templateResult.rows[0];

    // Get template messages from PostgreSQL
    const messagesQuery = `
      SELECT * FROM followup_messages 
      WHERE template_id = $1 AND status = 'active'
      ORDER BY day_number, sequence
    `;
    const messagesResult = await pool.query(messagesQuery, [templateId]);
    template.messages = messagesResult.rows;

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

async function scheduleFollowUpFromTemplate(chatId, idSubstring, customerName, template, phoneIndex) {
  try {
    if (!template || !template.template_id) {
      throw new Error("Invalid template: template.template_id is required");
    }

    console.log("Starting template scheduling with:", {
      templateId: template.template_id,
      templateName: template.name,
      createdAt: template.created_at,
      delayHours: template.delay_hours
    });

    let baseScheduledTime;
    if (template.is_custom_start_time) {
      baseScheduledTime = moment(template.start_time);
    } else {
      const createdAt = moment(template.created_at);
      const initialDelay = template.delay_hours || 24;
      baseScheduledTime = moment().add(initialDelay, "hours");
    }

    console.log("Initial base scheduled time:", baseScheduledTime.format());

    const lastMessageTimeByDay = {};
    const messagesByDay = {};

    // Group messages by day
    template.messages.forEach(message => {
      if (typeof message.day_number !== "number") {
        console.warn(`Message ${message.id} has invalid dayNumber:`, message.day_number);
        return;
      }
      const dayNumber = message.day_number.toString();
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
        if (message.use_scheduled_time && message.scheduled_time) {
          const [hours, minutes] = message.scheduled_time.split(":").map(Number);
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

        if (message.use_scheduled_time && message.scheduled_time) {
          const [hours, minutes] = message.scheduled_time.split(":").map(Number);
          scheduledTime = dayBaseTime.clone().hour(hours).minute(minutes).second(0);

          console.log(`Scheduling message for day ${dayNumber} at specific time:`, {
            messageTime: message.scheduled_time,
            calculatedTime: scheduledTime.format("YYYY-MM-DD HH:mm:ss"),
            dayNumber: message.day_number,
          });

          if (scheduledTime.isBefore(moment())) {
            scheduledTime.add(1, "day");
            console.log("Time has passed, pushed to:", scheduledTime.format("YYYY-MM-DD HH:mm:ss"));
          }
        } else {
          if (message === messages[0]) {
            if (dayNumber === "1" && message === messages[0] && message.delay_after) {
              scheduledTime = dayBaseTime.clone();
              
              if (message.delay_after.isInstantaneous) {
                scheduledTime.add(DELAY_BETWEEN_MESSAGES, "milliseconds");
              } else {
                scheduledTime.add(message.delay_after.value, message.delay_after.unit);
              }
              
              console.log(`First message of template with delay:`, {
                delay: `${message.delay_after.value} ${message.delay_after.unit}`,
                scheduledTime: scheduledTime.format("YYYY-MM-DD HH:mm:ss")
              });
            } else {
              scheduledTime = dayBaseTime.clone();
            }
          } else {
            if (message.delay_after?.isInstantaneous) {
              scheduledTime = lastMessageTimeByDay[dayNumber].clone().add(DELAY_BETWEEN_MESSAGES, "milliseconds");
            } else if (message.delay_after) {
              scheduledTime = lastMessageTimeByDay[dayNumber]
                .clone()
                .add(message.delay_after.value, message.delay_after.unit)
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
          dayNumber: message.day_number,
          sequence: message.sequence,
          scheduledTime: scheduledTime.format("YYYY-MM-DD HH:mm:ss"),
          use_scheduled_time: message.use_scheduled_time,
          specificTime: message.scheduled_time,
          delay_after: message.delay_after ? 
            `${message.delay_after.value} ${message.delay_after.unit} (isInstantaneous: ${!!message.delay_after.isInstantaneous})` : 
            'none'
        });

        let recipientIds = [chatId];

        if (message.specific_numbers?.enabled && message.specific_numbers.numbers?.length > 0) {
          console.log("Message has specific numbers:", message.specific_numbers.numbers);
          recipientIds = message.specific_numbers.numbers.map((number) => {
            return number.includes("@c.us") ? number : `${number}@c.us`;
          });
        }

        for (let i = 0; i < recipientIds.length; i++) {
          const recipientId = recipientIds[i];
          const recipientDelay = i * DELAY_BETWEEN_MESSAGES;
          const recipientScheduledTime = scheduledTime.clone().add(recipientDelay, "milliseconds");

          if (message.image) {
            await scheduleImageMessage(
              message.image.url,
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

async function pauseFollowUpMessages(chatId, idSubstring, template) {
  try {
    console.log(`Pausing template messages for chat ${chatId}`);

    // First, pause messages for the main chatId
    const snapshot = await pool.query(`
      SELECT id FROM scheduled_messages 
      WHERE chat_ids @> $1 
        AND status != 'completed' 
        AND type = $2 
        AND company_id = $3
    `, [[chatId], template.name, idSubstring]);

    if (snapshot.rows.length === 0) {
      console.log("No scheduled messages found to pause.");
      return;
    }

    for (const row of snapshot.rows) {
      await pauseMessage(row.id, idSubstring, chatId);
    }

    console.log(`Paused ${snapshot.rows.length} scheduled messages for chat ${chatId}`);

    // Then, check for specific numbers in template messages
    for (const message of template.messages) {
      if (message.specific_numbers?.enabled && message.specific_numbers.numbers?.length > 0) {
        for (const specificNumber of message.specific_numbers.numbers) {
          const specificChatId = `${specificNumber}@c.us`;
          const specificSnapshot = await pool.query(`
            SELECT id FROM scheduled_messages 
            WHERE chat_ids @> $1 
              AND status != 'completed' 
              AND type = $2 
              AND company_id = $3
          `, [[specificChatId], template.name, idSubstring]);

          for (const row of specificSnapshot.rows) {
            await pauseMessage(row.id, idSubstring, specificNumber);
          }

          console.log(`Paused ${specificSnapshot.rows.length} messages for specific number: ${specificNumber}`);
        }
      }
    }
  } catch (error) {
    console.error("Error pausing template messages:", error);
    throw error;
  }
}

async function pauseMessage(messageId, idSubstring, chatId) {
  try {
    const response = await axios.put(
      `http://localhost:8443/api/schedule-message/${idSubstring}/${messageId}`,
      {
        status: "paused",
        scheduledTime: {
          seconds: Math.floor(Date.now() / 1000),
          nanoseconds: 0,
        }
      }
    );
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

    // First, handle main chatId messages
    const snapshot = await pool.query(`
      SELECT id, scheduled_time FROM scheduled_messages 
      WHERE chat_ids @> $1 
        AND status = 'paused' 
        AND type = $2 
        AND company_id = $3
      ORDER BY scheduled_time ASC
    `, [[chatId], template.name, idSubstring]);

    if (snapshot.rows.length > 0) {
      await resumeMessagesGroup(snapshot.rows, idSubstring, chatId);
      console.log(`Resumed ${snapshot.rows.length} messages for main chat ${chatId}`);
    } else {
      console.log("No paused messages found for main chat.");
    }

    // Then, handle specific numbers from template messages
    for (const message of template.messages) {
      if (message.specific_numbers?.enabled && message.specific_numbers.numbers?.length > 0) {
        for (const specificNumber of message.specific_numbers.numbers) {
          const specificChatId = `${specificNumber}@c.us`;
          const specificSnapshot = await pool.query(`
            SELECT id, scheduled_time FROM scheduled_messages 
            WHERE chat_ids @> $1 
              AND status = 'paused' 
              AND type = $2 
              AND company_id = $3
            ORDER BY scheduled_time ASC
          `, [[specificChatId], template.name, idSubstring]);

          if (specificSnapshot.rows.length > 0) {
            await resumeMessagesGroup(specificSnapshot.rows, idSubstring, specificNumber);
            console.log(`Resumed ${specificSnapshot.rows.length} messages for specific number: ${specificNumber}`);
          }
        }
      }
    }
  } catch (error) {
    console.error("Error resuming template messages:", error);
    throw error;
  }
}

async function resumeMessagesGroup(rows, idSubstring, chatId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const firstScheduledTime = new Date(rows[0].scheduled_time);
  const timeDifference = today.getTime() - firstScheduledTime.getTime();

  for (const row of rows) {
    const originalTime = new Date(row.scheduled_time);
    const newScheduledTime = new Date(originalTime.getTime() + timeDifference);

    try {
      await axios.put(
        `http://localhost:8443/api/schedule-message/${idSubstring}/${row.id}`,
        {
          scheduledTime: {
            seconds: Math.floor(newScheduledTime.getTime() / 1000),
            nanoseconds: (newScheduledTime.getTime() % 1000) * 1e6,
          },
          status: "scheduled"
        }
      );
      console.log(`Resumed and rescheduled message ${row.id} for chatId: ${chatId}`);
    } catch (error) {
      console.error(
        `Error resuming and rescheduling message ${row.id}:`,
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
    createdAt: new Date(),
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
    createdAt: new Date(),
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
    
    // First, remove messages for main chatId
    const snapshot = await pool.query(`
      SELECT id FROM scheduled_messages 
      WHERE chat_ids @> $1 
        AND v2 = true 
        AND company_id = $2
    `, [[chatId], idSubstring]);

    console.log(`Found ${snapshot.rows.length} messages to delete for ${chatId}`);

    await removeMessagesGroup(snapshot.rows, idSubstring, chatId);
    console.log(`Deleted ${snapshot.rows.length} messages for main chat ${chatId}`);

    // Also check for messages where chatId is a single string
    const singleChatSnapshot = await pool.query(`
      SELECT id FROM scheduled_messages 
      WHERE chat_id = $1 
        AND v2 = true 
        AND company_id = $2
    `, [chatId, idSubstring]);

    if (singleChatSnapshot.rows.length > 0) {
      console.log(`Found ${singleChatSnapshot.rows.length} additional messages with single chatId`);
      await removeMessagesGroup(singleChatSnapshot.rows, idSubstring, chatId);
    }

    // Then, handle specific numbers from template messages
    for (const message of template.messages) {
      if (message.specific_numbers?.enabled && message.specific_numbers.numbers?.length > 0) {
        console.log("Processing specific numbers:", message.specific_numbers.numbers);
        for (const number of message.specific_numbers.numbers) {
          const specificChatId = number.includes("@c.us") ? number : `${number}@c.us`;
          const specificSnapshot = await pool.query(`
            SELECT id FROM scheduled_messages 
            WHERE chat_ids @> $1 
              AND v2 = true 
              AND company_id = $2
          `, [[specificChatId], idSubstring]);

          if (specificSnapshot.rows.length > 0) {
            await removeMessagesGroup(specificSnapshot.rows, idSubstring, specificChatId);
            console.log(`Deleted ${specificSnapshot.rows.length} messages for specific number: ${specificChatId}`);
          }
        }
      }
    }
  } catch (error) {
    console.error("Error removing template messages:", error);
    throw error;
  }
}

async function removeMessagesGroup(rows, idSubstring, chatId) {
  for (const row of rows) {
    const messageId = row.id;
    let retries = 3;
    
    while (retries > 0) {
      try {
        const response = await axios.delete(`http://localhost:8443/api/schedule-message/${idSubstring}/${messageId}`);
        console.log(`Successfully deleted message ${messageId} for ${chatId}:`, response.data);
        break;
      } catch (error) {
        retries--;
        if (retries === 0) {
          console.error(
            `Failed to delete message ${messageId} for ${chatId}:`,
            error.response ? error.response.data : error.message
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
}

module.exports = { handleTagFollowUp };