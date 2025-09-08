const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
  title: { type: String, required: true },
  desc: { type: String },
  name: { type: String, required: true }, 
  type: { type: String, required: true }, 
  size: { type: String, required: true }, 
  lastModified: { type: String }, 
  isUploadedFile: { type: Boolean, default: true }, 
  isNotes: { type: Boolean, default: false }, 
  filePath: { type: String, required: false }, 
  isLink: { type: Boolean, default: false }, // New field for links
 content: { type: String }, // Content for text files or notes or link URL
});

module.exports = mongoose.model('File', fileSchema);