const express = require('express');
const router = express.Router();
const ContactSyncService = require('../services/ContactSyncService');
const ContactSyncSpreadsheet = require('../spreadsheet/contactSyncSpreadsheet');

/**
 * Contact Sync API Routes
 * Handles syncing WhatsApp contacts to Google Sheets
 */

/**
 * POST /api/sync/contacts-to-sheets
 * Sync all WhatsApp contacts to Google Sheets
 *
 * Query Parameters:
 * - sheetId (optional): Google Sheet ID to sync to (defaults to env var)
 * - sheetName (optional): Sheet tab name (defaults to "Contacts")
 *
 * Body:
 * - companyId (required): Company/bot ID to sync contacts for
 */
router.post('/contacts-to-sheets', async (req, res) => {
  console.log('POST /api/sync/contacts-to-sheets - Starting contact sync');

  try {
    const { companyId } = req.body;
    const { sheetId, sheetName } = req.query;

    // Validate required parameters
    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'companyId is required in request body'
      });
    }

    // Get botMap from app locals (set by server.js)
    const botMap = req.app.locals.botMap;

    if (!botMap) {
      return res.status(500).json({
        success: false,
        error: 'Bot map not initialized'
      });
    }

    console.log(`Syncing contacts for company: ${companyId}`);

    // Initialize services
    const contactSyncService = new ContactSyncService(companyId, botMap);
    const sheetsHandler = new ContactSyncSpreadsheet(sheetId, sheetName);

    // Execute sync
    const syncResults = await contactSyncService.syncToSheets(sheetsHandler);

    // Close database connections
    await contactSyncService.close();

    // Return results
    if (syncResults.success) {
      return res.json({
        success: true,
        message: 'Contact sync completed successfully',
        data: {
          totalContacts: syncResults.totalContacts,
          syncedContacts: syncResults.syncedContacts,
          updatedContacts: syncResults.updatedContacts,
          newContacts: syncResults.newContacts,
          duration: `${(syncResults.duration / 1000).toFixed(2)}s`,
          sheetId: sheetsHandler.spreadsheetId,
          sheetName: sheetsHandler.sheetName
        }
      });
    } else {
      return res.status(500).json({
        success: false,
        error: 'Contact sync failed',
        details: syncResults.errors,
        data: {
          totalContacts: syncResults.totalContacts,
          syncedContacts: syncResults.syncedContacts,
          duration: `${(syncResults.duration / 1000).toFixed(2)}s`
        }
      });
    }

  } catch (error) {
    console.error('Error in /api/sync/contacts-to-sheets:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/sync/contacts-stats
 * Get statistics about contacts and sheet
 *
 * Query Parameters:
 * - companyId (required): Company/bot ID
 * - sheetId (optional): Google Sheet ID
 * - sheetName (optional): Sheet tab name
 */
router.get('/contacts-stats', async (req, res) => {
  console.log('GET /api/sync/contacts-stats');

  try {
    const { companyId, sheetId, sheetName } = req.query;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'companyId is required'
      });
    }

    const botMap = req.app.locals.botMap;

    if (!botMap) {
      return res.status(500).json({
        success: false,
        error: 'Bot map not initialized'
      });
    }

    // Get database stats
    const contactSyncService = new ContactSyncService(companyId, botMap);
    const contacts = await contactSyncService.getAllContactsWithStats();
    await contactSyncService.close();

    // Get sheet stats if sheet ID provided
    let sheetStats = null;
    if (sheetId || process.env.CONTACTS_SHEET_ID) {
      const sheetsHandler = new ContactSyncSpreadsheet(sheetId, sheetName);
      sheetStats = await sheetsHandler.getStats();
    }

    return res.json({
      success: true,
      data: {
        database: {
          totalContacts: contacts.length,
          contactsWithMessages: contacts.filter(c => c.total_messages > 0).length,
          contactsWithoutMessages: contacts.filter(c => c.total_messages === 0).length
        },
        sheet: sheetStats
      }
    });

  } catch (error) {
    console.error('Error in /api/sync/contacts-stats:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/sync/clear-sheet
 * Clear all contacts from the Google Sheet (except headers)
 *
 * Query Parameters:
 * - sheetId (optional): Google Sheet ID
 * - sheetName (optional): Sheet tab name
 *
 * Body:
 * - confirm (required): Must be true to confirm deletion
 */
router.post('/clear-sheet', async (req, res) => {
  console.log('POST /api/sync/clear-sheet');

  try {
    const { confirm } = req.body;
    const { sheetId, sheetName } = req.query;

    if (!confirm || confirm !== true) {
      return res.status(400).json({
        success: false,
        error: 'Must set confirm: true in request body to clear sheet'
      });
    }

    const sheetsHandler = new ContactSyncSpreadsheet(sheetId, sheetName);
    await sheetsHandler.clearSheet();

    return res.json({
      success: true,
      message: 'Sheet cleared successfully',
      data: {
        sheetId: sheetsHandler.spreadsheetId,
        sheetName: sheetsHandler.sheetName
      }
    });

  } catch (error) {
    console.error('Error in /api/sync/clear-sheet:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/sync/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Contact sync API is running',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
