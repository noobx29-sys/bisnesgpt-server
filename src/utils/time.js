/**
 * Time and scheduling utility functions
 */

/**
 * Convert timestamp to Date
 * @param {number|string} timestamp - Unix timestamp (seconds or milliseconds)
 * @returns {Date} - Date object
 */
function toDate(timestamp) {
  const ts = typeof timestamp === 'string' ? parseInt(timestamp) : timestamp;
  // If timestamp is in seconds (less than year 3000 in seconds), convert to ms
  return new Date(ts < 100000000000 ? ts * 1000 : ts);
}

/**
 * Get delay in milliseconds until target time
 * @param {Date|string} target - Target time
 * @returns {number} - Milliseconds until target (0 if past)
 */
function delayUntil(target) {
  const targetDate = typeof target === 'string' ? new Date(target) : target;
  const delay = targetDate.getTime() - Date.now();
  return Math.max(0, delay);
}

/**
 * Format date for display
 * @param {Date} date - Date object
 * @param {string} locale - Locale string
 * @returns {string} - Formatted date string
 */
function formatDate(date, locale = 'en-US') {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Check if date is within business hours
 * @param {Date} date - Date to check
 * @param {number} startHour - Start hour (0-23)
 * @param {number} endHour - End hour (0-23)
 * @returns {boolean} - Whether within business hours
 */
function isBusinessHours(date, startHour = 9, endHour = 18) {
  const hour = date.getHours();
  const day = date.getDay();
  return day >= 1 && day <= 5 && hour >= startHour && hour < endHour;
}

module.exports = { toDate, delayUntil, formatDate, isBusinessHours };
