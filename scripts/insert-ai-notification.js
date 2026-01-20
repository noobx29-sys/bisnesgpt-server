const fs = require('fs');

// Read the main file
const mainFile = 'bots/handleMessagesTemplateWweb.js';
const patchFile = 'ai-notification-patch.js';

const mainContent = fs.readFileSync(mainFile, 'utf8');
const patchContent = fs.readFileSync(patchFile, 'utf8');

// Split into lines
const lines = mainContent.split('\n');

// Find line 633 (index 632) - after addNotificationToUser function
const insertAfterLine = 633;

// Insert the patch content
const newLines = [
  ...lines.slice(0, insertAfterLine),
  '',
  patchContent,
  '',
  ...lines.slice(insertAfterLine)
];

// Write back
fs.writeFileSync(mainFile, newLines.join('\n'), 'utf8');

console.log('AI notification functions inserted successfully after line', insertAfterLine);
