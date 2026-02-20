#!/usr/bin/env node

/**
 * Test script for Contact Sync Service
 * Tests the fix for WhatsApp Cloud API compatibility
 * 
 * Usage: node scripts/test-contact-sync.js <companyId>
 */

const ContactSyncService = require('../services/ContactSyncService');
const { Pool } = require('pg');
require('dotenv').config();

const companyId = process.argv[2] || '920072';

console.log('='.repeat(60));
console.log('Contact Sync Service - Cloud API Compatibility Test');
console.log('='.repeat(60));
console.log(`Testing company: ${companyId}\n`);

// Mock botMap (empty since Cloud API doesn't use it)
const botMap = new Map();

async function testContactSync() {
  const service = new ContactSyncService(companyId, botMap);

  try {
    console.log('Step 1: Checking connection type...');
    const isCloudAPI = await service.usesCloudAPI();
    console.log(`   Result: ${isCloudAPI ? 'Cloud API ✓' : 'Web.js'}\n`);

    console.log('Step 2: Testing getWhatsAppClient()...');
    const client = service.getWhatsAppClient();
    console.log(`   Result: ${client ? 'Client found ✓' : 'No client (expected for Cloud API) ✓'}\n`);

    console.log('Step 3: Fetching contacts from database...');
    const contacts = await service.getAllContactsWithStats();
    console.log(`   Found: ${contacts.length} contacts ✓\n`);

    if (contacts.length > 0) {
      console.log('Step 4: Formatting contacts (first 5)...');
      const sample = contacts.slice(0, 5);
      const formatted = await service.formatContactsForSheets(sample);
      console.log(`   Formatted: ${formatted.length} contacts ✓\n`);

      console.log('Sample formatted contact:');
      console.log(JSON.stringify(formatted[0], null, 2));
      console.log('');
    }

    console.log('='.repeat(60));
    console.log('✓ TEST PASSED - No errors!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('✗ TEST FAILED');
    console.error('='.repeat(60));
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    await service.close();
  }
}

// Run test
testContactSync().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
