require("dotenv").config();
const axios = require("axios");

async function initializeBot() {
  const companyId = "ocd_international";
  const serverUrl = "https://bisnesgpt.jutateknologi.com";
  
  console.log("Initializing bot for company:", companyId);
  console.log("Server URL:", serverUrl);

  try {
    const response = await axios.post(
      `${serverUrl}/api/channel/create/${companyId}`,
      {
        name: "Metchelle",
        companyName: "OCD International Sdn Bhd",
        phoneNumber: "60380510033",
        email: "metchelle@odcinternational.com.my",
        password: "123456",
        plan: "premium",
        country: "Malaysia"
      }
    );

    console.log("\n✅ Bot initialization started successfully!");
    console.log("\nResponse:");
    console.log("- Company ID:", response.data.companyId);
    console.log("- Bot Status:", response.data.botStatus);
    console.log("- Plan:", response.data.plan);
    console.log("- API URL:", response.data.apiUrl);
    
    if (response.data.assistantId) {
      console.log("- Assistant ID:", response.data.assistantId);
    }

    console.log("\n📱 The bot will initialize in the background.");
    console.log("Check the server logs or status page for QR code.");
    console.log("\nStatus URL:", `${serverUrl}/status`);

  } catch (error) {
    console.error("❌ Error initializing bot:");
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Error:", error.response.data);
    } else {
      console.error(error.message);
    }
  }
}

initializeBot();
