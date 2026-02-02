/**
 * WhatsApp routes (360dialog, Meta Direct, and Embedded Signup integration)
 */

const router = require('express').Router();
const axios = require('axios');
const dialog360 = require('../services/whatsapp/dialog360');
const metaDirect = require('../services/whatsapp/metaDirect');
const { getService } = require('../services/whatsapp/WhatsAppService');
const { pool } = require('../config/database');

const GRAPH_API_VERSION = 'v24.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * POST /api/whatsapp/360dialog/onboard
 * Save onboarding data from 360dialog Connect flow
 */
router.post('/360dialog/onboard', async (req, res) => {
  try {
    const { companyId, phoneIndex, clientId, channelId } = req.body;

    if (!companyId || phoneIndex === undefined || !clientId || !channelId) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const result = await dialog360.onboard(companyId, phoneIndex, clientId, channelId);
    res.json(result);
  } catch (e) {
    console.error('Onboard error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/whatsapp/meta-direct/connect
 * Connect using Meta Direct credentials (Phone Number ID, WABA ID, Access Token)
 */
router.post('/meta-direct/connect', async (req, res) => {
  try {
    const { companyId, phoneIndex, phoneNumberId, wabaId, accessToken } = req.body;

    if (!companyId || phoneIndex === undefined || !phoneNumberId || !wabaId || !accessToken) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const result = await metaDirect.connect(companyId, phoneIndex, phoneNumberId, wabaId, accessToken);
    res.json(result);
  } catch (e) {
    console.error('Meta Direct connect error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/whatsapp/360dialog/status/:companyId/:phoneIndex
 * Get connection status for a phone
 */
router.get('/360dialog/status/:companyId/:phoneIndex', async (req, res) => {
  try {
    const { companyId, phoneIndex } = req.params;

    const result = await pool.query(
      'SELECT status, display_phone_number, connection_type FROM phone_configs WHERE company_id = $1 AND phone_index = $2',
      [companyId, parseInt(phoneIndex)]
    );

    if (!result.rows[0]) {
      return res.json({ status: 'not_configured' });
    }

    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/whatsapp/send
 * Unified send endpoint (works with both wwebjs and 360dialog)
 */
router.post('/send', async (req, res) => {
  try {
    const { companyId, phoneIndex = 0, chatId, type, content, caption, templateName, templateLang, templateComponents } = req.body;

    const service = await getService(companyId, phoneIndex);

    let result;
    switch (type) {
      case 'text':
        result = await service.sendText(chatId, content);
        break;
      case 'image':
      case 'video':
      case 'audio':
      case 'document':
        result = await service.sendMedia(chatId, type, content, caption);
        break;
      case 'template':
        result = await service.sendTemplate(chatId, templateName, templateLang, templateComponents);
        break;
      default:
        return res.status(400).json({ error: 'Invalid message type' });
    }

    res.json({ success: true, ...result });
  } catch (e) {
    console.error('Send error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/whatsapp/config/:companyId
 * Get all phone configurations for a company
 */
router.get('/config/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;

    const result = await pool.query(
      'SELECT phone_index, connection_type, status, display_phone_number FROM phone_configs WHERE company_id = $1 ORDER BY phone_index',
      [companyId]
    );

    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * DELETE /api/whatsapp/config/:companyId/:phoneIndex
 * Remove a phone configuration
 */
router.delete('/config/:companyId/:phoneIndex', async (req, res) => {
  try {
    const { companyId, phoneIndex } = req.params;

    await pool.query(
      'DELETE FROM phone_configs WHERE company_id = $1 AND phone_index = $2',
      [companyId, parseInt(phoneIndex)]
    );

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
//
/**
 * GET /api/whatsapp/embedded-signup/config
 * Get Meta App configuration for embedded signup
 */
router.get('/embedded-signup/config', (req, res) => {
  res.json({
    appId: process.env.META_APP_ID,
    configId: process.env.META_CONFIG_ID,
  });
});

/**
 * POST /api/whatsapp/embedded-signup/complete
 * Complete the embedded signup flow - exchange code for access token and save credentials
 */
router.post('/embedded-signup/complete', async (req, res) => {
  try {
    const { companyId, phoneIndex, code } = req.body;

    if (!companyId || phoneIndex === undefined || !code) {
      return res.status(400).json({ success: false, error: 'Missing required fields: companyId, phoneIndex, code' });
    }

    // Step 1: Exchange the code for an access token
    const tokenResponse = await axios.get(`${GRAPH_API_BASE}/oauth/access_token`, {
      params: {
        client_id: process.env.META_APP_ID,
        client_secret: process.env.META_APP_SECRET,
        code: code,
      },
    });

    const accessToken = tokenResponse.data.access_token;

    // Step 2: Get debug info to find WABA ID
    const debugResponse = await axios.get(`${GRAPH_API_BASE}/debug_token`, {
      params: {
        input_token: accessToken,
        access_token: `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`,
      },
    });

    const granularScopes = debugResponse.data.data?.granular_scopes || [];
    const wabaScope = granularScopes.find(s => s.scope === 'whatsapp_business_management');

    if (!wabaScope?.target_ids?.length) {
      return res.status(400).json({
        success: false,
        error: 'No WhatsApp Business Account found. Please complete the signup flow properly.'
      });
    }

    const wabaId = wabaScope.target_ids[0];

    // Step 3: Get phone numbers associated with WABA
    const phoneNumbersResponse = await axios.get(`${GRAPH_API_BASE}/${wabaId}/phone_numbers`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const phoneNumbers = phoneNumbersResponse.data.data || [];

    if (!phoneNumbers.length) {
      return res.status(400).json({
        success: false,
        error: 'No phone numbers found in the WhatsApp Business Account.'
      });
    }

    const phoneNumberId = phoneNumbers[0].id;
    const displayPhoneNumber = phoneNumbers[0].display_phone_number;
    const verifiedName = phoneNumbers[0].verified_name;

    // Step 4: Subscribe the app to the WABA webhooks
    try {
      await axios.post(
        `${GRAPH_API_BASE}/${wabaId}/subscribed_apps`,
        {},
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
    } catch (subError) {
      console.warn('Warning: Could not subscribe to WABA webhooks:', subError.response?.data || subError.message);
    }

    // Step 5: Save credentials using the existing metaDirect.connect method
    const result = await metaDirect.connect(companyId, phoneIndex, phoneNumberId, wabaId, accessToken);

    res.json({
      success: true,
      displayPhoneNumber,
      verifiedName,
      wabaId,
      phoneNumberId,
      ...result,
    });

  } catch (error) {
    console.error('Embedded signup error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.error?.message || error.message || 'Failed to complete embedded signup'
    });
  }
});

/**
 * POST /api/whatsapp/embedded-signup/session-info
 * Get session info after embedded signup (phone numbers, WABA details)
 */
router.post('/embedded-signup/session-info', async (req, res) => {
  try {
    const { accessToken } = req.body;

    if (!accessToken) {
      return res.status(400).json({ success: false, error: 'Missing access token' });
    }

    // Get debug info
    const debugResponse = await axios.get(`${GRAPH_API_BASE}/debug_token`, {
      params: {
        input_token: accessToken,
        access_token: `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`,
      },
    });

    const granularScopes = debugResponse.data.data?.granular_scopes || [];
    const wabaScope = granularScopes.find(s => s.scope === 'whatsapp_business_management');
    const wabaId = wabaScope?.target_ids?.[0];

    if (!wabaId) {
      return res.json({ success: true, phoneNumbers: [], wabaId: null });
    }

    // Get phone numbers
    const phoneNumbersResponse = await axios.get(`${GRAPH_API_BASE}/${wabaId}/phone_numbers`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    res.json({
      success: true,
      wabaId,
      phoneNumbers: phoneNumbersResponse.data.data || [],
    });

  } catch (error) {
    console.error('Session info error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
