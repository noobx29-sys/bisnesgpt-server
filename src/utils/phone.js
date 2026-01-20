/**
 * Phone number utility functions
 */

/**
 * Extract phone number from WhatsApp ID formats
 * @param {string} input - WhatsApp ID like "1234567890@c.us" or "1234567890@lid"
 * @returns {string|null} - Extracted phone number or null
 */
function extract(input) {
  if (!input) return null;
  if (input.includes('@lid')) {
    return input.match(/(\d+)@lid/)?.[1] || null;
  }
  return input.replace(/@(c\.us|s\.whatsapp\.net|g\.us)/, '');
}

/**
 * Format phone number to WhatsApp ID
 * @param {string} phone - Phone number
 * @returns {string} - WhatsApp ID format
 */
function format(phone) {
  return `${phone.replace(/\D/g, '')}@c.us`;
}

/**
 * Validate phone number
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - Whether phone number is valid
 */
function isValid(phone) {
  const n = phone.replace(/\D/g, '');
  return n.length >= 10 && n.length <= 15;
}

/**
 * Normalize phone number (remove non-digits)
 * @param {string} phone - Phone number
 * @returns {string} - Normalized phone number
 */
function normalize(phone) {
  return phone.replace(/\D/g, '');
}

module.exports = { extract, format, isValid, normalize };
