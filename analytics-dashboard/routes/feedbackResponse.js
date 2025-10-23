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
    
    // Get all feedback responses with form data and parse the JSON responses
    // Use a safer query that doesn't depend on feedback_forms table existing
    const responsesQuery = `
      SELECT 
        fr.id,
        fr.form_id,
        fr.phone_number,
        fr.responses,
        fr.submitted_at,
        fr.created_at,
        COALESCE(ff.title, 'Unknown Form') as form_title
      FROM feedback_responses fr
      LEFT JOIN feedback_forms ff ON fr.form_id = ff.id
      ORDER BY fr.created_at DESC
    `;
    
    const responsesResult = await pool.query(responsesQuery);
    
    // Process the responses - parse JSON and format them
    const feedbackResponses = responsesResult.rows.map(response => {
      let parsedResponses = [];
      
      try {
        // Parse the JSON responses if they exist
        if (response.responses && typeof response.responses === 'string') {
          parsedResponses = JSON.parse(response.responses);
        } else if (response.responses && Array.isArray(response.responses)) {
          parsedResponses = response.responses;
        }
      } catch (parseError) {
        console.warn(`Failed to parse responses for response ID ${response.id}:`, parseError);
        parsedResponses = [];
      }
      
      return {
        id: response.id,
        form_id: response.form_id,
        phone_number: response.phone_number,
        submitted_at: response.submitted_at,
        created_at: response.created_at,
        form_title: response.form_title,
        responses: parsedResponses
      };
    });
    
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
        fr.responses,
        fr.submitted_at,
        fr.created_at,
        COALESCE(ff.title, 'Unknown Form') as form_title
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
    
    const response = responseResult.rows[0];
    
    // Parse the JSON responses
    let parsedResponses = [];
    
    try {
      if (response.responses && typeof response.responses === 'string') {
        parsedResponses = JSON.parse(response.responses);
      } else if (response.responses && Array.isArray(response.responses)) {
        parsedResponses = response.responses;
      }
    } catch (parseError) {
      console.warn(`Failed to parse responses for response ID ${response.id}:`, parseError);
      parsedResponses = [];
    }
    
    res.json({
      success: true,
      feedbackResponse: {
        id: response.id,
        form_id: response.form_id,
        phone_number: response.phone_number,
        submitted_at: response.submitted_at,
        created_at: response.created_at,
        form_title: response.form_title,
        responses: parsedResponses
      }
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
    
    // Get all responses for the specific form
    const responsesQuery = `
      SELECT 
        fr.id,
        fr.form_id,
        fr.phone_number,
        fr.responses,
        fr.submitted_at,
        fr.created_at,
        COALESCE(ff.title, 'Unknown Form') as form_title
      FROM feedback_responses fr
      LEFT JOIN feedback_forms ff ON fr.form_id = ff.id
      WHERE fr.form_id = $1
      ORDER BY fr.created_at DESC
    `;
    
    const responsesResult = await pool.query(responsesQuery, [formId]);
    
    // Process the responses - parse JSON and format them
    const feedbackResponses = responsesResult.rows.map(response => {
      let parsedResponses = [];
      
      try {
        if (response.responses && typeof response.responses === 'string') {
          parsedResponses = JSON.parse(response.responses);
        } else if (response.responses && Array.isArray(response.responses)) {
          parsedResponses = response.responses;
        }
      } catch (parseError) {
        console.warn(`Failed to parse responses for response ID ${response.id}:`, parseError);
        parsedResponses = [];
      }
      
      return {
        id: response.id,
        form_id: response.form_id,
        phone_number: response.phone_number,
        submitted_at: response.submitted_at,
        created_at: response.created_at,
        form_title: response.form_title,
        responses: parsedResponses
      };
    });
    
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

// POST /api/feedback-responses - Create a new feedback response
router.post('/', async (req, res) => {
  try {
    const { form_id, phone_number, responses } = req.body;
    
    if (!form_id || !phone_number || !responses) {
      return res.status(422).json({
        success: false,
        error: 'form_id, phone_number, and responses are required'
      });
    }
    
    // Insert the feedback response
    const insertQuery = `
      INSERT INTO feedback_responses (form_id, phone_number, responses, submitted_at, created_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `;
    
    const result = await pool.query(insertQuery, [form_id, phone_number, JSON.stringify(responses)]);
    
    res.status(201).json({
      success: true,
      feedbackResponse: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating feedback response:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create feedback response'
    });
  }
});

// PUT /api/feedback-responses/{id} - Update a feedback response
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { responses } = req.body;
    
    if (!responses) {
      return res.status(422).json({
        success: false,
        error: 'responses is required'
      });
    }
    
    // Update the feedback response
    const updateQuery = `
      UPDATE feedback_responses 
      SET responses = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    
    const result = await pool.query(updateQuery, [JSON.stringify(responses), id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Feedback response not found'
      });
    }
    
    res.json({
      success: true,
      feedbackResponse: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating feedback response:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update feedback response'
    });
  }
});

// DELETE /api/feedback-responses/{id} - Delete a feedback response
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const deleteQuery = 'DELETE FROM feedback_responses WHERE id = $1 RETURNING *';
    const result = await pool.query(deleteQuery, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Feedback response not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Feedback response deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting feedback response:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete feedback response'
    });
  }
});

module.exports = router;
