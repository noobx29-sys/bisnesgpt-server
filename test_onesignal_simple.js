const { sendCompanyNotification } = require('./utils/oneSignalNotifications');

async function testSimpleNotification() {
  console.log('🧪 Testing Simple OneSignal Notification...');
  
  try {
    const result = await sendCompanyNotification(
      '0123', // Test company ID
      '🧪 Test Notification',
      'This is a test notification from your backend!',
      { 
        test: true,
        timestamp: new Date().toISOString(),
        message: 'Hello from OneSignal!'
      },
      'medium'
    );
    
    console.log('✅ Notification sent successfully!');
    console.log('Notification ID:', result.id);
    console.log('Result:', result);
    
  } catch (error) {
    console.error('❌ Notification failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the test
testSimpleNotification();
