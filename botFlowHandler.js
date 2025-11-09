/**
 * Bot Flow Handler Module
 * Handles execution of visual bot flows created in the Bot Builder UI
 * 
 * Features:
 * - Executes flow nodes sequentially
 * - Handles conditional branching (If/Else)
 * - Supports loops and delays
 * - Variable storage and templating
 * - AI Assistant integration
 */

const pool = require('./db');
const OpenAI = require('openai');

// Initialize OpenAI for AI Assistant blocks
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Main handler for incoming messages when company is in Bot Mode
 * @param {Object} client - WhatsApp client instance
 * @param {Object} msg - WhatsApp message object
 * @param {string} companyId - Company identifier
 * @param {number} phoneIndex - Phone number index
 */
async function handleBotFlowMessage(client, msg, companyId, phoneIndex) {
  try {
    console.log(`🤖 [BOT_FLOW] ===== Starting bot flow execution =====`);
    console.log(`🤖 [BOT_FLOW] Company: ${companyId}`);
    console.log(`🤖 [BOT_FLOW] From: ${msg.from}`);
    console.log(`🤖 [BOT_FLOW] Message: ${msg.body}`);
    
    // Load the bot flow for this company
    const botFlow = await loadBotFlow(companyId);
    
    if (!botFlow || !botFlow.nodes || botFlow.nodes.length === 0) {
      console.log(`🤖 [BOT_FLOW] ⚠️ No bot flow found, sending default message`);
      await client.sendMessage(msg.from, '⚙️ Bot is not configured yet. Please contact support.');
      return;
    }
    
    console.log(`🤖 [BOT_FLOW] Flow loaded: "${botFlow.name}" (${botFlow.nodes.length} nodes, ${botFlow.edges.length} edges)`);
    
    // Get contact info
    const contact = await msg.getContact();
    const contactName = contact.pushname || contact.name || contact.verifiedName || 'User';
    const contactPhone = msg.from.replace('@c.us', '');
    
    // Initialize execution context
    const context = {
      userMessage: msg.body,
      contactId: msg.from,
      variables: {
        message: msg.body,
        name: contactName,
        phone: contactPhone,
        email: '',
        address: '',
        notes: '',
      },
      visitedNodes: new Set(),
    };
    
    console.log(`🤖 [BOT_FLOW] Execution context initialized:`, {
      contactName,
      contactPhone,
      messagePreview: msg.body.substring(0, 50),
    });
    
    // Find the trigger node (WhatsApp Trigger)
    const triggerNode = botFlow.nodes.find(node => node.type === 'whatsappTrigger');
    
    if (!triggerNode) {
      console.log(`🤖 [BOT_FLOW] ❌ No trigger node found in flow`);
      await client.sendMessage(msg.from, '⚠️ Bot flow is not configured correctly.');
      return;
    }
    
    console.log(`🤖 [BOT_FLOW] Trigger node found: ${triggerNode.id}`);
    
    // Find the first connected node
    const firstEdge = botFlow.edges.find(edge => edge.source === triggerNode.id);
    
    if (!firstEdge) {
      console.log(`🤖 [BOT_FLOW] ⚠️ No nodes connected to trigger`);
      await client.sendMessage(msg.from, '⚠️ Bot flow has no actions configured.');
      return;
    }
    
    console.log(`🤖 [BOT_FLOW] Starting execution from node: ${firstEdge.target}`);
    
    // Log execution start (optional - can be used for analytics)
    const executionId = await logExecutionStart(companyId, msg.from, botFlow.id);
    
    // Execute the flow starting from the first node
    await executeNode(client, msg, botFlow, firstEdge.target, context, executionId);
    
    // Log execution completion
    await logExecutionComplete(executionId, context);
    
    console.log(`🤖 [BOT_FLOW] ✅ Flow execution completed successfully`);
    console.log(`🤖 [BOT_FLOW] ===== End bot flow execution =====`);
    
  } catch (error) {
    console.error(`🤖 [BOT_FLOW] ❌ Error executing bot flow:`, error);
    console.error(`🤖 [BOT_FLOW] Error stack:`, error.stack);
    
    try {
      await client.sendMessage(msg.from, '❌ Sorry, an error occurred while processing your message. Please try again later.');
    } catch (sendError) {
      console.error(`🤖 [BOT_FLOW] Failed to send error message:`, sendError);
    }
  }
}

/**
 * Loads the bot flow from database
 * @param {string} companyId - Company identifier
 * @returns {Object|null} Bot flow object or null if not found
 */
async function loadBotFlow(companyId) {
  let client;
  try {
    client = await pool.connect();
    
    const result = await client.query(
      'SELECT * FROM bot_flows WHERE company_id = $1',
      [companyId]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const flow = result.rows[0];
    return {
      id: flow.id,
      companyId: flow.company_id,
      name: flow.name,
      nodes: flow.nodes,
      edges: flow.edges,
      createdAt: flow.created_at,
      updatedAt: flow.updated_at,
    };
  } catch (error) {
    console.error('🤖 [BOT_FLOW] Error loading bot flow:', error);
    return null;
  } finally {
    if (client) client.release();
  }
}

/**
 * Executes a single node in the flow
 * @param {Object} client - WhatsApp client
 * @param {Object} msg - WhatsApp message
 * @param {Object} botFlow - Bot flow configuration
 * @param {string} nodeId - Node ID to execute
 * @param {Object} context - Execution context with variables
 * @param {number} executionId - Execution log ID
 */
async function executeNode(client, msg, botFlow, nodeId, context, executionId) {
  // Prevent infinite loops
  if (context.visitedNodes.has(nodeId)) {
    console.log(`🤖 [BOT_FLOW] ⚠️ Circular reference detected at node ${nodeId}, stopping execution`);
    return;
  }
  
  const node = botFlow.nodes.find(n => n.id === nodeId);
  
  if (!node) {
    console.log(`🤖 [BOT_FLOW] ❌ Node ${nodeId} not found in flow`);
    return;
  }
  
  context.visitedNodes.add(nodeId);
  console.log(`🤖 [BOT_FLOW] 📍 Executing node: ${node.type} (${nodeId}) - Label: "${node.data.label || 'N/A'}"`);
  
  // Log node execution
  await logNodeExecution(executionId, nodeId, node.type);
  
  try {
    switch (node.type) {
      case 'sendMessage':
        await executeSendMessage(client, msg, node, context);
        const nextEdge = botFlow.edges.find(edge => edge.source === nodeId);
        if (nextEdge) {
          await executeNode(client, msg, botFlow, nextEdge.target, context, executionId);
        }
        break;
        
      case 'aiAssistant':
        await executeAIAssistant(node, context);
        const aiNextEdge = botFlow.edges.find(edge => edge.source === nodeId);
        if (aiNextEdge) {
          await executeNode(client, msg, botFlow, aiNextEdge.target, context, executionId);
        }
        break;
        
      case 'ifElse':
        const conditionMet = await executeIfElse(node, context);
        const branchEdge = botFlow.edges.find(
          edge => edge.source === nodeId && 
          edge.sourceHandle === (conditionMet ? 'true' : 'false')
        );
        if (branchEdge) {
          console.log(`🤖 [BOT_FLOW] 🔀 Taking ${conditionMet ? 'TRUE' : 'FALSE'} path`);
          await executeNode(client, msg, botFlow, branchEdge.target, context, executionId);
        } else {
          console.log(`🤖 [BOT_FLOW] ⚠️ No edge found for ${conditionMet ? 'TRUE' : 'FALSE'} path`);
        }
        break;
        
      case 'delay':
        await executeDelay(node);
        const delayNextEdge = botFlow.edges.find(edge => edge.source === nodeId);
        if (delayNextEdge) {
          await executeNode(client, msg, botFlow, delayNextEdge.target, context, executionId);
        }
        break;
        
      case 'loop':
        await executeLoop(client, msg, botFlow, node, context, executionId);
        break;
        
      case 'setVariable':
        executeSetVariable(node, context);
        const varNextEdge = botFlow.edges.find(edge => edge.source === nodeId);
        if (varNextEdge) {
          await executeNode(client, msg, botFlow, varNextEdge.target, context, executionId);
        }
        break;
        
      default:
        console.log(`🤖 [BOT_FLOW] ⚠️ Unknown node type: ${node.type}`);
    }
  } catch (error) {
    console.error(`🤖 [BOT_FLOW] ❌ Error executing node ${nodeId}:`, error);
    await logNodeError(executionId, nodeId, error.message);
    
    // Continue to next node even if this one fails (graceful degradation)
    const errorNextEdge = botFlow.edges.find(edge => edge.source === nodeId);
    if (errorNextEdge) {
      console.log(`🤖 [BOT_FLOW] ⚠️ Continuing to next node despite error`);
      await executeNode(client, msg, botFlow, errorNextEdge.target, context, executionId);
    }
  }
}

/**
 * Executes a Send Message node
 */
async function executeSendMessage(client, msg, node, context) {
  let message = node.data.message || 'Hello!';
  
  // Replace variables in message
  message = replaceVariables(message, context);
  
  console.log(`🤖 [BOT_FLOW] 💬 Sending message: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`);
  
  try {
    await client.sendMessage(msg.from, message);
    console.log(`🤖 [BOT_FLOW] ✅ Message sent successfully`);
  } catch (error) {
    console.error(`🤖 [BOT_FLOW] ❌ Failed to send message:`, error);
    throw error;
  }
  
  // Add delay to avoid rate limiting
  await sleep(1000);
}

/**
 * Executes an AI Assistant node
 */
async function executeAIAssistant(node, context) {
  try {
    const instruction = node.data.instruction || 'Analyze the message and provide a helpful response';
    const selectedVars = node.data.variables || ['{{message}}'];
    const outputVar = node.data.outputVariable || 'aiResponse';
    
    console.log(`🤖 [BOT_FLOW] 🧠 AI Assistant - Instruction: "${instruction.substring(0, 100)}${instruction.length > 100 ? '...' : ''}"`);
    console.log(`🤖 [BOT_FLOW] 🧠 AI Assistant - Variables: ${selectedVars.join(', ')}`);
    console.log(`🤖 [BOT_FLOW] 🧠 AI Assistant - Output variable: ${outputVar}`);
    
    // Build context for AI
    let aiContext = `User instruction: ${instruction}\n\n`;
    aiContext += `Available data:\n`;
    
    selectedVars.forEach(varTemplate => {
      const varName = varTemplate.replace(/{{|}}/g, '');
      const varValue = context.variables[varName] || '';
      aiContext += `- ${varName}: ${varValue}\n`;
    });
    
    console.log(`🤖 [BOT_FLOW] 🧠 Calling OpenAI API...`);
    
    // Call OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that follows instructions precisely. Provide concise, relevant responses.'
        },
        {
          role: 'user',
          content: aiContext
        }
      ],
      temperature: 0.7,
      max_tokens: 500,
    });
    
    const aiResponse = response.choices[0].message.content.trim();
    console.log(`🤖 [BOT_FLOW] 🧠 AI Response: "${aiResponse.substring(0, 100)}${aiResponse.length > 100 ? '...' : ''}"`);
    
    // Store AI response in context
    context.variables[outputVar] = aiResponse;
    console.log(`🤖 [BOT_FLOW] 🧠 Stored in variable: ${outputVar}`);
    
  } catch (error) {
    console.error(`🤖 [BOT_FLOW] ❌ AI Assistant error:`, error);
    // Fallback response
    const fallbackMessage = 'I apologize, I am having trouble processing your request right now.';
    context.variables[node.data.outputVariable || 'aiResponse'] = fallbackMessage;
    console.log(`🤖 [BOT_FLOW] ⚠️ Using fallback response`);
  }
}

/**
 * Executes an If/Else node
 */
async function executeIfElse(node, context) {
  const condition = node.data.condition || '';
  console.log(`🤖 [BOT_FLOW] 🔍 Evaluating condition: "${condition}"`);
  
  // Replace variables in condition
  let evalCondition = condition;
  for (const [key, value] of Object.entries(context.variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    evalCondition = evalCondition.replace(regex, value);
  }
  
  console.log(`🤖 [BOT_FLOW] 🔍 Condition after variable replacement: "${evalCondition}"`);
  
  // Check for '==' conditions
  if (evalCondition.includes('==')) {
    const parts = evalCondition.split('==').map(p => p.trim().replace(/'/g, '').replace(/"/g, ''));
    if (parts.length === 2) {
      const result = parts[0].toLowerCase() === parts[1].toLowerCase();
      console.log(`🤖 [BOT_FLOW] 🔍 Condition result: ${result} ("${parts[0]}" == "${parts[1]}")`);
      return result;
    }
  }
  
  // Check for 'contains' conditions
  if (evalCondition.toLowerCase().includes('contains')) {
    const match = evalCondition.match(/(.+)\s+contains\s+['"](.+)['"]/i);
    if (match) {
      const text = match[1].trim();
      const keyword = match[2].toLowerCase();
      const result = text.toLowerCase().includes(keyword);
      console.log(`🤖 [BOT_FLOW] 🔍 Condition result: ${result} (contains "${keyword}")`);
      return result;
    }
  }
  
  // Check for '!=' conditions
  if (evalCondition.includes('!=')) {
    const parts = evalCondition.split('!=').map(p => p.trim().replace(/'/g, '').replace(/"/g, ''));
    if (parts.length === 2) {
      const result = parts[0].toLowerCase() !== parts[1].toLowerCase();
      console.log(`🤖 [BOT_FLOW] 🔍 Condition result: ${result} ("${parts[0]}" != "${parts[1]}")`);
      return result;
    }
  }
  
  console.log(`🤖 [BOT_FLOW] 🔍 Condition defaulting to false (unrecognized format)`);
  return false;
}

/**
 * Executes a Delay node
 */
async function executeDelay(node) {
  const delay = node.data.delay || 1;
  const unit = node.data.unit || 'seconds';
  
  let milliseconds = delay * 1000;
  if (unit === 'minutes') milliseconds = delay * 60 * 1000;
  if (unit === 'hours') milliseconds = delay * 60 * 60 * 1000;
  
  console.log(`🤖 [BOT_FLOW] ⏳ Delaying for ${delay} ${unit} (${milliseconds}ms)`);
  await sleep(milliseconds);
  console.log(`🤖 [BOT_FLOW] ✅ Delay completed`);
}

/**
 * Executes a Loop node
 */
async function executeLoop(client, msg, botFlow, node, context, executionId) {
  const iterations = node.data.iterations || 1;
  
  console.log(`🤖 [BOT_FLOW] 🔁 Starting loop: ${iterations} iteration(s)`);
  
  // Find loop body edge
  const loopBodyEdge = botFlow.edges.find(
    edge => edge.source === node.id && edge.sourceHandle === 'loop'
  );
  
  if (loopBodyEdge) {
    for (let i = 0; i < iterations; i++) {
      console.log(`🤖 [BOT_FLOW] 🔁 Loop iteration ${i + 1}/${iterations}`);
      
      // Create a new visited nodes set for each iteration
      const loopContext = {
        ...context,
        visitedNodes: new Set(),
        variables: { ...context.variables, loopIndex: i + 1 },
      };
      
      await executeNode(client, msg, botFlow, loopBodyEdge.target, loopContext, executionId);
      
      // Copy any new variables back to main context
      Object.assign(context.variables, loopContext.variables);
    }
    console.log(`🤖 [BOT_FLOW] 🔁 Loop completed`);
  } else {
    console.log(`🤖 [BOT_FLOW] ⚠️ No loop body edge found`);
  }
  
  // Continue after loop (single exit point)
  const exitEdge = botFlow.edges.find(
    edge => edge.source === node.id && !edge.sourceHandle
  );
  
  if (exitEdge) {
    console.log(`🤖 [BOT_FLOW] 🔁 Continuing after loop`);
    await executeNode(client, msg, botFlow, exitEdge.target, context, executionId);
  }
}

/**
 * Executes a Set Variable node
 */
function executeSetVariable(node, context) {
  const varName = node.data.variableName || '';
  let varValue = node.data.variableValue || '';
  
  // Replace variables in value
  varValue = replaceVariables(varValue, context);
  
  console.log(`🤖 [BOT_FLOW] 📝 Setting variable: ${varName} = "${varValue}"`);
  context.variables[varName] = varValue;
}

/**
 * Replaces variables in a string
 * Format: {{variableName}}
 */
function replaceVariables(text, context) {
  let result = text;
  
  // Replace all variables
  for (const [key, value] of Object.entries(context.variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, value);
  }
  
  return result;
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Logs execution start (optional - for analytics)
 */
async function logExecutionStart(companyId, contactId, flowId) {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query(
      `INSERT INTO bot_flow_executions (company_id, contact_id, flow_id, status)
       VALUES ($1, $2, $3, 'running')
       RETURNING id`,
      [companyId, contactId, flowId]
    );
    return result.rows[0].id;
  } catch (error) {
    console.error('🤖 [BOT_FLOW] Error logging execution start:', error);
    return null;
  } finally {
    if (client) client.release();
  }
}

/**
 * Logs execution completion
 */
async function logExecutionComplete(executionId, context) {
  if (!executionId) return;
  
  let client;
  try {
    client = await pool.connect();
    await client.query(
      `UPDATE bot_flow_executions 
       SET status = 'completed', 
           completed_at = NOW(),
           variables_final = $1
       WHERE id = $2`,
      [JSON.stringify(context.variables), executionId]
    );
  } catch (error) {
    console.error('🤖 [BOT_FLOW] Error logging execution complete:', error);
  } finally {
    if (client) client.release();
  }
}

/**
 * Logs node execution
 */
async function logNodeExecution(executionId, nodeId, nodeType) {
  if (!executionId) return;
  
  let client;
  try {
    client = await pool.connect();
    await client.query(
      `UPDATE bot_flow_executions 
       SET nodes_executed = nodes_executed || $1::jsonb
       WHERE id = $2`,
      [JSON.stringify([{ nodeId, nodeType, timestamp: new Date() }]), executionId]
    );
  } catch (error) {
    console.error('🤖 [BOT_FLOW] Error logging node execution:', error);
  } finally {
    if (client) client.release();
  }
}

/**
 * Logs node error
 */
async function logNodeError(executionId, nodeId, errorMessage) {
  if (!executionId) return;
  
  let client;
  try {
    client = await pool.connect();
    await client.query(
      `UPDATE bot_flow_executions 
       SET status = 'error',
           error_message = $1,
           completed_at = NOW()
       WHERE id = $2`,
      [`Error at node ${nodeId}: ${errorMessage}`, executionId]
    );
  } catch (error) {
    console.error('🤖 [BOT_FLOW] Error logging node error:', error);
  } finally {
    if (client) client.release();
  }
}

module.exports = {
  handleBotFlowMessage,
  loadBotFlow,
};
