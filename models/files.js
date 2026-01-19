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
  isLink: { type: Boolean, default: false },
  content: { type: String },
  
  url: { type: String },  
  uploadedBy: { type: String },
  uploadedByEmail: { type: String },
  uploadedByName: { type: String },
  uploadedAt: { type: Date, default: Date.now },
  
  isAssessmentMaterial: { type: Boolean, default: false },
  assessmentType: { type: String },
  classId: { type: String },
  unitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit' }
});

module.exports = mongoose.model('File', fileSchema);