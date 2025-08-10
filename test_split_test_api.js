/**
 * Split Test API Test Script
 * 
 * This script tests all the split test API endpoints to ensure they work correctly.
 * Run this after setting up the split test system.
 * 
 * Usage: node test_split_test_api.js
 */

const axios = require('axios');

// Configuration - Update these for your environment
const BASE_URL = 'http://localhost:3000'; // Adjust to your server URL
const TEST_COMPANY_ID = 'test-company-123';
const TEST_CUSTOMER_ID = 'test-customer-456';

// Test data
const testVariations = [
  {
    name: 'Friendly Sales Assistant',
    instructions: 'You are a friendly and enthusiastic sales assistant. Always greet customers warmly and focus on their needs.',
    isActive: true
  },
  {
    name: 'Professional Consultant',
    instructions: 'You are a professional business consultant. Provide detailed, analytical responses and focus on business value.',
    isActive: true
  },
  {
    name: 'Casual Helper',
    instructions: 'You are a casual, helpful assistant. Keep things simple and conversational.',
    isActive: false
  }
];

// Helper function to make API calls
async function apiCall(method, endpoint, data = null) {
  try {
    const config = {
      method,
      url: `${BASE_URL}${endpoint}`,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    if (data) {
      config.data = data;
    }
    
    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error(`API call failed: ${method} ${endpoint}`);
    console.error('Error:', error.response?.data || error.message);
    throw error;
  }
}

// Test functions
async function testCreateVariations() {
  console.log('\n🧪 Testing: Create Variations');
  
  const data = {
    companyId: TEST_COMPANY_ID,
    variations: testVariations
  };
  
  const result = await apiCall('POST', '/api/split-test/variations', data);
  console.log('✅ Created variations:', result.variations.length);
  
  return result.variations;
}

async function testGetVariations() {
  console.log('\n🧪 Testing: Get Variations');
  
  const result = await apiCall('GET', `/api/split-test/variations?companyId=${TEST_COMPANY_ID}`);
  console.log('✅ Retrieved variations:', result.variations.length);
  
  result.variations.forEach(v => {
    console.log(`  - ${v.name} (${v.isActive ? 'Active' : 'Inactive'})`);
  });
  
  return result.variations;
}

async function testToggleVariation(variationId) {
  console.log('\n🧪 Testing: Toggle Variation Status');
  
  const data = {
    companyId: TEST_COMPANY_ID,
    isActive: false
  };
  
  const result = await apiCall('PATCH', `/api/split-test/variations/${variationId}/toggle`, data);
  console.log('✅ Toggled variation status:', result.variation.name, '→', result.variation.isActive);
  
  return result.variation;
}

async function testAssignCustomer() {
  console.log('\n🧪 Testing: Assign Customer');
  
  const data = {
    customerId: TEST_CUSTOMER_ID,
    companyId: TEST_COMPANY_ID
  };
  
  const result = await apiCall('POST', '/api/split-test/assign-customer', data);
  
  if (result.assignedVariation) {
    console.log('✅ Customer assigned to variation:', result.assignedVariation.id);
    console.log('  Instructions preview:', result.assignedVariation.instructions.substring(0, 50) + '...');
  } else {
    console.log('✅ No active variations found for assignment');
  }
  
  return result.assignedVariation;
}

async function testMarkClosed() {
  console.log('\n🧪 Testing: Mark Customer as Closed');
  
  const data = {
    customerId: TEST_CUSTOMER_ID,
    companyId: TEST_COMPANY_ID
  };
  
  const result = await apiCall('POST', '/api/split-test/mark-closed', data);
  console.log('✅ Customer marked as closed:', result.message);
  
  return result;
}

async function testGetPerformance() {
  console.log('\n🧪 Testing: Get Performance Data');
  
  const result = await apiCall('GET', `/api/split-test/performance?companyId=${TEST_COMPANY_ID}`);
  console.log('✅ Performance metrics:');
  console.log(`  Total Customers: ${result.totalCustomers}`);
  console.log(`  Total Closed: ${result.totalClosed}`);
  console.log(`  Conversion Rate: ${result.overallConversionRate}%`);
  
  result.variations.forEach(v => {
    console.log(`  - ${v.name}: ${v.customers} customers, ${v.closedCustomers} closed (${v.conversionRate}%)`);
  });
  
  return result;
}

// Main test runner
async function runTests() {
  console.log('🚀 Starting Split Test API Tests');
  console.log('=====================================');
  
  try {
    // Test 1: Create variations
    const createdVariations = await testCreateVariations();
    
    // Test 2: Get variations
    const variations = await testGetVariations();
    
    // Test 3: Toggle a variation (make one inactive)
    if (variations.length > 0) {
      await testToggleVariation(variations[0].id);
    }
    
    // Test 4: Assign customer
    const assignment = await testAssignCustomer();
    
    // Test 5: Mark customer as closed (if assigned)
    if (assignment) {
      await testMarkClosed();
    }
    
    // Test 6: Get performance data
    await testGetPerformance();
    
    console.log('\n🎉 All tests completed successfully!');
    console.log('=====================================');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the tests if this file is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = {
  runTests,
  testCreateVariations,
  testGetVariations,
  testAssignCustomer,
  testMarkClosed,
  testGetPerformance
}; 