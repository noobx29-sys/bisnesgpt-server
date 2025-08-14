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

// GET /api/attendance-records - Fetch all attendance records for a company
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
      FROM attendance_records 
      WHERE company_id = $1
    `;
    
    const countResult = await pool.query(countQuery, [company_id]);
    const total = parseInt(countResult.rows[0].total);
    
    // Get paginated results
    const query = `
      SELECT id, event_id, event_slug, phone_number, confirmed_at, company_id
      FROM attendance_records 
      WHERE company_id = $1 
      ORDER BY confirmed_at DESC
      LIMIT $2 OFFSET $3
    `;
    
    const result = await pool.query(query, [company_id, limitNum, offset]);
    
    res.json({
      success: true,
      attendance_records: result.rows,
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
    console.error('Error fetching attendance records:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch attendance records'
    });
  }
});

module.exports = router;
