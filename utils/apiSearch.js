// utils/apiSearch.js
const axios = require('axios');
const apiKeys = require('../config/apiKeys');

class APISearch {
  constructor() {
    this.results = [];
    this.googleEnabled = false;
    this.checkGoogleStatus();
  }

  // Check if Google API is properly configured
  async checkGoogleStatus() {
    try {
      const testUrl = 'https://www.googleapis.com/customsearch/v1';
      const params = {
        key: apiKeys.google.apiKey,
        cx: apiKeys.google.cx,
        q: 'test',
        num: 1
      };
      
      const response = await axios.get(testUrl, { params, timeout: 5000 });
      this.googleEnabled = response.status === 200;
      console.log('✅ Google Custom Search API is working');
    } catch (error) {
      this.googleEnabled = false;
      console.log('⚠️ Google Custom Search API not working:', error.message);
    }
  }

  // ─── Google Custom Search API with better error handling ─────────────────
  async searchGoogle(query) {
    if (!apiKeys.google.enabled) {
      console.log('    Google API not configured');
      return [];
    }
    
    if (!this.googleEnabled) {
      console.log('    Google API previously failed, skipping...');
      return [];
    }
    
    try {
      console.log('    Using Google Custom Search API...');
      const url = 'https://www.googleapis.com/customsearch/v1';
      const params = {
        key: apiKeys.google.apiKey,
        cx: apiKeys.google.cx,
        q: query,
        num: 5, // Reduced from 10 to avoid quota issues
        fields: 'items(title,link,snippet,displayLink)'
      };
      
      const response = await axios.get(url, { params, timeout: 8000 });
      
      if (response.data.items) {
        console.log(`    ✅ Google found ${response.data.items.length} results`);
        apiKeys.rateLimits.google.used += response.data.items.length;
        return response.data.items.map(item => ({
          title: item.title,
          url: item.link,
          snippet: item.snippet,
          domain: item.displayLink,
          source: 'Google Search',
          type: 'web',
          confidence: 0.8
        }));
      }
      return [];
    } catch (error) {
      console.error('    ❌ Google API error:', error.message);
      
      if (error.response) {
        console.error('    Status:', error.response.status);
        console.error('    Data:', error.response.data);
        
        // If 403, disable Google for this session
        if (error.response.status === 403) {
          this.googleEnabled = false;
          console.log('    ⚠️ Google API disabled for this session');
        }
      }
      
      return [];
    }
  }

  // ─── Tavily Search ─────────────────────────────────────────────────────────
  async searchTavily(query) {
    if (!apiKeys.tavily.enabled) {
      console.log('    Tavily API not configured');
      return [];
    }

    // Truncate query to prevent "Query is too long" 400 error (Tavily max ~400 chars)
    const safeQuery = query.length > 380 
      ? query.substring(0, 380) + '...' 
      : query;

    try {
      console.log('    Using Tavily search...');
      const url = 'https://api.tavily.com/search';
      
      const response = await axios.post(url, {
        api_key: apiKeys.tavily.apiKey,
        query: safeQuery,
        search_depth: "basic",      // or "advanced" if you want deeper
        include_answer: false,
        include_images: false,
        include_raw_content: false,
        max_results: 5
      }, {
        timeout: 10000
      });

      if (response.data.results && response.data.results.length > 0) {
        console.log(`    ✅ Tavily found ${response.data.results.length} results`);
        apiKeys.rateLimits.tavily.used += response.data.results.length;

        return response.data.results.map(item => ({
          title: item.title || 'Untitled',
          url: item.url,
          snippet: item.content || 'No snippet',
          domain: new URL(item.url).hostname.replace('www.', ''),
          source: 'Tavily',
          type: 'web',
          confidence: 0.90
        }));
      }
      return [];
    } catch (error) {
      console.error('    ❌ Tavily API error:', error.message);
      if (error.response) {
        console.error('    Status:', error.response.status);
        console.error('    Data:', error.response.data);
      }
      return [];
    }
  }

  // ─── Serper.dev Google SERP ────────────────────────────────────────────────
  async searchSerper(query) {
    if (!apiKeys.serper.enabled) {
      console.log('    Serper API not configured');
      return [];
    }

    try {
      console.log('    Using Serper.dev...');
      const url = 'https://google.serper.dev/search';
      
      const response = await axios.post(url, {
        q: query,
        num: 5
      }, {
        headers: {
          'X-API-KEY': apiKeys.serper.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      let results = [];
      if (response.data.organic) {
        results = response.data.organic;
      } else if (response.data['organicResults']) {
        results = response.data['organicResults'];
      }

      if (results.length > 0) {
        console.log(`    ✅ Serper found ${results.length} results`);
        apiKeys.rateLimits.serper.used += results.length;

        return results.map(item => ({
          title: item.title || 'Untitled',
          url: item.link || item.url,
          snippet: item.snippet || item.description || 'No snippet',
          domain: (item.link || item.url || '').split('/')[2]?.replace('www.', '') || 'unknown',
          source: 'Serper',
          type: 'web',
          confidence: 0.85
        }));
      }
      return [];
    } catch (error) {
      console.error('    ❌ Serper API error:', error.message);
      if (error.response) {
        console.error('    Status:', error.response.status);
        console.error('    Data:', error.response.data);
      }
      return [];
    }
  }

  // ─── Firecrawl Search (web search + snippets) ──────────────────────────────
  async searchFirecrawlSearch(query) {
    if (!apiKeys.firecrawl.enabled) {
      console.log('    Firecrawl API not configured');
      return [];
    }

    try {
      console.log('    Using Firecrawl search...');
      const url = 'https://api.firecrawl.dev/v0/search';
      
      const response = await axios.post(url, {
        query: query,
        limit: 5,
        lang: "en",
        // optional: scrape: true → would return full content but costs more
      }, {
        headers: {
          'Authorization': `Bearer ${apiKeys.firecrawl.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000   // Increased to 60 seconds to avoid timeout errors
      });

      if (response.data.data && response.data.data.length > 0) {
        console.log(`    ✅ Firecrawl search found ${response.data.data.length} results`);
        apiKeys.rateLimits.firecrawl.used += response.data.data.length;

        return response.data.data.map(item => ({
          title: item.metadata?.title || 'Untitled',
          url: item.url || item.metadata?.sourceURL,
          snippet: item.content?.substring(0, 300) || item.metadata?.description || 'No snippet',
          domain: new URL(item.url || item.metadata?.sourceURL || 'about:blank').hostname.replace('www.', ''),
          source: 'Firecrawl Search',
          type: 'web',
          confidence: 0.88
        }));
      }
      return [];
    } catch (error) {
      console.error('    ❌ Firecrawl search API error:', error.message);
      if (error.response) {
        console.error('    Status:', error.response.status);
        console.error('    Data:', error.response.data);
      } else if (error.code === 'ECONNABORTED') {
        console.error('    Firecrawl timed out after 60 seconds - consider checking API quota or network');
      }
      return [];
    }
  }

  // ─── Exa.ai Semantic Search ────────────────────────────────────────────────
  async searchExa(query) {
    if (!apiKeys.exa.enabled) {
      console.log('    Exa API not configured');
      return [];
    }

    try {
      console.log('    Using Exa.ai semantic search...');
      const url = 'https://api.exa.ai/search';
      
      const response = await axios.post(url, {
        query: query,
        numResults: 5,
        type: 'auto',             // can be 'fast', 'neural', 'deep', 'auto'
        contents: {
          text: true,             // get text content / highlights
          highlights: { maxCharacters: 800 }
        }
      }, {
        headers: {
          'x-api-key': apiKeys.exa.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      if (response.data.results && response.data.results.length > 0) {
        console.log(`    ✅ Exa found ${response.data.results.length} results`);
        apiKeys.rateLimits.exa.used += response.data.results.length;

        return response.data.results.map(item => ({
          title: item.title || 'Untitled',
          url: item.url,
          snippet: item.text || item.highlights?.join(' ') || 'No snippet available',
          domain: new URL(item.url).hostname.replace('www.', ''),
          source: 'Exa.ai',
          type: 'web',
          confidence: 0.92          // Exa is semantic → higher confidence
        }));
      }
      return [];
    } catch (error) {
      console.error('    ❌ Exa API error:', error.message);
      if (error.response) {
        console.error('    Status:', error.response.status);
        console.error('    Data:', error.response.data);
      }
      return [];
    }
  }

  // ─── SerpAPI with better error handling ─────────────────────────────────
  async searchSerpAPI(query) {
    if (!apiKeys.serpapi.enabled) return [];
    
    try {
      console.log('    Using SerpAPI...');
      const url = 'https://serpapi.com/search';
      const params = {
        api_key: apiKeys.serpapi.apiKey,
        q: query,
        engine: 'google',
        num: 5,
        google_domain: 'google.com',
        hl: 'en'
      };
      
      const response = await axios.get(url, { params, timeout: 10000 });
      
      if (response.data.organic_results) {
        console.log(`    ✅ SerpAPI found ${response.data.organic_results.length} results`);
        apiKeys.rateLimits.serpapi.used += response.data.organic_results.length;
        return response.data.organic_results.map(item => ({
          title: item.title,
          url: item.link,
          snippet: item.snippet,
          domain: item.displayLink || item.link.split('/')[2],
          source: 'SerpAPI',
          type: 'web',
          confidence: 0.85
        }));
      }
      return [];
    } catch (error) {
      console.error('    ❌ SerpAPI error:', error.message);
      return [];
    }
  }

  // ─── CORE API with better error handling ────────────────────────────────
  async searchCORE(query) {
    if (!apiKeys.core.enabled) return [];
    
    try {
      console.log('    Searching CORE Academic API...');
      const url = 'https://api.core.ac.uk/v3/search/works';
      
      // Try different query formats
      const queries = [
        query,
        query.split(' ').slice(0, 5).join(' '), // First 5 words
        query.substring(0, 100) // First 100 chars
      ];
      
      for (const q of queries) {
        try {
          const response = await axios.post(url, 
            {
              q: q,
              limit: 3,
              select: ['title', 'authors', 'year', 'publisher', 'downloadUrl', 'abstract']
            },
            {
              headers: {
                'Authorization': `Bearer ${apiKeys.core.apiKey}`,
                'Content-Type': 'application/json'
              },
              timeout: 8000
            }
          );
          
          if (response.data.results && response.data.results.length > 0) {
            console.log(`    ✅ CORE found ${response.data.results.length} results`);
            apiKeys.rateLimits.core.used += response.data.results.length;
            return response.data.results.map(item => ({
              title: item.title,
              url: item.downloadUrl || `https://core.ac.uk/search?q=${encodeURIComponent(item.title)}`,
              snippet: item.abstract?.substring(0, 200) || 'Academic paper',
              authors: item.authors?.map(a => a.name).join(', ') || 'Unknown',
              year: item.year,
              publisher: item.publisher,
              domain: 'core.ac.uk',
              source: 'CORE Academic',
              type: 'academic',
              confidence: 0.9
            }));
          }
        } catch (e) {
          continue; // Try next query format
        }
      }
      return [];
    } catch (error) {
      console.error('    ❌ CORE API error:', error.message);
      return [];
    }
  }

  // ─── Crossref API with better error handling ────────────────────────────
  async searchCrossref(query) {
    try {
      console.log('    Searching Crossref Academic API...');
      const url = 'https://api.crossref.org/works';
      const params = {
        query: query,
        rows: 3,
        select: 'DOI,title,author,abstract,URL,published-print,container-title',
        mailto: apiKeys.crossref.email
      };
      
      const response = await axios.get(url, { params, timeout: 8000 });
      
      if (response.data.message?.items && response.data.message.items.length > 0) {
        console.log(`    ✅ Crossref found ${response.data.message.items.length} results`);
        return response.data.message.items.map(item => ({
          title: item.title?.[0] || 'Unknown',
          url: item.URL || `https://doi.org/${item.DOI}`,
          snippet: item.abstract?.substring(0, 200) || 'Academic paper',
          authors: item.author?.map(a => `${a.given || ''} ${a.family || ''}`.trim()).join(', ') || 'Unknown',
          year: item.published?.['print']?.[0] || item.published?.['online']?.[0] || 'Unknown',
          journal: item['container-title']?.[0] || 'Unknown',
          domain: 'crossref.org',
          source: 'Crossref',
          type: 'academic',
          confidence: 0.85
        }));
      }
      return [];
    } catch (error) {
      console.error('    ❌ Crossref API error:', error.message);
      return [];
    }
  }

  // ─── Google Scholar via SerpAPI ────────────────────────────────────────
  async searchGoogleScholar(query) {
    if (!apiKeys.serpapi.enabled) return [];
    
    try {
      console.log('    Searching Google Scholar...');
      const url = 'https://serpapi.com/search';
      const params = {
        api_key: apiKeys.serpapi.apiKey,
        q: query,
        engine: 'google_scholar',
        num: 3
      };
      
      const response = await axios.get(url, { params, timeout: 8000 });
      
      if (response.data.organic_results) {
        console.log(`    ✅ Google Scholar found ${response.data.organic_results.length} results`);
        return response.data.organic_results.map(item => ({
          title: item.title,
          url: item.link,
          snippet: item.snippet,
          authors: item.publication_info?.authors || 'Unknown',
          year: item.publication_info?.summary || 'Unknown',
          domain: 'scholar.google.com',
          source: 'Google Scholar',
          type: 'academic',
          confidence: 0.95
        }));
      }
      return [];
    } catch (error) {
      console.error('    ❌ Google Scholar error:', error.message);
      return [];
    }
  }

  // ─── Fallback Web Scraping when APIs fail ──────────────────────────────
  async fallbackWebSearch(query) {
    console.log('    ⚠️ Using fallback web search...');
    
    const searchUrls = [
      `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
      `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    ];
    
    const results = [];
    
    for (const searchUrl of searchUrls) {
      try {
        const response = await axios.get(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 5000
        });
        
        // Simple URL extraction (this would need proper parsing)
        const urls = response.data.match(/https?:\/\/[^\s"<>]+/g) || [];
        const uniqueUrls = [...new Set(urls)]
          .filter(url => !url.includes('google.com') && !url.includes('bing.com') && !url.includes('duckduckgo.com'))
          .slice(0, 5);
        
        uniqueUrls.forEach(url => {
          results.push({
            title: 'Web Search Result',
            url: url,
            snippet: 'Found via web search',
            domain: url.split('/')[2] || 'unknown',
            source: 'Web Search',
            type: 'web',
            confidence: 0.5
          });
        });
        
        if (results.length > 0) break;
      } catch (e) {
        continue;
      }
    }
    
    return results;
  }

  // ─── Main Search Function ──────────────────────────────────────────────
  async searchAll(query) {
    console.log(`  🔍 Searching all APIs for: "${query.substring(0, 60)}..."`);
    
    const allResults = [];
    const errors = [];
    
    // Check Google status first
    if (this.googleEnabled) {
      await this.checkGoogleStatus();
    }
    
    // Run all API searches in parallel with individual error handling
    const searches = await Promise.allSettled([
      this.searchGoogle(query).catch(e => {
        errors.push(`Google: ${e.message}`);
        return [];
      }),
      this.searchTavily(query).catch(e => {
        errors.push(`Tavily: ${e.message}`);
        return [];
      }),
      this.searchSerper(query).catch(e => {
        errors.push(`Serper: ${e.message}`);
        return [];
      }),
      this.searchFirecrawlSearch(query).catch(e => {
        errors.push(`Firecrawl: ${e.message}`);
        return [];
      }),
      this.searchExa(query).catch(e => {
        errors.push(`Exa: ${e.message}`);
        return [];
      }),
      this.searchSerpAPI(query).catch(e => {
        errors.push(`SerpAPI: ${e.message}`);
        return [];
      }),
      this.searchCORE(query).catch(e => {
        errors.push(`CORE: ${e.message}`);
        return [];
      }),
      this.searchCrossref(query).catch(e => {
        errors.push(`Crossref: ${e.message}`);
        return [];
      }),
      this.searchGoogleScholar(query).catch(e => {
        errors.push(`Google Scholar: ${e.message}`);
        return [];
      })
    ]);
    
    // Collect all successful results
    searches.forEach(result => {
      if (result.status === 'fulfilled' && result.value.length > 0) {
        allResults.push(...result.value);
      }
    });
    
    // If no results from APIs, try fallback search
    if (allResults.length === 0) {
      console.log('  ⚠️ No API results, trying fallback search...');
      const fallback = await this.fallbackWebSearch(query);
      allResults.push(...fallback);
    }
    
    // Remove duplicates by URL
    const uniqueMap = new Map();
    allResults.forEach(result => {
      if (result.url && !uniqueMap.has(result.url)) {
        uniqueMap.set(result.url, result);
      }
    });
    
    const uniqueResults = Array.from(uniqueMap.values());
    
    if (errors.length > 0) {
      console.log('  ⚠️ API Errors:', errors.join(', '));
    }
    
    console.log(`  📊 Total results: ${uniqueResults.length} unique sources`);
    
    return uniqueResults;
  }

  // ─── Get Rate Limit Status ─────────────────────────────────────────────
  getRateLimitStatus() {
    return {
      google: `${apiKeys.rateLimits.google.used}/100 daily - ${this.googleEnabled ? '✅' : '❌'}`,
      tavily: `${apiKeys.rateLimits.tavily.used}/1000 monthly - ${apiKeys.tavily.enabled ? '✅' : '❌'}`,
      serper: `${apiKeys.rateLimits.serper.used}/2500 monthly - ${apiKeys.serper.enabled ? '✅' : '❌'}`,
      firecrawl: `${apiKeys.rateLimits.firecrawl.used}/500 monthly - ${apiKeys.firecrawl.enabled ? '✅' : '❌'}`,
      exa: `${apiKeys.rateLimits.exa.used}/1000 daily - ${apiKeys.exa.enabled ? '✅' : '❌'}`,
      serpapi: `${apiKeys.rateLimits.serpapi.used}/100 monthly`,
      core: `${apiKeys.rateLimits.core.used}/1000 daily`
    };
  }
}

module.exports = new APISearch();