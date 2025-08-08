const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

// Create pool connection
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

// GET /api/feedback-responses - Retrieve all feedback responses with form data
router.get('/', async (req, res) => {
  try {
    const { company_id } = req.query;
    
    if (!company_id) {
      return res.status(422).json({
        success: false,
        error: 'company_id is required'
      });
    }
    
    // First get all feedback responses with form data
    const responsesQuery = `
      SELECT 
        fr.id,
        fr.form_id,
        fr.phone_number,
        fr.submitted_at,
        fr.created_at,
        ff.title as form_title
      FROM feedback_responses fr
      LEFT JOIN feedback_forms ff ON fr.form_id = ff.id
      WHERE ff.company_id = $1
      ORDER BY fr.created_at DESC
    `;
    
    const responsesResult = await pool.query(responsesQuery, [company_id]);
    
    // For each response, get the individual field responses
    const feedbackResponses = [];
    
    for (const response of responsesResult.rows) {
      const fieldsQuery = `
        SELECT 
          id,
          field_id,
          question,
          answer
        FROM feedback_response_fields
        WHERE response_id = $1
        ORDER BY created_at ASC
      `;
      
      const fieldsResult = await pool.query(fieldsQuery, [response.id]);
      
      feedbackResponses.push({
        id: response.id,
        form_id: response.form_id,
        phone_number: response.phone_number,
        submitted_at: response.submitted_at,
        created_at: response.created_at,
        form_title: response.form_title,
        responses: fieldsResult.rows
      });
    }
    
    res.json({
      success: true,
      feedbackResponses
    });
  } catch (error) {
    console.error('Error fetching feedback responses:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch feedback responses'
    });
  }
});

// GET /api/feedback-responses/{id} - Get specific feedback response
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get the main response
    const responseQuery = `
      SELECT 
        fr.id,
        fr.form_id,
        fr.phone_number,
        fr.submitted_at,
        fr.created_at,
        ff.title as form_title
      FROM feedback_responses fr
      LEFT JOIN feedback_forms ff ON fr.form_id = ff.id
      WHERE fr.id = $1
    `;
    
    const responseResult = await pool.query(responseQuery, [id]);
    
    if (responseResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Feedback response not found'
      });
    }
    
    // Get the field responses
    const fieldsQuery = `
      SELECT 
        id,
        field_id,
        question,
        answer
      FROM feedback_response_fields
      WHERE response_id = $1
      ORDER BY created_at ASC
    `;
    
    const fieldsResult = await pool.query(fieldsQuery, [id]);
    
    const feedbackResponse = {
      ...responseResult.rows[0],
      responses: fieldsResult.rows
    };
    
    res.json({
      success: true,
      feedbackResponse
    });
  } catch (error) {
    console.error('Error fetching feedback response:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch feedback response'
    });
  }
});

// GET /api/feedback-responses/form/{formId} - Get all responses for a specific form
router.get('/form/:formId', async (req, res) => {
  try {
    const { formId } = req.params;
    
    // Get all responses for this form
    const responsesQuery = `
      SELECT 
        fr.id,
        fr.form_id,
        fr.phone_number,
        fr.submitted_at,
        fr.created_at,
        ff.title as form_title
      FROM feedback_responses fr
      LEFT JOIN feedback_forms ff ON fr.form_id = ff.id
      WHERE fr.form_id = $1
      ORDER BY fr.created_at DESC
    `;
    
    const responsesResult = await pool.query(responsesQuery, [formId]);
    
    // For each response, get the individual field responses
    const feedbackResponses = [];
    
    for (const response of responsesResult.rows) {
      const fieldsQuery = `
        SELECT 
          id,
          field_id,
          question,
          answer
        FROM feedback_response_fields
        WHERE response_id = $1
        ORDER BY created_at ASC
      `;
      
      const fieldsResult = await pool.query(fieldsQuery, [response.id]);
      
      feedbackResponses.push({
        id: response.id,
        form_id: response.form_id,
        phone_number: response.phone_number,
        submitted_at: response.submitted_at,
        created_at: response.created_at,
        form_title: response.form_title,
        responses: fieldsResult.rows
      });
    }
    
    res.json({
      success: true,
      feedbackResponses
    });
  } catch (error) {
    console.error('Error fetching form feedback responses:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch form feedback responses'
    });
  }
});

module.exports = router;
