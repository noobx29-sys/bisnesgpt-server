const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');

console.log('🔌 [SPLIT TEST] Initializing database connection pool');
console.log('🔌 [SPLIT TEST] DATABASE_URL:', process.env.DATABASE_URL ? 'Set' : 'Not set');

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

// Add pool event listeners for debugging
pool.on('connect', (client) => {
  console.log('🔌 [SPLIT TEST] New client connected to pool');
});

pool.on('error', (err, client) => {
  console.error('❌ [SPLIT TEST] Pool error:', err);
});

pool.on('acquire', (client) => {
  console.log('🔌 [SPLIT TEST] Client acquired from pool');
});

pool.on('release', (client) => {
  console.log('🔌 [SPLIT TEST] Client released back to pool');
});

// Test database connection on startup
pool.query('SELECT NOW() as current_time')
  .then(result => {
    console.log('✅ [SPLIT TEST] Database connection test successful:', result.rows[0]);
  })
  .catch(err => {
    console.error('❌ [SPLIT TEST] Database connection test failed:', err.message);
  });

// Middleware to log all requests
router.use((req, res, next) => {
  console.log('🌐 [SPLIT TEST] Incoming request:', {
    method: req.method,
    url: req.url,
    path: req.path,
    headers: req.headers,
    body: req.body,
    query: req.query,
    params: req.params,
    timestamp: new Date().toISOString()
  });
  next();
});

// Helper function to calculate conversion rate
function calculateConversionRate(customers, closedCustomers) {
  if (customers === 0) return 0;
  return Math.round((closedCustomers / customers) * 100 * 10) / 10; // Round to 1 decimal place
}

// GET /api/split-test/variations - Get all variations for a company
router.get('/variations', async (req, res) => {
  console.log('🔍 [SPLIT TEST] GET /variations - Request received');
  console.log('📋 Query params:', req.query);
  
  try {
    const { companyId } = req.query;
    
    if (!companyId) {
      console.log('❌ [SPLIT TEST] Missing companyId parameter');
      return res.status(422).json({
        success: false,
        error: 'companyId is required'
      });
    }
    
    console.log('🏢 [SPLIT TEST] Fetching variations for company:', companyId);
    
    const query = `
      SELECT 
        id,
        name,
        instructions,
        is_active as "isActive",
        customers,
        closed_customers as "closedCustomers",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM split_test_variations 
      WHERE company_id = $1 
      ORDER BY created_at DESC
    `;
    
    console.log('📝 [SPLIT TEST] Executing SQL query:', query);
    console.log('🔢 [SPLIT TEST] Query parameters:', [companyId]);
    
    const result = await pool.query(query, [companyId]);
    
    console.log('✅ [SPLIT TEST] Query successful, rows returned:', result.rows.length);
    console.log('📊 [SPLIT TEST] Variations data:', result.rows);
    
    res.json({
      success: true,
      variations: result.rows
    });
  } catch (error) {
    console.error('❌ [SPLIT TEST] Error fetching variations:', error);
    console.error('🔍 [SPLIT TEST] Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      detail: error.detail
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch variations'
    });
  }
});

// POST /api/split-test/variations - Save all variations (create/update)
router.post('/variations', async (req, res) => {
  console.log('🔍 [SPLIT TEST] POST /variations - Request received');
  console.log('📋 Request headers:', req.headers);
  console.log('📋 Request body:', JSON.stringify(req.body, null, 2));
  console.log('📋 Request body type:', typeof req.body);
  console.log('📋 Request body keys:', Object.keys(req.body || {}));
  
  const client = await pool.connect();
  
  try {
    const { companyId, variations } = req.body;
    
    console.log('🏢 [SPLIT TEST] Company ID:', companyId);
    console.log('🏢 [SPLIT TEST] Company ID type:', typeof companyId);
    console.log('📝 [SPLIT TEST] Variations:', variations);
    console.log('📝 [SPLIT TEST] Variations type:', typeof variations);
    console.log('📝 [SPLIT TEST] Variations is array:', Array.isArray(variations));
    console.log('📝 [SPLIT TEST] Variations count:', variations ? variations.length : 'undefined');
    console.log('📝 [SPLIT TEST] Variations data:', variations);
    
    // Detailed validation logging
    const validation = {
      hasCompanyId: !!companyId,
      companyIdType: typeof companyId,
      companyIdValue: companyId,
      hasVariations: !!variations,
      variationsType: typeof variations,
      isArray: Array.isArray(variations),
      variationsLength: variations ? variations.length : 'undefined',
      variationsContent: variations
    };
    
    console.log('🔍 [SPLIT TEST] Validation details:', validation);
    
    if (!companyId || !Array.isArray(variations)) {
      console.log('❌ [SPLIT TEST] Validation failed:', {
        hasCompanyId: !!companyId,
        hasVariations: !!variations,
        isArray: Array.isArray(variations),
        companyIdType: typeof companyId,
        variationsType: typeof variations
      });
      
      // Provide more specific error messages
      let errorMessage = 'Validation failed: ';
      if (!companyId) {
        errorMessage += 'companyId is required and must be provided';
      } else if (!Array.isArray(variations)) {
        errorMessage += 'variations must be an array';
      }
      
      return res.status(422).json({
        success: false,
        error: errorMessage,
        validation: validation
      });
    }
    
    console.log('🚀 [SPLIT TEST] Starting database transaction');
    await client.query('BEGIN');
    
    const savedVariations = [];
    
    for (let i = 0; i < variations.length; i++) {
      const variation = variations[i];
      const { id, name, instructions, isActive } = variation;
      
      console.log(`📝 [SPLIT TEST] Processing variation ${i + 1}/${variations.length}:`, {
        id: id || 'NEW',
        name,
        instructionsLength: instructions ? instructions.length : 0,
        isActive
      });
      
      if (!name || !instructions) {
        console.log('❌ [SPLIT TEST] Missing required fields for variation:', {
          hasName: !!name,
          hasInstructions: !!instructions
        });
        throw new Error('name and instructions are required for each variation');
      }
      
      let result;
      if (id) {
        // Update existing variation
        console.log('🔄 [SPLIT TEST] Updating existing variation:', id);
        const updateQuery = `
          UPDATE split_test_variations 
           SET name = $1, instructions = $2, is_active = $3, updated_at = CURRENT_TIMESTAMP
           WHERE id = $4 AND company_id = $5
           RETURNING id, name, instructions, is_active as "isActive", customers, closed_customers as "closedCustomers", 
                     created_at as "createdAt", updated_at as "updatedAt"
        `;
        console.log('📝 [SPLIT TEST] Update SQL:', updateQuery);
        console.log('🔢 [SPLIT TEST] Update parameters:', [name, instructions, isActive || false, id, companyId]);
        
        result = await client.query(updateQuery, [name, instructions, isActive || false, id, companyId]);
        console.log('✅ [SPLIT TEST] Update successful, rows affected:', result.rows.length);
        
        // If update didn't affect any rows, the variation doesn't exist, so create it
        if (result.rows.length === 0) {
          console.log('⚠️ [SPLIT TEST] Update affected 0 rows, variation does not exist. Creating new variation...');
          const newId = uuidv4();
          console.log('🆕 [SPLIT TEST] Creating new variation with ID:', newId);
          const insertQuery = `
            INSERT INTO split_test_variations (id, company_id, name, instructions, is_active)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, name, instructions, is_active as "isActive", customers, closed_customers as "closedCustomers", 
                       created_at as "createdAt", updated_at as "updatedAt"
          `;
          console.log('📝 [SPLIT TEST] Insert SQL:', insertQuery);
          console.log('🔢 [SPLIT TEST] Insert parameters:', [newId, companyId, name, instructions, isActive || false]);
          
          result = await client.query(insertQuery, [newId, companyId, name, instructions, isActive || false]);
          console.log('✅ [SPLIT TEST] Insert successful, rows created:', result.rows.length);
        }
      } else {
        // Create new variation
        const newId = uuidv4();
        console.log('🆕 [SPLIT TEST] Creating new variation with ID:', newId);
        const insertQuery = `
          INSERT INTO split_test_variations (id, company_id, name, instructions, is_active)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, name, instructions, is_active as "isActive", customers, closed_customers as "closedCustomers", 
                     created_at as "createdAt", updated_at as "updatedAt"
        `;
        console.log('📝 [SPLIT TEST] Insert SQL:', insertQuery);
        console.log('🔢 [SPLIT TEST] Insert parameters:', [newId, companyId, name, instructions, isActive || false]);
        
        result = await client.query(insertQuery, [newId, companyId, name, instructions, isActive || false]);
        console.log('✅ [SPLIT TEST] Insert successful, rows created:', result.rows.length);
      }
      
      if (result.rows.length > 0) {
        savedVariations.push(result.rows[0]);
        console.log('💾 [SPLIT TEST] Variation saved:', result.rows[0]);
      }
    }
    
    console.log('💾 [SPLIT TEST] Committing transaction');
    await client.query('COMMIT');
    
    console.log('✅ [SPLIT TEST] All variations saved successfully, count:', savedVariations.length);
    
    if (savedVariations.length === 0) {
      console.log('⚠️ [SPLIT TEST] Warning: No variations were saved!');
      return res.status(422).json({
        success: false,
        error: 'No variations were saved. This might indicate a database issue or validation problem.',
        validation: {
          companyId,
          variationsCount: variations.length,
          savedCount: savedVariations.length
        }
      });
    }
    
    res.json({
      success: true,
      message: 'Variations saved successfully',
      variations: savedVariations
    });
  } catch (error) {
    console.error('❌ [SPLIT TEST] Error saving variations:', error);
    console.error('🔍 [SPLIT TEST] Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      detail: error.detail
    });
    
    console.log('🔄 [SPLIT TEST] Rolling back transaction');
    await client.query('ROLLBACK');
    
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to save variations'
    });
  } finally {
    console.log('🔌 [SPLIT TEST] Releasing database client');
    client.release();
  }
});

// PATCH /api/split-test/variations/:variationId/toggle - Toggle variation active status
router.patch('/variations/:variationId/toggle', async (req, res) => {
  console.log('🔍 [SPLIT TEST] PATCH /variations/:variationId/toggle - Request received');
  console.log('📋 Request params:', req.params);
  console.log('📋 Request body:', req.body);
  
  try {
    const { variationId } = req.params;
    const { companyId } = req.body;
    
    console.log('🆔 [SPLIT TEST] Variation ID:', variationId);
    console.log('🏢 [SPLIT TEST] Company ID:', companyId);
    
    if (!companyId) {
      console.log('❌ [SPLIT TEST] Validation failed: Missing companyId');
      return res.status(422).json({
        success: false,
        error: 'companyId is required'
      });
    }
    
    // First, get the current status of the variation
    console.log('🔍 [SPLIT TEST] Getting current variation status');
    const getCurrentStatusQuery = `
      SELECT is_active as "isActive" 
      FROM split_test_variations 
      WHERE id = $1 AND company_id = $2
    `;
    
    const currentStatusResult = await pool.query(getCurrentStatusQuery, [variationId, companyId]);
    
    if (currentStatusResult.rows.length === 0) {
      console.log('❌ [SPLIT TEST] Variation not found for ID:', variationId);
      return res.status(404).json({
        success: false,
        error: 'Variation not found'
      });
    }
    
    const currentStatus = currentStatusResult.rows[0].isActive;
    const newStatus = !currentStatus; // Toggle the status
    
    console.log('🔄 [SPLIT TEST] Toggling status:', currentStatus, '→', newStatus);
    
    // Now update with the toggled status
    const updateQuery = `
      UPDATE split_test_variations 
       SET is_active = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND company_id = $3
       RETURNING id, name, instructions, is_active as "isActive", customers, closed_customers as "closedCustomers", 
                 created_at as "createdAt", updated_at as "updatedAt"
    `;
    
    console.log('📝 [SPLIT TEST] Toggle SQL:', updateQuery);
    console.log('🔢 [SPLIT TEST] Toggle parameters:', [newStatus, variationId, companyId]);
    
    const result = await pool.query(updateQuery, [newStatus, variationId, companyId]);
    
    console.log('✅ [SPLIT TEST] Toggle query successful, rows affected:', result.rows.length);
    
    console.log('✅ [SPLIT TEST] Variation toggled successfully:', result.rows[0]);
    
    res.json({
      success: true,
      variation: result.rows[0]
    });
  } catch (error) {
    console.error('❌ [SPLIT TEST] Error toggling variation:', error);
    console.error('🔍 [SPLIT TEST] Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      detail: error.detail
    });
    res.status(500).json({
      success: false,
      error: 'Failed to toggle variation'
    });
  }
});

// GET /api/split-test/performance - Get performance dashboard data
router.get('/performance', async (req, res) => {
  console.log('🔍 [SPLIT TEST] GET /performance - Request received');
  console.log('📋 Query params:', req.query);
  
  try {
    const { companyId } = req.query;
    
    if (!companyId) {
      console.log('❌ [SPLIT TEST] Missing companyId parameter');
      return res.status(422).json({
        success: false,
        error: 'companyId is required'
      });
    }
    
    console.log('🏢 [SPLIT TEST] Fetching performance data for company:', companyId);
    
    // Get variations with performance metrics
    const variationsQuery = `
      SELECT 
        id,
        name,
        customers,
        closed_customers as "closedCustomers",
        is_active as "isActive"
      FROM split_test_variations 
      WHERE company_id = $1 
      ORDER BY created_at DESC
    `;
    
    console.log('📝 [SPLIT TEST] Performance SQL:', variationsQuery);
    console.log('🔢 [SPLIT TEST] Performance parameters:', [companyId]);
    
    const variationsResult = await pool.query(variationsQuery, [companyId]);
    
    console.log('✅ [SPLIT TEST] Performance query successful, rows returned:', variationsResult.rows.length);
    console.log('📊 [SPLIT TEST] Raw performance data:', variationsResult.rows);
    
    // Calculate totals and conversion rates
    let totalCustomers = 0;
    let totalClosed = 0;
    
    const variations = variationsResult.rows.map(variation => {
      totalCustomers += variation.customers;
      totalClosed += variation.closedCustomers;
      
      const conversionRate = calculateConversionRate(variation.customers, variation.closedCustomers);
      
      console.log(`📊 [SPLIT TEST] Variation ${variation.id} metrics:`, {
        name: variation.name,
        customers: variation.customers,
        closedCustomers: variation.closedCustomers,
        conversionRate
      });
      
      return {
        ...variation,
        conversionRate
      };
    });
    
    const overallConversionRate = calculateConversionRate(totalCustomers, totalClosed);
    
    console.log('📊 [SPLIT TEST] Overall performance metrics:', {
      totalCustomers,
      totalClosed,
      overallConversionRate
    });
    
    res.json({
      success: true,
      totalCustomers,
      totalClosed,
      overallConversionRate,
      variations
    });
  } catch (error) {
    console.error('❌ [SPLIT TEST] Error fetching performance data:', error);
    console.error('🔍 [SPLIT TEST] Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      detail: error.detail
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch performance data'
    });
  }
});

// POST /api/split-test/assign-customer - Assign customer to variation (internal use)
router.post('/assign-customer', async (req, res) => {
  console.log('🔍 [SPLIT TEST] POST /assign-customer - Request received');
  console.log('📋 Request body:', JSON.stringify(req.body, null, 2));
  
  const client = await pool.connect();
  
  try {
    const { customerId, companyId } = req.body;
    
    console.log('👤 [SPLIT TEST] Customer ID:', customerId);
    console.log('🏢 [SPLIT TEST] Company ID:', companyId);
    
    if (!customerId || !companyId) {
      console.log('❌ [SPLIT TEST] Missing required parameters:', {
        hasCustomerId: !!customerId,
        hasCompanyId: !!companyId
      });
      return res.status(422).json({
        success: false,
        error: 'customerId and companyId are required'
      });
    }
    
    // Check if customer already has an active assignment
    console.log('🔍 [SPLIT TEST] Checking for existing customer assignment');
    const existingAssignmentQuery = `
      SELECT cva.*, stv.instructions 
       FROM customer_variation_assignments cva
       JOIN split_test_variations stv ON cva.variation_id = stv.id
       WHERE cva.customer_id = $1 AND cva.company_id = $2 AND cva.is_closed = false
    `;
    
    console.log('📝 [SPLIT TEST] Existing assignment SQL:', existingAssignmentQuery);
    console.log('🔢 [SPLIT TEST] Existing assignment parameters:', [customerId, companyId]);
    
    const existingAssignment = await client.query(existingAssignmentQuery, [customerId, companyId]);
    
    console.log('✅ [SPLIT TEST] Existing assignment query successful, rows found:', existingAssignment.rows.length);
    
    if (existingAssignment.rows.length > 0) {
      console.log('✅ [SPLIT TEST] Customer already has active assignment:', existingAssignment.rows[0]);
      return res.json({
        success: true,
        assignedVariation: {
          id: existingAssignment.rows[0].variation_id,
          instructions: existingAssignment.rows[0].instructions
        }
      });
    }
    
    console.log('🚀 [SPLIT TEST] Starting customer assignment transaction');
    await client.query('BEGIN');
    
    // Get all active variations for the company
    console.log('🔍 [SPLIT TEST] Fetching active variations for company');
    const activeVariationsQuery = `
      SELECT id, instructions 
      FROM split_test_variations 
      WHERE company_id = $1 AND is_active = true
    `;
    
    console.log('📝 [SPLIT TEST] Active variations SQL:', activeVariationsQuery);
    console.log('🔢 [SPLIT TEST] Active variations parameters:', [companyId]);
    
    const activeVariations = await client.query(activeVariationsQuery, [companyId]);
    
    console.log('✅ [SPLIT TEST] Active variations query successful, rows found:', activeVariations.rows.length);
    console.log('📝 [SPLIT TEST] Active variations:', activeVariations.rows);
    
    if (activeVariations.rows.length === 0) {
      console.log('❌ [SPLIT TEST] No active variations found for company');
      await client.query('ROLLBACK');
      return res.json({
        success: true,
        assignedVariation: null,
        message: 'No active variations found'
      });
    }
    
    // Randomly select a variation
    const randomIndex = Math.floor(Math.random() * activeVariations.rows.length);
    const selectedVariation = activeVariations.rows[randomIndex];
    
    console.log('🎲 [SPLIT TEST] Randomly selected variation:', {
      index: randomIndex,
      variation: selectedVariation
    });
    
    // Create assignment record
    const assignmentId = uuidv4();
    console.log('🆔 [SPLIT TEST] Creating assignment with ID:', assignmentId);
    
    const assignmentQuery = `
      INSERT INTO customer_variation_assignments (id, customer_id, variation_id, company_id)
       VALUES ($1, $2, $3, $4)
    `;
    
    console.log('📝 [SPLIT TEST] Assignment SQL:', assignmentQuery);
    console.log('🔢 [SPLIT TEST] Assignment parameters:', [assignmentId, customerId, selectedVariation.id, companyId]);
    
    await client.query(assignmentQuery, [assignmentId, customerId, selectedVariation.id, companyId]);
    console.log('✅ [SPLIT TEST] Assignment record created successfully');
    
    // Increment customer count for the variation
    console.log('📊 [SPLIT TEST] Incrementing customer count for variation:', selectedVariation.id);
    const incrementQuery = `
      UPDATE split_test_variations 
       SET customers = customers + 1 
       WHERE id = $1
    `;
    
    console.log('📝 [SPLIT TEST] Increment SQL:', incrementQuery);
    console.log('🔢 [SPLIT TEST] Increment parameters:', [selectedVariation.id]);
    
    await client.query(incrementQuery, [selectedVariation.id]);
    console.log('✅ [SPLIT TEST] Customer count incremented successfully');
    
    console.log('💾 [SPLIT TEST] Committing assignment transaction');
    await client.query('COMMIT');
    
    console.log('✅ [SPLIT TEST] Customer assigned successfully to variation:', selectedVariation.id);
    
    res.json({
      success: true,
      assignedVariation: {
        id: selectedVariation.id,
        instructions: selectedVariation.instructions
      }
    });
  } catch (error) {
    console.error('❌ [SPLIT TEST] Error assigning customer:', error);
    console.error('🔍 [SPLIT TEST] Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      detail: error.detail
    });
    
    console.log('🔄 [SPLIT TEST] Rolling back assignment transaction');
    await client.query('ROLLBACK');
    
    res.status(500).json({
      success: false,
      error: 'Failed to assign customer to variation'
    });
  } finally {
    console.log('🔌 [SPLIT TEST] Releasing assignment database client');
    client.release();
  }
});

// POST /api/split-test/mark-closed - Mark customer as closed
router.post('/mark-closed', async (req, res) => {
  console.log('🔍 [SPLIT TEST] POST /mark-closed - Request received');
  console.log('📋 Request body:', JSON.stringify(req.body, null, 2));
  
  const client = await pool.connect();
  
  try {
    const { customerId, companyId } = req.body;
    
    console.log('👤 [SPLIT TEST] Customer ID:', customerId);
    console.log('🏢 [SPLIT TEST] Company ID:', companyId);
    
    if (!customerId || !companyId) {
      console.log('❌ [SPLIT TEST] Missing required parameters:', {
        hasCustomerId: !!customerId,
        hasCompanyId: !!companyId
      });
      return res.status(422).json({
        success: false,
        error: 'customerId and companyId are required'
      });
    }
    
    console.log('🚀 [SPLIT TEST] Starting mark-closed transaction');
    await client.query('BEGIN');
    
    // Find the customer's active assignment
    console.log('🔍 [SPLIT TEST] Finding customer active assignment');
    const assignmentQuery = `
      SELECT id, variation_id 
      FROM customer_variation_assignments 
      WHERE customer_id = $1 AND company_id = $2 AND is_closed = false
    `;
    
    console.log('📝 [SPLIT TEST] Assignment lookup SQL:', assignmentQuery);
    console.log('🔢 [SPLIT TEST] Assignment lookup parameters:', [customerId, companyId]);
    
    const assignmentResult = await client.query(assignmentQuery, [customerId, companyId]);
    
    console.log('✅ [SPLIT TEST] Assignment lookup successful, rows found:', assignmentResult.rows.length);
    
    if (assignmentResult.rows.length === 0) {
      console.log('❌ [SPLIT TEST] No active assignment found for customer');
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Active assignment not found for customer'
      });
    }
    
    const assignment = assignmentResult.rows[0];
    console.log('📝 [SPLIT TEST] Found assignment:', assignment);
    
    // Mark assignment as closed
    console.log('🔒 [SPLIT TEST] Marking assignment as closed');
    const closeAssignmentQuery = `
      UPDATE customer_variation_assignments 
       SET is_closed = true, closed_at = CURRENT_TIMESTAMP 
       WHERE id = $1
    `;
    
    console.log('📝 [SPLIT TEST] Close assignment SQL:', closeAssignmentQuery);
    console.log('🔢 [SPLIT TEST] Close assignment parameters:', [assignment.id]);
    
    await client.query(closeAssignmentQuery, [assignment.id]);
    console.log('✅ [SPLIT TEST] Assignment marked as closed successfully');
    
    // Increment closed customers count for the variation
    console.log('📊 [SPLIT TEST] Incrementing closed customers count for variation:', assignment.variation_id);
    const incrementClosedQuery = `
      UPDATE split_test_variations 
       SET closed_customers = closed_customers + 1 
       WHERE id = $1
    `;
    
    console.log('📝 [SPLIT TEST] Increment closed SQL:', incrementClosedQuery);
    console.log('🔢 [SPLIT TEST] Increment closed parameters:', [assignment.variation_id]);
    
    await client.query(incrementClosedQuery, [assignment.variation_id]);
    console.log('✅ [SPLIT TEST] Closed customers count incremented successfully');
    
    console.log('💾 [SPLIT TEST] Committing mark-closed transaction');
    await client.query('COMMIT');
    
    console.log('✅ [SPLIT TEST] Customer marked as closed successfully');
    
    res.json({
      success: true,
      message: 'Customer marked as closed'
    });
  } catch (error) {
    console.error('❌ [SPLIT TEST] Error marking customer as closed:', error);
    console.error('🔍 [SPLIT TEST] Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      detail: error.detail
    });
    
    console.log('🔄 [SPLIT TEST] Rolling back mark-closed transaction');
    await client.query('ROLLBACK');
    
    res.status(500).json({
      success: false,
      error: 'Failed to mark customer as closed'
    });
  } finally {
    console.log('🔌 [SPLIT TEST] Releasing mark-closed database client');
    client.release();
  }
});

// DELETE /api/split-test/variations/:variationId - Delete a variation
router.delete('/variations/:variationId', async (req, res) => {
  console.log('🔍 [SPLIT TEST] DELETE /variations/:variationId - Request received');
  console.log('📋 Request params:', req.params);
  console.log('📋 Query params:', req.query);
  
  const client = await pool.connect();
  
  try {
    const { variationId } = req.params;
    const { companyId } = req.query;
    
    console.log('🆔 [SPLIT TEST] Variation ID:', variationId);
    console.log('🏢 [SPLIT TEST] Company ID:', companyId);
    
    if (!companyId) {
      console.log('❌ [SPLIT TEST] Missing companyId parameter');
      return res.status(422).json({
        success: false,
        error: 'companyId is required'
      });
    }
    
    console.log('🚀 [SPLIT TEST] Starting delete variation transaction');
    await client.query('BEGIN');
    
    // Check if variation exists and belongs to company
    console.log('🔍 [SPLIT TEST] Checking if variation exists and belongs to company');
    const existingVariationQuery = 'SELECT id FROM split_test_variations WHERE id = $1 AND company_id = $2';
    
    console.log('📝 [SPLIT TEST] Existence check SQL:', existingVariationQuery);
    console.log('🔢 [SPLIT TEST] Existence check parameters:', [variationId, companyId]);
    
    const existingVariation = await client.query(existingVariationQuery, [variationId, companyId]);
    
    console.log('✅ [SPLIT TEST] Existence check successful, rows found:', existingVariation.rows.length);
    
    if (existingVariation.rows.length === 0) {
      console.log('❌ [SPLIT TEST] Variation not found or does not belong to company');
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Variation not found'
      });
    }
    
    // Delete the variation (cascade will handle assignments)
    console.log('🗑️ [SPLIT TEST] Deleting variation:', variationId);
    const deleteQuery = 'DELETE FROM split_test_variations WHERE id = $1 AND company_id = $2';
    
    console.log('📝 [SPLIT TEST] Delete SQL:', deleteQuery);
    console.log('🔢 [SPLIT TEST] Delete parameters:', [variationId, companyId]);
    
    await client.query(deleteQuery, [variationId, companyId]);
    console.log('✅ [SPLIT TEST] Variation deleted successfully');
    
    console.log('💾 [SPLIT TEST] Committing delete transaction');
    await client.query('COMMIT');
    
    console.log('✅ [SPLIT TEST] Variation deletion completed successfully');
    
    res.json({
      success: true,
      message: 'Variation deleted successfully'
    });
  } catch (error) {
    console.error('❌ [SPLIT TEST] Error deleting variation:', error);
    console.error('🔍 [SPLIT TEST] Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      detail: error.detail
    });
    
    console.log('🔄 [SPLIT TEST] Rolling back delete transaction');
    await client.query('ROLLBACK');
    
    res.status(500).json({
      success: false,
      error: 'Failed to delete variation'
    });
  } finally {
    console.log('🔌 [SPLIT TEST] Releasing delete database client');
    client.release();
  }
});

// GET /api/split-test/health - Check database health and table existence
router.get('/health', async (req, res) => {
  console.log('🔍 [SPLIT TEST] GET /health - Database health check requested');
  
  try {
    // Check if we can connect to the database
    console.log('🔌 [SPLIT TEST] Testing database connection...');
    const connectionTest = await pool.query('SELECT NOW() as current_time, version() as pg_version');
    console.log('✅ [SPLIT TEST] Database connection successful:', connectionTest.rows[0]);
    
    // Check if required tables exist
    console.log('🔍 [SPLIT TEST] Checking required tables...');
    const tablesQuery = `
      SELECT 
        table_name,
        table_type,
        (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
      FROM information_schema.tables t
      WHERE table_name IN ('split_test_variations', 'customer_variation_assignments')
      ORDER BY table_name
    `;
    
    console.log('📝 [SPLIT TEST] Tables check SQL:', tablesQuery);
    const tablesResult = await pool.query(tablesQuery);
    console.log('✅ [SPLIT TEST] Tables check successful, found tables:', tablesResult.rows);
    
    // Check table schemas
    const tableSchemas = {};
    for (const table of tablesResult.rows) {
      console.log(`🔍 [SPLIT TEST] Checking schema for table: ${table.table_name}`);
      const schemaQuery = `
        SELECT 
          column_name,
          data_type,
          is_nullable,
          column_default,
          ordinal_position
        FROM information_schema.columns 
        WHERE table_name = $1 
        ORDER BY ordinal_position
      `;
      
      console.log('📝 [SPLIT TEST] Schema check SQL:', schemaQuery);
      console.log('🔢 [SPLIT TEST] Schema check parameters:', [table.table_name]);
      
      const schemaResult = await pool.query(schemaQuery, [table.table_name]);
      console.log(`✅ [SPLIT TEST] Schema for ${table.table_name}:`, schemaResult.rows);
      
      tableSchemas[table.table_name] = schemaResult.rows;
    }
    
    // Check if tables have data
    const dataChecks = {};
    for (const table of tablesResult.rows) {
      console.log(`🔍 [SPLIT TEST] Checking data count for table: ${table.table_name}`);
      const countQuery = `SELECT COUNT(*) as row_count FROM ${table.table_name}`;
      
      console.log('📝 [SPLIT TEST] Count SQL:', countQuery);
      const countResult = await pool.query(countQuery);
      console.log(`✅ [SPLIT TEST] Row count for ${table.table_name}:`, countResult.rows[0]);
      
      dataChecks[table.table_name] = countResult.rows[0].row_count;
    }
    
    const healthStatus = {
      success: true,
      database: {
        connected: true,
        currentTime: connectionTest.rows[0].current_time,
        postgresVersion: connectionTest.rows[0].pg_version
      },
      tables: {
        found: tablesResult.rows.map(t => t.table_name),
        schemas: tableSchemas,
        rowCounts: dataChecks
      },
      requiredTables: ['split_test_variations', 'customer_variation_assignments'],
      missingTables: ['split_test_variations', 'customer_variation_assignments'].filter(
        required => !tablesResult.rows.find(t => t.table_name === required)
      )
    };
    
    console.log('📊 [SPLIT TEST] Health check completed:', healthStatus);
    
    res.json(healthStatus);
  } catch (error) {
    console.error('❌ [SPLIT TEST] Health check failed:', error);
    console.error('🔍 [SPLIT TEST] Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      detail: error.detail
    });
    
    res.status(500).json({
      success: false,
      error: 'Health check failed',
      details: error.message,
      database: {
        connected: false,
        error: error.message
      }
    });
  }
});

module.exports = router; 