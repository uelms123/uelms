const mongoose = require('mongoose');

const DailyUploadSchema = new mongoose.Schema({
  date: { type: String, required: true }, // YYYY-MM-DD
  totalBytes: { type: Number, default: 0 },
}, { timestamps: true });

DailyUploadSchema.index({ date: 1 }, { unique: true });

module.exports = mongoose.model('DailyUpload', DailyUploadSchema);
