const mongoose = require('mongoose');

const ebookSchema = new mongoose.Schema({
  fileName: {
    type: String,
    required: true,
    trim: true
  },
  fileLink: {
    type: String,
    required: true,
    trim: true
  },
  uploadedBy: {
    type: String,
    default: 'Admin'
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Ebook', ebookSchema);