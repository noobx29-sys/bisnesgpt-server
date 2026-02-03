/**
 * Message Templates Service for WhatsApp Business API
 * Handles syncing, storing, and managing message templates from Meta
 */

const axios = require('axios');
const { pool } = require('../../config/database');
const metaDirect = require('./metaDirect');

const GRAPH_API_VERSION = 'v24.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

class TemplatesService {
  /**
   * Sync templates from Meta Business API
   * @param {string} companyId - Company ID
   * @param {number} phoneIndex - Phone index
   * @returns {Promise<{success: boolean, templates: array, synced: number}>}
   */
  async syncTemplates(companyId, phoneIndex = 0) {
    try {
      // Get phone config
      const config = await pool.query(
        'SELECT meta_waba_id, meta_access_token_encrypted FROM phone_configs WHERE company_id = $1 AND phone_index = $2 AND connection_type IN ($3, $4)',
        [companyId, phoneIndex, 'meta_direct', 'meta_embedded']
      );

      if (!config.rows[0]) {
        throw new Error('No Meta connection found for this company. Please connect via Official API first.');
      }

      const { meta_waba_id, meta_access_token_encrypted } = config.rows[0];
      const accessToken = metaDirect.decrypt(meta_access_token_encrypted);

      // Fetch templates from Meta
      const response = await axios.get(
        `${GRAPH_API_BASE}/${meta_waba_id}/message_templates`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { 
            fields: 'id,name,language,status,category,components',
            limit: 250 
          }
        }
      );

      const templates = response.data.data || [];
      let syncedCount = 0;

      // Upsert each template
      for (const template of templates) {
        await pool.query(`
          INSERT INTO message_templates (
            company_id, phone_index, template_id, template_name,
            template_language, category, status, components, synced_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          ON CONFLICT (company_id, phone_index, template_id) DO UPDATE SET
            template_name = $4,
            template_language = $5,
            category = $6,
            status = $7,
            components = $8,
            synced_at = NOW(),
            updated_at = NOW()
        `, [
          companyId,
          phoneIndex,
          template.id,
          template.name,
          template.language,
          template.category,
          template.status,
          JSON.stringify(template.components)
        ]);
        syncedCount++;
      }

      // Remove templates that no longer exist in Meta
      const templateIds = templates.map(t => t.id);
      if (templateIds.length > 0) {
        await pool.query(`
          DELETE FROM message_templates 
          WHERE company_id = $1 AND phone_index = $2 
          AND template_id NOT IN (${templateIds.map((_, i) => `$${i + 3}`).join(',')})
        `, [companyId, phoneIndex, ...templateIds]);
      }

      return {
        success: true,
        templates: templates.map(t => ({
          id: t.id,
          name: t.name,
          language: t.language,
          status: t.status,
          category: t.category,
          components: t.components
        })),
        synced: syncedCount
      };
    } catch (error) {
      console.error('Error syncing templates:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || error.message);
    }
  }

  /**
   * Get all templates for a company
   * @param {string} companyId - Company ID
   * @param {number} phoneIndex - Phone index
   * @param {string} status - Optional status filter (APPROVED, PENDING, REJECTED)
   * @returns {Promise<array>}
   */
  async getTemplates(companyId, phoneIndex = 0, status = null) {
    let query = `
      SELECT * FROM message_templates 
      WHERE company_id = $1 AND phone_index = $2
    `;
    const params = [companyId, phoneIndex];

    if (status) {
      query += ` AND status = $3`;
      params.push(status);
    }

    query += ` ORDER BY template_name ASC`;

    const result = await pool.query(query, params);
    return result.rows.map(row => ({
      id: row.template_id,
      name: row.template_name,
      language: row.template_language,
      status: row.status,
      category: row.category,
      components: row.components,
      syncedAt: row.synced_at
    }));
  }

  /**
   * Get a specific template by name
   * @param {string} companyId - Company ID
   * @param {number} phoneIndex - Phone index
   * @param {string} templateName - Template name
   * @param {string} language - Optional language code
   * @returns {Promise<object|null>}
   */
  async getTemplate(companyId, phoneIndex, templateName, language = null) {
    let query = `
      SELECT * FROM message_templates 
      WHERE company_id = $1 AND phone_index = $2 AND template_name = $3
    `;
    const params = [companyId, phoneIndex, templateName];

    if (language) {
      query += ` AND template_language = $4`;
      params.push(language);
    }

    query += ` LIMIT 1`;

    const result = await pool.query(query, params);
    if (!result.rows[0]) return null;

    const row = result.rows[0];
    return {
      id: row.template_id,
      name: row.template_name,
      language: row.template_language,
      status: row.status,
      category: row.category,
      components: row.components
    };
  }

  /**
   * Check if conversation is within 24-hour window
   * @param {string} companyId - Company ID
   * @param {number} phoneIndex - Phone index
   * @param {string} contactPhone - Customer's phone number
   * @returns {Promise<{isOpen: boolean, lastCustomerMessage: Date|null, hoursRemaining: number}>}
   */
  async checkSessionWindow(companyId, phoneIndex, contactPhone) {
    // Clean phone number (remove @c.us, etc.)
    const cleanPhone = contactPhone.replace(/@.+/, '').replace(/\D/g, '');

    const result = await pool.query(`
      SELECT last_customer_message_at,
             (NOW() - last_customer_message_at) < INTERVAL '24 hours' as is_open,
             EXTRACT(EPOCH FROM (INTERVAL '24 hours' - (NOW() - last_customer_message_at))) / 3600 as hours_remaining
      FROM conversation_sessions
      WHERE company_id = $1 AND phone_index = $2 AND contact_phone = $3
    `, [companyId, phoneIndex, cleanPhone]);

    if (!result.rows[0] || !result.rows[0].last_customer_message_at) {
      return {
        isOpen: false,
        lastCustomerMessage: null,
        hoursRemaining: 0,
        requiresTemplate: true
      };
    }

    const { last_customer_message_at, is_open, hours_remaining } = result.rows[0];
    
    return {
      isOpen: is_open,
      lastCustomerMessage: last_customer_message_at,
      hoursRemaining: Math.max(0, Math.round(hours_remaining * 10) / 10),
      requiresTemplate: !is_open
    };
  }

  /**
   * Update session when customer sends a message
   * @param {string} companyId - Company ID
   * @param {number} phoneIndex - Phone index
   * @param {string} contactPhone - Customer's phone number
   */
  async updateCustomerSession(companyId, phoneIndex, contactPhone) {
    const cleanPhone = contactPhone.replace(/@.+/, '').replace(/\D/g, '');

    await pool.query(`
      INSERT INTO conversation_sessions (
        company_id, phone_index, contact_phone, 
        last_customer_message_at, session_open
      )
      VALUES ($1, $2, $3, NOW(), true)
      ON CONFLICT (company_id, phone_index, contact_phone) DO UPDATE SET
        last_customer_message_at = NOW(),
        session_open = true,
        updated_at = NOW()
    `, [companyId, phoneIndex, cleanPhone]);
  }

  /**
   * Update session when business sends a message
   * @param {string} companyId - Company ID
   * @param {number} phoneIndex - Phone index
   * @param {string} contactPhone - Customer's phone number
   */
  async updateBusinessSession(companyId, phoneIndex, contactPhone) {
    const cleanPhone = contactPhone.replace(/@.+/, '').replace(/\D/g, '');

    await pool.query(`
      INSERT INTO conversation_sessions (
        company_id, phone_index, contact_phone, 
        last_business_message_at
      )
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (company_id, phone_index, contact_phone) DO UPDATE SET
        last_business_message_at = NOW(),
        updated_at = NOW()
    `, [companyId, phoneIndex, cleanPhone]);
  }

  /**
   * Check if company uses Official API (requires template for re-engagement)
   * @param {string} companyId - Company ID
   * @param {number} phoneIndex - Phone index
   * @returns {Promise<boolean>}
   */
  async isOfficialApi(companyId, phoneIndex = 0) {
    const result = await pool.query(`
      SELECT connection_type FROM phone_configs 
      WHERE company_id = $1 AND phone_index = $2
    `, [companyId, phoneIndex]);

    if (!result.rows[0]) return false;
    
    const connectionType = result.rows[0].connection_type;
    return ['meta_direct', 'meta_embedded', '360dialog'].includes(connectionType);
  }

  /**
   * Build template components with variable substitution
   * @param {object} template - Template object
   * @param {object} variables - Variables to substitute { header: [], body: [], button: [] }
   * @returns {array} - Components array for API
   */
  buildTemplateComponents(template, variables = {}) {
    const components = [];
    
    if (!template.components) return components;

    for (const comp of template.components) {
      if (comp.type === 'HEADER' && variables.header?.length) {
        components.push({
          type: 'header',
          parameters: variables.header.map(v => 
            typeof v === 'object' ? v : { type: 'text', text: v }
          )
        });
      }
      
      if (comp.type === 'BODY' && variables.body?.length) {
        components.push({
          type: 'body',
          parameters: variables.body.map(v => ({ type: 'text', text: v }))
        });
      }
      
      if (comp.type === 'BUTTON' && variables.button?.length) {
        variables.button.forEach((btn, index) => {
          components.push({
            type: 'button',
            sub_type: btn.type || 'url',
            index: index,
            parameters: btn.parameters || [{ type: 'text', text: btn.text }]
          });
        });
      }
    }

    return components;
  }

  /**
   * Get template preview text (for display purposes)
   * @param {object} template - Template object
   * @returns {string} - Preview text
   */
  getTemplatePreview(template) {
    if (!template.components) return '';

    const parts = [];
    
    for (const comp of template.components) {
      if (comp.type === 'HEADER' && comp.text) {
        parts.push(`[Header] ${comp.text}`);
      }
      if (comp.type === 'BODY' && comp.text) {
        parts.push(comp.text);
      }
      if (comp.type === 'FOOTER' && comp.text) {
        parts.push(`[Footer] ${comp.text}`);
      }
      if (comp.type === 'BUTTONS') {
        const buttons = comp.buttons?.map(b => b.text).join(' | ') || '';
        if (buttons) parts.push(`[Buttons: ${buttons}]`);
      }
    }

    return parts.join('\n');
  }
}

module.exports = new TemplatesService();
