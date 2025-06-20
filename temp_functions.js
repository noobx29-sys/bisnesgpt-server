async function updateContactInDatabase(idSubstring, phoneNumber, contactData) {
  console.log(`Updating contact for company ${idSubstring}...`);
  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const updateQuery = `
      UPDATE public.contacts 
      SET 
        name = $1,
        phone = $2,
        tags = $3,
        unread_count = $4,
        last_updated = $5,
        chat_data = $6,
        chat_id = $7,
        company = $8,
        thread_id = $9,
        last_message = $10,
        profile_pic_url = $11,
        additional_emails = $12,
        address1 = $13,
        assigned_to = $14,
        business_id = $15,
        city = $16
      WHERE phone = $17 AND company_id = $18
    `;

    await sqlClient.query(updateQuery, [
      contactData.name,
      contactData.phone,
      JSON.stringify(contactData.tags || []),
      contactData.unread_count || 0,
      contactData.last_updated,
      JSON.stringify(contactData.chat_data || {}),
      contactData.chat_id,
      contactData.company,
      contactData.thread_id,
      JSON.stringify(contactData.last_message || {}),
      contactData.profile_pic_url,
      JSON.stringify(contactData.additional_emails || []),
      contactData.address1,
      contactData.assigned_to,
      contactData.business_id,
      contactData.city,
      phoneNumber,
      idSubstring,
    ]);

    await sqlClient.query("COMMIT");

    console.log(
      `Successfully updated contact for Company ${idSubstring} at ID ${phoneNumber}`
    );

    return "Contact updated successfully";
  } catch (error) {
    await sqlClient.query("ROLLBACK");
    console.error(
      `Error updating contact in database for Company ${idSubstring} at ID ${phoneNumber}:`,
      error
    );
    return "Failed to update contact.";
  } finally {
    sqlClient.release();
  }
}

async function createContactInDatabase(idSubstring, contactData) {
  console.log(`Creating contact for company ${idSubstring}...`);
  const sqlClient = await pool.connect();

  try {
    await sqlClient.query("BEGIN");

    const insertQuery = `
      INSERT INTO public.contacts (
        company_id,
        name,
        phone,
        tags,
        unread_count,
        created_at,
        last_updated,
        chat_data,
        chat_id,
        company,
        thread_id,
        last_message,
        profile_pic_url,
        additional_emails,
        address1,
        assigned_to,
        business_id,
        city
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    `;

    await sqlClient.query(insertQuery, [
      idSubstring,
      contactData.name,
      contactData.phone,
      JSON.stringify(contactData.tags || []),
      contactData.unread_count || 0,
      contactData.created_at || new Date(),
      contactData.last_updated,
      JSON.stringify(contactData.chat_data || {}),
      contactData.chat_id,
      contactData.company,
      contactData.thread_id,
      JSON.stringify(contactData.last_message || {}),
      contactData.profile_pic_url,
      JSON.stringify(contactData.additional_emails || []),
      contactData.address1,
      contactData.assigned_to,
      contactData.business_id,
      contactData.city,
    ]);

    await sqlClient.query("COMMIT");

    console.log(
      `Successfully created contact for Company ${idSubstring} at ID ${contactData.phone}`
    );

    return "Contact created successfully";
  } catch (error) {
    await sqlClient.query("ROLLBACK");
    console.error(
      `Error creating contact in database for Company ${idSubstring} at ID ${contactData.phone}:`,
      error
    );
    return "Failed to create contact.";
  } finally {
    sqlClient.release();
  }
} 