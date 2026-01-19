const mongoose = require('mongoose');

const attendeeSchema = new mongoose.Schema({
  studentId: {
    type: String
  },
  email: {
    type: String,
    required: true,
    lowercase: true
  },
  name: {
    type: String,
    default: 'Guest'
  },
  joinedAt: {
    type: Date,
    default: Date.now
  },
  leftAt: Date,
  duration: {
    type: Number, // in minutes
    default: 0
  },
  status: {
    type: String,
    enum: ['attended', 'not-attended', 'late', 'external'],
    default: 'attended'
  },
  isExternal: {
    type: Boolean,
    default: false
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  lastHeartbeat: Date,
  autoLeave: {
    type: Boolean,
    default: false
  },
  autoLeaveReason: String,
  joinType: {
    type: String,
    enum: ['lms', 'external_link', 'whatsapp', 'email', 'direct'],
    default: 'lms'
  },
  deviceInfo: {
    userAgent: String,
    platform: String,
    browser: String,
    os: String
  },
  attendanceScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 100
  }
});

const meetingSchema = new mongoose.Schema({
  classId: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  courseCode: {
    type: String,
    default: 'N/A'
  },
  meetLink: {
    type: String,
    required: true
  },
  meetSpaceId: {
    type: String
  },
  meetType: {
    type: String,
    enum: ['google-meet', 'zoom', 'teams', 'meet-google', 'meet-zoom', 'meet-teams'],
    default: 'google-meet'
  },
  scheduledTime: {
    type: Date,
    required: true
  },
  duration: {
    type: Number,
    default: 60
  },
  createdBy: {
    type: String,
    required: true
  },
  
  // Meeting tracking
  actualStartTime: {
    type: Date
  },
  actualEndTime: {
    type: Date
  },
  actualDuration: {
    type: Number,
    default: 0
  },
  isMeetingActive: {
    type: Boolean,
    default: false
  },
  
  // Attendees with detailed tracking
  attendees: [attendeeSchema],
  
  // External participants tracking
  externalParticipants: [{
    email: String,
    name: String,
    source: String, // whatsapp, email, direct_link
    joinTime: Date,
    leaveTime: Date,
    duration: Number
  }],
  
  // Meeting statistics
  stats: {
    totalEnrolled: {
      type: Number,
      default: 0
    },
    totalAttended: {
      type: Number,
      default: 0
    },
    totalExternal: {
      type: Number,
      default: 0
    },
    averageDuration: {
      type: Number,
      default: 0
    },
    attendancePercentage: {
      type: Number,
      default: 0
    }
  },
  
  status: {
    type: String,
    enum: ['scheduled', 'ongoing', 'completed', 'cancelled'],
    default: 'scheduled'
  },
  
  // Staff information
  staffInfo: {
    name: String,
    email: String,
    department: String
  },
  
  // Google Meet API data
  googleMeetData: {
    spaceId: String,
    conferenceId: String,
    recordingUrl: String,
    transcriptUrl: String
  },
  
  // Sync information
  lastSyncTime: Date,
  syncStatus: {
    type: String,
    enum: ['pending', 'synced', 'failed', 'partial'],
    default: 'pending'
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

// Update the updatedAt field before saving
meetingSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  // Calculate stats before saving
  if (this.attendees && this.attendees.length > 0) {
    const attended = this.attendees.filter(a => a.status === 'attended' || a.status === 'external');
    const totalDuration = attended.reduce((sum, a) => sum + (a.duration || 0), 0);
    
    this.stats.totalAttended = attended.length;
    this.stats.averageDuration = attended.length > 0 ? Math.round(totalDuration / attended.length) : 0;
    
    if (this.stats.totalEnrolled > 0) {
      this.stats.attendancePercentage = Math.round((this.stats.totalAttended / this.stats.totalEnrolled) * 100);
    }
  }
  
  next();
});

// Indexes for better performance
meetingSchema.index({ classId: 1, scheduledTime: -1 });
meetingSchema.index({ createdBy: 1, status: 1 });
meetingSchema.index({ 'attendees.email': 1 });
meetingSchema.index({ meetSpaceId: 1 });

module.exports = mongoose.model('Meeting', meetingSchema);