const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// Input and output file paths
const inputFile = '/Users/firaz/Downloads/feedback_responses.csv';
const outputFile = '/Users/firaz/Downloads/feedback_responses_parsed.csv';

// Function to parse the responses JSON and extract individual fields
function parseResponses(responsesStr) {
    try {
        // Parse the JSON string from the responses column
        const responses = JSON.parse(responsesStr);
        
        // Create an object to store the parsed responses
        const parsed = {};
        
        // Extract each response field
        responses.forEach(response => {
            const question = response.question;
            const answer = response.answer;
            
            // Map questions to column names
            if (question.includes('Programs To Register')) {
                parsed.program = answer;
            } else if (question.includes('Full Name')) {
                parsed.fullName = answer;
            } else if (question.includes('Organisation/Company')) {
                parsed.organisation = answer;
            } else if (question.includes('Email Address')) {
                parsed.email = answer;
            } else if (question.includes('Profession')) {
                parsed.profession = answer;
            }
        });
        
        return parsed;
    } catch (error) {
        console.error('Error parsing responses:', error);
        return {
            program: '',
            fullName: '',
            organisation: '',
            email: '',
            profession: ''
        };
    }
}

// Main processing function
async function processCSV() {
    const results = [];
    
    return new Promise((resolve, reject) => {
        fs.createReadStream(inputFile)
            .pipe(csv())
            .on('data', (row) => {
                // Parse the responses column
                const parsedResponses = parseResponses(row.responses);
                
                // Create new row with separated columns
                const newRow = {
                    id: row.id,
                    form_id: row.form_id,
                    phone_number: row.phone_number,
                    program: parsedResponses.program || '',
                    full_name: parsedResponses.fullName || '',
                    organisation: parsedResponses.organisation || '',
                    email: parsedResponses.email || '',
                    profession: parsedResponses.profession || '',
                    submitted_at: row.submitted_at,
                    created_at: row.created_at,
                    updated_at: row.updated_at
                };
                
                results.push(newRow);
            })
            .on('end', () => {
                resolve(results);
            })
            .on('error', (error) => {
                reject(error);
            });
    });
}

// CSV writer configuration
const csvWriter = createCsvWriter({
    path: outputFile,
    header: [
        { id: 'id', title: 'ID' },
        { id: 'form_id', title: 'Form ID' },
        { id: 'phone_number', title: 'Phone Number' },
        { id: 'program', title: 'Program' },
        { id: 'full_name', title: 'Full Name' },
        { id: 'organisation', title: 'Organisation/Company' },
        { id: 'email', title: 'Email Address' },
        { id: 'profession', title: 'Profession' },
        { id: 'submitted_at', title: 'Submitted At' },
        { id: 'created_at', title: 'Created At' },
        { id: 'updated_at', title: 'Updated At' }
    ]
});

// Main execution
async function main() {
    try {
        console.log('Processing CSV file...');
        const results = await processCSV();
        
        console.log(`Processed ${results.length} rows`);
        
        // Write the parsed data to new CSV
        await csvWriter.writeRecords(results);
        
        console.log(`Successfully created parsed CSV file: ${outputFile}`);
        console.log(`Total rows processed: ${results.length}`);
        
        // Show sample of first few rows
        console.log('\nSample of parsed data:');
        results.slice(0, 3).forEach((row, index) => {
            console.log(`\nRow ${index + 1}:`);
            console.log(`  Program: ${row.program}`);
            console.log(`  Full Name: ${row.full_name}`);
            console.log(`  Organisation: ${row.organisation}`);
            console.log(`  Email: ${row.email}`);
            console.log(`  Profession: ${row.profession}`);
        });
        
    } catch (error) {
        console.error('Error processing CSV:', error);
    }
}

// Run the script
main();
