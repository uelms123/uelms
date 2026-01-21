const mongoose = require('mongoose');

const staffActivitySchema = new mongoose.Schema({
  staffId: {
    type: String,
    required: [true, 'Staff ID is required']
  },
  staffEmail: {
    type: String,
    required: [true, 'Staff email is required'],
    lowercase: true,
    trim: true
  },
  staffName: {
    type: String,
    required: [true, 'Staff name is required'],
    trim: true
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true
  },
  className: {
    type: String,
    required: true,
    trim: true
  },
  classSubject: {
    type: String,
    default: '',
    trim: true
  },
  classSection: {
    type: String,
    default: '',
    trim: true
  },
  classCreatedDate: {
    type: Date,
    default: Date.now
  },
  activities: {
    streams: {
      count: { 
        type: Number, 
        default: 0 
      },
      lastUpdated: { 
        type: Date 
      },
      items: [{
        title: String,
        createdAt: Date,
        type: {
          type: String,
          enum: ['video', 'document', 'link', 'presentation', 'other']
        },
        description: String
      }]
    },
    assignments: {
      count: { 
        type: Number, 
        default: 0 
      },
      lastUpdated: { 
        type: Date 
      },
      items: [{
        title: String,
        createdAt: Date,
        dueDate: Date,
        maxScore: Number,
        description: String,
        submissionCount: Number
      }]
    },
    assessments: {
      count: { 
        type: Number, 
        default: 0 
      },
      lastUpdated: { 
        type: Date 
      },
      items: [{
        title: String,
        createdAt: Date,
        type: {
          type: String,
     enum: ['quiz', 'exam', 'test', 'project', 'unit', 'unit_creation', 'material', 'other']
        },
        maxScore: Number,
        description: String
      }]
    }
  },
  totalStreams: { 
    type: Number, 
    default: 0 
  },
  totalAssignments: { 
    type: Number, 
    default: 0 
  },
  totalAssessments: { 
    type: Number, 
    default: 0 
  },
  lastClassVisit: { 
    type: Date 
  },
  visitsCount: { 
    type: Number, 
    default: 0 
  },
  firstTrackedDate: { 
    type: Date, 
    default: Date.now 
  },
  actualCreationDate: { 
    type: Date 
  },
  isHistoricalData: { 
    type: Boolean, 
    default: false 
  },
  notes: {
    type: String,
    default: '',
    trim: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'archived'],
    default: 'active'
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

// Update timestamp before saving
staffActivitySchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes for faster queries
staffActivitySchema.index({ staffId: 1, classId: 1 }, { unique: true });
staffActivitySchema.index({ staffEmail: 1 });
staffActivitySchema.index({ classId: 1 });
staffActivitySchema.index({ updatedAt: -1 });
staffActivitySchema.index({ 'activities.streams.count': -1 });
staffActivitySchema.index({ 'activities.assignments.count': -1 });
staffActivitySchema.index({ 'activities.assessments.count': -1 });

// Virtual for total activities
staffActivitySchema.virtual('totalActivities').get(function() {
  return this.totalStreams + this.totalAssignments + this.totalAssessments;
});

// Method to increment activity
staffActivitySchema.methods.incrementActivity = function(activityType, itemData = null) {
  const validTypes = ['streams', 'assignments', 'assessments'];
  
  if (!validTypes.includes(activityType)) {
    throw new Error(`Invalid activity type: ${activityType}`);
  }
  
  // Increment count
  this.activities[activityType].count += 1;
  this.activities[activityType].lastUpdated = new Date();
  
  // Add item if provided
  if (itemData) {
    this.activities[activityType].items.push({
      ...itemData,
      createdAt: itemData.createdAt || new Date()
    });
  }
  
  // Update total counts
  if (activityType === 'streams') {
    this.totalStreams += 1;
  } else if (activityType === 'assignments') {
    this.totalAssignments += 1;
  } else if (activityType === 'assessments') {
    this.totalAssessments += 1;
  }
  
  return this;
};

// Method to track visit
staffActivitySchema.methods.trackVisit = function() {
  this.visitsCount += 1;
  this.lastClassVisit = new Date();
  return this;
};

// Static method to get staff summary
staffActivitySchema.statics.getStaffSummary = async function(staffId) {
  const activities = await this.find({ staffId });
  
  const summary = {
    totalStreams: 0,
    totalAssignments: 0,
    totalAssessments: 0,
    totalVisits: 0,
    totalClasses: activities.length,
    classes: []
  };
  
  activities.forEach(activity => {
    summary.totalStreams += activity.totalStreams;
    summary.totalAssignments += activity.totalAssignments;
    summary.totalAssessments += activity.totalAssessments;
    summary.totalVisits += activity.visitsCount;
    
    summary.classes.push({
      classId: activity.classId,
      className: activity.className,
      streams: activity.totalStreams,
      assignments: activity.totalAssignments,
      assessments: activity.totalAssessments,
      visits: activity.visitsCount,
      lastVisit: activity.lastClassVisit
    });
  });
  
  return summary;
};

module.exports = mongoose.model('StaffActivity', staffActivitySchema);