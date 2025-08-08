const fetch = require("node-fetch");
const moment = require("moment-timezone");
const path = require('path');
require("dotenv").config({ path: path.resolve(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  // Connection pooling
  connectionString: process.env.DATABASE_URL,
  max: 2000,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

const API_BASE_URL = process.env.URL || 'http://localhost:8443';

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
  const contactId = idSubstring + "-" + phoneWithoutPlus;

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

    // Get template messages from PostgreSQL and sort properly
    const messagesQuery = `
      SELECT * FROM followup_messages 
      WHERE template_id = $1 AND status = 'active'
      ORDER BY day_number ASC, sequence ASC
    `;
    const messagesResult = await pool.query(messagesQuery, [templateId]);
    template.messages = messagesResult.rows;

    switch (requestType) {
      case "startTemplate":
        await scheduleFollowUpFromTemplate(chatId, idSubstring, first_name, template, phoneIndex, contactId);
        break;
      case "removeTemplate":
        await removeScheduledMessages(chatId, idSubstring, template, contactId);
        break;
      default:
        return res.status(400).json({
          error: "Invalid request type. Must be one of: startTemplate, removeTemplate",
        });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error in handleTagFollowUp:", error);
    res.status(500).json({
      phone: phoneWithPlus,
      first_name,
      success: false,
      error: error.message,
    });
  }
}

async function scheduleFollowUpFromTemplate(chatId, idSubstring, customerName, template, phoneIndex, contactId) {
  try {
    if (!template || !template.template_id) {
      throw new Error("Invalid template: template.template_id is required");
    }

    console.log("Starting template scheduling with:", {
      templateId: template.template_id,
      templateName: template.name,
      contactId: contactId
    });

    // First, remove any existing scheduled messages from other templates for this contact
    await removeExistingScheduledMessages(idSubstring, contactId);

    // Start scheduling from current time
    let currentScheduleTime = moment();
    
    // Sort messages by day_number first, then by sequence
    const sortedMessages = template.messages.sort((a, b) => {
      if (a.day_number !== b.day_number) {
        return a.day_number - b.day_number;
      }
      return a.sequence - b.sequence;
    });

    console.log(`Processing ${sortedMessages.length} messages for template ${template.name}`);

    for (let i = 0; i < sortedMessages.length; i++) {
      const message = sortedMessages[i];
      let scheduledTime;

      // Check if this message uses scheduled time
      if (message.use_scheduled_time && message.scheduled_time) {
        // Use the specific scheduled time
        const [hours, minutes] = message.scheduled_time.split(":").map(Number);
        scheduledTime = moment().hour(hours).minute(minutes).second(0);
        
        // If the time has passed today, schedule for tomorrow
        if (scheduledTime.isBefore(moment())) {
          scheduledTime.add(1, "day");
        }
        
        // Adjust for the day number
        if (message.day_number > 1) {
          scheduledTime.add(message.day_number - 1, "days");
        }
        
        console.log(`Message ${i + 1} scheduled for specific time: ${scheduledTime.format("YYYY-MM-DD HH:mm:ss")}`);
      } else {
        // Use delay_after logic
        if (i === 0) {
          // First message - schedule based on delay_after or immediately
          if (message.delay_after) {
            const delay = typeof message.delay_after === 'string' ? JSON.parse(message.delay_after) : message.delay_after;
            if (delay.isInstantaneous) {
              scheduledTime = moment().add(1, "minute"); // Small delay for instantaneous
            } else {
              scheduledTime = moment().add(delay.value, delay.unit);
            }
          } else {
            scheduledTime = moment().add(1, "minute"); // Default 1 minute delay
          }
        } else {
          // Subsequent messages - schedule based on previous message + delay_after
          if (message.delay_after) {
            const delay = typeof message.delay_after === 'string' ? JSON.parse(message.delay_after) : message.delay_after;
            if (delay.isInstantaneous) {
              scheduledTime = currentScheduleTime.clone().add(1, "minute"); // Small delay for instantaneous
            } else {
              scheduledTime = currentScheduleTime.clone().add(delay.value, delay.unit);
            }
          } else {
            scheduledTime = currentScheduleTime.clone().add(5, "minutes"); // Default 5 minutes
          }
        }
        
        console.log(`Message ${i + 1} scheduled with delay: ${scheduledTime.format("YYYY-MM-DD HH:mm:ss")}`);
      }

      // Schedule the actual message
      await scheduleMessage(message, scheduledTime, chatId, idSubstring, template.name, phoneIndex, customerName, template.template_id);
      
      // Update current schedule time for next message
      currentScheduleTime = scheduledTime.clone();
      
      // Small delay between API calls
      await customWait(500);
    }

    console.log("Template scheduling completed successfully");
  } catch (error) {
    console.error("Error scheduling template messages:", error);
    throw error;
  }
}

async function removeExistingScheduledMessages(companyId, contactId) {
  try {
    // Get all active templates for this company to check for existing scheduled messages
    const templatesResult = await pool.query(
      `SELECT template_id FROM followup_templates WHERE company_id = $1 AND status = 'active'`,
      [companyId]
    );

    // Remove scheduled messages for each template
    for (const template of templatesResult.rows) {
      const response = await fetch(`${API_BASE_URL}/api/schedule-message/${companyId}/template/${template.template_id}/contact/${contactId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        console.log(`Removed existing scheduled messages for template ${template.template_id} and contact ${contactId}`);
      } else {
        console.log(`No existing messages found for template ${template.template_id} and contact ${contactId}`);
      }
    }
  } catch (error) {
    console.error("Error removing existing scheduled messages:", error);
    // Don't throw error here as this is cleanup - continue with scheduling
  }
}

async function addTagsToContact(companyId, contactId, tags) {
  try {
    for (const tag of tags) {
      const response = await fetch(`${API_BASE_URL}/api/contacts/${companyId}/${contactId}/tags`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ tags: [tag] })
      });

      if (response.ok) {
        console.log(`Added tag "${tag}" to contact ${contactId}`);
      } else {
        console.error(`Failed to add tag "${tag}" to contact ${contactId}:`, response.statusText);
      }
    }
  } catch (error) {
    console.error("Error adding tags to contact:", error);
  }
}

async function removeTagsFromContact(companyId, contactId, tags) {
  try {
    for (const tag of tags) {
      const response = await fetch(`${API_BASE_URL}/api/contacts/${companyId}/${contactId}/tags`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ tags: [tag] })
      });

      if (response.ok) {
        console.log(`Removed tag "${tag}" from contact ${contactId}`);
      } else {
        console.error(`Failed to remove tag "${tag}" from contact ${contactId}:`, response.statusText);
      }
    }
  } catch (error) {
    console.error("Error removing tags from contact:", error);
  }
}

async function scheduleMessage(message, scheduledTime, chatId, idSubstring, templateName, phoneIndex, customerName, templateId) {
  try {
    let messageContent = message.message || "";
    
    // Replace customer name placeholder
    if (customerName && !/\d/.test(customerName)) {
      messageContent = messageContent.replace(/\{customerName\}/g, customerName);
    } else {
      messageContent = messageContent.replace(/\{customerName\}/g, "");
    }

    // Process tags for this message
    const contactId = chatId.replace("@c.us", "");
    const fullContactId = idSubstring + "-" + contactId;
    
    // Schedule tag operations along with the message
    if (message.add_tags && message.add_tags.length > 0) {
      // Schedule tag addition slightly before the message
      setTimeout(async () => {
        await addTagsToContact(idSubstring, fullContactId, message.add_tags);
      }, Math.max(0, scheduledTime.toDate().getTime() - Date.now() - 5000)); // 5 seconds before message
    }
    
    if (message.remove_tags && message.remove_tags.length > 0) {
      // Schedule tag removal slightly before the message
      setTimeout(async () => {
        await removeTagsFromContact(idSubstring, fullContactId, message.remove_tags);
      }, Math.max(0, scheduledTime.toDate().getTime() - Date.now() - 5000)); // 5 seconds before message
    }

    // Handle different message types
    if (message.image && message.image.url) {
      await scheduleMediaMessage(scheduledTime.toDate(), chatId, idSubstring, templateName, phoneIndex, {
        type: 'image',
        url: message.image.url,
        caption: messageContent,
        customerName: customerName
      }, templateId);
    } else if (message.document && message.document.url) {
      await scheduleMediaMessage(scheduledTime.toDate(), chatId, idSubstring, templateName, phoneIndex, {
        type: 'document',
        url: message.document.url,
        fileName: message.document.fileName || 'Document',
        caption: messageContent,
        customerName: customerName
      }, templateId);
    } else if (message.video && message.video.url) {
      await scheduleMediaMessage(scheduledTime.toDate(), chatId, idSubstring, templateName, phoneIndex, {
        type: 'video',
        url: message.video.url,
        caption: messageContent,
        customerName: customerName
      }, templateId);
    } else {
      // Text message
      await scheduleTextMessage(messageContent, scheduledTime.toDate(), chatId, idSubstring, templateName, phoneIndex, templateId);
    }

    console.log(`Scheduled message for ${scheduledTime.format("YYYY-MM-DD HH:mm:ss")}`);
  } catch (error) {
    console.error("Error scheduling individual message:", error);
    throw error;
  }
}

async function customWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function scheduleMediaMessage(scheduledTime, chatId, idSubstring, templateName, phoneIndex, mediaData, templateId) {
  let finalCaption = mediaData.caption || "";
  if (mediaData.customerName && !/\d/.test(mediaData.customerName)) {
    finalCaption = finalCaption.replace("{customerName}", mediaData.customerName);
  } else {
    finalCaption = finalCaption.replace("{customerName}", "");
  }

  try {
    const contactID = idSubstring + '-' + chatId.split('@')[0];
    const scheduledMessage = {
      chatIds: [chatId],
      companyId: idSubstring,
      message: finalCaption,
      scheduledTime: {
        seconds: Math.floor(scheduledTime.getTime() / 1000),
        nanoseconds: (scheduledTime.getTime() % 1000) * 1e6,
      },
      phoneIndex: phoneIndex || 0,
      v2: true,
      status: "scheduled",
      type: templateName,
      template_id: templateId,
      batchQuantity: 1,
      repeatInterval: 0,
      repeatUnit: "days",
      contact_id: contactID
    };

    // Add media-specific fields
    switch (mediaData.type) {
      case 'image':
      case 'video':
        scheduledMessage.mediaUrl = mediaData.url;
        scheduledMessage.mimeType = mediaData.type === 'image' ? "image/jpeg" : "video/mp4";
        scheduledMessage.caption = finalCaption;
        break;
      case 'document':
        scheduledMessage.documentUrl = mediaData.url;
        scheduledMessage.fileName = mediaData.fileName || 'Document';
        scheduledMessage.mimeType = "application/pdf";
        scheduledMessage.caption = finalCaption;
        break;
    }

    const response = await fetch(`${API_BASE_URL}/api/schedule-message/${idSubstring}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(scheduledMessage)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to schedule ${mediaData.type}: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    console.log(`${mediaData.type} message scheduled successfully for:`, scheduledTime, 'ID:', result.id);
    return result.id;
  } catch (error) {
    console.error(`Error scheduling ${mediaData.type} message:`, error.message);
    throw error;
  }
}

async function scheduleTextMessage(message, scheduledTime, chatId, idSubstring, templateName, phoneIndex, templateId) {
  console.log("Scheduling text message for:", scheduledTime);

  try {
    const contactID = idSubstring + '-' + chatId.split('@')[0];
    const scheduledMessage = {
      chatIds: [chatId],
      companyId: idSubstring,
      message: message,
      scheduledTime: {
        seconds: Math.floor(scheduledTime.getTime() / 1000),
        nanoseconds: (scheduledTime.getTime() % 1000) * 1e6,
      },
      phoneIndex: phoneIndex || 0,
      v2: true,
      status: "scheduled",
      type: templateName,
      template_id: templateId,
      batchQuantity: 1,
      repeatInterval: 0,
      repeatUnit: "days",
      contact_id: contactID
    };

    const response = await fetch(`${API_BASE_URL}/api/schedule-message/${idSubstring}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(scheduledMessage)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to schedule text message: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    console.log("Text message scheduled successfully, ID:", result.id);
    return result.id;
  } catch (error) {
    console.error("Error scheduling text message:", error.message);
    throw error;
  }
}

async function removeScheduledMessages(chatId, idSubstring, template, contactId) {
  try {
    console.log(`Removing template messages for contact ${contactId}`);
    
    // Use the API to remove scheduled messages for this template and contact
    const response = await fetch(`${API_BASE_URL}/api/schedule-message/${idSubstring}/template/${template.template_id}/contact/${contactId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      console.log(`Successfully removed scheduled messages for template ${template.template_id} and contact ${contactId}`);
    } else {
      console.log(`No scheduled messages found or error removing messages for template ${template.template_id} and contact ${contactId}`);
    }
  } catch (error) {
    console.error("Error removing template messages:", error);
    throw error;
  }
}

module.exports = { handleTagFollowUp };