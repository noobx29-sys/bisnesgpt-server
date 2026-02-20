const { Pool } = require('pg');
const { neon, neonConfig } = require('@neondatabase/serverless');
const WebSocket = require('ws');

neonConfig.webSocketConstructor = WebSocket;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 500,
  min: 5,
  idleTimeoutMillis: 30000,
});

const sql = neon(process.env.DATABASE_URL);

module.exports = { pool, sql };
