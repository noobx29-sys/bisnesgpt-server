const fs = require('fs');

// Input and output file paths
const inputFile = '/Users/firaz/Downloads/feedback_responses (2).csv';
const outputFile = '/Users/firaz/Downloads/feedback_responses_parsed.csv';

// Function to parse CSV line (simple CSV parser)
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    
    result.push(current.trim());
    return result;
}

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

// Function to escape CSV values
function escapeCSV(value) {
    if (value === null || value === undefined) {
        return '';
    }
    
    const stringValue = String(value);
    
    // If the value contains comma, quote, or newline, wrap it in quotes
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        // Escape quotes by doubling them
        const escaped = stringValue.replace(/"/g, '""');
        return `"${escaped}"`;
    }
    
    return stringValue;
}

// Main processing function
function processCSV() {
    try {
        console.log('Reading CSV file...');
        const fileContent = fs.readFileSync(inputFile, 'utf8');
        const lines = fileContent.split('\n').filter(line => line.trim());
        
        console.log(`Found ${lines.length} lines`);
        
        // Parse header
        const header = parseCSVLine(lines[0]);
        console.log('Original headers:', header);
        
        // New headers for the parsed CSV
        const newHeaders = [
            'ID',
            'Form ID', 
            'Phone Number',
            'Program',
            'Full Name',
            'Organisation/Company',
            'Email Address',
            'Profession',
            'Submitted At',
            'Created At',
            'Updated At'
        ];
        
        // Process each data row
        const processedRows = [];
        
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue;
            
            const row = parseCSVLine(line);
            
            // Parse the responses column (index 3)
            const responsesStr = row[3];
            const parsedResponses = parseResponses(responsesStr);
            
            // Create new row with separated columns
            const newRow = [
                row[0], // ID
                row[1], // Form ID
                row[2], // Phone Number
                parsedResponses.program || '',
                parsedResponses.fullName || '',
                parsedResponses.organisation || '',
                parsedResponses.email || '',
                parsedResponses.profession || '',
                row[4], // Submitted At
                row[5], // Created At
                row[6]  // Updated At
            ];
            
            processedRows.push(newRow);
        }
        
        console.log(`Processed ${processedRows.length} rows`);
        
        // Create CSV content
        let csvContent = newHeaders.map(escapeCSV).join(',') + '\n';
        
        processedRows.forEach(row => {
            csvContent += row.map(escapeCSV).join(',') + '\n';
        });
        
        // Write to output file
        fs.writeFileSync(outputFile, csvContent, 'utf8');
        
        console.log(`Successfully created parsed CSV file: ${outputFile}`);
        console.log(`Total rows processed: ${processedRows.length}`);
        
        // Show sample of first few rows
        console.log('\nSample of parsed data:');
        processedRows.slice(0, 3).forEach((row, index) => {
            console.log(`\nRow ${index + 1}:`);
            console.log(`  Program: ${row[3]}`);
            console.log(`  Full Name: ${row[4]}`);
            console.log(`  Organisation: ${row[5]}`);
            console.log(`  Email: ${row[6]}`);
            console.log(`  Profession: ${row[7]}`);
        });
        
    } catch (error) {
        console.error('Error processing CSV:', error);
    }
}

// Run the script
console.log('Starting CSV parsing...');
processCSV();
console.log('Done!');

