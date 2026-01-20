const fs = require('fs').promises;
const path = require('path');
const pdf = require('pdf-parse');
const { Poppler } = require('node-poppler');
const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAIKEY,
});

async function testResumeExtraction() {
  const pdfPath = 'C:\\Users\\FHE_Marketing1\\Downloads\\download.pdf';
  let tempDir = './temp';
  let outputPrefix = null;

  try {
    console.log('=== Testing Job Builder Resume Extraction ===\n');
    console.log('[1] Reading PDF file...');
    
    // Read the PDF file
    const buffer = await fs.readFile(pdfPath);
    console.log(`[✓] PDF loaded, size: ${buffer.length} bytes\n`);

    // Create temp directory
    try {
      await fs.access(tempDir);
    } catch {
      await fs.mkdir(tempDir, { recursive: true });
    }

    // Get page count
    console.log('[2] Analyzing PDF structure...');
    const pdfData = await pdf(buffer);
    const pageCount = pdfData.numpages;
    console.log(`[✓] Total pages: ${pageCount}\n`);

    // Save to temp file
    const tempPdfPath = path.join(tempDir, `test_resume_${Date.now()}.pdf`);
    await fs.writeFile(tempPdfPath, buffer);
    console.log(`[3] Temporary file created: ${tempPdfPath}\n`);

    // Convert to images using Poppler
    console.log('[4] Converting PDF to images with Poppler...');
    const poppler = new Poppler();
    outputPrefix = path.join(tempDir, `resume_page_${Date.now()}`);

    const options = {
      firstPageToConvert: 1,
      lastPageToConvert: Math.min(pageCount, 3),
      pngFile: true,
      resolutionXYAxis: 300,
      scalePageTo: 2480,
    };

    await poppler.pdfToCairo(tempPdfPath, outputPrefix, options);
    console.log('[✓] PDF converted to images\n');

    let allPagesAnalysis = [];
    const pagesToProcess = Math.min(pageCount, 3);

    for (let i = 1; i <= pagesToProcess; i++) {
      console.log(`[5.${i}] Processing page ${i} of ${pagesToProcess}...`);

      let imagePath = `${outputPrefix}-${i}.png`;

      // Check if image exists
      try {
        await fs.access(imagePath);
      } catch {
        // Try alternative naming patterns
        const altPaths = [
          `${outputPrefix}_${i}.png`,
          `${outputPrefix}-${String(i).padStart(3, '0')}.png`,
          `${outputPrefix}${i}.png`,
        ];

        let found = false;
        for (const altPath of altPaths) {
          try {
            await fs.access(altPath);
            imagePath = altPath;
            found = true;
            break;
          } catch {
            continue;
          }
        }

        if (!found) {
          console.error(`[✗] Could not find image for page ${i}`);
          continue;
        }
      }

      console.log(`    Image found: ${imagePath}`);

      // Convert image to base64
      const imageBuffer = await fs.readFile(imagePath);
      const base64Image = imageBuffer.toString('base64');
      console.log(`    Image size: ${base64Image.length} characters`);

      // Analyze using the Job Builder specific prompt
      console.log(`    Sending to OpenAI for analysis...`);
      
      const extractionPrompt = `You are analyzing a RESUME/CV document. Extract ALL information with EXTREME ACCURACY, paying special attention to:

**CRITICAL FIELDS (Job Builder Resume):**
1. **Email Address:** 
   - Extract the COMPLETE email address with 100% accuracy
   - Format: username@domain.com
   - Double-check EVERY CHARACTER (no typos allowed)
   - Look in header, contact section, or anywhere on the page
   - Example: john.doe@gmail.com, johndoe123@yahoo.com

2. **Full Name:**
   - Extract complete first name and last name
   - Include middle name if present

3. **Phone Number:**
   - Include country code and full number
   - Format: +60123456789 or similar

4. **Skills (VERY IMPORTANT):**
   - List ALL technical skills mentioned (programming languages, frameworks, tools, software)
   - List ALL soft skills (communication, leadership, teamwork, etc.)
   - Format as a comma-separated list
   - Examples: "Full Stack Developer, Web Developer, React Developer, Frontend Developer"
   - Or: "JavaScript, Python, React, Node.js, HTML, CSS, SQL, Git"

5. **Work Experience/Employment History (VERY IMPORTANT):**
   - Extract EVERY job position with:
     * Job Title / Position
     * Company Name
     * Duration (start date - end date or "Present")
     * Key responsibilities and achievements (bullet points)
   - Format clearly for each position
   - Example format:
     Position: Senior Developer
     Company: ABC Tech Sdn Bhd
     Duration: Jan 2020 - Present
     Responsibilities: Led team of 5, developed web applications, etc.

6. **Education:**
   - Degrees, certifications, schools attended
   - Graduation years

7. **Summary/Profile:**
   - Professional summary or career objective if present

**OUTPUT FORMAT:**
Organize the extracted data with clear section headers:

EMAIL: [exact email address]
FULL NAME: [complete name]
PHONE: [full phone number]

SKILLS:
[List all skills found - technical and soft skills]

WORK EXPERIENCE:
[Each position with company, title, duration, responsibilities]

EDUCATION:
[Degrees and schools]

PROFILE/SUMMARY:
[Career objective or professional summary if present]

Be thorough and accurate. If any field is not found on this page, write "Not found on this page".`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: extractionPrompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${base64Image}`,
                },
              },
            ],
          },
        ],
        max_tokens: 1000,
      });

      const pageAnalysis = response.choices[0].message.content;
      console.log(`[✓] Analysis received (${pageAnalysis.length} characters)\n`);
      allPagesAnalysis.push(`\n=== PAGE ${i} ===\n${pageAnalysis}`);

      // Clean up image
      try {
        await fs.unlink(imagePath);
      } catch (err) {
        console.error(`Error deleting temp image: ${err}`);
      }
    }

    // Clean up PDF
    try {
      await fs.unlink(tempPdfPath);
    } catch (err) {
      console.error(`Error deleting temp PDF: ${err}`);
    }

    // Display combined results
    console.log('\n' + '='.repeat(80));
    console.log('EXTRACTED RESUME DATA:');
    console.log('='.repeat(80));
    console.log(allPagesAnalysis.join('\n'));
    console.log('='.repeat(80));

    // Check for critical fields
    const combinedText = allPagesAnalysis.join(' ');
    console.log('\n=== VALIDATION ===');
    console.log('✓ Email found:', combinedText.toLowerCase().includes('email:') ? 'YES' : 'NO');
    console.log('✓ Skills found:', combinedText.toLowerCase().includes('skills:') ? 'YES' : 'NO');
    console.log('✓ Experience found:', combinedText.toLowerCase().includes('experience') ? 'YES' : 'NO');
    
  } catch (error) {
    console.error('\n[ERROR]:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
  }
}

testResumeExtraction().then(() => {
  console.log('\n=== Test completed ===');
  process.exit(0);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
