// ============================================================
// PLAGIARISM CHECKER — Enhanced Multi-Source Detection Engine
// (Memory Optimized Stable Version with Enhanced Detection)
// ============================================================
const axios = require('axios');
const cheerio = require('cheerio');
const stringSimilarity = require('string-similarity');
const apiSearch = require('./apiSearch');

// ─── Complete Site Registry with educational, academic & useful sources ────────
const SITE_REGISTRY = [
  // Educational Sites
  { domain: 'javatpoint.com', name: 'JavaTpoint', type: 'educational', priority: 1 },
  { domain: 'geeksforgeeks.org', name: 'GeeksForGeeks', type: 'educational', priority: 1 },
  { domain: 'tutorialspoint.com', name: 'TutorialsPoint', type: 'educational', priority: 1 },
  { domain: 'w3schools.com', name: 'W3Schools', type: 'educational', priority: 1 },
  { domain: 'studytonight.com', name: 'StudyTonight', type: 'educational', priority: 1 },
  { domain: 'programiz.com', name: 'Programiz', type: 'educational', priority: 1 },
  { domain: 'guru99.com', name: 'Guru99', type: 'educational', priority: 1 },
  { domain: 'freecodecamp.org', name: 'FreeCodeCamp', type: 'educational', priority: 1 },
  { domain: 'simplilearn.com', name: 'Simplilearn', type: 'educational', priority: 1 },
  { domain: 'interviewbit.com', name: 'InterviewBit', type: 'educational', priority: 1 },
  { domain: 'baeldung.com', name: 'Baeldung', type: 'educational', priority: 1 },
  { domain: 'educba.com', name: 'EDUCBA', type: 'educational', priority: 1 },
  { domain: 'cplusplus.com', name: 'CPlusPlus', type: 'educational', priority: 1 },
  { domain: 'learncpp.com', name: 'LearnCPP', type: 'educational', priority: 1 },
  { domain: 'codecademy.com', name: 'Codecademy', type: 'educational', priority: 1 },
  
  // Academic & Journal Sites
  { domain: 'researchgate.net', name: 'ResearchGate', type: 'journal', priority: 2 },
  { domain: 'academia.edu', name: 'Academia.edu', type: 'journal', priority: 2 },
  { domain: 'sciencedirect.com', name: 'ScienceDirect', type: 'journal', priority: 2 },
  { domain: 'springer.com', name: 'Springer', type: 'journal', priority: 2 },
  { domain: 'ieee.org', name: 'IEEE Xplore', type: 'journal', priority: 2 },
  { domain: 'acm.org', name: 'ACM Digital Library', type: 'journal', priority: 2 },
  { domain: 'jstor.org', name: 'JSTOR', type: 'journal', priority: 2 },
  { domain: 'pubmed.ncbi.nlm.nih.gov', name: 'PubMed', type: 'academic', priority: 2 },
  { domain: 'ncbi.nlm.nih.gov', name: 'NCBI', type: 'academic', priority: 2 },
  { domain: 'cambridge.org', name: 'Cambridge Core', type: 'journal', priority: 2 },
  { domain: 'oxfordjournals.org', name: 'Oxford Journals', type: 'journal', priority: 2 },
  { domain: 'wiley.com', name: 'Wiley Online Library', type: 'journal', priority: 2 },
  { domain: 'tandfonline.com', name: 'Taylor & Francis', type: 'journal', priority: 2 },
  { domain: 'sagepub.com', name: 'SAGE Journals', type: 'journal', priority: 2 },
  { domain: 'mdpi.com', name: 'MDPI', type: 'journal', priority: 2 },
  { domain: 'frontiersin.org', name: 'Frontiers', type: 'journal', priority: 2 },
  { domain: 'plos.org', name: 'PLOS ONE', type: 'journal', priority: 2 },
  { domain: 'biorxiv.org', name: 'bioRxiv', type: 'preprint', priority: 2 },
  { domain: 'arxiv.org', name: 'arXiv', type: 'preprint', priority: 2 },
  { domain: 'ssrn.com', name: 'SSRN', type: 'preprint', priority: 2 },
  
  // University Sites
  { domain: 'mit.edu', name: 'MIT OpenCourseWare', type: 'university', priority: 3 },
  { domain: 'stanford.edu', name: 'Stanford University', type: 'university', priority: 3 },
  { domain: 'harvard.edu', name: 'Harvard University', type: 'university', priority: 3 },
  { domain: 'berkeley.edu', name: 'UC Berkeley', type: 'university', priority: 3 },
  { domain: 'cmu.edu', name: 'Carnegie Mellon', type: 'university', priority: 3 },
  { domain: 'ox.ac.uk', name: 'University of Oxford', type: 'university', priority: 3 },
  { domain: 'cam.ac.uk', name: 'University of Cambridge', type: 'university', priority: 3 },
  { domain: 'ethz.ch', name: 'ETH Zurich', type: 'university', priority: 3 },
  { domain: 'nptel.ac.in', name: 'NPTEL', type: 'university', priority: 3 },
  
  // Q&A and Forums
  { domain: 'stackoverflow.com', name: 'StackOverflow', type: 'forum', priority: 4 },
  { domain: 'stackexchange.com', name: 'StackExchange', type: 'forum', priority: 4 },
  { domain: 'quora.com', name: 'Quora', type: 'forum', priority: 4 },
  { domain: 'reddit.com', name: 'Reddit', type: 'forum', priority: 4 },
  { domain: 'github.com', name: 'GitHub', type: 'code', priority: 4 },
  
  // Knowledge Bases
  { domain: 'wikipedia.org', name: 'Wikipedia', type: 'wiki', priority: 5 },
  { domain: 'wikihow.com', name: 'wikiHow', type: 'wiki', priority: 5 },
  { domain: 'britannica.com', name: 'Encyclopedia Britannica', type: 'encyclopedia', priority: 5 },
];

// ─── AI Phrase Detection ──────────────────────────────────────────────────────
const AI_PHRASES = [
  'it is important to note', 'in today\'s digital age', 'in the realm of',
  'delve into', 'it is worth noting', 'one must consider', 'in the ever-evolving',
  'it goes without saying', 'at the end of the day', 'having said that',
  'with that being said', 'it is crucial to', 'plays a pivotal role',
  'as previously mentioned', 'taking everything into consideration',
  'in conclusion, it is evident', 'shed light on', 'foster a culture of',
  'leverage the power of', 'dive deep into', 'revolutionize the way',
  'in summary, it is clear', 'it is essential to understand', 'upon reflection',
  'in this context, it is', 'allow us to explore', 'this comprehensive guide'
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const delay = (ms) => new Promise(r => setTimeout(r, ms));

const getSiteInfo = (url) => {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    for (const site of SITE_REGISTRY) {
      if (hostname.includes(site.domain.replace('www.', ''))) return site;
    }
    return { name: hostname.split('.')[0], type: 'web', domain: hostname };
  } catch {
    return { name: 'Unknown', type: 'web', domain: 'unknown' };
  }
};

const normalizeText = (t) =>
  t.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// ─── Enhanced Detection Algorithms ────────────────────────────────────────────

const hasPhraseMatch = (sentence, pageText) => {
  const sentWords = normalizeText(sentence).split(' ').filter(Boolean);
  const normPage = normalizeText(pageText);
  
  const windowSizes = [5, 6, 7, 8, 9, 10];
  
  for (const windowSize of windowSizes) {
    const win = Math.min(windowSize, sentWords.length);
    if (win < 3) continue;
    
    for (let i = 0; i <= sentWords.length - win; i++) {
      const phrase = sentWords.slice(i, i + win).join(' ');
      if (normPage.includes(phrase)) return true;
    }
  }
  
  if (sentWords.length <= 15) {
    return normPage.includes(normalizeText(sentence));
  }
  
  return false;
};

const getNgrams = (text, nValues = [3, 4, 5]) => {
  const words = normalizeText(text).split(' ').filter(Boolean);
  const results = {};
  
  for (const n of nValues) {
    const set = new Set();
    if (words.length >= n) {
      for (let i = 0; i <= words.length - n; i++) {
        set.add(words.slice(i, i + n).join(' '));
      }
    }
    results[n] = set;
  }
  return results;
};

const ngramSimilarity = (a, b) => {
  const ngramsA = getNgrams(a);
  const ngramsB = getNgrams(b);
  
  let totalSimilarity = 0;
  let count = 0;
  
  for (const n of [3, 4, 5]) {
    const setA = ngramsA[n];
    const setB = ngramsB[n];
    
    if (setA && setB && setA.size > 0 && setB.size > 0) {
      let common = 0;
      for (const g of setA) {
        if (setB.has(g)) common++;
      }
      const similarity = common / Math.min(setA.size, setB.size);
      totalSimilarity += similarity;
      count++;
    }
  }
  
  return count > 0 ? totalSimilarity / count : 0;
};

const bestWindowSimilarity = (sentence, pageText) => {
  const norm = normalizeText(sentence);
  const normPage = normalizeText(pageText);
  
  const winLen = Math.min(Math.max(norm.length * 1.5, 200), 1500);
  let best = 0;
  const step = Math.max(100, Math.floor(winLen / 3));
  
  for (let i = 0; i < Math.min(normPage.length - winLen, 20000); i += step) {
    const window = normPage.substring(i, i + winLen);
    const sim = stringSimilarity.compareTwoStrings(norm, window);
    
    if (sim > best) {
      best = sim;
      if (best > 0.95) break;
    }
  }
  
  return best;
};

// ─── HTTP Layer ───────────────────────────────────────────────────────────────
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
};

const fetchHTML = async (url, baseTimeout = 30000) => {  // Increased default to 30 seconds
  const maxRetries = 2;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      // Increase timeout on each retry (30s → 45s → 60s)
      const timeout = baseTimeout + (attempt * 15000);
      
      const res = await axios.get(url, {
        headers: BROWSER_HEADERS,
        timeout,
        maxRedirects: 5,           // Better redirect handling
        validateStatus: (s) => s < 500,
      });

      return typeof res.data === 'string' ? res.data : '';
    } catch (err) {
      attempt++;
      console.warn(`  Fetch attempt ${attempt}/${maxRetries+1} failed for ${url}: ${err.message} (${err.code || 'no code'})`);

      // Retry only on timeout or network errors
      if (attempt > maxRetries || !err.code?.includes('ECONNABORTED')) {
        return '';
      }

      // Small backoff delay
      await new Promise(r => setTimeout(r, 3000 * attempt));
    }
  }

  console.warn(`  Fetch completely failed after ${maxRetries+1} attempts: ${url}`);
  return '';
};

const extractPageText = (html) => {
  if (!html) return '';
  const $ = cheerio.load(html);
  
  $('script,style,nav,footer,header,aside,.ads,.advertisement,noscript,iframe,.sidebar,.menu,.nav,.cookie,.popup,.modal').remove();
  
  let mainContent = '';
  const selectors = ['article', 'main', '.content', '.post-content', '.article-content', '.entry-content', '#content'];
  
  for (const selector of selectors) {
    const element = $(selector);
    if (element.length) {
      mainContent += ' ' + element.text();
    }
  }
  
  if (!mainContent.trim()) {
    mainContent = $('body').text();
  }
  
  return mainContent.replace(/\s+/g, ' ').trim().substring(0, 30000);
};

// ─── Check Single URL ─────────────────────────────────────────────────────────
const checkUrl = async (sentence, url) => {
  // Optional: Skip very slow / known blocked domains to save time
  const slowDomains = ['.gov', 'mauicounty.gov', 'crown.edu'];
  if (slowDomains.some(d => url.includes(d))) {
    console.log(`  Skipping known slow domain: ${url}`);
    return null;
  }

  const html = await fetchHTML(url);
  if (!html) return null;
  
  const pageText = extractPageText(html);
  if (pageText.length < 100) return null;
  
  const phraseMatch = hasPhraseMatch(sentence, pageText);
  const ngramSim = ngramSimilarity(sentence, pageText);
  const strSim = bestWindowSimilarity(sentence, pageText);
  
  let score = phraseMatch ? 0.95 : 0;
  score = Math.max(score, ngramSim * 0.9, strSim * 0.85);
  
  const siteInfo = getSiteInfo(url);
  const threshold = siteInfo.type === 'journal' || siteInfo.type === 'academic' ? 0.4 : 0.45;
  
  if (phraseMatch || score >= threshold) {
    return {
      similarity: Math.round(Math.max(score * 100, phraseMatch ? 92 : 0)),
      phraseMatch,
      ngramScore: Math.round(ngramSim * 100),
      textScore: Math.round(strSim * 100),
      matchedSnippet: pageText.substring(0, 150) + '...'  // optional: short preview
    };
  }
  
  return null;
};

// ─── AI Detection ─────────────────────────────────────────────────────────────
const checkAIPhrases = (sentence) => {
  const lower = sentence.toLowerCase();
  const matches = [];
  
  for (const phrase of AI_PHRASES) {
    if (lower.includes(phrase)) {
      matches.push(phrase);
    }
  }
  
  const patterns = [
    /\b(?:firstly|secondly|thirdly|lastly|finally)\b/gi,
    /\b(?:moreover|furthermore|additionally|consequently)\b/gi,
    /\b(?:in other words|that is to say|to put it simply)\b/gi,
  ];
  
  let patternCount = 0;
  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (match) patternCount += match.length;
  }
  
  const isAI = matches.length >= 2 || patternCount >= 3;
  return {
    isAI,
    matches: matches.slice(0, 3),
    confidence: isAI ? 70 + matches.length * 5 : 0
  };
};

// ─── Core Sentence Checker ────────────────────────────────────────────────────
const checkSentence = async (sentence) => {
  const base = {
    sentence,
    isPlagiarized: false,
    matchedUrl: '',
    matchedWebsite: '',
    similarity: 0,
    source: 'original',
    aiConfidence: 0,
    aiMatches: []
  };
  
  // Step 1: AI detection
  const aiResult = checkAIPhrases(sentence);
  if (aiResult.isAI) {
    console.log(`  🤖 AI Pattern Detected (${aiResult.confidence}%)`);
    return {
      ...base,
      isPlagiarized: true,
      source: 'ai-generated',
      matchedWebsite: 'AI-Generated Content',
      matchedUrl: '#',
      similarity: aiResult.confidence,
      aiConfidence: aiResult.confidence,
      aiMatches: aiResult.matches
    };
  }
  
  // Step 2: API Search (Primary method) - now with many strong backends
  console.log('  📡 Checking APIs (Tavily / Serper / Firecrawl / Exa / SerpAPI / CORE / Crossref / Scholar / Google)...');
  const apiResults = await apiSearch.searchAll(sentence);
  
  for (const result of apiResults) {
    try {
      const match = await checkUrl(sentence, result.url);
      if (match) {
        console.log(`  ✅ MATCH FOUND via ${result.source} - ${match.similarity}% similarity`);
        return {
          ...base,
          isPlagiarized: true,
          matchedUrl: result.url,
          matchedWebsite: result.source,
          similarity: match.similarity,
          source: result.type || 'web',
          metadata: {
            title: result.title,
            authors: result.authors,
            year: result.year,
            snippet: result.snippet?.substring(0, 120) || 'No snippet'
          }
        };
      }
    } catch (err) {
      console.warn(`  Skipped URL check error: ${err.message}`);
    }
  }
  
  // Step 3: Direct Site Crawling (Backup method) - expanded a bit
  console.log('  📚 Checking priority educational & academic sites directly...');
  
  // Priority sites to check (added a few more high-value ones)
  const priorityUrls = [
    `https://www.google.com/search?q=${encodeURIComponent('site:javatpoint.com ' + sentence)}`,
    `https://www.google.com/search?q=${encodeURIComponent('site:geeksforgeeks.org ' + sentence)}`,
    `https://www.google.com/search?q=${encodeURIComponent('site:tutorialspoint.com ' + sentence)}`,
    `https://www.google.com/search?q=${encodeURIComponent('site:w3schools.com ' + sentence)}`,
    `https://www.google.com/search?q=${encodeURIComponent('site:programiz.com ' + sentence)}`,
    `https://www.google.com/search?q=${encodeURIComponent('site:researchgate.net ' + sentence)}`,
    `https://www.google.com/search?q=${encodeURIComponent('site:arxiv.org ' + sentence)}`,
    `https://www.google.com/search?q=${encodeURIComponent('site:stackoverflow.com ' + sentence)}`,
  ];
  
  for (const url of priorityUrls) {
    try {
      const html = await fetchHTML(url);
      if (html) {
        const $ = cheerio.load(html);
        const links = [];
        
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href') || '';
          if (href.startsWith('/url?q=')) {
            try {
              const realUrl = decodeURIComponent(href.replace('/url?q=', '').split('&')[0]);
              if (realUrl.startsWith('http') && !realUrl.includes('google.com')) {
                links.push(realUrl);
              }
            } catch {}
          }
        });
        
        for (const link of links.slice(0, 4)) {  // increased to 4 for better coverage
          const match = await checkUrl(sentence, link);
          if (match) {
            const info = getSiteInfo(link);
            console.log(`  ✅ DIRECT MATCH: ${info.name} - ${match.similarity}%`);
            return {
              ...base,
              isPlagiarized: true,
              matchedUrl: link,
              matchedWebsite: info.name,
              similarity: match.similarity,
              source: info.type
            };
          }
        }
      }
    } catch (err) {
      console.warn(`  Direct site search failed: ${err.message}`);
    }
  }
  
  console.log(`  ✓ Original content (no strong matches found)`);
  return base;
};

// ─── Main Export ──────────────────────────────────────────────────────────────
const checkPlagiarism = async (sentences) => {
  const results = [];
  
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    console.log(`\n━━ [${i + 1}/${sentences.length}] "${sentence.substring(0, 60)}..."`);
    
    try {
      const result = await checkSentence(sentence);
      results.push(result);
    } catch (err) {
      console.error('  Error:', err.message);
      results.push({
        sentence,
        isPlagiarized: false,
        matchedUrl: '',
        matchedWebsite: '',
        similarity: 0,
        source: 'original'
      });
    }
    
    // Force garbage collection if enabled
    if (global.gc) global.gc();
    
    if (i < sentences.length - 1) {
      await delay(800);  // slightly longer delay to be kinder to APIs
    }
  }
  
  // Show rate limit status
  const limits = apiSearch.getRateLimitStatus();
  console.log('\n📊 API Usage Status:', limits);
  
  return results;
};

module.exports = { checkPlagiarism, checkSentence };