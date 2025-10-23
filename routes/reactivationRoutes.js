const express = require('express');
const router = express.Router();
const sqlDb = require('../db');

// Get all reactivation candidates
router.get('/:companyId/reactivation', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { search = '', page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    // Build the query
    let query = `
      SELECT 
        c.contact_id,
        c.name,
        c.phone,
        c.custom_fields->'analytics'->>'reactivation_eligible' as eligible,
        c.custom_fields->'analytics'->>'reactivation_priority' as priority,
        c.custom_fields->'analytics'->>'reactivation_notes' as notes,
        c.custom_fields->'analytics'->>'reactivation_updated_at' as updated_at,
        COUNT(*) OVER() as total_count
      FROM contacts c
      WHERE c.company_id = $1
        AND c.custom_fields->'analytics'->>'reactivation_eligible' = 'true'
    `;

    const queryParams = [companyId];
    let paramCount = queryParams.length + 1;

    // Add search filter if provided
    if (search) {
      query += ` AND (c.name ILIKE $${paramCount} OR c.phone ILIKE $${paramCount})`;
      queryParams.push(`%${search}%`);
      paramCount++;
    }

    // Add pagination
    query += ` ORDER BY (c.custom_fields->'analytics'->>'reactivation_priority')::int DESC, c.updated_at DESC
              LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    
    queryParams.push(parseInt(limit), offset);

    const result = await sqlDb.query(query, queryParams);
    
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;
    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      success: true,
      data: {
        candidates: result.rows.map(row => {
          const { total_count, ...rest } = row;
          return rest;
        }),
        pagination: {
          total: totalCount,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages
        }
      }
    });
  } catch (error) {
    console.error('Error fetching reactivation candidates:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get single reactivation candidate
router.get('/:companyId/reactivation/:contactId', async (req, res) => {
  try {
    const { companyId, contactId } = req.params;
    
    const result = await sqlDb.query(
      `SELECT 
        contact_id,
        name,
        phone,
        custom_fields->'analytics'->>'reactivation_eligible' as eligible,
        custom_fields->'analytics'->>'reactivation_priority' as priority,
        custom_fields->'analytics'->>'reactivation_notes' as notes,
        custom_fields->'analytics'->>'reactivation_updated_at' as updated_at
      FROM contacts 
      WHERE contact_id = $1 AND company_id = $2`,
      [contactId, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Contact not found or not eligible for reactivation' 
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching reactivation candidate:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Create or update reactivation data
router.post('/:companyId/reactivation/:contactId?', async (req, res) => {
  try {
    const { companyId, contactId } = req.params;
    const { eligible, priority, notes } = req.body;

    // Validate input
    if (eligible === undefined || priority === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: eligible and priority are required'
      });
    }

    // Check if contact exists
    const contactCheck = await sqlDb.query(
      'SELECT contact_id, custom_fields FROM contacts WHERE contact_id = $1 AND company_id = $2',
      [contactId, companyId]
    );

    if (contactCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found'
      });
    }

    // Update or create reactivation data
    const customFields = contactCheck.rows[0].custom_fields || {};
    customFields.analytics = {
      ...(customFields.analytics || {}),
      reactivation_eligible: Boolean(eligible),
      reactivation_priority: parseInt(priority) || 5,
      reactivation_notes: notes || null,
      reactivation_updated_at: new Date().toISOString()
    };

    await sqlDb.query(
      'UPDATE contacts SET custom_fields = $1, updated_at = NOW() WHERE contact_id = $2 AND company_id = $3',
      [customFields, contactId, companyId]
    );

    res.json({
      success: true,
      data: {
        contact_id: contactId,
        eligible: Boolean(eligible),
        priority: parseInt(priority) || 5,
        notes: notes || null,
        updated_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error updating reactivation data:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Delete reactivation data
router.delete('/:companyId/reactivation/:contactId', async (req, res) => {
  try {
    const { companyId, contactId } = req.params;

    // Get current custom fields
    const result = await sqlDb.query(
      'SELECT custom_fields FROM contacts WHERE contact_id = $1 AND company_id = $2',
      [contactId, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found'
      });
    }

    // Remove reactivation data from custom fields
    const customFields = result.rows[0].custom_fields || {};
    if (customFields.analytics) {
      delete customFields.analytics.reactivation_eligible;
      delete customFields.analytics.reactivation_priority;
      delete customFields.analytics.reactivation_notes;
      delete customFields.analytics.reactivation_updated_at;
      
      // Update the contact
      await sqlDb.query(
        'UPDATE contacts SET custom_fields = $1, updated_at = NOW() WHERE contact_id = $2 AND company_id = $3',
        [customFields, contactId, companyId]
      );
    }

    res.json({
      success: true,
      message: 'Reactivation data removed successfully'
    });
  } catch (error) {
    console.error('Error deleting reactivation data:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
