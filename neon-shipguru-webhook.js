const {
  createShipGuruMessage,
  createNotificationMessage,
  formatPhoneNumberShipguru
} = require('./neon-webhook-utils');

const {
  saveContact,
  saveMessage,
  getContactByPhone
} = require('./neon-contact-operations');

// ======================
// SHIPGURU WEBHOOK HANDLER
// ======================

async function handleShipGuruWebhook(req, res, botMap) {
  try {
    const botData = botMap.get('0123');
    if (!botData) {
      return res.status(404).json({ error: 'WhatsApp client not found for this company' });
    }
    const client = botData[2].client;

    // Log the incoming webhook data
    console.log('Webhook received:', req.body);

    // Extract data with correct field names
    const firstName = req.body['First Name'] || '';
    const lastName = req.body['Last Name'] || '';
    const contactNumber = req.body['Contact Number'] || '';
    const email = req.body['Email'] || '';
    const companyName = req.body['Company Name'] || '';
    const monthlyShipments = req.body['Amount of Monthly Shipments'] || '';
    const services = req.body['Interested Services'] || '';
    const customerMessage = req.body['Comment or Message'] || '';
    const submissionDate = req.body['Date'] || '';
    const submissionTime = req.body['Time'] || '';
    const pageUrl = req.body['Page URL'] || '';

    // Validate required fields
    if (!firstName || !contactNumber || !email || !companyName) {
      console.error('Missing required fields:', { firstName, contactNumber, email, companyName });
      return res.status(400).json({ 
        error: 'Missing required fields',
        received: { firstName, contactNumber, email, companyName }
      });
    }

    // Convert services to array
    const servicesArray = services.split(',').map(s => s.trim());
    servicesArray.push('Website Lead');

    // Format phone number - ensure it starts with '+'
    const phoneWithPlus = `+${contactNumber.replace(/\D/g, '')}`;
    const phoneWithoutPlus = phoneWithPlus.replace(/\D/g, '');
    const chatId = `${phoneWithoutPlus}@c.us`;

    console.log('Formatted phone:', phoneWithPlus);
    console.log('Chat ID:', chatId);

    // Send welcome message
    const welcomeMessage = createShipGuruMessage();
    const msg = await client.sendMessage(chatId, welcomeMessage);

    // Prepare contact data for Neon database
    const contactData = {
      company_id: '0123',
      contact_id: phoneWithPlus,
      phone: phoneWithPlus,
      name: `${firstName} ${lastName}`,
      email: email,
      profile: null,
      tags: [...servicesArray],
      last_updated: new Date(),
      additional_emails: [email],
      address1: null,
      assigned_to: null,
      business_id: null,
      chat_id: chatId,
      city: null,
      company_name: companyName,
      contact_name: `${firstName} ${lastName}`.trim(),
      job_title: null,
      monthly_shipments: monthlyShipments,
      customer_message: customerMessage,
      created_at: new Date(),
      phone_index: 2,
      thread_id: "",
      form_submission: {
        timestamp: Math.floor(Date.now() / 1000),
        date: submissionDate,
        time: submissionTime,
        source: "Website Form",
        page_url: pageUrl,
        raw_data: req.body
      },
      storage_requirements: null,
      services: servicesArray,
      message: customerMessage
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
        tags: [...servicesArray],
        source: "Website Form",
        status: "sent",
        text_body: welcomeMessage,
        phone_index: 2
      };
      
      await saveMessage(messageData);
      
      console.log(`Successfully saved contact data for ${phoneWithPlus}`);
    } catch (neonError) {
      console.error(`Neon database error saving contact data for ${phoneWithPlus}:`, neonError);
      throw new Error(`Failed to save contact data: ${neonError.message}`);
    }

    // Send notification to team
    try {
      const notificationMessage = createNotificationMessage(
        firstName,
        lastName,
        companyName,
        phoneWithPlus,
        servicesArray,
        monthlyShipments,
        customerMessage,
        submissionDate,
        submissionTime
      );
      await client.sendMessage("60192738360@c.us", notificationMessage);
      console.log(`Notification sent to team for contact: ${phoneWithPlus}`);
    } catch (notificationError) {
      console.error(`Error sending notification for ${phoneWithPlus}:`, notificationError);
      // Continue execution even if notification fails
    }

    res.json({ 
      success: true, 
      message: 'Contact created and message sent successfully',
      contactId: phoneWithPlus
    });

  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      requestBody: req.body
    });
  }
}

// Express route handler
function setupShipGuruWebhook(app, botMap) {
  app.post('/api/shipguru/webhook', async (req, res) => {
    await handleShipGuruWebhook(req, res, botMap);
  });
}

module.exports = {
  handleShipGuruWebhook,
  setupShipGuruWebhook
}; 