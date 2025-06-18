const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const app = express();

// Lalamove API credentials
const API_KEY = 'pk_test_293d571c2c2d519583326617750761e8';
const SECRET = "sk_test_On8eL9w6N7hJBweWocmozS/KBWr9FBOsuAJsDWG2xeINEzMTo55mst2h2qEQas4u";
const LALAMOVE_BASE_URL = "https://rest.sandbox.lalamove.com";

// Function to generate signature
function generateSignature(timestamp, method, path, body = '') {
    const rawSignature = `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${body}`;
    return crypto
        .createHmac('sha256', SECRET)
        .update(rawSignature)
        .digest('hex');
}

// Route to get city information
app.get('/cities', async (req, res) => {
    try {
        const timestamp = new Date().getTime().toString();
        const method = 'GET';
        const path = '/v3/cities';
        
        const signature = generateSignature(timestamp, method, path);
        
        const response = await axios({
            method: method,
            url: `${LALAMOVE_BASE_URL}${path}`,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `hmac ${API_KEY}:${timestamp}:${signature}`,
            }
        });

        res.json(response.data);
    } catch (error) {
        console.error('Error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch city information' });
    }
});

// Start server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});