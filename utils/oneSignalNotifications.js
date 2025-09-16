const axios = require('axios');

// OneSignal Configuration
const ONESIGNAL_CONFIG = {
  appId: process.env.ONESIGNAL_APP_ID || '8df2a641-209a-4a29-bca9-4bc57fe78a31',
  apiKey: process.env.ONESIGNAL_API_KEY,
  apiUrl: 'https://api.onesignal.com/api/v1/notifications'
};

/**
 * Send notification to all users in a company
 * @param {string} companyId - Company identifier
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {object} data - Additional data payload
 * @param {string} priority - Notification priority (high, medium, low)
 * @returns {Promise<object>} OneSignal API response
 */
async function sendCompanyNotification(companyId, title, message, data = {}, priority = 'medium') {
  try {
    const notificationData = {
      app_id: ONESIGNAL_CONFIG.appId,
      target_channel: "push",
      name: "Company Notification",
      headings: { "en": title },
      contents: { "en": message },
      include_external_user_ids: [companyId], // Targets ALL users in the company
      data: {
        type: "company_announcement",
        company_id: companyId,
        priority: priority,
        timestamp: new Date().toISOString(),
        ...data
      },
      priority: priority === 'high' ? 10 : priority === 'medium' ? 5 : 1
    };

    const response = await axios.post(ONESIGNAL_CONFIG.apiUrl, notificationData, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_CONFIG.apiKey}`
      }
    });

    console.log(`Company notification sent successfully to ${companyId}:`, response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending company notification:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Send notification to specific user by email
 * @param {string} userEmail - User's email address
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {object} data - Additional data payload
 * @param {string} priority - Notification priority (high, medium, low)
 * @returns {Promise<object>} OneSignal API response
 */
async function sendUserNotification(userEmail, title, message, data = {}, priority = 'medium') {
  try {
    const notificationData = {
      app_id: ONESIGNAL_CONFIG.appId,
      target_channel: "push",
      name: "Personal Notification",
      headings: { "en": title },
      contents: { "en": message },
      include_external_user_ids: [userEmail], // Target specific user by email
      data: {
        type: "personal",
        user_email: userEmail,
        priority: priority,
        timestamp: new Date().toISOString(),
        ...data
      },
      priority: priority === 'high' ? 10 : priority === 'medium' ? 5 : 1
    };

    const response = await axios.post(ONESIGNAL_CONFIG.apiUrl, notificationData, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_CONFIG.apiKey}`
      }
    });

    console.log(`User notification sent successfully to ${userEmail}:`, response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending user notification:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Send notification to multiple specific users
 * @param {Array<string>} userEmails - Array of user email addresses
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {object} data - Additional data payload
 * @param {string} priority - Notification priority (high, medium, low)
 * @returns {Promise<object>} OneSignal API response
 */
async function sendBulkUserNotification(userEmails, title, message, data = {}, priority = 'medium') {
  try {
    const notificationData = {
      app_id: ONESIGNAL_CONFIG.appId,
      target_channel: "push",
      name: "Bulk User Notification",
      headings: { "en": title },
      contents: { "en": message },
      include_external_user_ids: userEmails, // Target multiple specific users
      data: {
        type: "bulk_personal",
        user_emails: userEmails,
        priority: priority,
        timestamp: new Date().toISOString(),
        ...data
      },
      priority: priority === 'high' ? 10 : priority === 'medium' ? 5 : 1
    };

    const response = await axios.post(ONESIGNAL_CONFIG.apiUrl, notificationData, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_CONFIG.apiKey}`
      }
    });

    console.log(`Bulk notification sent successfully to ${userEmails.length} users:`, response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending bulk user notification:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Send notification to users with specific tags
 * @param {Array<string>} tags - Array of tags to target
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {object} data - Additional data payload
 * @param {string} priority - Notification priority (high, medium, low)
 * @returns {Promise<object>} OneSignal API response
 */
async function sendTaggedNotification(tags, title, message, data = {}, priority = 'medium') {
  try {
    const notificationData = {
      app_id: ONESIGNAL_CONFIG.appId,
      target_channel: "push",
      name: "Tagged Notification",
      headings: { "en": title },
      contents: { "en": message },
      include_tags: tags, // Target users with specific tags
      data: {
        type: "tagged",
        tags: tags,
        priority: priority,
        timestamp: new Date().toISOString(),
        ...data
      },
      priority: priority === 'high' ? 10 : priority === 'medium' ? 5 : 1
    };

    const response = await axios.post(ONESIGNAL_CONFIG.apiUrl, notificationData, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_CONFIG.apiKey}`
      }
    });

    console.log(`Tagged notification sent successfully to users with tags ${tags}:`, response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending tagged notification:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Send maintenance/alert notification
 * @param {string} companyId - Company identifier
 * @param {string} title - Alert title
 * @param {string} message - Alert message
 * @param {string} alertType - Type of alert (maintenance, outage, update, etc.)
 * @param {string} priority - Alert priority (high, medium, low)
 * @param {object} additionalData - Additional data payload
 * @returns {Promise<object>} OneSignal API response
 */
async function sendAlertNotification(companyId, title, message, alertType = 'general', priority = 'medium', additionalData = {}) {
  try {
    const notificationData = {
      app_id: ONESIGNAL_CONFIG.appId,
      target_channel: "push",
      name: "Alert Notification",
      headings: { "en": title },
      contents: { "en": message },
      include_external_user_ids: [companyId],
      data: {
        type: "alert",
        alert_type: alertType,
        company_id: companyId,
        priority: priority,
        timestamp: new Date().toISOString(),
        requires_action: priority === 'high',
        ...additionalData
      },
      priority: priority === 'high' ? 10 : priority === 'medium' ? 5 : 1
    };

    const response = await axios.post(ONESIGNAL_CONFIG.apiUrl, notificationData, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_CONFIG.apiKey}`
      }
    });

    console.log(`Alert notification sent successfully to ${companyId}:`, response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending alert notification:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Send appointment/booking notification
 * @param {string} companyId - Company identifier
 * @param {string} title - Appointment title
 * @param {string} message - Appointment message
 * @param {object} appointmentData - Appointment details
 * @param {string} priority - Notification priority
 * @returns {Promise<object>} OneSignal API response
 */
async function sendAppointmentNotification(companyId, title, message, appointmentData = {}, priority = 'medium') {
  try {
    const notificationData = {
      app_id: ONESIGNAL_CONFIG.appId,
      target_channel: "push",
      name: "Appointment Notification",
      headings: { "en": title },
      contents: { "en": message },
      include_external_user_ids: [companyId],
      data: {
        type: "appointment",
        company_id: companyId,
        priority: priority,
        timestamp: new Date().toISOString(),
        appointment: appointmentData,
        ...appointmentData
      },
      priority: priority === 'high' ? 10 : priority === 'medium' ? 5 : 1
    };

    const response = await axios.post(ONESIGNAL_CONFIG.apiUrl, notificationData, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_CONFIG.apiKey}`
      }
    });

    console.log(`Appointment notification sent successfully to ${companyId}:`, response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending appointment notification:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Get notification delivery status
 * @param {string} notificationId - OneSignal notification ID
 * @returns {Promise<object>} Notification status
 */
async function getNotificationStatus(notificationId) {
  try {
    const response = await axios.get(`${ONESIGNAL_CONFIG.apiUrl}/${notificationId}?app_id=${ONESIGNAL_CONFIG.appId}`, {
      headers: {
        'Authorization': `Basic ${ONESIGNAL_CONFIG.apiKey}`
      }
    });

    return response.data;
  } catch (error) {
    console.error('Error getting notification status:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Cancel a scheduled notification
 * @param {string} notificationId - OneSignal notification ID
 * @returns {Promise<object>} Cancellation response
 */
async function cancelNotification(notificationId) {
  try {
    const response = await axios.delete(`${ONESIGNAL_CONFIG.apiUrl}/${notificationId}?app_id=${ONESIGNAL_CONFIG.appId}`, {
      headers: {
        'Authorization': `Basic ${ONESIGNAL_CONFIG.apiKey}`
      }
    });

    console.log(`Notification ${notificationId} cancelled successfully`);
    return response.data;
  } catch (error) {
    console.error('Error cancelling notification:', error.response?.data || error.message);
    throw error;
  }
}

module.exports = {
  sendCompanyNotification,
  sendUserNotification,
  sendBulkUserNotification,
  sendTaggedNotification,
  sendAlertNotification,
  sendAppointmentNotification,
  getNotificationStatus,
  cancelNotification,
  ONESIGNAL_CONFIG
};
