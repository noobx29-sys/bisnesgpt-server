const axios = require('axios');

const configFile = 'config.json';

const getAppData = async () => {
    try {
        // Read config file
        const appConfig = require('./config.json');

        const { clientId, clientSecret, grantType, code, refreshToken, userType } = appConfig;

        // Call getToken function
        const accessToken = await getToken(clientId, clientSecret, grantType, code, refreshToken, userType);

       // console.log('Access Token:', accessToken);
    } catch (error) {
        console.error('Error:', error.message);
    }
};

const getToken = async (clientId, clientSecret, grantType, code, refreshToken, userType) => {
    try {
        const data = {
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: grantType,
            code: code,
            refresh_token: refreshToken,
            user_type: userType,
        };

        const response = await axios.post('https://services.leadconnectorhq.com/oauth/token', data, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        return response.data;
    } catch (error) {
        throw new Error('Failed to get access token: ' + error.message);
    }
};

// Call getAppData function
getAppData();
