const mongoose = require('mongoose');

const staffSchema = new mongoose.Schema({
  staffId: {
    type: String,
    required: [true, 'Staff ID is required'],
    unique: true
  },
  name: {
    type: String,
    required: [true, 'Staff name is required'],
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
    required: false // Store for export, but not for authentication
  },
  tempPassword: {
    type: String,
    required: false // Temporary password for PDF generation
  },
  position: {
    type: String,
    default: 'Teacher',
    trim: true
  },
  department: {
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
staffSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  if (!this.createdTimestamp) {
    this.createdTimestamp = new Date().toISOString();
  }
  next();
});

// Create index for email for faster lookups
staffSchema.index({ email: 1 });

module.exports = mongoose.model('Staff', staffSchema);