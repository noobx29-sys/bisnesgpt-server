const {
  createStoreGuruMessage,
  createStoreGuruNotification,
  formatPhoneNumber
} = require('./neon-webhook-utils');

const {
  saveContact,
  saveMessage,
  getContactByPhone
} = require('./neon-contact-operations');

// ======================
// STOREGURU WEBHOOK HANDLER
// ======================

// Track recent submissions to prevent duplicates
const recentSubmissions = new Set();
const SUBMISSION_TIMEOUT = 60000; // 1 minute timeout

async function handleStoreGuruWebhook(req, res, botMap) {
  try {
    // Generate a unique submission ID based on form data
    const submissionId = `${req.body['first-name']}_${req.body.phone}_${Date.now()}`;
   
    // Check if this submission was recently processed
    if (recentSubmissions.has(submissionId)) {
      console.log('Duplicate submission detected:', submissionId);
      return res.status(200).json({ 
        success: true, 
        message: 'Duplicate submission ignored',
        duplicate: true
      });
    }

    // Add submission to tracking set
    recentSubmissions.add(submissionId);
    
    // Remove submission from tracking after timeout
    setTimeout(() => {
      recentSubmissions.delete(submissionId);
    }, SUBMISSION_TIMEOUT);

    const botData = botMap.get('0123');
    if (!botData) {
      return res.status(404).json({ error: 'WhatsApp client not found for this company' });
    }
    const client = botData[1].client; // Using index 1 for StoreGuru

    // Log the incoming webhook data
    console.log('StoreGuru webhook received:', req.body);

    // Extract data from the form submission
    const {
      salutation,
      'first-name': firstName,
      'last-name': lastName,
      email,
      phone,
      'storage-space': storageSpace,
      'storage-duration': storageDuration,
      services,
      'lorry-size': lorrySize,
      manpower,
      'store-location': storeLocation,
      message
    } = req.body;

    // Validate required fields
    if (!firstName || !phone || !email || !storeLocation) {
      console.error('Missing required fields:', { firstName, phone, email, storeLocation });
      return res.status(400).json({ 
        error: 'Missing required fields',
        received: { firstName, phone, email, storeLocation }
      });
    }

    // Format phone number - ensure it starts with '+'
    const phoneWithPlus = formatPhoneNumber(phone);
    const phoneWithoutPlus = phoneWithPlus.replace(/\D/g, '');
    const chatId = `${phoneWithoutPlus}@c.us`;

    // Send welcome message
    const welcomeMessage = createStoreGuruMessage();
    const msg = await client.sendMessage(chatId, welcomeMessage);

    // Convert services to array if it's not already
    let servicesArray = [];
    if (services) {
      servicesArray = Array.isArray(services) ? services : [services];
    }
    servicesArray.push('Website Lead');
    const filteredServicesArray = servicesArray.filter(service => service != null && service !== '');
    
    // Prepare contact data for Neon database
    const contactData = {
      company_id: '0123',
      contact_id: phoneWithPlus,
      phone: phoneWithPlus,
      name: [salutation, firstName, lastName].filter(Boolean).join(' ').trim() || firstName,
      email: email,
      profile: null,
      tags: filteredServicesArray,
      last_updated: new Date(),
      additional_emails: [email],
      address1: null,
      assigned_to: null,
      business_id: null,
      chat_id: chatId,
      city: null,
      company_name: null,
      contact_name: [salutation, firstName, lastName].filter(Boolean).join(' ').trim() || firstName,
      job_title: null,
      monthly_shipments: null,
      customer_message: message ?? "",
      created_at: new Date(),
      phone_index: 1,
      thread_id: "",
      form_submission: {
        timestamp: Math.floor(Date.now() / 1000),
        source: "Website Inquiry Form",
        raw_data: req.body
      },
      storage_requirements: {
        space: storageSpace ?? 'Not specified',
        duration: storageDuration ?? 'Not specified',
        location: storeLocation ?? 'Not specified',
        lorry_size: lorrySize ?? 'Not specified',
        manpower: manpower ?? 'Not specified',
      },
      services: filteredServicesArray,
      message: message ?? ""
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
        tags: filteredServicesArray,
        source: 'Website Form',
        status: 'sent',
        text_body: welcomeMessage,
        phone_index: 1
      };
      
      await saveMessage(messageData);
      
      console.log(`Successfully saved contact data for ${phoneWithPlus}`);
    } catch (neonError) {
      console.error(`Neon database error saving contact data for ${phoneWithPlus}:`, neonError);
      throw new Error(`Failed to save contact data: ${neonError.message}`);
    }

    // Send notification to team
    const notificationMessage = createStoreGuruNotification(req.body);
    await client.sendMessage("60192738360@c.us", notificationMessage); // Replace with your notification group number

    res.json({ 
      success: true, 
      message: 'Contact created and message sent successfully',
      contactId: phoneWithPlus
    });

  } catch (error) {
    console.error('Error processing StoreGuru webhook:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      requestBody: req.body
    });
  }
}

// Express route handler
function setupStoreGuruWebhook(app, botMap) {
  app.post('/api/storeguru/webhook', async (req, res) => {
    await handleStoreGuruWebhook(req, res, botMap);
  });
}

module.exports = {
  handleStoreGuruWebhook,
  setupStoreGuruWebhook
}; 