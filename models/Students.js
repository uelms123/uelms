const mongoose = require('mongoose');

const passwordHistorySchema = new mongoose.Schema({
  password: { type: String },
  createdAt: { type: Date, default: Date.now },
  createdBy: {
    type: String,
    enum: ['admin', 'self', 'system'],
    default: 'system'
  },
  note: { type: String, default: '' }
}, { _id: false });

const studentSchema = new mongoose.Schema({
  studentId: {
    type: String,
    required: false, // We'll auto-generate if missing
    unique: true
  },

  name: {
    type: String,
    required: [true, 'Student name is required'],
    trim: true
  },

  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },

  // Passwords
  password: {
    type: String,
    required: false
  },

  // Temporary password (e.g. for PDF generation or one-time use)
  tempPassword: {
    type: String,
    required: false
  },

  // Password history & tracking
  passwordHistory: {
    type: [passwordHistorySchema],
    default: []
  },

  lastPasswordUpdated: {
    type: Date,
    default: Date.now
  },

  // Academic / contact fields
  program: {
    type: String,
    default: '',
    trim: true
  },

  phone: {
    type: String,
    default: '',
    trim: true
  },

  // Administrative fields
  createdByAdmin: {
    type: Boolean,
    default: false
  },

  createdTimestamp: {
    type: String,
    default: () => new Date().toISOString()
  },

  enrollmentDate: {
    type: Date,
    default: Date.now
  },

  // Standard timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },

  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Pre-save hook: update timestamps + ensure createdTimestamp + auto-generate studentId if missing
studentSchema.pre('save', function (next) {
  // Update updatedAt
  this.updatedAt = Date.now();

  // Ensure createdTimestamp exists (string ISO)
  if (!this.createdTimestamp) {
    this.createdTimestamp = new Date().toISOString();
  }

  // Auto-generate studentId only when missing
  if (!this.studentId && this.email) {
    const prefix = this.email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '');
    // keep last 6 digits of time to reduce collision risk while keeping id short
    this.studentId = `stu_${prefix}_${Date.now().toString().slice(-6)}`;
  }

  next();
});

// Indexes for faster lookups
studentSchema.index({ email: 1 });
studentSchema.index({ studentId: 1 });

module.exports = mongoose.model('Student', studentSchema);
