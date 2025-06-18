const admin = require('./firebase.js');

const db = admin.firestore();

async function deleteInvalidContacts() {
  const contactsRef = db.collection('companies/001/contacts');
  
  // Query for documents where 'phone' field starts with '++'
  const snapshot = await contactsRef.where('phone', '>=', '++')
                                    .where('phone', '<', '+,')
                                    .get();

  if (snapshot.empty) {
    console.log('No matching documents.');
    return;
  }

  const batch = db.batch();
  let deleteCount = 0;

  snapshot.docs.forEach((doc) => {
    const phone = doc.data().phone;
    if (phone && phone.startsWith('++')) {
      console.log(`Deleting contact: ${doc.id} with phone: ${phone}`);
      batch.delete(doc.ref);
      deleteCount++;
    }
  });

  if (deleteCount > 0) {
    await batch.commit();
    console.log(`Batch delete completed. ${deleteCount} documents deleted.`);
  } else {
    console.log('No documents to delete.');
  }
}

deleteInvalidContacts()
  .then(() => {
    console.log('Script completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error running script:', error);
    process.exit(1);
  });