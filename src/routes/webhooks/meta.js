/**
 * Meta WhatsApp Direct webhook routes
 */

const router = require('express').Router();
const metaDirect = require('../../services/whatsapp/metaDirect');

/**
 * POST /webhook/meta
 * Webhook endpoint for Meta WhatsApp events
 */
router.post('/meta', async (req, res) => {
  // Always respond 200 immediately to avoid timeouts
  res.sendStatus(200);

  try {
    await metaDirect.handleWebhook(req.body);
  } catch (e) {
    console.error('Meta webhook error:', e);
  }
});

/**
 * GET /webhook/meta
 * Webhook verification (Meta webhook challenge)
 */
router.get('/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Use META_WEBHOOK_VERIFY_TOKEN or fall back to WEBHOOK_VERIFY_TOKEN
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('Meta webhook verified');
    res.status(200).send(challenge);
  } else {
    console.log('Meta webhook verification failed');
    res.sendStatus(403);
  }
});

module.exports = router;
