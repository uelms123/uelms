const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
  sentence: String,
  isPlagiarized: Boolean,
  matchedUrl: String,
  matchedWebsite: String,
  similarity: Number,
  source: String,
  aiConfidence: Number,
  aiMatches: [String],
  metadata: {
    title: String,
    authors: String,
    year: String,
    journal: String
  }
});

const reportSchema = new mongoose.Schema({
  // User identification (optional for backward compatibility)
  userId: { 
    type: String, 
    index: true,
    sparse: true
  },
  userEmail: {
    type: String,
    index: true,
    sparse: true,
    lowercase: true
  },
  
  // Report data
  fileName: { type: String, required: true },
  originalText: { type: String, required: true },
  totalWords: { type: Number, required: true },
  totalSentences: { type: Number, required: true },
  plagiarizedSentences: { type: Number, required: true },
  originalSentences: { type: Number, required: true },
  plagiarismPercentage: { type: Number, required: true },
  sourceTypes: {
    educational: { type: Number, default: 0 },
    journal: { type: Number, default: 0 },
    wiki: { type: Number, default: 0 },
    forum: { type: Number, default: 0 },
    ai: { type: Number, default: 0 },
    web: { type: Number, default: 0 },
    other: { type: Number, default: 0 }
  },
  matches: [matchSchema],
  createdAt: { type: Date, default: Date.now }
}, {
  // Add compound index for user-specific queries sorted by date
  indexes: [
    { userId: 1, createdAt: -1 },
    { userEmail: 1, createdAt: -1 }
  ]
});

module.exports = mongoose.model('Report', reportSchema);