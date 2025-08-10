const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

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

/**
 * Get customer's assigned variation instructions
 * @param {string} customerId - Customer ID
 * @param {string} companyId - Company ID
 * @returns {Object|null} - Variation instructions or null if no active assignment
 */
async function getCustomerVariationInstructions(customerId, companyId) {
  try {
    const query = `
      SELECT stv.instructions, stv.id as variation_id
      FROM customer_variation_assignments cva
      JOIN split_test_variations stv ON cva.variation_id = stv.id
      WHERE cva.customer_id = $1 AND cva.company_id = $2 AND cva.is_closed = false
    `;
    
    const result = await pool.query(query, [customerId, companyId]);
    
    if (result.rows.length > 0) {
      return {
        id: result.rows[0].variation_id,
        instructions: result.rows[0].instructions
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error getting customer variation instructions:', error);
    throw error;
  }
}

/**
 * Assign customer to a random active variation
 * @param {string} customerId - Customer ID
 * @param {string} companyId - Company ID
 * @returns {Object|null} - Assigned variation or null if no active variations
 */
async function assignCustomerToVariation(customerId, companyId) {
  const client = await pool.connect();
  
  try {
    // Check if customer already has an active assignment
    const existingAssignment = await getCustomerVariationInstructions(customerId, companyId);
    if (existingAssignment) {
      return existingAssignment;
    }
    
    await client.query('BEGIN');
    
    // Get all active variations for the company
    const activeVariationsQuery = `
      SELECT id, instructions 
      FROM split_test_variations 
      WHERE company_id = $1 AND is_active = true
    `;
    
    const activeVariations = await client.query(activeVariationsQuery, [companyId]);
    
    if (activeVariations.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    
    // Randomly select a variation
    const randomIndex = Math.floor(Math.random() * activeVariations.rows.length);
    const selectedVariation = activeVariations.rows[randomIndex];
    
    // Create assignment record
    const assignmentId = uuidv4();
    await client.query(
      `INSERT INTO customer_variation_assignments (id, customer_id, variation_id, company_id)
       VALUES ($1, $2, $3, $4)`,
      [assignmentId, customerId, selectedVariation.id, companyId]
    );
    
    // Increment customer count for the variation
    await client.query(
      `UPDATE split_test_variations 
       SET customers = customers + 1 
       WHERE id = $1`,
      [selectedVariation.id]
    );
    
    await client.query('COMMIT');
    
    return {
      id: selectedVariation.id,
      instructions: selectedVariation.instructions
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error assigning customer to variation:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Mark customer as closed (converted)
 * @param {string} customerId - Customer ID
 * @param {string} companyId - Company ID
 * @returns {boolean} - Success status
 */
async function markCustomerAsClosed(customerId, companyId) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Find the customer's active assignment
    const assignmentQuery = `
      SELECT id, variation_id 
      FROM customer_variation_assignments 
      WHERE customer_id = $1 AND company_id = $2 AND is_closed = false
    `;
    
    const assignmentResult = await client.query(assignmentQuery, [customerId, companyId]);
    
    if (assignmentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    
    const assignment = assignmentResult.rows[0];
    
    // Mark assignment as closed
    await client.query(
      `UPDATE customer_variation_assignments 
       SET is_closed = true, closed_at = CURRENT_TIMESTAMP 
       WHERE id = $1`,
      [assignment.id]
    );
    
    // Increment closed customers count for the variation
    await client.query(
      `UPDATE split_test_variations 
       SET closed_customers = closed_customers + 1 
       WHERE id = $1`,
      [assignment.variation_id]
    );
    
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error marking customer as closed:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get split test performance metrics for a company
 * @param {string} companyId - Company ID
 * @returns {Object} - Performance metrics
 */
async function getSplitTestPerformance(companyId) {
  try {
    const query = `
      SELECT 
        id,
        name,
        customers,
        closed_customers,
        is_active,
        created_at,
        updated_at
      FROM split_test_variations 
      WHERE company_id = $1 
      ORDER BY created_at DESC
    `;
    
    const result = await pool.query(query, [companyId]);
    
    let totalCustomers = 0;
    let totalClosed = 0;
    
    const variations = result.rows.map(variation => {
      totalCustomers += variation.customers;
      totalClosed += variation.closed_customers;
      
      const conversionRate = variation.customers > 0 
        ? Math.round((variation.closed_customers / variation.customers) * 100 * 10) / 10 
        : 0;
      
      return {
        id: variation.id,
        name: variation.name,
        customers: variation.customers,
        closedCustomers: variation.closed_customers,
        conversionRate,
        isActive: variation.is_active,
        createdAt: variation.created_at,
        updatedAt: variation.updated_at
      };
    });
    
    const overallConversionRate = totalCustomers > 0 
      ? Math.round((totalClosed / totalCustomers) * 100 * 10) / 10 
      : 0;
    
    return {
      totalCustomers,
      totalClosed,
      overallConversionRate,
      variations
    };
  } catch (error) {
    console.error('Error getting split test performance:', error);
    throw error;
  }
}

/**
 * Check if a company has any active variations
 * @param {string} companyId - Company ID
 * @returns {boolean} - True if company has active variations
 */
async function hasActiveVariations(companyId) {
  try {
    const query = `
      SELECT COUNT(*) as count
      FROM split_test_variations 
      WHERE company_id = $1 AND is_active = true
    `;
    
    const result = await pool.query(query, [companyId]);
    return parseInt(result.rows[0].count) > 0;
  } catch (error) {
    console.error('Error checking active variations:', error);
    throw error;
  }
}

/**
 * Get all variations for a company
 * @param {string} companyId - Company ID
 * @returns {Array} - Array of variations
 */
async function getCompanyVariations(companyId) {
  try {
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
    
    const result = await pool.query(query, [companyId]);
    return result.rows;
  } catch (error) {
    console.error('Error getting company variations:', error);
    throw error;
  }
}

/**
 * Update variation active status
 * @param {string} variationId - Variation ID
 * @param {string} companyId - Company ID
 * @param {boolean} isActive - Active status
 * @returns {Object|null} - Updated variation or null if not found
 */
async function updateVariationStatus(variationId, companyId, isActive) {
  try {
    const query = `
      UPDATE split_test_variations 
      SET is_active = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND company_id = $3
      RETURNING id, name, instructions, is_active as "isActive", customers, 
                closed_customers as "closedCustomers", created_at as "createdAt", 
                updated_at as "updatedAt"
    `;
    
    const result = await pool.query(query, [isActive, variationId, companyId]);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('Error updating variation status:', error);
    throw error;
  }
}

/**
 * Delete a variation and all its assignments
 * @param {string} variationId - Variation ID
 * @param {string} companyId - Company ID
 * @returns {boolean} - Success status
 */
async function deleteVariation(variationId, companyId) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Check if variation exists and belongs to company
    const existingVariation = await client.query(
      'SELECT id FROM split_test_variations WHERE id = $1 AND company_id = $2',
      [variationId, companyId]
    );
    
    if (existingVariation.rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    
    // Delete the variation (cascade will handle assignments)
    await client.query(
      'DELETE FROM split_test_variations WHERE id = $1 AND company_id = $2',
      [variationId, companyId]
    );
    
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting variation:', error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getCustomerVariationInstructions,
  assignCustomerToVariation,
  markCustomerAsClosed,
  getSplitTestPerformance,
  hasActiveVariations,
  getCompanyVariations,
  updateVariationStatus,
  deleteVariation
}; 