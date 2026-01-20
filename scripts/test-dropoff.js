const { ContactTagger } = require('./contactTagger.js');

async function test() {
  const tagger = new ContactTagger('0210', { verbose: true, dryRun: true });

  // Get contacts to test
  const contacts = await tagger.getAllContacts(20);

  if (contacts.length === 0) {
    console.log('No contacts found for company 0210');
    return;
  }

  // Find first non-group contact
  const contact = contacts.find(c => !c.phone?.includes('@g.us') && !c.phone?.includes('120363'));

  if (!contact) {
    console.log('No individual contacts found');
    return;
  }

  const contactId = contact.contact_id;
  console.log('Testing with contact:', contactId);
  console.log('Phone:', contact.phone);

  const result = await tagger.tagContact(contactId);

  if (result.success && result.metrics) {
    console.log('\n=== DROP-OFF ANALYSIS ===');
    const dropPoint = result.metrics.response_drop_point;
    console.log('Stage:', dropPoint.stage);
    console.log('Unanswered Messages Count:', dropPoint.unanswered_messages?.length || 0);

    if (dropPoint.unanswered_messages && dropPoint.unanswered_messages.length > 0) {
      console.log('\n=== UNANSWERED MESSAGES (Last messages they did NOT respond to) ===');
      dropPoint.unanswered_messages.forEach((msg, idx) => {
        console.log(`\n[${idx + 1}] ${msg.days_ago} days ago:`);
        console.log(`    "${msg.content}"`);
      });
    } else {
      console.log('\nNo unanswered messages (contact is active or responded to everything)');
    }
  }

  process.exit(0);
}

test().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
