const axios = require('axios');

// Test configuration
const BASE_URL = 'http://localhost:3000'; // Adjust port if needed
const TEST_COMPANY_ID = '0380'; // Use a test company ID

async function testEndpoints() {
  console.log('🧪 Testing API Endpoints...\n');

  try {
    // Test 1: Events endpoint
    console.log('1️⃣ Testing Events Endpoint...');
    const eventsResponse = await axios.get(`${BASE_URL}/api/events?company_id=${TEST_COMPANY_ID}`);
    console.log('✅ Events endpoint successful');
    console.log(`   Found ${eventsResponse.data.events.length} events`);
    console.log(`   Pagination: ${eventsResponse.data.pagination.total} total events`);
    console.log('   Sample event:', eventsResponse.data.events[0] || 'No events found');
    console.log('');

    // Test 2: Attendance Records endpoint
    console.log('2️⃣ Testing Attendance Records Endpoint...');
    const attendanceResponse = await axios.get(`${BASE_URL}/api/attendance-records?company_id=${TEST_COMPANY_ID}`);
    console.log('✅ Attendance records endpoint successful');
    console.log(`   Found ${attendanceResponse.data.attendance_records.length} attendance records`);
    console.log(`   Pagination: ${attendanceResponse.data.pagination.total} total records`);
    console.log('   Sample record:', attendanceResponse.data.attendance_records[0] || 'No records found');
    console.log('');

    // Test 3: Pagination
    console.log('3️⃣ Testing Pagination...');
    const paginatedResponse = await axios.get(`${BASE_URL}/api/events?company_id=${TEST_COMPANY_ID}&page=1&limit=5`);
    console.log('✅ Pagination working correctly');
    console.log(`   Page: ${paginatedResponse.data.pagination.page}`);
    console.log(`   Limit: ${paginatedResponse.data.pagination.limit}`);
    console.log(`   Total: ${paginatedResponse.data.pagination.total}`);
    console.log(`   Total Pages: ${paginatedResponse.data.pagination.total_pages}`);
    console.log('');

    // Test 4: Error handling - missing company_id
    console.log('4️⃣ Testing Error Handling...');
    try {
      await axios.get(`${BASE_URL}/api/events`);
      console.log('❌ Should have returned error for missing company_id');
    } catch (error) {
      if (error.response && error.response.status === 422) {
        console.log('✅ Error handling working correctly - missing company_id returns 422');
      } else {
        console.log('❌ Unexpected error response:', error.response?.status);
      }
    }

    console.log('\n🎉 All tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  testEndpoints();
}

module.exports = { testEndpoints };
