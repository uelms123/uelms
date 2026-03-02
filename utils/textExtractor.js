const fs = require('fs');
const path = require('path');

// Try different import methods for pdf-parse with better error handling
let pdfParse;
try {
  // Standard require
  pdfParse = require('pdf-parse');
  console.log('✅ pdf-parse loaded successfully (standard require)');
} catch (e) {
  try {
    // Try default import style
    pdfParse = require('pdf-parse').default;
    console.log('✅ pdf-parse loaded successfully (default import)');
  } catch (e2) {
    console.error('❌ Failed to load pdf-parse:', e2.message);
    pdfParse = null;
  }
}

// Add fallback PDF parser for problematic PDFs
let pdfParseFallback;
try {
  // Try to load pdf-parse-fallback if available
  pdfParseFallback = require('pdf-parse-fallback');
  console.log('✅ pdf-parse-fallback loaded successfully');
} catch (e) {
  pdfParseFallback = null;
}

const mammoth = require('mammoth');
console.log('✅ mammoth loaded successfully');

// ─── Enhanced PDF extraction with fallback ─────────────────────────────────────
const extractPDFText = async (dataBuffer) => {
  if (!pdfParse) {
    throw new Error('pdf-parse library is not available. Please install it with: npm install pdf-parse');
  }
  
  console.log(`📄 PDF buffer size: ${dataBuffer.length} bytes`);
  
  // First attempt with standard parser
  try {
    const data = await pdfParse(dataBuffer);
    if (data.text && data.text.length > 0) {
      console.log(`✅ PDF extracted successfully with standard parser: ${data.text.length} characters`);
      return data.text || '';
    }
  } catch (err) {
    console.warn(`⚠️ Standard PDF parser failed: ${err.message}`);
    
    // If it's the XRef error, try alternative parsing options
    if (err.message.includes('bad XRef entry') || err.message.includes('xref')) {
      console.log('🔄 Attempting alternative PDF parsing methods...');
      
      // Try with different parsing options
      try {
        // Attempt 1: Try with pagerender option to extract text page by page
        const options = {
          pagerender: renderPage,
          max: 0 // No page limit
        };
        
        const data = await pdfParse(dataBuffer, options);
        if (data.text && data.text.length > 0) {
          console.log(`✅ PDF extracted with page renderer: ${data.text.length} characters`);
          return data.text || '';
        }
      } catch (err2) {
        console.warn(`⚠️ Page renderer method failed: ${err2.message}`);
        
        // Attempt 2: Try with fallback parser if available
        if (pdfParseFallback) {
          try {
            const data = await pdfParseFallback(dataBuffer);
            if (data.text && data.text.length > 0) {
              console.log(`✅ PDF extracted with fallback parser: ${data.text.length} characters`);
              return data.text || '';
            }
          } catch (err3) {
            console.warn(`⚠️ Fallback parser failed: ${err3.message}`);
          }
        }
        
        // Attempt 3: Try extracting raw text with different encoding
        try {
          const rawText = dataBuffer.toString('utf-8');
          // Look for text content between PDF markers
          const textMatches = rawText.match(/\(([^)]{10,})\)/g) || [];
          if (textMatches.length > 0) {
            const extractedText = textMatches
              .map(m => m.substring(1, m.length - 1))
              .filter(t => t.length > 20)
              .join(' ');
            
            if (extractedText.length > 100) {
              console.log(`✅ PDF extracted via raw text method: ${extractedText.length} characters`);
              return extractedText;
            }
          }
        } catch (err4) {
          console.warn(`⚠️ Raw text extraction failed: ${err4.message}`);
        }
      }
    }
    
    // Re-throw the error if all methods fail
    throw err;
  }
  
  return '';
};

// Custom page renderer function
const renderPage = (pageData) => {
  try {
    return pageData.getTextContent()
      .then(textContent => {
        return textContent.items
          .map(item => item.str)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
      })
      .catch(() => '');
  } catch {
    return '';
  }
};

// ─── Extract raw text ─────────────────────────────────────────────────────────
const extractText = async (filePath, originalName) => {
  const ext = path.extname(originalName || filePath).toLowerCase();
  console.log(`📄 Extracting text from ${ext} file: ${originalName || filePath}`);
  
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found at path: ${filePath}`);
    }

    // TXT files
    if (ext === '.txt') {
      const text = fs.readFileSync(filePath, 'utf-8');
      console.log(`✅ TXT extracted: ${text.length} characters`);
      return text;
    }
    
    // PDF files
    if (ext === '.pdf') {
      const dataBuffer = fs.readFileSync(filePath);
      return await extractPDFText(dataBuffer);
    }
    
    // DOCX files
    if (ext === '.docx') {
      try {
        const result = await mammoth.extractRawText({ path: filePath });
        if (result.value && result.value.length > 0) {
          console.log(`✅ DOCX extracted: ${result.value.length} characters`);
          return result.value || '';
        } else {
          // Try alternative extraction method
          const buffer = fs.readFileSync(filePath);
          const altResult = await mammoth.extractRawText({ buffer });
          console.log(`✅ DOCX extracted via buffer: ${altResult.value.length} characters`);
          return altResult.value || '';
        }
      } catch (docxErr) {
        console.warn(`⚠️ Standard DOCX extraction failed: ${docxErr.message}`);
        
        // Try buffer-based extraction as fallback
        try {
          const buffer = fs.readFileSync(filePath);
          const result = await mammoth.extractRawText({ buffer });
          console.log(`✅ DOCX extracted via buffer fallback: ${result.value.length} characters`);
          return result.value || '';
        } catch (bufferErr) {
          throw new Error(`DOCX extraction failed: ${bufferErr.message}`);
        }
      }
    }
    
    throw new Error(`Unsupported file type: ${ext}. Please upload PDF, DOCX, or TXT files.`);
  } catch (err) {
    console.error('❌ Text extraction error:', err.message);
    throw new Error(`Text extraction failed: ${err.message}`);
  }
};

// ─── Split into checkable sentences ──────────────────────────────────────────
/**
 * Produces sentences that are:
 *   • at least 8 words long          (enough for phrase-window matching)
 *   • at most 300 words long         (avoid giant paragraph blobs)
 *   • stripped of leading bullets / numbers
 */
const splitIntoSentences = (text) => {
  if (!text || typeof text !== 'string') {
    console.warn('⚠️ Invalid text provided to splitIntoSentences');
    return [];
  }

  // 1. Normalise line endings and tabs
  let cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\n{3,}/g, '\n\n')          // collapse triple+ blank lines
    .trim();

  // 2. Treat paragraph breaks as sentence boundaries too
  cleaned = cleaned.replace(/\n\n+/g, ' |PARA| ');
  cleaned = cleaned.replace(/\n/g, ' ');
  cleaned = cleaned.replace(/\s{2,}/g, ' ');

  // 3. Split on sentence-ending punctuation OR paragraph markers
  const rawParts = cleaned.split(/(?<=[.!?])\s+|\s*\|PARA\|\s*/);

  // 4. Merge very short fragments into the previous sentence
  const merged = [];
  for (const part of rawParts) {
    const s = part
      .replace(/^\s*[\-•*>\d]+[\.\)]\s*/, '') // strip leading bullets / numbering
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) continue;

    const wc = s.split(/\s+/).filter(Boolean).length;

    if (wc < 8 && merged.length > 0) {
      // Append to last sentence if it's very short
      merged[merged.length - 1] += ' ' + s;
    } else if (wc >= 8) {
      merged.push(s);
    }
    // Skip fragments under 8 words with no prior sentence to merge into
  }

  // 5. Filter: keep only sentences with 8–300 words and length ≥ 40 chars
  const filtered = merged.filter(s => {
    const wc = s.split(/\s+/).filter(Boolean).length;
    return wc >= 8 && wc <= 300 && s.length >= 40;
  });

  console.log(`📊 Sentence splitting: ${filtered.length} valid sentences extracted`);
  return filtered;
};

// ─── Word count ───────────────────────────────────────────────────────────────
const countWords = (text) => {
  if (!text || typeof text !== 'string') return 0;
  return text.split(/\s+/).filter(w => w.length > 0).length;
};

module.exports = { extractText, splitIntoSentences, countWords };