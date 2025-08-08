const {
  createRevotrendMessage,
  createRevotrendNotification,
  formatPhoneNumber,
  retryOperation
} = require('./neon-webhook-utils');

const {
  saveContact,
  saveMessage,
  getContactByPhone
} = require('./neon-contact-operations');

// ======================
// REVOTREND WEBHOOK HANDLER
// ======================

async function handleRevotrendWebhook(req, res, botMap) {
  let retryCount = 0;
  const maxRetries = 3;
  const initialDelay = 1000; // 1 second

  const processWebhook = async () => {
    try {
      console.log(`Processing webhook (attempt ${retryCount + 1}/${maxRetries + 1})`);
      
      const botData = botMap.get('0123'); // Replace with your Revotrend company ID
      if (!botData) {
        throw new Error('WhatsApp client not found for this company');
      }
      
      const client = botData[0].client;
      if (!client) {
        throw new Error("WhatsApp client is null or undefined");
      }
  
      // Log the incoming webhook data
      console.log("Revotrend webhook received:", req.body);
  
      const {
        firstName,
        lastName,
        jobTitle,
        company,
        states,
        phone,
        email,
        services,
        message,
      } = req.body;
  
      const missingFields = [];
      if (!firstName) missingFields.push("firstName");
      if (!lastName) missingFields.push("lastName");
      if (!phone) missingFields.push("phone");
      if (!email) missingFields.push("email");
      if (!services || services.length === 0) missingFields.push("services");
      if (!message) missingFields.push("message");
  
      if (missingFields.length > 0) {
        console.error("Missing required fields:", missingFields);
        throw new Error(`Missing fields: ${missingFields.join(", ")}`);
      }
  
      // Process and log the received data
      console.log("Processed data:", {
        firstName,
        lastName,
        jobTitle,
        company,
        states,
        phone,
        email,
        services,
        message,
      });
      
      // Format phone number - ensure it starts with '+'
      const phoneWithPlus = `+${phone.replace(/\D/g, '')}`;
      const phoneWithoutPlus = phoneWithPlus.replace(/\D/g, '');
      const chatId = `${phoneWithoutPlus}@c.us`;

      // Send welcome message
      const welcomeMessage = createRevotrendMessage();
      const msg = await client.sendMessage(chatId, welcomeMessage);
  
      // Prepare contact data for Neon database
      const contactData = {
        company_id: '0123',
        contact_id: phoneWithPlus,
        phone: phoneWithPlus,
        name: `${firstName} ${lastName}`,
        email: email,
        profile: null,
        tags: ['Website Lead', ...services], // Add services as tags
        last_updated: new Date(),
        additional_emails: [email],
        address1: null,
        assigned_to: null,
        business_id: null,
        chat_id: chatId,
        city: states,
        company_name: company || null,
        contact_name: `${firstName} ${lastName}`,
        job_title: jobTitle || null,
        monthly_shipments: null,
        customer_message: message,
        created_at: new Date(),
        phone_index: 0,
        thread_id: '',
        form_submission: {
          timestamp: Math.floor(Date.now() / 1000),
          source: 'Website Inquiry Form',
          raw_data: req.body,
        },
        storage_requirements: null,
        services: services,
        message: message
      };

      // Save contact data to Neon database with explicit error handling
      try {
        console.log(`Saving contact data to Neon for phone: ${phoneWithPlus}`);
        
        // First, save the contact
        await saveContact(contactData);
        
        // Then save the welcome message
        const messageData = {
          company_id: '0123',
          contact_id: phoneWithPlus,
          message_id: msg.id._serialized || `msg_${Date.now()}`,
          content: welcomeMessage,
          message_type: 'text',
          from_me: true,
          timestamp: Math.floor(Date.now() / 1000),
          thread_id: chatId,
          logs: null,
          tags: ['Website Lead', ...services],
          source: 'Website Form',
          status: 'sent',
          text_body: welcomeMessage,
          phone_index: 0
        };
        
        await saveMessage(messageData);
        
        console.log(`Successfully saved contact data for ${phoneWithPlus}`);
      } catch (neonError) {
        console.error(`Neon database error saving contact data for ${phoneWithPlus}:`, neonError);
        throw new Error(`Failed to save contact data: ${neonError.message}`);
      }
  
      // Send notification to team
      const notificationMessage = createRevotrendNotification(
        `${firstName} ${lastName}`,
        email,
        company,
        phoneWithPlus
      );
  
      // Send notifications to a team group
      await client.sendMessage("60192738360@c.us", notificationMessage); // Replace with your notification group number
  
      return {
        success: true,
        message: 'Contact created and message sent successfully',
        contactId: phoneWithPlus,
      };
    } catch (error) {
      console.error(`Error processing Revotrend webhook (attempt ${retryCount + 1}):`, error);
      throw error;
    }
  };

  try {
    // Try to process the webhook with retries
    const result = await retryOperation(processWebhook, maxRetries, initialDelay);
    res.json(result);
  } catch (error) {
    console.error('All retry attempts failed for Revotrend webhook:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

// Express route handler
function setupRevotrendWebhook(app, botMap) {
  app.post('/api/revotrend/webhook', async (req, res) => {
    await handleRevotrendWebhook(req, res, botMap);
  });
}

module.exports = {
  handleRevotrendWebhook,
  setupRevotrendWebhook
}; 