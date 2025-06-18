const path = require('path');

function getAxiosInstance() {
    try {
        return require(process.pkg ? 
            path.join(process.cwd(), 'node_modules', 'axios', 'dist', 'node', 'axios.cjs') : 
            'axios').default;
    } catch (error) {
        console.error('Failed to load axios:', error);
        process.exit(1);
    }
}

module.exports = getAxiosInstance(); 