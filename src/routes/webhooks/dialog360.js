/**
 * 360dialog webhook routes
 */

const router = require('express').Router();
const dialog360 = require('../../services/whatsapp/dialog360');

/**
 * POST /webhook/360dialog
 * Webhook endpoint for 360dialog events
 */
router.post('/360dialog', async (req, res) => {
  // Always respond 200 immediately to avoid timeouts
  res.sendStatus(200);

  try {
    await dialog360.handleWebhook(req.body);
  } catch (e) {
    console.error('360dialog webhook error:', e);
  }
});

/**
 * GET /webhook/360dialog
 * Webhook verification (Meta webhook challenge)
 */
router.get('/360dialog', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

module.exports = router;
