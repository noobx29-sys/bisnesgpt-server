/**
 * Database utility functions
 */

const { pool } = require('../config/database');

/**
 * Execute a transaction
 * @param {function} callback - Async function receiving client
 * @returns {Promise} - Transaction result
 */
async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Upsert helper
 * @param {string} table - Table name
 * @param {object} data - Data to insert
 * @param {string[]} conflictKeys - Conflict columns
 * @param {string[]} updateKeys - Columns to update on conflict
 * @returns {Promise} - Query result
 */
async function upsert(table, data, conflictKeys, updateKeys) {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

  const updates = updateKeys.map(k => `${k} = EXCLUDED.${k}`).join(', ');

  const query = `
    INSERT INTO ${table} (${keys.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (${conflictKeys.join(', ')}) DO UPDATE SET ${updates}, updated_at = NOW()
    RETURNING *
  `;

  return pool.query(query, values);
}

module.exports = { transaction, upsert };
