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

// POST /api/attendance-events/confirm - Confirm attendance
router.post('/confirm', async (req, res) => {
  try {
    const { eventId, eventSlug, phoneNumber, confirmedAt } = req.body;
    
    // Validation
    if (!eventId || !eventSlug || !phoneNumber) {
      return res.status(422).json({
        success: false,
        error: 'eventId, eventSlug, and phoneNumber are required'
      });
    }
    
    // Verify event exists
    const eventQuery = 'SELECT id, company_id FROM events WHERE id = $1 AND slug = $2';
    const eventResult = await pool.query(eventQuery, [eventId, eventSlug]);
    
    if (eventResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Event not found'
      });
    }
    
    const companyId = eventResult.rows[0].company_id;
    
    // Check if attendance already confirmed
    const existingQuery = `
      SELECT id FROM attendance_records 
      WHERE event_id = $1 AND phone_number = $2
    `;
    const existingResult = await pool.query(existingQuery, [eventId, phoneNumber]);
    
    if (existingResult.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Attendance already confirmed for this phone number'
      });
    }
    
    // Insert attendance record
    const insertQuery = `
      INSERT INTO attendance_records (event_id, event_slug, phone_number, confirmed_at, company_id)
      VALUES ($1, $2, $3, $4, $5)
    `;
    
    await pool.query(insertQuery, [
      eventId,
      eventSlug,
      phoneNumber,
      confirmedAt || new Date().toISOString(),
      companyId
    ]);
    
    res.json({
      success: true
    });
  } catch (error) {
    console.error('Error confirming attendance:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to confirm attendance'
    });
  }
});

module.exports = router;
