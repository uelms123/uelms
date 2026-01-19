const mongoose = require('mongoose');

const staffSchema = new mongoose.Schema({
  staffId: {
    type: String,
    required: [false, 'Staff ID is required'],
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
    required: false
  },
  tempPassword: {
    type: String,
    required: false
  },
  position: {
    type: String,
    default: 'Teacher',
    trim: true
  },
  department: {
    type: String,
    required: [true, 'Department/Program is required'], // CHANGED: Made required
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
  // ADD THIS FIELD for tracking staff classes
  createdClasses: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class'
    }],
    default: []
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
    if (!this.staffId) {
    // Create staffId from email (remove @ and domain)
    const emailPrefix = this.email.split('@')[0];
    this.staffId = `staff_${emailPrefix}_${Date.now().toString().slice(-6)}`;
  }
    this.updatedAt = Date.now();
  if (!this.createdTimestamp) {
    this.createdTimestamp = new Date().toISOString();
  }
  next();
});

// Create index for email for faster lookups
staffSchema.index({ email: 1 });

module.exports = mongoose.model('Staff', staffSchema);