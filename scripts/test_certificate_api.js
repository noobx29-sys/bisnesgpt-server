const axios = require('axios');

// Test configuration
const API_BASE_URL = 'http://localhost:3000';
const TEST_ENDPOINT = '/api/certificates/generate-and-send';

// Test data
const testRequests = [
  {
    name: 'Valid Request',
    data: {
      phoneNumber: '+60123456789',
      formId: 'test_form_001',
      formTitle: 'FUTUREX.AI 2025 Feedback Form',
      companyId: '123456'
    }
  },
  {
    name: 'Missing Phone Number',
    data: {
      formId: 'test_form_002',
      formTitle: 'FUTUREX.AI 2025 Feedback Form',
      companyId: '123456'
    }
  },
  {
    name: 'Missing Company ID',
    data: {
      phoneNumber: '+60123456789',
      formId: 'test_form_003',
      formTitle: 'FUTUREX.AI 2025 Feedback Form'
    }
  }
];

// Test function
async function testCertificateAPI() {
  console.log('🧪 Testing Certificate Generation & WhatsApp Sending API\n');
  
  for (const test of testRequests) {
    console.log(`📋 Test: ${test.name}`);
    console.log(`📤 Request: ${JSON.stringify(test.data, null, 2)}`);
    
    try {
      const response = await axios.post(`${API_BASE_URL}${TEST_ENDPOINT}`, test.data, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      });
      
      console.log(`✅ Success (${response.status}):`);
      console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);
      
    } catch (error) {
      if (error.response) {
        console.log(`❌ Error (${error.response.status}):`);
        console.log(`   Error: ${error.response.data.error}`);
        console.log(`   Details: ${error.response.data.details}`);
      } else if (error.request) {
        console.log(`❌ Network Error: No response received`);
        console.log(`   Request: ${error.request}`);
      } else {
        console.log(`❌ Error: ${error.message}`);
      }
    }
    
    console.log('─'.repeat(50));
  }
  
  // Test health endpoint
  console.log('🏥 Testing Health Endpoint');
  try {
    const healthResponse = await axios.get(`${API_BASE_URL}/api/certificates/health`);
    console.log(`✅ Health Check (${healthResponse.status}):`);
    console.log(`   Response: ${JSON.stringify(healthResponse.data, null, 2)}`);
  } catch (error) {
    console.log(`❌ Health Check Failed: ${error.message}`);
  }
}

// Run tests
if (require.main === module) {
  testCertificateAPI().catch(console.error);
}

module.exports = { testCertificateAPI };
