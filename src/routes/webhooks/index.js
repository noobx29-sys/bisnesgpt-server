/**
 * Webhook routes index
 */

const router = require('express').Router();

router.use('/', require('./dialog360'));
router.use('/', require('./meta'));

module.exports = router;
