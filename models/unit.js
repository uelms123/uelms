const mongoose = require('mongoose');

const unitSchema = new mongoose.Schema({
  title: { type: String, required: true },
  date: { 
    type: String, 
    default: () => new Date().toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    }) 
  },
  files: [{ type: mongoose.Schema.Types.ObjectId, ref: 'File' }], 
  classId: { type: String, required: true },
  
  createdBy: { type: String }, // staffId
  createdByEmail: { type: String },
  createdByName: { type: String },
  createdAt: { type: Date, default: Date.now },
  isAssessmentUnit: { type: Boolean, default: false }
});

module.exports = mongoose.model('Unit', unitSchema);