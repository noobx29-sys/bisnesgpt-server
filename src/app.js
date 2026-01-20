/**
 * Express application setup
 */

const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const { clients } = require('./utils/broadcast');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files
app.use('/uploads', express.static('uploads'));

// API routes (new modular routes)
app.use('/api', routes);

// Health check
app.get('/health', (_, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

/**
 * Setup WebSocket server
 * @param {http.Server} server - HTTP server instance
 */
function setupWebSocket(server) {
  const { WebSocketServer } = require('ws');
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const urlParts = req.url.split('/');

    // Expected format: /ws/v1/{companyId}
    if (urlParts[1] === 'ws' && urlParts[3]) {
      const companyId = urlParts[3];

      // Add to clients map
      if (!clients.has(companyId)) {
        clients.set(companyId, []);
      }
      clients.get(companyId).push(ws);

      console.log(`WebSocket connected: ${companyId}`);

      // Handle close
      ws.on('close', () => {
        const list = clients.get(companyId) || [];
        const index = list.indexOf(ws);
        if (index > -1) {
          list.splice(index, 1);
        }
        console.log(`WebSocket disconnected: ${companyId}`);
      });

      // Handle errors
      ws.on('error', (err) => {
        console.error(`WebSocket error for ${companyId}:`, err);
      });

      // Handle messages (optional ping/pong)
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        } catch (e) {
          // Ignore parse errors
        }
      });
    }
  });

  return wss;
}

module.exports = { app, setupWebSocket };
