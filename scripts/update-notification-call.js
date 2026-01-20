const fs = require('fs');

// Read the main file
const mainFile = 'bots/handleMessagesTemplateWweb.js';
const content = fs.readFileSync(mainFile, 'utf8');

// The old code to replace
const oldCode = `} finally {
      await safeRelease(client);
      await addNotificationToUser(idSubstring, messageBody, contactName);
    }`;

// The new code with AI decision
const newCode = `} finally {
      await safeRelease(client);

      // Check if this company should use AI-based notification filtering
      if (AI_NOTIFICATION_COMPANY_IDS.includes(idSubstring)) {
        const shouldNotify = await shouldSendNotificationAI(
          messageBody,
          contactName,
          idSubstring
        );
        if (shouldNotify) {
          await addNotificationToUser(idSubstring, messageBody, contactName);
        } else {
          console.log(
            \`[AI_NOTIFICATION] Skipping notification for message from \${contactName}\`
          );
        }
      } else {
        // For other companies, send notification as usual
        await addNotificationToUser(idSubstring, messageBody, contactName);
      }
    }`;

// Replace the code
const updatedContent = content.replace(oldCode, newCode);

if (updatedContent === content) {
  console.log('Warning: No replacement was made. The old code pattern was not found.');
} else {
  // Write back
  fs.writeFileSync(mainFile, updatedContent, 'utf8');
  console.log('Successfully updated the addNotificationToUser call with AI decision logic');
}
