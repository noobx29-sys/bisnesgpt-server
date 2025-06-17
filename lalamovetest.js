const crypto = require('crypto');
const axios = require('axios');
const Table = require('cli-table3');

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

// Function to get city information
async function getCityInfo() {
    try {
        const timestamp = new Date().getTime().toString();z
        const method = 'GET';
        const path = '/v3/cities';
        
        const signature = generateSignature(timestamp, method, path);
        
        const response = await axios({
            method: method,
            url: `${LALAMOVE_BASE_URL}${path}`,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `hmac ${API_KEY}:${timestamp}:${signature}`,
                'Accept': 'application/json',
                'Market': 'MY'  // Added Market header for Thailand
            }
        });

        // Create a table with wider columns
        const table = new Table({
            head: ['City', 'Vehicle Type', 'Description', 'Max Load', 'Dimensions (L×W×H)', 'Special Requests'],
            colWidths: [15, 15, 35, 15, 25, 50],
            wordWrap: true
        });

        response.data.data.forEach(city => {
            city.services.forEach(service => {
                const dimensions = `${service.dimensions.length.value}×${service.dimensions.width.value}×${service.dimensions.height.value} ${service.dimensions.length.unit}`;
                const load = `${service.load.value} ${service.load.unit}`;
                const specialRequests = service.specialRequests
                    ? service.specialRequests
                        .map(req => req.name)
                        .join(', ')
                    : 'None';

                table.push([
                    city.name,
                    service.key,
                    service.description || 'No description available',
                    load,
                    dimensions,
                    specialRequests
                ]);
            });
        });

        console.log(table.toString());
    } catch (error) {
        console.error('Error:', error.response?.data || error.message);
    }
}

// Call the function immediately
getCityInfo(); 