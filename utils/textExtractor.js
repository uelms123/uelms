const fs = require('fs');
const path = require('path');

// Try different import methods for pdf-parse
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

const mammoth = require('mammoth');
console.log('✅ mammoth loaded successfully');

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
      if (!pdfParse) {
        throw new Error('pdf-parse library is not available. Please install it with: npm install pdf-parse');
      }
      
      const dataBuffer = fs.readFileSync(filePath);
      console.log(`📄 PDF buffer size: ${dataBuffer.length} bytes`);
      
      const data = await pdfParse(dataBuffer);
      console.log(`✅ PDF extracted: ${data.text?.length || 0} characters`);
      return data.text || '';
    }
    
    // DOCX files
    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ path: filePath });
      console.log(`✅ DOCX extracted: ${result.value?.length || 0} characters`);
      return result.value || '';
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