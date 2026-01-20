// AI-based notification decision function
async function shouldSendNotificationAI(
  messageContent,
  contactName,
  companyId
) {
  try {
    console.log(
      `[AI_NOTIFICATION] Checking if notification should be sent for company: ${companyId}`
    );

    // Create a prompt for OpenAI to determine if notification is needed
    const prompt = `You are an AI assistant that helps determine if a customer message is important enough to send a notification to business users.

Analyze the following message and determine if it requires immediate attention or notification:

Message from: ${contactName}
Message content: "${messageContent}"

Consider the following criteria:
- Is this a new inquiry or question that needs a response?
- Does it contain important information (booking request, complaint, urgent issue)?
- Is it a meaningful conversation starter?
- Does it require human attention or follow-up?

DO NOT send notification if:
- It's just a simple acknowledgment (e.g., "ok", "thanks", "got it")
- It's an automated message or confirmation
- It's a casual greeting without substance
- It's a continuation of an ongoing conversation that doesn't need immediate attention

Respond with only "YES" if a notification should be sent, or "NO" if it shouldn't.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an expert at determining message importance. Reply only with YES or NO.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 10,
    });

    const decision = response.choices[0].message.content.trim().toUpperCase();
    const shouldNotify = decision === "YES";

    console.log(
      `[AI_NOTIFICATION] Decision: ${decision} - ${shouldNotify ? "Sending" : "Skipping"} notification`
    );

    return shouldNotify;
  } catch (error) {
    console.error("[AI_NOTIFICATION] Error in AI decision making:", error);
    // Default to sending notification on error to avoid missing important messages
    return true;
  }
}

// Modified call in addMessageToPostgres function (line 5203):
// Replace:
//   await addNotificationToUser(idSubstring, messageBody, contactName);
//
// With:
//   const shouldNotify = await shouldSendNotificationAI(messageBody, contactName, idSubstring);
//   if (shouldNotify) {
//     await addNotificationToUser(idSubstring, messageBody, contactName);
//   } else {
//     console.log(`[AI_NOTIFICATION] Skipping notification for message from ${contactName}`);
//   }
