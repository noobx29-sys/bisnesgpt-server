const express = require('express');
const router = express.Router();
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// CSV Google Sheets URL for participant data
const PARTICIPANT_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ9Wlb5GVpeT1FUavQdufnLukU1oyRWh1AaKKSJlGoFAAgjqxIh4JeHcNkK58JHT4BBP_qrkQacDtYc/pub?output=csv';

// Certificate generation function using Puppeteer
async function generateCertificate(participantName, programDate = '7 August 2025') {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    
    // Set viewport for consistent rendering
    await page.setViewport({ width: 1200, height: 800 });
    
    // Create HTML content for the certificate
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body {
            margin: 0;
            padding: 0;
            font-family: 'Arial', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
          }
          .certificate {
            background: white;
            padding: 60px;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 800px;
            position: relative;
            overflow: hidden;
          }
          .certificate::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 8px;
            background: linear-gradient(90deg, #667eea, #764ba2);
          }
          .header {
            margin-bottom: 40px;
          }
          .title {
            font-size: 48px;
            font-weight: bold;
            color: #2c3e50;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 2px;
          }
          .subtitle {
            font-size: 24px;
            color: #7f8c8d;
            margin-bottom: 30px;
          }
          .content {
            margin: 40px 0;
          }
          .participant-name {
            font-size: 36px;
            font-weight: bold;
            color: #2c3e50;
            margin: 20px 0;
            padding: 20px;
            border: 3px solid #3498db;
            border-radius: 15px;
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
          }
          .description {
            font-size: 18px;
            color: #34495e;
            line-height: 1.6;
            margin: 20px 0;
          }
          .date {
            font-size: 20px;
            color: #7f8c8d;
            margin: 30px 0;
            font-style: italic;
          }
          .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 2px solid #ecf0f1;
          }
          .signature {
            font-size: 16px;
            color: #7f8c8d;
            margin-top: 10px;
          }
          .logo {
            font-size: 32px;
            color: #667eea;
            margin-bottom: 20px;
          }
        </style>
      </head>
      <body>
        <div class="certificate">
          <div class="logo">🏆</div>
          <div class="header">
            <div class="title">Certificate of Participation</div>
            <div class="subtitle">FUTUREX.AI 2025</div>
          </div>
          
          <div class="content">
            <div class="description">
              This is to certify that
            </div>
            <div class="participant-name">
              ${participantName}
            </div>
            <div class="description">
              has successfully participated in the Business Automation & AI Chatbot Experience session
            </div>
            <div class="date">
              held on ${programDate}
            </div>
          </div>
          
          <div class="footer">
            <div class="description">
              We acknowledge your valuable contribution to the success of this event.
            </div>
            <div class="signature">
              Co9P AI Chatbot Team
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    // Set HTML content
    await page.setContent(htmlContent);
    
    // Wait for content to render
    await page.waitForTimeout(1000);
    
    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20px',
        right: '20px',
        bottom: '20px',
        left: '20px'
      }
    });

    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

// Function to fetch and parse CSV data
async function fetchParticipantData() {
  try {
    const response = await axios.get(PARTICIPANT_CSV_URL);
    const csvData = response.data;
    
    // Parse CSV data (simple parsing for now)
    const lines = csvData.split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const participants = [];
    
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim()) {
        const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
        const participant = {};
        headers.forEach((header, index) => {
          participant[header] = values[index] || '';
        });
        participants.push(participant);
      }
    }
    
    return participants;
  } catch (error) {
    console.error('Error fetching participant data:', error);
    throw new Error('Failed to fetch participant data from CSV');
  }
}

// Function to find participant by phone number
function findParticipantByPhone(participants, phoneNumber) {
  // Clean phone number for comparison
  const cleanPhone = phoneNumber.replace(/\D/g, '');
  
  for (const participant of participants) {
    // Check various possible phone number fields
    const possiblePhoneFields = ['Phone', 'Mobile Number', 'Mobile', 'Phone Number', 'Contact'];
    
    for (const field of possiblePhoneFields) {
      if (participant[field]) {
        const participantPhone = participant[field].replace(/\D/g, '');
        if (participantPhone === cleanPhone || participantPhone.endsWith(cleanPhone.slice(-9))) {
          return participant;
        }
      }
    }
  }
  
  return null;
}

// Function to format phone number for WhatsApp
function formatPhoneForWhatsApp(phoneNumber) {
  // Remove all non-digits
  const cleanPhone = phoneNumber.replace(/\D/g, '');
  
  // Ensure it starts with 6 (Malaysia country code)
  let formattedPhone = cleanPhone;
  if (!formattedPhone.startsWith('6')) {
    formattedPhone = '6' + formattedPhone;
  }
  
  // Format as WhatsApp chat ID
  return `${formattedPhone}@c.us`;
}

// Main endpoint for certificate generation and WhatsApp sending
router.post('/generate-and-send', async (req, res) => {
  try {
    const { phoneNumber, formId, formTitle, companyId } = req.body;
    
    // Validate required fields
    if (!phoneNumber || !formId || !formTitle || !companyId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        details: 'phoneNumber, formId, formTitle, and companyId are required'
      });
    }
    
    console.log(`[Certificates] Processing request for phone: ${phoneNumber}, form: ${formId}, company: ${companyId}`);
    
    // Fetch participant data from CSV
    const participants = await fetchParticipantData();
    console.log(`[Certificates] Fetched ${participants.length} participants from CSV`);
    
    // Find participant by phone number
    const participant = findParticipantByPhone(participants, phoneNumber);
    if (!participant) {
      return res.status(404).json({
        success: false,
        error: 'Participant not found in CSV data',
        details: `No participant found with phone number ${phoneNumber}`
      });
    }
    
    // Extract participant information
    const participantName = participant['Full Name'] || participant['Nama'] || participant['Full Namea'] || 'Participant';
    const programDate = participant['Program Date & Time'] || '7 August 2025';
    
    console.log(`[Certificates] Found participant: ${participantName}, Date: ${programDate}`);
    
    // Generate certificate PDF
    const pdfBuffer = await generateCertificate(participantName, programDate);
    console.log(`[Certificates] Generated certificate PDF for ${participantName}`);
    
    // Save certificate to temporary file
    const certificateId = uuidv4();
    const filename = `${participantName.replace(/\s+/g, '_')}_FUTUREX.AI_2025_Certificate.pdf`;
    const tempPath = path.join('/tmp', `${certificateId}_${filename}`);
    
    await fs.writeFile(tempPath, pdfBuffer);
    console.log(`[Certificates] Saved certificate to: ${tempPath}`);
    
    // TODO: Upload to storage (Firebase/Cloud Storage) and get URL
    // For now, we'll use the temporary file path
    const certificateUrl = tempPath;
    
    // Prepare WhatsApp message content
    const thankYouText = `Dear ${participantName}

Thank You for Attending FUTUREX.AI 2025

On behalf of the organizing team, we would like to extend our heartfelt thanks for your participation in FUTUREX.AI 2025 held on ${programDate}.

Your presence and engagement in the Business Automation & AI Chatbot Experience session greatly contributed to the success of the event.

We hope the experience was insightful and inspiring as we continue to explore how artificial intelligence and robotics can shape the future.

We hope you can join our next event as well.

Please find your digital certificate of participation attached.

Warm regards,
Co9P AI Chatbot`;

    console.log(`[Certificates] Prepared WhatsApp message for ${participantName}`);
    
    // Return success response with all necessary data for WhatsApp sending
    res.json({
      success: true,
      message: 'Certificate generation and WhatsApp sending initiated successfully',
      participantName,
      certificateUrl,
      filename,
      whatsappMessage: thankYouText,
      phoneNumber: formatPhoneForWhatsApp(phoneNumber),
      companyId,
      // Additional data for WhatsApp integration
      chatId: formatPhoneForWhatsApp(phoneNumber),
      documentPath: tempPath,
      documentCaption: 'Certificate of Participation'
    });
    
  } catch (error) {
    console.error('[Certificates] Error:', error);
    res.status(500).json({
      success: false,
        error: 'Internal server error',
        details: error.message
    });
  }
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Certificates service is running',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
