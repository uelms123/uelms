const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  studentId: {
    type: String,
    required: [true, 'Student ID is required'],
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
  password: {
    type: String,
    required: false
  },
  tempPassword: {
    type: String,
    required: false // Temporary password for PDF generation
  },
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
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field on save
studentSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  if (!this.createdTimestamp) {
    this.createdTimestamp = new Date().toISOString();
  }
  next();
});

// Create index for email for faster lookups
studentSchema.index({ email: 1 });

module.exports = mongoose.model('Student', studentSchema);