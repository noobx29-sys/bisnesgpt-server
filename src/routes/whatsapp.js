/**
 * WhatsApp routes (360dialog and Meta Direct integration)
 */

const router = require('express').Router();
const dialog360 = require('../services/whatsapp/dialog360');
const metaDirect = require('../services/whatsapp/metaDirect');
const { getService } = require('../services/whatsapp/WhatsAppService');
const { pool } = require('../config/database');

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

module.exports = router;
