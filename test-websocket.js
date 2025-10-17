const WebSocket = require('ws');

// Test WebSocket connection to a given URL
function testWebSocket(url) {
  return new Promise((resolve) => {
    console.log(`\n🔍 Testing: ${url}`);
    const startTime = Date.now();

    const ws = new WebSocket(url);

    const timeout = setTimeout(() => {
      ws.close();
      resolve({
        success: false,
        error: 'Connection timeout (10s)',
        duration: Date.now() - startTime
      });
    }, 10000);

    ws.on('open', () => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;
      console.log(`✅ Connected in ${duration}ms`);

      // Send test message
      ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));

      setTimeout(() => {
        ws.close();
        resolve({
          success: true,
          duration: duration,
          message: 'WebSocket connected successfully'
        });
      }, 1000);
    });

    ws.on('message', (data) => {
      console.log(`📨 Received: ${data}`);
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      console.log(`❌ Error: ${error.message}`);
      resolve({
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
    });

    ws.on('close', () => {
      console.log(`🔌 Connection closed`);
    });
  });
}

// Main test function
async function runTests() {
  console.log('='.repeat(60));
  console.log('WebSocket Tunnel Service Comparison Test');
  console.log('='.repeat(60));

  const results = {};

  // Test current serveo (should fail)
  console.log('\n📍 Test 1: Current Serveo Setup (Expected to FAIL)');
  results.serveo = await testWebSocket('wss://bisnesgpt.jutateknologi.com/status');

  // Instructions for manual testing
  console.log('\n' + '='.repeat(60));
  console.log('📋 Manual Testing Instructions:');
  console.log('='.repeat(60));
  console.log('\nTo test other services, follow these steps:\n');

  console.log('1️⃣  TEST LOCALHOST.RUN:');
  console.log('   Terminal 1: ssh -R 80:localhost:8443 nokey@localhost.run');
  console.log('   Copy the URL you get (e.g., https://xxxxx.lhr.life)');
  console.log('   Terminal 2: node test-websocket.js <URL>');
  console.log('');

  console.log('2️⃣  TEST CLOUDFLARE TUNNEL:');
  console.log('   Terminal 1: cloudflared tunnel --url http://localhost:8443');
  console.log('   (Or install: wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && sudo dpkg -i cloudflared-linux-amd64.deb)');
  console.log('   Copy the URL you get (e.g., https://xxxxx.trycloudflare.com)');
  console.log('   Terminal 2: node test-websocket.js <URL>');
  console.log('');

  console.log('3️⃣  TEST NGROK FREE:');
  console.log('   Terminal 1: ngrok http 8443');
  console.log('   Copy the URL you get (e.g., https://xxxxx.ngrok-free.app)');
  console.log('   Terminal 2: node test-websocket.js <URL>');
  console.log('');

  // If URL provided as argument, test it
  if (process.argv[2]) {
    const testUrl = process.argv[2];
    let wsUrl = testUrl;

    // Convert http/https to ws/wss
    if (testUrl.startsWith('http://')) {
      wsUrl = testUrl.replace('http://', 'ws://');
    } else if (testUrl.startsWith('https://')) {
      wsUrl = testUrl.replace('https://', 'wss://');
    }

    // Add /status endpoint if not present
    if (!wsUrl.includes('/status')) {
      wsUrl = wsUrl.replace(/\/$/, '') + '/status';
    }

    console.log('\n' + '='.repeat(60));
    console.log('📍 Testing Provided URL:');
    results.custom = await testWebSocket(wsUrl);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('='.repeat(60));

  Object.entries(results).forEach(([service, result]) => {
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    const time = result.duration ? `(${result.duration}ms)` : '';
    const msg = result.error || result.message;
    console.log(`\n${service.toUpperCase()}: ${status} ${time}`);
    console.log(`  ${msg}`);
  });

  console.log('\n' + '='.repeat(60));
  console.log('💡 RECOMMENDATION:');
  console.log('='.repeat(60));
  console.log('Choose a service that shows ✅ PASS with low latency (<500ms)');
  console.log('Stability and uptime are also important - test for a few minutes!');
  console.log('='.repeat(60) + '\n');
}

// Run tests
runTests().catch(console.error);
