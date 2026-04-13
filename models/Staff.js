const mongoose = require('mongoose');

const passwordHistorySchema = new mongoose.Schema(
  {
    password: {
      type: String,
      default: ''
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    createdBy: {
      type: String,
      default: 'admin'
    },
    note: {
      type: String,
      default: ''
    }
  },
  { _id: false }
);

const staffSchema = new mongoose.Schema({
  staffId: {
    type: String,
    required: false,
    unique: true,
    sparse: true,
    trim: true
  },

  uid: {
    type: String,
    unique: true,
    sparse: true,
    trim: true
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
    required: false,
    default: ''
  },

  tempPassword: {
    type: String,
    required: false,
    default: ''
  },

  passwordHistory: {
    type: [passwordHistorySchema],
    default: []
  },

  lastPasswordUpdated: {
    type: Date,
    default: null
  },

  position: {
    type: String,
    default: 'Teacher',
    trim: true
  },

  department: {
    type: String,
    required: [true, 'Department/Program is required'],
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

  createdClasses: {
    type: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Class'
      }
    ],
    default: []
  },

  isActive: {
    type: Boolean,
    default: true
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

// normalize values before validation
staffSchema.pre('validate', function (next) {
  if (this.email) {
    this.email = String(this.email).trim().toLowerCase();
  }

  if (this.name) {
    this.name = String(this.name).trim();
  }

  if (this.department) {
    this.department = String(this.department).trim();
  }

  if (this.position) {
    this.position = String(this.position).trim();
  }

  if (this.phone) {
    this.phone = String(this.phone).trim();
  }

  if (this.uid) {
    this.uid = String(this.uid).trim();
  }

  next();
});

// update auto fields
staffSchema.pre('save', function (next) {
  this.updatedAt = new Date();

  if (!this.staffId && this.email) {
    const emailPrefix = this.email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '');
    this.staffId = `staff_${emailPrefix}_${Date.now().toString().slice(-6)}`;
  }

  if (!this.createdTimestamp) {
    this.createdTimestamp = new Date().toISOString();
  }

  if (
    this.isModified('password') ||
    this.isModified('tempPassword')
  ) {
    this.lastPasswordUpdated = new Date();
  }

  next();
});

// indexes
staffSchema.index({ email: 1 });
staffSchema.index({ uid: 1 });
staffSchema.index({ staffId: 1 });
staffSchema.index({ department: 1 });
staffSchema.index({ createdAt: -1 });

module.exports = mongoose.models.Staff || mongoose.model('Staff', staffSchema);