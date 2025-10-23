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

// Add debugging for database connection
console.log('🔌 [PARTICIPANTS] Database pool created');
console.log('🔌 [PARTICIPANTS] DATABASE_URL set:', !!process.env.DATABASE_URL);
if (process.env.DATABASE_URL) {
  const url = new URL(process.env.DATABASE_URL);
  console.log('🔌 [PARTICIPANTS] Database host:', url.hostname);
  console.log('🔌 [PARTICIPANTS] Database name:', url.pathname.substring(1));
}

// Test database connection
pool.query('SELECT NOW() as current_time')
  .then(result => {
    console.log('✅ [PARTICIPANTS] Database connection test successful:', result.rows[0]);
  })
  .catch(error => {
    console.error('❌ [PARTICIPANTS] Database connection test failed:', error);
  });

// GET /api/participants - List all participants (paginated)
router.get('/', async (req, res) => {
  try {
    const { company_id, page = 1, limit, page_size } = req.query;
    
    // Handle both 'limit' and 'page_size' parameters for compatibility
    const actualLimit = limit || page_size || 20;
    
    console.log(`🔍 [PARTICIPANTS API] Request: company_id=${company_id}, page=${page}, limit=${actualLimit}`);
    
    if (!company_id) {
      console.log('❌ [PARTICIPANTS API] Missing company_id parameter');
      return res.status(422).json({
        success: false,
        error: 'company_id is required'
      });
    }
    
    const offset = (page - 1) * actualLimit;
    
    const query = `
      SELECT p.*, e.name as enrollee_name, e.email as enrollee_email, 
             e.mobile_number as enrollee_mobile, ev.name as event_name, ev.slug as event_slug
      FROM participants p
      LEFT JOIN enrollees e ON p.enrollee_id = e.id
      LEFT JOIN events ev ON p.event_id = ev.id
      WHERE p.company_id = $1 
      ORDER BY p.created_at DESC
      LIMIT $2 OFFSET $3
    `;
    
    const countQuery = `
      SELECT COUNT(*) as total FROM participants WHERE company_id = $1
    `;
    
    const [result, countResult] = await Promise.all([
      pool.query(query, [company_id, actualLimit, offset]),
      pool.query(countQuery, [company_id])
    ]);
    
    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / actualLimit);
    
    console.log(`✅ [PARTICIPANTS API] Response: ${result.rows.length} participants, total: ${total}, pages: ${totalPages}`);
    
    res.json({
      success: true,
      participants: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(actualLimit),
        total,
        totalPages
      }
    });
  } catch (error) {
    console.error('❌ [PARTICIPANTS API] Error fetching participants:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch participants',
      details: error.message
    });
  }
});

// GET /api/participants/{id} - Get participant by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `
      SELECT p.*, e.name as enrollee_name, e.email as enrollee_email, 
             ev.name as event_name, ev.slug as event_slug
      FROM participants p
      LEFT JOIN enrollees e ON p.enrollee_id = e.id
      LEFT JOIN events ev ON p.event_id = ev.id
      WHERE p.id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Participant not found'
      });
    }
    
    res.json({
      success: true,
      participant: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching participant:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch participant'
    });
  }
});

// GET /api/participants/mobile/{mobile_number} - Get latest participant by mobile number
router.get('/mobile/:mobile_number', async (req, res) => {
  try {
    const { mobile_number } = req.params;
    
    const query = `
      SELECT p.*, e.name as enrollee_name, e.email as enrollee_email, 
             ev.name as event_name, ev.slug as event_slug
      FROM participants p
      LEFT JOIN enrollees e ON p.enrollee_id = e.id
      LEFT JOIN events ev ON p.event_id = ev.id
      WHERE e.mobile_number = $1
      ORDER BY p.created_at DESC
      LIMIT 1
    `;
    
    const result = await pool.query(query, [mobile_number]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Participant not found'
      });
    }
    
    res.json({
      success: true,
      participant: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching participant by mobile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch participant'
    });
  }
});

// POST /api/participants - Create new participant
router.post('/', async (req, res) => {
  try {
    const {
      enrollee_id, event_id, reference_number, payment_status_id,
      is_attended, remarks, company_id
    } = req.body;
    
    // Validation
    if (!enrollee_id || !event_id || !company_id) {
      return res.status(422).json({
        success: false,
        error: 'enrollee_id, event_id, and company_id are required'
      });
    }
    
    // Verify enrollee exists
    const enrolleeCheck = await pool.query('SELECT id FROM enrollees WHERE id = $1', [enrollee_id]);
    if (enrolleeCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Enrollee not found'
      });
    }
    
    // Verify event exists
    const eventCheck = await pool.query('SELECT id FROM events WHERE id = $1', [event_id]);
    if (eventCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Event not found'
      });
    }
    
    const participantId = uuidv4();
    
    const query = `
      INSERT INTO participants (
        id, enrollee_id, event_id, reference_number, payment_status_id,
        is_attended, remarks, company_id, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING id
    `;
    
    const result = await pool.query(query, [
      participantId, enrollee_id, event_id, reference_number, payment_status_id,
      is_attended, remarks, company_id
    ]);
    
    res.status(201).json({
      success: true,
      participantId: result.rows[0].id
    });
  } catch (error) {
    console.error('Error creating participant:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create participant'
    });
  }
});

// PUT /api/participants/{id} - Update participant
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      reference_number, enrollee_id, event_id, fee_id, payment_date,
      payment_status_id, cheque_number, amount_paid, payment_mode_id,
      pst, payment_mode, receipt_number, is_attended, tshirt_size,
      remarks, empno
    } = req.body;
    
    // Check if participant exists
    const checkQuery = 'SELECT id FROM participants WHERE id = $1';
    const checkResult = await pool.query(checkQuery, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Participant not found'
      });
    }
    
    // Build update query dynamically
    const updateFields = [];
    const values = [];
    let paramCount = 1;
    
    if (reference_number !== undefined) {
      updateFields.push(`reference_number = $${paramCount++}`);
      values.push(reference_number);
    }
    if (enrollee_id !== undefined) {
      updateFields.push(`enrollee_id = $${paramCount++}`);
      values.push(enrollee_id);
    }
    if (event_id !== undefined) {
      updateFields.push(`event_id = $${paramCount++}`);
      values.push(event_id);
    }
    if (fee_id !== undefined) {
      updateFields.push(`fee_id = $${paramCount++}`);
      values.push(fee_id);
    }
    if (payment_date !== undefined) {
      updateFields.push(`payment_date = $${paramCount++}`);
      values.push(payment_date);
    }
    if (payment_status_id !== undefined) {
      updateFields.push(`payment_status_id = $${paramCount++}`);
      values.push(payment_status_id);
    }
    if (cheque_number !== undefined) {
      updateFields.push(`cheque_number = $${paramCount++}`);
      values.push(cheque_number);
    }
    if (amount_paid !== undefined) {
      updateFields.push(`amount_paid = $${paramCount++}`);
      values.push(amount_paid);
    }
    if (payment_mode_id !== undefined) {
      updateFields.push(`payment_mode_id = $${paramCount++}`);
      values.push(payment_mode_id);
    }
    if (pst !== undefined) {
      updateFields.push(`pst = $${paramCount++}`);
      values.push(pst);
    }
    if (payment_mode !== undefined) {
      updateFields.push(`payment_mode = $${paramCount++}`);
      values.push(payment_mode);
    }
    if (receipt_number !== undefined) {
      updateFields.push(`receipt_number = $${paramCount++}`);
      values.push(receipt_number);
    }
    if (is_attended !== undefined) {
      updateFields.push(`is_attended = $${paramCount++}`);
      values.push(is_attended);
    }
    if (tshirt_size !== undefined) {
      updateFields.push(`tshirt_size = $${paramCount++}`);
      values.push(tshirt_size);
    }
    if (remarks !== undefined) {
      updateFields.push(`remarks = $${paramCount++}`);
      values.push(remarks);
    }
    if (empno !== undefined) {
      updateFields.push(`empno = $${paramCount++}`);
      values.push(empno);
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
      UPDATE participants 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;
    
    const result = await pool.query(query, values);
    
    res.json({
      success: true,
      participant: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating participant:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update participant'
    });
  }
});

module.exports = router;