const path = require('path');

function getOpenAIInstance() {
    try {
        const OpenAI = process.pkg ? 
            require(path.join(process.cwd(), 'node_modules', 'openai', 'dist', 'index.js')) :
            require('openai');

        return new OpenAI({
            apiKey: process.env.OPENAIKEY,
        });
    } catch (error) {
        console.error('Failed to load OpenAI:', error);
        process.exit(1);
    }
}

module.exports = getOpenAIInstance();