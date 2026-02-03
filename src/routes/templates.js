/**
 * Message Templates Routes
 * API endpoints for managing WhatsApp Business API message templates
 * and checking 24-hour messaging window
 */

const router = require('express').Router();
const templatesService = require('../services/whatsapp/templatesService');
const { pool } = require('../config/database');

/**
 * POST /api/templates/sync
 * Sync templates from Meta Business API
 */
router.post('/sync', async (req, res) => {
  try {
    const { companyId, phoneIndex = 0 } = req.body;

    if (!companyId) {
      return res.status(400).json({ success: false, error: 'Missing companyId' });
    }

    const result = await templatesService.syncTemplates(companyId, phoneIndex);
    res.json(result);
  } catch (error) {
    console.error('Template sync error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/templates/:companyId
 * Get all templates for a company
 */
router.get('/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { phoneIndex = 0, status } = req.query;

    const templates = await templatesService.getTemplates(
      companyId, 
      parseInt(phoneIndex), 
      status || null
    );

    res.json({ success: true, templates });
  } catch (error) {
    console.error('Get templates error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/templates/:companyId/approved
 * Get only approved templates (ready to send)
 */
router.get('/:companyId/approved', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { phoneIndex = 0 } = req.query;

    const templates = await templatesService.getTemplates(
      companyId, 
      parseInt(phoneIndex), 
      'APPROVED'
    );

    res.json({ success: true, templates });
  } catch (error) {
    console.error('Get approved templates error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/templates/:companyId/template/:templateName
 * Get a specific template by name
 */
router.get('/:companyId/template/:templateName', async (req, res) => {
  try {
    const { companyId, templateName } = req.params;
    const { phoneIndex = 0, language } = req.query;

    const template = await templatesService.getTemplate(
      companyId,
      parseInt(phoneIndex),
      templateName,
      language || null
    );

    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    res.json({ success: true, template });
  } catch (error) {
    console.error('Get template error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/templates/session/:companyId/:contactPhone
 * Check if conversation is within 24-hour messaging window
 */
router.get('/session/:companyId/:contactPhone', async (req, res) => {
  try {
    const { companyId, contactPhone } = req.params;
    const { phoneIndex = 0 } = req.query;

    // First check if this company uses Official API
    const isOfficial = await templatesService.isOfficialApi(companyId, parseInt(phoneIndex));

    if (!isOfficial) {
      // Non-official API (wwebjs) doesn't have 24-hour restriction
      return res.json({
        success: true,
        isOfficialApi: false,
        sessionWindow: {
          isOpen: true,
          requiresTemplate: false,
          message: 'Using unofficial API - no template restriction'
        }
      });
    }

    const sessionWindow = await templatesService.checkSessionWindow(
      companyId,
      parseInt(phoneIndex),
      contactPhone
    );

    res.json({
      success: true,
      isOfficialApi: true,
      sessionWindow
    });
  } catch (error) {
    console.error('Check session error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/templates/session/update-customer
 * Update session when customer sends a message
 * (Called automatically by webhook handler)
 */
router.post('/session/update-customer', async (req, res) => {
  try {
    const { companyId, phoneIndex = 0, contactPhone } = req.body;

    if (!companyId || !contactPhone) {
      return res.status(400).json({ success: false, error: 'Missing companyId or contactPhone' });
    }

    await templatesService.updateCustomerSession(companyId, phoneIndex, contactPhone);
    res.json({ success: true });
  } catch (error) {
    console.error('Update customer session error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/templates/connection-type/:companyId
 * Check connection type for a company (to determine if templates are needed)
 */
router.get('/connection-type/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { phoneIndex = 0 } = req.query;

    const result = await pool.query(`
      SELECT connection_type, status, display_phone_number
      FROM phone_configs 
      WHERE company_id = $1 AND phone_index = $2
    `, [companyId, parseInt(phoneIndex)]);

    if (!result.rows[0]) {
      return res.json({
        success: true,
        connectionType: 'wwebjs', // Default
        requiresTemplates: false
      });
    }

    const { connection_type, status, display_phone_number } = result.rows[0];
    const requiresTemplates = ['meta_direct', 'meta_embedded', '360dialog'].includes(connection_type);

    res.json({
      success: true,
      connectionType: connection_type,
      status,
      displayPhoneNumber: display_phone_number,
      requiresTemplates
    });
  } catch (error) {
    console.error('Get connection type error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/templates/preview
 * Get a preview of a template with variable substitution
 */
router.post('/preview', async (req, res) => {
  try {
    const { companyId, phoneIndex = 0, templateName, variables } = req.body;

    const template = await templatesService.getTemplate(companyId, phoneIndex, templateName);
    
    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    const preview = templatesService.getTemplatePreview(template);
    const components = templatesService.buildTemplateComponents(template, variables);

    res.json({
      success: true,
      template,
      preview,
      components
    });
  } catch (error) {
    console.error('Template preview error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
