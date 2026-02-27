// config/apiKeys.js
require('dotenv').config();

module.exports = {
  google: {
    apiKey: process.env.GOOGLE_API_KEY,
    cx: process.env.GOOGLE_CX,
    enabled: !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CX)
  },
  
  serpapi: {
    apiKey: process.env.SERPAPI_KEY,
    enabled: !!process.env.SERPAPI_KEY
  },
  
  core: {
    apiKey: process.env.CORE_API_KEY,
    enabled: !!process.env.CORE_API_KEY
  },
  
  crossref: {
    email: process.env.CROSSREF_EMAIL,
    enabled: true
  },

  exa: {
    apiKey: process.env.EXA_API_KEY,
    enabled: !!process.env.EXA_API_KEY
  },

  tavily: {
    apiKey: process.env.TAVILY_API_KEY,
    enabled: !!process.env.TAVILY_API_KEY
  },

  serper: {
    apiKey: process.env.SERPER_API_KEY,
    enabled: !!process.env.SERPER_API_KEY
  },

  firecrawl: {
    apiKey: process.env.FIRECRAWL_API_KEY,
    enabled: !!process.env.FIRECRAWL_API_KEY
  },
  
  // Rate limits tracking
  rateLimits: {
    google: { daily: 100, used: 0 },
    serpapi: { monthly: 100, used: 0 },
    core: { daily: 1000, used: 0 },
    exa: { daily: 1000, used: 0 },
    tavily: { monthly: 1000, used: 0 },     // adjust based on your plan (Tavily free ~1000/mo)
    serper: { monthly: 2500, used: 0 },     // Serper free tier ~2500 searches/mo
    firecrawl: { monthly: 500, used: 0 }    // Firecrawl free tier varies; check dashboard
  }
};