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

// GET /api/enrollees - List all enrollees (paginated)
router.get('/', async (req, res) => {
  try {
    const { company_id, page = 1, limit = 20 } = req.query;
    
    if (!company_id) {
      return res.status(422).json({
        success: false,
        error: 'company_id is required'
      });
    }
    
    const offset = (page - 1) * limit;
    
    const query = `
      SELECT * FROM enrollees 
      WHERE company_id = $1 
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
    
    const countQuery = `
      SELECT COUNT(*) as total FROM enrollees WHERE company_id = $1
    `;
    
    const [result, countResult] = await Promise.all([
      pool.query(query, [company_id, limit, offset]),
      pool.query(countQuery, [company_id])
    ]);
    
    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);
    
    res.json({
      success: true,
      enrollees: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages
      }
    });
  } catch (error) {
    console.error('Error fetching enrollees:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch enrollees'
    });
  }
});

// GET /api/enrollees/{id} - Get enrollee by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = 'SELECT * FROM enrollees WHERE id = $1';
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Enrollee not found'
      });
    }
    
    res.json({
      success: true,
      enrollee: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching enrollee:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch enrollee'
    });
  }
});

// POST /api/enrollees - Create new enrollee
router.post('/', async (req, res) => {
  try {
    const {
      email, name, designation, organisation, website, business_nature,
      address, office_number, mobile_number, fax_number, is_vegetarian, company_id
    } = req.body;
    
    // Validation
    if (!email || !name || !mobile_number || !company_id) {
      return res.status(422).json({
        success: false,
        error: 'email, name, mobile_number, and company_id are required'
      });
    }
    
    // Check if enrollee already exists by email or mobile number
    const checkQuery = `
      SELECT * FROM enrollees 
      WHERE (email = $1 OR mobile_number = $2) 
      AND company_id = $3
    `;
    const checkResult = await pool.query(checkQuery, [email, mobile_number, company_id]);
    
    if (checkResult.rows.length > 0) {
      // Update existing enrollee
      const existingEnrollee = checkResult.rows[0];
      
      // Check if we're trying to change the email to one that already exists for a different enrollee
      if (email !== existingEnrollee.email) {
        const emailCheckQuery = `
          SELECT id FROM enrollees 
          WHERE email = $1 AND company_id = $2 AND id != $3
        `;
        const emailCheckResult = await pool.query(emailCheckQuery, [email, company_id, existingEnrollee.id]);
        
        if (emailCheckResult.rows.length > 0) {
          return res.status(409).json({
            success: false,
            error: 'An account with this email already exists'
          });
        }
      }
      
      const updateQuery = `
        UPDATE enrollees 
        SET email = $1, name = $2, designation = $3, organisation = $4, website = $5,
            business_nature = $6, address = $7, office_number = $8, 
            mobile_number = $9, fax_number = $10, is_vegetarian = $11,
            updated_at = NOW()
        WHERE id = $12
        RETURNING id
      `;
      
      const result = await pool.query(updateQuery, [
        email, name, designation, organisation, website, business_nature,
        address, office_number, mobile_number, fax_number, is_vegetarian,
        existingEnrollee.id
      ]);
      
      res.json({
        success: true,
        enrolleeId: result.rows[0].id,
        message: 'Enrollee updated successfully'
      });
    } else {
      // Create new enrollee
      const enrolleeId = uuidv4();
      
      const query = `
        INSERT INTO enrollees (
          id, email, name, designation, organisation, website, business_nature,
          address, office_number, mobile_number, fax_number, is_vegetarian,
          company_id, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
        RETURNING id
      `;
      
      const result = await pool.query(query, [
        enrolleeId, email, name, designation, organisation, website, business_nature,
        address, office_number, mobile_number, fax_number, is_vegetarian, company_id
      ]);
      
      res.status(201).json({
        success: true,
        enrolleeId: result.rows[0].id,
        message: 'Enrollee created successfully'
      });
    }
  } catch (error) {
    console.error('Error creating/updating enrollee:', error);
    
    // Handle specific database errors
    if (error.code === '23505') {
      // Unique constraint violation
      if (error.constraint === 'enrollees_email_key') {
        return res.status(409).json({
          success: false,
          error: 'An account with this email already exists'
        });
      }
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to create/update enrollee'
    });
  }
});

// PUT /api/enrollees/{id} - Update enrollee
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      email, name, designation, organisation, website, business_nature,
      address, office_number, mobile_number, fax_number, is_vegetarian
    } = req.body;
    
    // Check if enrollee exists
    const checkQuery = 'SELECT id FROM enrollees WHERE id = $1';
    const checkResult = await pool.query(checkQuery, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Enrollee not found'
      });
    }
    
    // Build update query dynamically
    const updateFields = [];
    const values = [];
    let paramCount = 1;
    
    if (email !== undefined) {
      updateFields.push(`email = $${paramCount++}`);
      values.push(email);
    }
    if (name !== undefined) {
      updateFields.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (designation !== undefined) {
      updateFields.push(`designation = $${paramCount++}`);
      values.push(designation);
    }
    if (organisation !== undefined) {
      updateFields.push(`organisation = $${paramCount++}`);
      values.push(organisation);
    }
    if (website !== undefined) {
      updateFields.push(`website = $${paramCount++}`);
      values.push(website);
    }
    if (business_nature !== undefined) {
      updateFields.push(`business_nature = $${paramCount++}`);
      values.push(business_nature);
    }
    if (address !== undefined) {
      updateFields.push(`address = $${paramCount++}`);
      values.push(address);
    }
    if (office_number !== undefined) {
      updateFields.push(`office_number = $${paramCount++}`);
      values.push(office_number);
    }
    if (mobile_number !== undefined) {
      updateFields.push(`mobile_number = $${paramCount++}`);
      values.push(mobile_number);
    }
    if (fax_number !== undefined) {
      updateFields.push(`fax_number = $${paramCount++}`);
      values.push(fax_number);
    }
    if (is_vegetarian !== undefined) {
      updateFields.push(`is_vegetarian = $${paramCount++}`);
      values.push(is_vegetarian);
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
      UPDATE enrollees 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;
    
    const result = await pool.query(query, values);
    
    res.json({
      success: true,
      enrollee: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating enrollee:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update enrollee'
    });
  }
});

// POST /api/enrollees/mobile/{mobile_number} - Upsert enrollee by mobile number
router.post('/mobile/:mobile_number', async (req, res) => {
  try {
    const { mobile_number } = req.params;
    const {
      email, name, designation, organisation, website, business_nature,
      address, office_number, fax_number, is_vegetarian, company_id
    } = req.body;
    
    // Validation
    if (!name || !company_id) {
      return res.status(422).json({
        success: false,
        error: 'name and company_id are required'
      });
    }
    
    // Check if enrollee exists
    const checkQuery = 'SELECT * FROM enrollees WHERE mobile_number = $1';
    const checkResult = await pool.query(checkQuery, [mobile_number]);
    
    if (checkResult.rows.length > 0) {
      // Update existing enrollee
      const updateQuery = `
        UPDATE enrollees 
        SET email = $1, name = $2, designation = $3, organisation = $4, website = $5,
            business_nature = $6, address = $7, office_number = $8, fax_number = $9,
            is_vegetarian = $10, updated_at = NOW()
        WHERE mobile_number = $11
        RETURNING *
      `;
      
      const result = await pool.query(updateQuery, [
        email, name, designation, organisation, website, business_nature,
        address, office_number, fax_number, is_vegetarian, mobile_number
      ]);
      
      res.json({
        success: true,
        enrollee: result.rows[0]
      });
    } else {
      // Create new enrollee
      const enrolleeId = uuidv4();
      
      const insertQuery = `
        INSERT INTO enrollees (
          id, email, name, designation, organisation, website, business_nature,
          address, office_number, mobile_number, fax_number, is_vegetarian,
          company_id, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
        RETURNING *
      `;
      
      const result = await pool.query(insertQuery, [
        enrolleeId, email, name, designation, organisation, website, business_nature,
        address, office_number, mobile_number, fax_number, is_vegetarian, company_id
      ]);
      
      res.status(201).json({
        success: true,
        enrollee: result.rows[0]
      });
    }
  } catch (error) {
    console.error('Error upserting enrollee by mobile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upsert enrollee'
    });
  }
});

// POST /api/enrollees/email/{email} - Upsert enrollee by email
router.post('/email/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const {
      name, designation, organisation, website, business_nature,
      address, office_number, mobile_number, fax_number, is_vegetarian, company_id
    } = req.body;
    
    // Validation
    if (!name || !mobile_number || !company_id) {
      return res.status(422).json({
        success: false,
        error: 'name, mobile_number, and company_id are required'
      });
    }
    
    // Check if enrollee exists
    const checkQuery = 'SELECT * FROM enrollees WHERE email = $1';
    const checkResult = await pool.query(checkQuery, [email]);
    
    if (checkResult.rows.length > 0) {
      // Update existing enrollee
      const updateQuery = `
        UPDATE enrollees 
        SET name = $1, designation = $2, organisation = $3, website = $4,
            business_nature = $5, address = $6, office_number = $7, mobile_number = $8,
            fax_number = $9, is_vegetarian = $10, updated_at = NOW()
        WHERE email = $11
        RETURNING *
      `;
      
      const result = await pool.query(updateQuery, [
        name, designation, organisation, website, business_nature,
        address, office_number, mobile_number, fax_number, is_vegetarian, email
      ]);
      
      res.json({
        success: true,
        enrollee: result.rows[0]
      });
    } else {
      // Create new enrollee
      const enrolleeId = uuidv4();
      
      const insertQuery = `
        INSERT INTO enrollees (
          id, email, name, designation, organisation, website, business_nature,
          address, office_number, mobile_number, fax_number, is_vegetarian,
          company_id, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
        RETURNING *
      `;
      
      const result = await pool.query(insertQuery, [
        enrolleeId, email, name, designation, organisation, website, business_nature,
        address, office_number, mobile_number, fax_number, is_vegetarian, company_id
      ]);
      
      res.status(201).json({
        success: true,
        enrollee: result.rows[0]
      });
    }
  } catch (error) {
    console.error('Error upserting enrollee by email:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upsert enrollee'
    });
  }
});

module.exports = router;
