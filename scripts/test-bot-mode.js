/**
 * Bot Mode Test Script
 * Run this script to verify bot mode implementation
 * 
 * Usage: node test-bot-mode.js
 */

const pool = require('./db');

async function testBotMode() {
  console.log('🧪 Testing Bot Mode Implementation...\n');
  
  let allTestsPassed = true;
  
  try {
    // Test 1: Database Connection
    console.log('📡 Test 1: Database Connection');
    const connectionTest = await pool.query('SELECT NOW()');
    console.log('✅ Database connected:', connectionTest.rows[0].now);
    console.log();
    
    // Test 2: Check if bot_flows table exists
    console.log('📊 Test 2: Check bot_flows table');
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'bot_flows'
      )
    `);
    
    if (tableCheck.rows[0].exists) {
      console.log('✅ bot_flows table exists');
    } else {
      console.log('❌ bot_flows table NOT found - Run migration!');
      allTestsPassed = false;
    }
    console.log();
    
    // Test 3: Check if companies.bot_mode column exists
    console.log('📊 Test 3: Check companies.bot_mode column');
    const columnCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'companies' 
        AND column_name = 'bot_mode'
      )
    `);
    
    if (columnCheck.rows[0].exists) {
      console.log('✅ companies.bot_mode column exists');
    } else {
      console.log('❌ companies.bot_mode column NOT found - Run migration!');
      allTestsPassed = false;
    }
    console.log();
    
    // Test 4: Check if bot_flow_executions table exists
    console.log('📊 Test 4: Check bot_flow_executions table');
    const executionsTableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'bot_flow_executions'
      )
    `);
    
    if (executionsTableCheck.rows[0].exists) {
      console.log('✅ bot_flow_executions table exists');
    } else {
      console.log('⚠️  bot_flow_executions table NOT found (optional - for logging)');
    }
    console.log();
    
    // Test 5: Test creating a sample bot flow
    console.log('📝 Test 5: Create test bot flow');
    const testCompanyId = 'test-bot-mode-' + Date.now();
    
    const sampleFlow = {
      companyId: testCompanyId,
      name: 'Test Flow',
      nodes: [
        {
          id: 'node-1',
          type: 'whatsappTrigger',
          position: { x: 0, y: 0 },
          data: { label: 'Trigger' }
        },
        {
          id: 'node-2',
          type: 'sendMessage',
          position: { x: 0, y: 100 },
          data: { label: 'Welcome', message: 'Hello {{name}}!' }
        }
      ],
      edges: [
        {
          id: 'edge-1',
          source: 'node-1',
          target: 'node-2',
          type: 'smoothstep',
          animated: true,
          markerEnd: { type: 'arrowclosed' }
        }
      ]
    };
    
    await pool.query(
      `INSERT INTO bot_flows (company_id, name, nodes, edges)
       VALUES ($1, $2, $3, $4)`,
      [
        sampleFlow.companyId,
        sampleFlow.name,
        JSON.stringify(sampleFlow.nodes),
        JSON.stringify(sampleFlow.edges)
      ]
    );
    console.log('✅ Test flow created');
    console.log();
    
    // Test 6: Read the flow back
    console.log('📖 Test 6: Read test bot flow');
    const flowResult = await pool.query(
      'SELECT * FROM bot_flows WHERE company_id = $1',
      [testCompanyId]
    );
    
    if (flowResult.rows.length > 0) {
      const flow = flowResult.rows[0];
      console.log('✅ Flow retrieved successfully');
      console.log(`   - Name: ${flow.name}`);
      console.log(`   - Nodes: ${flow.nodes.length}`);
      console.log(`   - Edges: ${flow.edges.length}`);
    } else {
      console.log('❌ Failed to retrieve flow');
      allTestsPassed = false;
    }
    console.log();
    
    // Test 7: Update flow
    console.log('✏️  Test 7: Update test bot flow');
    await pool.query(
      `UPDATE bot_flows 
       SET name = $1, updated_at = NOW()
       WHERE company_id = $2`,
      ['Test Flow Updated', testCompanyId]
    );
    
    const updatedFlow = await pool.query(
      'SELECT name FROM bot_flows WHERE company_id = $1',
      [testCompanyId]
    );
    
    if (updatedFlow.rows[0].name === 'Test Flow Updated') {
      console.log('✅ Flow updated successfully');
    } else {
      console.log('❌ Failed to update flow');
      allTestsPassed = false;
    }
    console.log();
    
    // Test 8: Clean up test data
    console.log('🧹 Test 8: Clean up test data');
    await pool.query(
      'DELETE FROM bot_flows WHERE company_id = $1',
      [testCompanyId]
    );
    console.log('✅ Test data cleaned up');
    console.log();
    
    // Test 9: Check OpenAI API key
    console.log('🔑 Test 9: Check OpenAI API key');
    if (process.env.OPENAI_API_KEY) {
      console.log('✅ OPENAI_API_KEY is set');
      console.log(`   - Key preview: ${process.env.OPENAI_API_KEY.substring(0, 10)}...`);
    } else {
      console.log('⚠️  OPENAI_API_KEY not set (AI Assistant blocks will not work)');
    }
    console.log();
    
    // Test 10: Check if botFlowHandler exists
    console.log('📦 Test 10: Check botFlowHandler module');
    try {
      const botFlowHandler = require('./botFlowHandler');
      if (botFlowHandler.handleBotFlowMessage && botFlowHandler.loadBotFlow) {
        console.log('✅ botFlowHandler module loaded successfully');
      } else {
        console.log('❌ botFlowHandler module missing required functions');
        allTestsPassed = false;
      }
    } catch (error) {
      console.log('❌ botFlowHandler module not found:', error.message);
      allTestsPassed = false;
    }
    console.log();
    
    // Final Summary
    console.log('═══════════════════════════════════════════════');
    if (allTestsPassed) {
      console.log('✅ All critical tests passed!');
      console.log('🚀 Bot Mode is ready to use!');
      console.log();
      console.log('Next steps:');
      console.log('1. Create bot flows in the UI');
      console.log('2. Switch company to bot mode: POST /api/company-mode');
      console.log('3. Test with real WhatsApp messages');
    } else {
      console.log('❌ Some tests failed!');
      console.log('⚠️  Please fix the issues above before using Bot Mode');
      console.log();
      console.log('To fix:');
      console.log('1. Run database migration: psql $DATABASE_URL -f migrations/create_bot_flows_tables.sql');
      console.log('2. Ensure all files are in place');
      console.log('3. Restart the server');
    }
    console.log('═══════════════════════════════════════════════');
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    console.error(error.stack);
    allTestsPassed = false;
  } finally {
    await pool.end();
  }
  
  process.exit(allTestsPassed ? 0 : 1);
}

// Run tests
testBotMode();
