const admin = require('firebase-admin'); // Pass module name as a string
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Decode the base64 environment variable to get the service account JSON
const serviceAccount = require('./sa_firebase.json');
const { config } = require('dotenv');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: "gs://onboarding-a5fcb.appspot.com" // Replace with your actual bucket name
    // Add your databaseURL if necessary
    // databaseURL: "https://your-database-url.firebaseio.com"
  });
}

module.exports = admin;
 // Use module.exports to export in CommonJS
