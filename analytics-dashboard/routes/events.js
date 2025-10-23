const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
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

// GET /api/events - List all events for a company
router.get('/', async (req, res) => {
  try {
    const { company_id, page = 1, limit = 100 } = req.query;
    
    if (!company_id) {
      return res.status(422).json({
        success: false,
        error: 'company_id is required'
      });
    }
    
    // Validate pagination parameters
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    
    if (pageNum < 1 || limitNum < 1 || limitNum > 1000) {
      return res.status(422).json({
        success: false,
        error: 'Invalid pagination parameters. page must be >= 1, limit must be between 1 and 1000'
      });
    }
    
    const offset = (pageNum - 1) * limitNum;
    
    // Get total count for pagination info
    const countQuery = `
      SELECT COUNT(*) as total
      FROM events 
      WHERE company_id = $1
    `;
    
    const countResult = await pool.query(countQuery, [company_id]);
    const total = parseInt(countResult.rows[0].total);
    
    // Get paginated results
    const query = `
      SELECT 
        id, name, slug, description, start_date, end_date,
        start_time, end_time, location, company_id, created_at
      FROM events 
      WHERE company_id = $1 
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
    
    const result = await pool.query(query, [company_id, limitNum, offset]);
    
    res.json({
      success: true,
      events: result.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        total_pages: Math.ceil(total / limitNum),
        has_next: pageNum < Math.ceil(total / limitNum),
        has_prev: pageNum > 1
      }
    });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch events'
    });
  }
});

// GET /api/events/{id} - Get event by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = 'SELECT * FROM events WHERE id = $1';
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Event not found'
      });
    }
    
    res.json({
      success: true,
      event: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching event:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch event'
    });
  }
});

// POST /api/events - Create new event
router.post('/', async (req, res) => {
  try {
    const {
      name, slug, description, short_description, start_date, end_date,
      start_time, end_time, location, city, state_id, country_id,
      company_id, created_by
    } = req.body;
    
    // Validation
    if (!name || !slug || !start_date || !end_date || !company_id || !created_by) {
      return res.status(422).json({
        success: false,
        error: 'name, slug, start_date, end_date, company_id, and created_by are required'
      });
    }
    
    const eventId = uuidv4();
    
    const query = `
      INSERT INTO events (
        id, name, slug, description, short_description, start_date, end_date,
        start_time, end_time, location, city, state_id, country_id,
        company_id, created_by, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
      RETURNING id
    `;
    
    const result = await pool.query(query, [
      eventId, name, slug, description, short_description, start_date, end_date,
      start_time, end_time, location, city, state_id, country_id,
      company_id, created_by
    ]);
    
    res.status(201).json({
      success: true,
      eventId: result.rows[0].id
    });
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create event'
    });
  }
});

// PUT /api/events/{id} - Update event
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, slug, description, short_description, start_date, end_date,
      start_time, end_time, location, city, state_id, country_id,
      is_active
    } = req.body;
    
    // Check if event exists
    const checkQuery = 'SELECT id FROM events WHERE id = $1';
    const checkResult = await pool.query(checkQuery, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Event not found'
      });
    }
    
    // Build update query dynamically
    const updateFields = [];
    const values = [];
    let paramCount = 1;
    
    if (name !== undefined) {
      updateFields.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (slug !== undefined) {
      updateFields.push(`slug = $${paramCount++}`);
      values.push(slug);
    }
    if (description !== undefined) {
      updateFields.push(`description = $${paramCount++}`);
      values.push(description);
    }
    if (short_description !== undefined) {
      updateFields.push(`short_description = $${paramCount++}`);
      values.push(short_description);
    }
    if (start_date !== undefined) {
      updateFields.push(`start_date = $${paramCount++}`);
      values.push(start_date);
    }
    if (end_date !== undefined) {
      updateFields.push(`end_date = $${paramCount++}`);
      values.push(end_date);
    }
    if (start_time !== undefined) {
      updateFields.push(`start_time = $${paramCount++}`);
      values.push(start_time);
    }
    if (end_time !== undefined) {
      updateFields.push(`end_time = $${paramCount++}`);
      values.push(end_time);
    }
    if (location !== undefined) {
      updateFields.push(`location = $${paramCount++}`);
      values.push(location);
    }
    if (city !== undefined) {
      updateFields.push(`city = $${paramCount++}`);
      values.push(city);
    }
    if (state_id !== undefined) {
      updateFields.push(`state_id = $${paramCount++}`);
      values.push(state_id);
    }
    if (country_id !== undefined) {
      updateFields.push(`country_id = $${paramCount++}`);
      values.push(country_id);
    }
    if (is_active !== undefined) {
      updateFields.push(`is_active = $${paramCount++}`);
      values.push(is_active);
    }
    
    if (updateFields.length === 0) {
      return res.status(422).json({
        success: false,
        error: 'No fields to update'
      });
    }
    
    updateFields.push(`updated_at = NOW()`);
    values.push(id);
    
    const query = `
      UPDATE events 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;
    
    const result = await pool.query(query, values);
    
    res.json({
      success: true,
      event: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating event:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update event'
    });
  }
});

// DELETE /api/events/{id} - Delete event
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if event exists
    const checkQuery = 'SELECT id FROM events WHERE id = $1';
    const checkResult = await pool.query(checkQuery, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Event not found'
      });
    }
    
    // Delete event (participants will be deleted due to CASCADE)
    await pool.query('DELETE FROM events WHERE id = $1', [id]);
    
    res.json({
      success: true
    });
  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete event'
    });
  }
});

// GET /api/events/public/{slug} - Get public event data
router.get('/public/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    
    const query = `
      SELECT id, name, slug, description, short_description, start_date, end_date,
             start_time, end_time, location, city, state_id, country_id, is_active
      FROM events 
      WHERE slug = $1 AND is_active = true
    `;
    
    const result = await pool.query(query, [slug]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Event not found'
      });
    }
    
    res.json({
      success: true,
      event: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching public event:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch event'
    });
  }
});

module.exports = router;