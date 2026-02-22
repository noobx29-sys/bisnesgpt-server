/**
 * Routes index - aggregates all API routes
 */

const router = require('express').Router();

// WhatsApp routes (360dialog integration)
router.use('/whatsapp', require('./whatsapp'));

// Webhook routes
router.use('/webhook', require('./webhooks'));

// AI Pipeline Audit
router.use('/audit', require('./audit'));

module.exports = router;
