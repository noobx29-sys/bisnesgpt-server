// =====================================================
// Lead Analytics Server
// Standalone server for lead analytics and visualization
// =====================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlDb = require('../db');
const leadAnalyticsRouter = require('./routes/leadAnalytics');

const app = express();
const PORT = process.env.ANALYTICS_PORT || process.env.PORT || 3005;

// =====================================================
// MIDDLEWARE   
// =====================================================

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'analytics-dashboard')));

// =====================================================
// API ROUTES
// =====================================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    service: 'Lead Analytics Server',
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

// API info endpoint
app.get('/api/lead-analytics', (req, res) => {
  res.json({
    success: true,
    message: 'Lead Analytics API',
    version: '1.0.0',
    endpoints: {
      companies: 'GET /api/companies',
      bottlenecks: 'GET /api/lead-analytics/:companyId/bottlenecks',
      followup: 'GET /api/lead-analytics/:companyId/followup-performance',
      pipeline: 'GET /api/lead-analytics/:companyId/pipeline',
      reactivation: 'GET /api/lead-analytics/:companyId/reactivation',
      trigger: 'POST /api/lead-analytics/:companyId/reactivation/trigger'
    },
    example: 'GET /api/lead-analytics/0210/bottlenecks'
  });
});

app.use('/api/lead-analytics', leadAnalyticsRouter);

// Get list of companies
app.get('/api/companies', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT company_id, COUNT(*) as contact_count
      FROM contacts
      GROUP BY company_id
      ORDER BY company_id
    `;
    const result = await sqlDb.query(query);
    
    res.json({
      success: true,
      companies: result.rows.map(row => ({
        company_id: row.company_id,
        contact_count: parseInt(row.contact_count)
      }))
    });
  } catch (error) {
    console.error('Error fetching companies:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// SERVE DASHBOARD
// =====================================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'analytics-dashboard', 'index.html'));
});

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 Lead Analytics Server Started');
  console.log('='.repeat(60));
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔌 API Info: http://localhost:${PORT}/api/lead-analytics`);
  console.log(`💚 Health: http://localhost:${PORT}/api/health`);
  console.log(`🏢 Companies: http://localhost:${PORT}/api/companies`);
  console.log('='.repeat(60));
  console.log('📖 Example API calls:');
  console.log(`   GET http://localhost:${PORT}/api/lead-analytics/0210/bottlenecks`);
  console.log(`   GET http://localhost:${PORT}/api/lead-analytics/0210/pipeline`);
  console.log('='.repeat(60) + '\n');
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Error: Port ${PORT} is already in use`);
    console.error(`Try a different port: ANALYTICS_PORT=3005 node analytics-server.js\n`);
  } else {
    console.error('\n❌ Server error:', err.message, '\n');
  }
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received, shutting down gracefully...');
  process.exit(0);
});
