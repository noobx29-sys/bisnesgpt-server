const { pool, sql } = require('./database');
const redis = require('./redis');

module.exports = {
  pool,
  sql,
  redis,
};
