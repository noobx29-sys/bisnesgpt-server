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
const reactivationRouter = require('../routes/reactivationRoutes');
const app = express();
const PORT = process.env.ANALYTICS_PORT || process.env.PORT || 3005;

// =====================================================
// MIDDLEWARE   
// =====================================================

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// API routes
app.use('/api/lead-analytics', leadAnalyticsRouter);
app.use('/api', reactivationRouter);

// =====================================================
// API ROUTES
// =====================================================

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    service: 'Lead Analytics Server',
    status: 'running',
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

// API routes are now registered above

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

// Log a contact attempt
app.post('/api/contacts/:contactId/log', async (req, res) => {
  try {
    const { contactId } = req.params;
    const { message, status = 'contacted' } = req.body;
    
    // Start a transaction
    await sqlDb.query('BEGIN');
    
    // Log the contact
    const logResult = await sqlDb.query(
      `INSERT INTO contact_history 
       (contact_id, message, status, next_contact_date)
       VALUES ($1, $2, $3, NOW() + INTERVAL '3 days')
       RETURNING *`,
      [contactId, message, status]
    );
    
    // Update the contact's last_contact and contact_count
    await sqlDb.query(
      `UPDATE contacts 
       SET last_contact = NOW(),
           contact_count = COALESCE(contact_count, 0) + 1,
           last_contact_status = $1
       WHERE id = $2`,
      [status, contactId]
    );
    
    // Commit the transaction
    await sqlDb.query('COMMIT');
    
    res.json({ 
      success: true, 
      data: logResult.rows[0] 
    });
    
  } catch (error) {
    await sqlDb.query('ROLLBACK');
    console.error('Error logging contact:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get contact history
app.get('/api/contacts/:contactId/history', async (req, res) => {
  try {
    const { contactId } = req.params;
    const result = await sqlDb.query(
      `SELECT * FROM contact_history 
       WHERE contact_id = $1 
       ORDER BY contact_date DESC`,
      [contactId]
    );
    
    res.json({ 
      success: true, 
      data: result.rows 
    });
    
  } catch (error) {
    console.error('Error fetching contact history:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// =====================================================
// SERVE DASHBOARD
// =====================================================

// Serve the main app for all other GET requests
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
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
