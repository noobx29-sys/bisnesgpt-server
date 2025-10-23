const express = require('express');
const router = express.Router();
const sqlDb = require('../../db');

// Get all reactivation candidates for a company
router.get('/lead-analytics/:companyId/reactivation', async (req, res) => {
  try {
    const { companyId } = req.params;
    
    const query = `
      SELECT 
        c.id as contact_id,
        c.name,
        c.phone,
        c.email,
        r.eligible,
        r.priority,
        r.notes,
        r.last_updated
      FROM 
        contacts c
      LEFT JOIN 
        reactivation_candidates r ON c.id = r.contact_id
      WHERE 
        c.company_id = $1
        AND (r.eligible = true OR r.eligible IS NULL)
      ORDER BY 
        r.priority DESC NULLS LAST, 
        c.name
    `;
    
    const result = await sqlDb.query(query, [companyId]);
    
    res.json({
      success: true,
      candidates: result.rows
    });
  } catch (error) {
    console.error('Error fetching reactivation candidates:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reactivation candidates'
    });
  }
});

// Add or update a reactivation candidate
router.post('/lead-analytics/:companyId/reactivation', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { contactId, eligible, priority, notes } = req.body;

    if (!contactId) {
      return res.status(400).json({
        success: false,
        error: 'Contact ID is required'
      });
    }

    const query = `
      INSERT INTO reactivation_candidates 
        (contact_id, company_id, eligible, priority, notes)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (contact_id) 
      DO UPDATE SET
        eligible = EXCLUDED.eligible,
        priority = EXCLUDED.priority,
        notes = EXCLUDED.notes,
        last_updated = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const result = await sqlDb.query(query, [
      contactId,
      companyId,
      eligible || false,
      priority || 5,
      notes || ''
    ]);

    res.json({
      success: true,
      candidate: result.rows[0]
    });
  } catch (error) {
    console.error('Error saving reactivation candidate:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save reactivation candidate'
    });
  }
});

// Delete a reactivation candidate
router.delete('/lead-analytics/:companyId/reactivation/:contactId', async (req, res) => {
  try {
    const { companyId, contactId } = req.params;

    const query = `
      DELETE FROM reactivation_candidates
      WHERE contact_id = $1 AND company_id = $2
      RETURNING *
    `;

    const result = await sqlDb.query(query, [contactId, companyId]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Reactivation candidate not found'
      });
    }

    res.json({
      success: true,
      message: 'Reactivation candidate removed successfully'
    });
  } catch (error) {
    console.error('Error deleting reactivation candidate:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete reactivation candidate'
    });
  }
});

// Trigger reactivation for selected candidates
router.post('/lead-analytics/:companyId/reactivation/trigger', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { contactIds } = req.body;

    if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Contact IDs are required'
      });
    }

    // Update the last_contacted timestamp for the selected contacts
    const updateQuery = `
      UPDATE contacts
      SET last_contacted = CURRENT_TIMESTAMP
      WHERE id = ANY($1) AND company_id = $2
      RETURNING id, name, phone
    `;

    const result = await sqlDb.query(updateQuery, [contactIds, companyId]);

    // Here you would typically trigger the actual reactivation process
    // For example, send messages, update status, etc.

    res.json({
      success: true,
      message: `Reactivation triggered for ${result.rowCount} contacts`,
      contacts: result.rows
    });
  } catch (error) {
    console.error('Error triggering reactivation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to trigger reactivation'
    });
  }
});

module.exports = router;
