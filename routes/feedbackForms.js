const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');

// Create pool connection directly in this file
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 500,
  min: 5,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 10000,
  acquireTimeoutMillis: 30000,
  createTimeoutMillis: 10000,
  destroyTimeoutMillis: 5000,
  reapIntervalMillis: 1000,
  createRetryIntervalMillis: 100,
});

// GET /api/feedback-forms/{companyId} - Fetch all forms for a company
router.get('/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    
    const query = `
      SELECT id, title, slug, form_title, description, fields, company_id, created_by, created_at, updated_at
      FROM feedback_forms 
      WHERE company_id = $1 
      ORDER BY created_at DESC
    `;
    
    const result = await pool.query(query, [companyId]);
    
    res.json({
      success: true,
      forms: result.rows
    });
  } catch (error) {
    console.error('Error fetching feedback forms:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch feedback forms'
    });
  }
});

// POST /api/feedback-forms - Create a new feedback form
router.post('/', async (req, res) => {
  try {
    const { title, description, fields, companyId, createdBy } = req.body;
    const formId = uuidv4();
    
    // Generate URL-friendly form_title and slug
    const formTitle = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Remove multiple consecutive hyphens
      .trim();
    
    const query = `
      INSERT INTO feedback_forms (id, title, slug, form_title, description, fields, company_id, created_by, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING id
    `;
    
    const result = await pool.query(query, [
      formId,
      title,
      formTitle, // Use same value for both slug and form_title
      formTitle,
      description,
      JSON.stringify(fields),
      companyId,
      createdBy
    ]);
    
    res.json({
      success: true,
      formId: result.rows[0].id
    });
  } catch (error) {
    console.error('Error creating feedback form:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create feedback form'
    });
  }
});

// PUT /api/feedback-forms/{formId} - Update existing feedback form
router.put('/:formId', async (req, res) => {
  try {
    const { formId } = req.params;
    const { title, form_title, description, fields, companyId, createdBy, createdAt, isActive } = req.body;
    
    // Validation
    if (!title || !description || !fields || !Array.isArray(fields) || !companyId) {
      return res.status(422).json({
        success: false,
        error: 'Missing required fields: title, description, fields, and companyId are required'
      });
    }
    
    // Validate fields structure
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (!field.id || !field.type || !field.question || field.required === undefined) {
        return res.status(422).json({
          success: false,
          error: `Field ${i + 1} is missing required properties: id, type, question, or required`
        });
      }
      
      // Validate field types
      const validTypes = ['rating', 'multiple-choice', 'text', 'yes-no'];
      if (!validTypes.includes(field.type)) {
        return res.status(422).json({
          success: false,
          error: `Field ${i + 1} has invalid type. Must be one of: ${validTypes.join(', ')}`
        });
      }
      
      // Validate multiple-choice fields have options
      if (field.type === 'multiple-choice' && (!field.options || !Array.isArray(field.options) || field.options.length === 0)) {
        return res.status(422).json({
          success: false,
          error: `Field ${i + 1} (multiple-choice) must have options array`
        });
      }
      
      // Validate rating fields have ratingScale
      if (field.type === 'rating' && (!field.ratingScale || ![3, 5, 10].includes(field.ratingScale))) {
        return res.status(422).json({
          success: false,
          error: `Field ${i + 1} (rating) must have ratingScale of 3, 5, or 10`
        });
      }
    }
    
    // Check if form exists and belongs to company
    const formCheck = await pool.query(
      'SELECT id FROM feedback_forms WHERE id = $1 AND company_id = $2',
      [formId, companyId]
    );
    
    if (formCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Form not found or access denied'
      });
    }
    
    // Generate form_title if not provided
    let finalFormTitle = form_title;
    if (!finalFormTitle) {
      finalFormTitle = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-') // Remove multiple consecutive hyphens
        .trim();
    }
    
    // Build update query dynamically
    const updateFields = [];
    const values = [];
    let paramCount = 1;
    
    updateFields.push(`title = $${paramCount++}`);
    values.push(title);
    
    updateFields.push(`slug = $${paramCount++}`);
    values.push(finalFormTitle);
    
    updateFields.push(`form_title = $${paramCount++}`);
    values.push(finalFormTitle);
    
    updateFields.push(`description = $${paramCount++}`);
    values.push(description);
    
    updateFields.push(`fields = $${paramCount++}`);
    values.push(JSON.stringify(fields));
    
    if (isActive !== undefined) {
      updateFields.push(`is_active = $${paramCount++}`);
      values.push(isActive);
    }
    
    updateFields.push(`updated_at = NOW()`);
    values.push(formId);
    values.push(companyId);
    
    // Update the form
    const updateQuery = `
      UPDATE feedback_forms 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount} AND company_id = $${paramCount + 1}
      RETURNING *
    `;
    
    const result = await pool.query(updateQuery, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Form not found or access denied'
      });
    }
    
    const updatedForm = result.rows[0];
    
    // Parse fields if they're stored as string
    if (typeof updatedForm.fields === 'string') {
      updatedForm.fields = JSON.parse(updatedForm.fields);
    }
    
    res.json({
      success: true,
      message: 'Form updated successfully',
      form: updatedForm
    });
  } catch (error) {
    console.error('Error updating feedback form:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update feedback form'
    });
  }
});

// DELETE /api/feedback-forms/{formId} - Delete a feedback form
router.delete('/:formId', async (req, res) => {
  try {
    const { formId } = req.params;
    
    // First delete all responses for this form
    await pool.query('DELETE FROM feedback_responses WHERE form_id = $1', [formId]);
    
    // Then delete the form
    const result = await pool.query('DELETE FROM feedback_forms WHERE id = $1 RETURNING id', [formId]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Form not found'
      });
    }
    
    res.json({
      success: true
    });
  } catch (error) {
    console.error('Error deleting feedback form:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete feedback form'
    });
  }
});

// GET /api/feedback-forms/public/{formTitle} - Get form data for public access
router.get('/public/:formTitle', async (req, res) => {
  try {
    const { formTitle } = req.params;
    
    const query = `
      SELECT id, title, slug, form_title, description, fields, created_at
      FROM feedback_forms 
      WHERE form_title = $1
    `;
    
    const result = await pool.query(query, [formTitle]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Form not found'
      });
    }
    
    const form = result.rows[0];
    
    // Check if fields is already an object or needs parsing
    if (typeof form.fields === 'string') {
      form.fields = JSON.parse(form.fields);
    }
    // If it's already an object, no need to parse
    
    res.json({
      success: true,
      form
    });
  } catch (error) {
    console.error('Error fetching public form:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch form'
    });
  }
});

// POST /api/feedback-forms/submit - Submit a form response (Updated for data import)
router.post('/submit', async (req, res) => {
  try {
    const { formId, formTitle, phoneNumber, responses, submittedAt } = req.body;
    
    // Validation
    if (!formId || !phoneNumber || !responses || !Array.isArray(responses)) {
      return res.status(422).json({
        success: false,
        error: 'formId, phoneNumber, and responses array are required'
      });
    }
    
    // Verify form exists
    const formCheck = await pool.query('SELECT id FROM feedback_forms WHERE id = $1', [formId]);
    
    if (formCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Form not found'
      });
    }
    
    // Check if user already submitted this form
    const existingResponse = await pool.query(
      'SELECT id FROM feedback_responses WHERE form_id = $1 AND phone_number = $2',
      [formId, phoneNumber]
    );
    
    if (existingResponse.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'You have already submitted this form'
      });
    }
    
    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Insert the main response
      const responseId = uuidv4();
      const insertResponseQuery = `
      INSERT INTO feedback_responses (form_id, phone_number, responses, submitted_at, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id
    `;
      
    const responseResult = await client.query(insertResponseQuery, [
      formId,
      phoneNumber,
      JSON.stringify(responses), // Store all responses as JSON
      submittedAt || new Date().toISOString()
    ]);
    
 
      
      await client.query('COMMIT');
      
      res.json({
        success: true,
        message: 'Feedback submitted successfully',
        submissionId: responseId
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error submitting feedback form:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit feedback form'
    });
  }
});

module.exports = router;