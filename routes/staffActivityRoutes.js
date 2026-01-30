const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const StaffActivity = mongoose.models.StaffActivity || require('../models/StaffActivity');
const Class = mongoose.models.Class || require('../models/Class');
const Staff = mongoose.models.Staff || require('../models/Staff');
const Unit = mongoose.models.Unit || require('../models/unit');
const Meeting = mongoose.models.Meeting || require('../models/Meeting');

const validateObjectId = (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid ID format'
    });
  }
  next();
};

const allowedOrigins = [
  'https://uelms.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

router.use((req, res, next) => {
  const origin = req.headers.origin;

  if (
    allowedOrigins.includes(origin) ||
    (origin && origin.startsWith('http://localhost'))
  ) {
    res.header('Access-Control-Allow-Origin', origin);
  }

  res.header(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS'
  );

  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  );

  res.header('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});

// TRACK VISIT - FIXED
router.post('/track-visit', async (req, res) => {
  try {
    const { staffId, staffEmail, staffName, classId } = req.body;

    if (!staffId || !classId) {
      return res.status(400).json({ error: 'Staff ID and Class ID are required' });
    }

    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    let activity = await StaffActivity.findOne({ staffId, classId });

    if (!activity) {
      activity = new StaffActivity({
        staffId,
        staffEmail: staffEmail || '',
        staffName: staffName || '',
        classId,
        className: classData.name || '',
        classSubject: classData.subject || '',
        classSection: classData.section || '',
        classCreatedDate: classData.createdAt,
        visitsCount: 1,
        totalVisits: 1,
        lastClassVisit: new Date(),
        activities: {
          streams: { items: [], count: 0, lastUpdated: new Date() },
          assignments: { items: [], count: 0, lastUpdated: new Date() },
          assessments: { items: [], count: 0, lastUpdated: new Date() }
        }
      });
    } else {
      activity.visitsCount = (activity.visitsCount || 0) + 1;
      activity.totalVisits = (activity.totalVisits || 0) + 1;
      activity.lastClassVisit = new Date();
      if (staffName) activity.staffName = staffName;
      if (staffEmail) activity.staffEmail = staffEmail;

      // Ensure activities object exists
      if (!activity.activities) {
        activity.activities = {
          streams: { items: [], count: 0, lastUpdated: new Date() },
          assignments: { items: [], count: 0, lastUpdated: new Date() },
          assessments: { items: [], count: 0, lastUpdated: new Date() }
        };
      }
    }

    await activity.save();
    res.json({ success: true, message: 'Visit tracked successfully' });
  } catch (err) {
    console.error('Error tracking visit:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// TRACK ASSIGNMENT - FIXED
router.post('/track-assignment', async (req, res) => {
  try {
    const { 
      staffId, 
      staffEmail, 
      staffName, 
      classId, 
      activityType, 
      itemData = {} 
    } = req.body;
    
    console.log('Tracking assignment:', { staffId, classId, activityType, itemData });

    if (!staffId || !classId) {
      return res.status(400).json({ 
        success: false,
        error: 'Staff ID and Class ID are required' 
      });
    }

    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ 
        success: false,
        error: 'Class not found' 
      });
    }

    let activity = await StaffActivity.findOne({ staffId, classId });
    const now = new Date();

    if (!activity) {
      // Create new activity record
      activity = new StaffActivity({
        staffId,
        staffEmail: staffEmail || '',
        staffName: staffName || '',
        classId,
        className: classData.name,
        classSubject: classData.subject || '',
        classSection: classData.section || '',
        classCreatedDate: classData.createdAt,
        totalAssignments: 1,
        lastAssignmentUpdate: now,
        activities: {
          assignments: {
            items: [{
              id: itemData.id || new mongoose.Types.ObjectId().toString(),
              title: itemData.title || 'Untitled Assignment',
              type: itemData.type || 'assignment',
              assignmentType: itemData.assignmentType || 'text',
              createdAt: now,
            }],
            count: 1,
            lastUpdated: now
          },
          streams: { items: [], count: 0, lastUpdated: now },
          assessments: { items: [], count: 0, lastUpdated: now }
        }
      });
    } else {
      // Update existing activity
      activity.totalAssignments = (activity.totalAssignments || 0) + 1;
      activity.lastAssignmentUpdate = now;
      
      // Ensure activities object exists
      if (!activity.activities) {
        activity.activities = {
          assignments: { items: [], count: 0, lastUpdated: now },
          streams: { items: [], count: 0, lastUpdated: now },
          assessments: { items: [], count: 0, lastUpdated: now }
        };
      }
      
      // Ensure assignments object exists
      if (!activity.activities.assignments) {
        activity.activities.assignments = { items: [], count: 0, lastUpdated: now };
      }
      
      // Ensure items array exists
      if (!Array.isArray(activity.activities.assignments.items)) {
        activity.activities.assignments.items = [];
      }
      
      // Add new assignment item
      activity.activities.assignments.items.push({
        id: itemData.id || new mongoose.Types.ObjectId().toString(),
        title: itemData.title || 'Untitled Assignment',
        type: itemData.type || 'assignment',
        assignmentType: itemData.assignmentType || 'text',
        createdAt: now,
      });
      
      // Update count and timestamp
      activity.activities.assignments.count = activity.totalAssignments;
      activity.activities.assignments.lastUpdated = now;
      
      // Update staff info if provided
      if (staffName) activity.staffName = staffName;
      if (staffEmail) activity.staffEmail = staffEmail;
    }

    await activity.save();
    
    console.log('Assignment tracked successfully:', {
      staffId,
      classId,
      totalAssignments: activity.totalAssignments
    });
    
    res.json({ 
      success: true, 
      message: 'Assignment tracked successfully',
      data: {
        totalAssignments: activity.totalAssignments,
        activityId: activity._id
      }
    });
  } catch (err) {
    console.error('Error tracking assignment:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to track assignment: ' + (err.message || 'Internal server error')
    });
  }
});

// TRACK ASSESSMENT - FIXED
router.post('/track-assessment', async (req, res) => {
  try {
    const {
      staffId,
      staffEmail,
      staffName,
      classId,
      activityType,
      itemData = {},
      assessmentType,
      assessmentTitle,
      assessmentId
    } = req.body;
    
    console.log('Tracking assessment:', { staffId, classId, assessmentType, assessmentTitle });

    if (!staffId || !classId) {
      return res.status(400).json({ 
        success: false,
        error: 'Staff ID and Class ID are required' 
      });
    }

    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ 
        success: false,
        error: 'Class not found' 
      });
    }

    let activity = await StaffActivity.findOne({ staffId, classId });
    const now = new Date();

    if (!activity) {
      activity = new StaffActivity({
        staffId,
        staffEmail,
        staffName,
        classId,
        className: classData.name,
        classSubject: classData.subject || '',
        classSection: classData.section || '',
        classCreatedDate: classData.createdAt,
        totalAssessments: 1,
        lastAssessmentUpdate: now,
        activities: {
          assessments: {
            items: [{
              id: assessmentId || new mongoose.Types.ObjectId().toString(),
              title: assessmentTitle || itemData.title || 'Untitled Assessment',
              type: assessmentType || itemData.type || 'material',
              createdAt: now,
            }],
            count: 1,
            lastUpdated: now
          },
          assignments: { items: [], count: 0, lastUpdated: now },
          streams: { items: [], count: 0, lastUpdated: now }
        }
      });
    } else {
      activity.totalAssessments = (activity.totalAssessments || 0) + 1;
      activity.lastAssessmentUpdate = now;
      
      // Ensure activities object exists
      if (!activity.activities) {
        activity.activities = {
          assessments: { items: [], count: 0, lastUpdated: now },
          assignments: { items: [], count: 0, lastUpdated: now },
          streams: { items: [], count: 0, lastUpdated: now }
        };
      }
      
      // Ensure assessments object exists
      if (!activity.activities.assessments) {
        activity.activities.assessments = { items: [], count: 0, lastUpdated: now };
      }
      
      // Ensure items array exists
      if (!Array.isArray(activity.activities.assessments.items)) {
        activity.activities.assessments.items = [];
      }
      
      activity.activities.assessments.items.push({
        id: assessmentId || new mongoose.Types.ObjectId().toString(),
        title: assessmentTitle || itemData.title || 'Untitled Assessment',
        type: assessmentType || itemData.type || 'material',
        createdAt: now,
      });
      
      activity.activities.assessments.count = activity.totalAssessments;
      activity.activities.assessments.lastUpdated = now;
      
      if (staffName) activity.staffName = staffName;
      if (staffEmail) activity.staffEmail = staffEmail;
    }

    await activity.save();
    
    console.log('Assessment tracked successfully:', {
      staffId,
      classId,
      totalAssessments: activity.totalAssessments
    });
    
    res.json({ 
      success: true,
      message: 'Assessment tracked successfully',
      data: {
        totalAssessments: activity.totalAssessments,
        activityId: activity._id
      }
    });
  } catch (err) {
    console.error('Error tracking assessment:', err);
    res.status(500).json({ 
      success: false,
      error: err.message || 'Internal server error' 
    });
  }
});

// TRACK STREAM - FIXED
router.post('/track-stream', async (req, res) => {
  try {
    const { 
      staffId, 
      staffEmail, 
      staffName, 
      classId, 
      meetingId, 
      meetingTitle, 
      meetingType = 'live_stream',
      scheduledTime,
      duration 
    } = req.body;

    console.log('Tracking stream:', { staffId, classId, meetingId, meetingTitle });

    if (!staffId || !meetingId) {
      return res.status(400).json({ 
        success: false,
        error: 'Staff ID and meeting ID are required' 
      });
    }

    let classData = null;
    let className = '', subject = '', section = '';
    
    if (classId) {
      classData = await Class.findById(classId);
      if (classData) {
        className = classData.name || '';
        subject = classData.subject || '';
        section = classData.section || '';
      }
    }

    let activity = await StaffActivity.findOne({ 
      staffId, 
      classId: classId || null 
    });
    const now = new Date();

    if (!activity) {
      activity = new StaffActivity({
        staffId,
        staffEmail: staffEmail || '',
        staffName: staffName || '',
        classId: classId || null,
        className,
        classSubject: subject,
        classSection: section,
        classCreatedDate: classData ? classData.createdAt : now,
        totalStreams: 1,
        lastStreamUpdate: now,
        activities: {
          streams: {
            items: [{
              id: meetingId,
              title: meetingTitle || 'Untitled Meeting/Stream',
              type: meetingType,
              scheduledTime: scheduledTime || now,
              duration: duration || 60,
              createdAt: now,
            }],
            count: 1,
            lastUpdated: now
          },
          assignments: { items: [], count: 0, lastUpdated: now },
          assessments: { items: [], count: 0, lastUpdated: now }
        }
      });
    } else {
      activity.totalStreams = (activity.totalStreams || 0) + 1;
      activity.lastStreamUpdate = now;
      
      if (staffName) activity.staffName = staffName;
      if (staffEmail) activity.staffEmail = staffEmail;

      // Ensure activities object exists
      if (!activity.activities) {
        activity.activities = {
          streams: { items: [], count: 0, lastUpdated: now },
          assignments: { items: [], count: 0, lastUpdated: now },
          assessments: { items: [], count: 0, lastUpdated: now }
        };
      }
      
      // Ensure streams object exists
      if (!activity.activities.streams) {
        activity.activities.streams = {
          items: [],
          count: 0,
          lastUpdated: now
        };
      }
      
      // Ensure items array exists
      if (!Array.isArray(activity.activities.streams.items)) {
        activity.activities.streams.items = [];
      }

      activity.activities.streams.items.push({
        id: meetingId,
        title: meetingTitle || 'Untitled Meeting/Stream',
        type: meetingType,
        scheduledTime: scheduledTime || now,
        duration: duration || 60,
        createdAt: now,
      });
      
      activity.activities.streams.count = activity.totalStreams;
      activity.activities.streams.lastUpdated = now;
    }

    await activity.save();

    console.log('Stream tracked successfully:', {
      staffId,
      classId,
      totalStreams: activity.totalStreams
    });
    
    res.json({ 
      success: true, 
      message: 'Stream/Meeting tracked successfully',
      data: {
        streamCount: activity.totalStreams,
        activityId: activity._id
      }
    });
  } catch (err) {
    console.error('Error tracking stream:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
});

// UPDATE ACTIVITY - FIXED
router.post('/update-activity', async (req, res) => {
  try {
    const { staffId, staffEmail, staffName, classId, activityType, itemData = {} } = req.body;
    
    console.log('Updating activity:', { staffId, classId, activityType });

    if (!staffId || !classId || !activityType) {
      return res.status(400).json({ 
        success: false,
        error: 'Staff ID, Class ID, and activityType are required' 
      });
    }
    
    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ 
        success: false,
        error: 'Class not found' 
      });
    }
    
    let activity = await StaffActivity.findOne({ staffId, classId });
    const now = new Date();
    
    if (!activity) {
      activity = new StaffActivity({
        staffId,
        staffEmail: staffEmail || '',
        staffName: staffName || '',
        classId,
        className: classData.name,
        classSubject: classData.subject || '',
        classSection: classData.section || '',
        classCreatedDate: classData.createdAt,
        lastActivityUpdate: now,
      });
      
      // Initialize activities object
      activity.activities = {
        assignments: { items: [], count: 0, lastUpdated: now },
        assessments: { items: [], count: 0, lastUpdated: now },
        streams: { items: [], count: 0, lastUpdated: now }
      };
    } else {
      activity.lastActivityUpdate = now;
      if (staffEmail) activity.staffEmail = staffEmail;
      if (staffName) activity.staffName = staffName;
      
      // Ensure activities object exists
      if (!activity.activities) {
        activity.activities = {
          assignments: { items: [], count: 0, lastUpdated: now },
          assessments: { items: [], count: 0, lastUpdated: now },
          streams: { items: [], count: 0, lastUpdated: now }
        };
      }
    }
    
    // Handle different activity types
    switch (activityType) {
      case 'assessments':
        activity.totalAssessments = (activity.totalAssessments || 0) + 1;
        activity.lastAssessmentUpdate = now;
        
        if (!activity.activities.assessments) {
          activity.activities.assessments = { items: [], count: 0, lastUpdated: now };
        }
        
        if (!Array.isArray(activity.activities.assessments.items)) {
          activity.activities.assessments.items = [];
        }
        
        activity.activities.assessments.items.push({
          id: itemData.id || new mongoose.Types.ObjectId().toString(),
          title: itemData.title || 'Untitled Assessment',
          type: itemData.type || 'material',
          createdAt: now,
        });
        
        activity.activities.assessments.count = activity.totalAssessments;
        activity.activities.assessments.lastUpdated = now;
        break;
        
      case 'assignments':
        activity.totalAssignments = (activity.totalAssignments || 0) + 1;
        activity.lastAssignmentUpdate = now;
        
        if (!activity.activities.assignments) {
          activity.activities.assignments = { items: [], count: 0, lastUpdated: now };
        }
        
        if (!Array.isArray(activity.activities.assignments.items)) {
          activity.activities.assignments.items = [];
        }
        
        activity.activities.assignments.items.push({
          id: itemData.id || new mongoose.Types.ObjectId().toString(),
          title: itemData.title || 'Untitled Assignment',
          type: itemData.type || 'assignment',
          createdAt: now,
        });
        
        activity.activities.assignments.count = activity.totalAssignments;
        activity.activities.assignments.lastUpdated = now;
        break;
        
      case 'streams':
        activity.totalStreams = (activity.totalStreams || 0) + 1;
        activity.lastStreamUpdate = now;
        
        if (!activity.activities.streams) {
          activity.activities.streams = { items: [], count: 0, lastUpdated: now };
        }
        
        if (!Array.isArray(activity.activities.streams.items)) {
          activity.activities.streams.items = [];
        }
        
        activity.activities.streams.items.push({
          id: itemData.id || new mongoose.Types.ObjectId().toString(),
          title: itemData.title || 'Untitled Stream',
          type: itemData.type || 'stream',
          createdAt: now,
        });
        
        activity.activities.streams.count = activity.totalStreams;
        activity.activities.streams.lastUpdated = now;
        break;
        
      default:
        return res.status(400).json({ 
          success: false,
          error: 'Invalid activityType' 
        });
    }
    
    await activity.save();
    
    console.log('Activity updated successfully:', {
      staffId,
      classId,
      activityType,
      counts: {
        assignments: activity.totalAssignments,
        assessments: activity.totalAssessments,
        streams: activity.totalStreams
      }
    });
    
    res.json({ 
      success: true,
      message: 'Activity updated successfully',
      data: {
        assignments: activity.totalAssignments,
        assessments: activity.totalAssessments,
        streams: activity.totalStreams,
        activityId: activity._id
      }
    });
  } catch (err) {
    console.error('Error updating activity:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
});

// GET STAFF TIMELINE - FIXED
router.get('/staff/:staffId/timeline', async (req, res) => {
  try {
    const { staffId } = req.params;
    const { startDate, endDate } = req.query;
    
    console.log('Fetching timeline for staff:', staffId);

    let staffIdentifier = staffId;
    let staffEmail = staffId;
    let staff = null;
    
    // Try to find staff by email or staffId
    if (staffId.includes('@')) {
      staff = await Staff.findOne({ email: staffId.toLowerCase() });
      if (staff) {
        staffIdentifier = staff.staffId;
        staffEmail = staff.email;
      }
    } else {
      staff = await Staff.findOne({ staffId });
      if (staff) {
        staffEmail = staff.email;
      }
    }
    
    if (!staff) {
      return res.status(404).json({
        success: false,
        error: 'Staff not found'
      });
    }
    
    // Build date filter
    let dateFilter = {};
    if (startDate) {
      dateFilter.createdAt = dateFilter.createdAt || {};
      dateFilter.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      dateFilter.createdAt = dateFilter.createdAt || {};
      dateFilter.createdAt.$lte = new Date(endDate);
    }
    
    // Get staff activities
    const staffActivities = await StaffActivity.find({
      $or: [
        { staffId: staffIdentifier },
        { staffEmail: staffEmail.toLowerCase() }
      ],
      ...dateFilter
    });
    
    // Get meetings
    const meetingsQuery = {
      $or: [
        { createdBy: staff._id.toString() },
        { createdBy: staffEmail },
        { 'staffInfo.email': staffEmail.toLowerCase() }
      ],
      ...dateFilter
    };
    
    const meetings = await Meeting.find(meetingsQuery);
    
    // Calculate totals
    let totalAssignments = 0;
    let totalAssessments = 0;
    let totalVisits = 0;
    let totalClasses = 0;
    
    staffActivities.forEach(activity => {
      totalAssignments += activity.totalAssignments || 0;
      totalAssessments += activity.totalAssessments || 0;
      totalVisits += activity.visitsCount || 0;
      if (activity.classId) totalClasses++;
    });
    
    const totalStreams = meetings.length;
    
    // Build class breakdown
    const classBreakdown = [];
    
    for (const activity of staffActivities) {
      if (activity.classId) {
        const classData = await Class.findById(activity.classId);
        if (classData) {
          const cidStr = activity.classId.toString();
          let entry = classBreakdown.find(e => e.classId.toString() === cidStr);
          
          if (!entry) {
            entry = {
              classId: activity.classId,
              className: classData.name || activity.className || 'Unknown Class',
              subject: classData.subject || activity.classSubject || 'N/A',
              section: classData.section || activity.classSection || 'N/A',
              streams: 0,
              assignments: 0,
              assessments: 0,
              visits: 0
            };
            classBreakdown.push(entry);
          }
          
          entry.assignments += activity.totalAssignments || 0;
          entry.assessments += activity.totalAssessments || 0;
          entry.visits += activity.visitsCount || 0;
        }
      }
    }
    
    // Add streams to class breakdown
    const meetingsByClass = await Meeting.aggregate([
      {
        $match: {
          $or: [
            { createdBy: staff._id.toString() },
            { createdBy: staffEmail },
            { 'staffInfo.email': staffEmail.toLowerCase() }
          ],
          classId: { $exists: true, $ne: null },
          ...dateFilter
        }
      },
      {
        $group: {
          _id: "$classId",
          count: { $sum: 1 }
        }
      }
    ]);
    
    for (const m of meetingsByClass) {
      const cidStr = m._id.toString();
      let entry = classBreakdown.find(e => e.classId.toString() === cidStr);
      
      if (entry) {
        entry.streams = m.count;
      } else {
        const classData = await Class.findById(m._id);
        if (classData) {
          classBreakdown.push({
            classId: m._id,
            className: classData.name || 'Unknown Class',
            subject: classData.subject || 'N/A',
            section: classData.section || 'N/A',
            streams: m.count,
            assignments: 0,
            assessments: 0,
            visits: 0
          });
        }
      }
    }
    
    // Sort class breakdown by total activity
    classBreakdown.sort((a, b) =>
      (b.streams + b.assignments + b.assessments + b.visits) -
      (a.streams + a.assignments + a.assessments + a.visits)
    );
    
    console.log('Timeline fetched successfully:', {
      staffId: staffIdentifier,
      totalActivities: staffActivities.length + meetings.length
    });
    
    res.status(200).json({
      success: true,
      summary: {
        totalStreams,
        totalAssignments,
        totalAssessments,
        totalVisits,
        totalClasses,
        totalActivities: staffActivities.length + meetings.length
      },
      timeline: [
        ...staffActivities.map(activity => ({
          type: 'activity',
          date: activity.lastActivityUpdate || activity.createdAt,
          title: `${activity.activityType} activity`,
          description: `Tracked ${activity.activityType} in ${activity.className || 'class'}`,
          className: activity.className,
          classId: activity.classId
        })),
        ...meetings.map(meeting => ({
          type: 'stream',
          date: meeting.scheduledTime || meeting.createdAt,
          title: meeting.title || 'Untitled Meeting',
          description: `Created ${meeting.meetType || 'live stream'}`,
          className: meeting.className || 'General Meeting',
          classId: meeting.classId,
          meetingId: meeting._id
        }))
      ].sort((a, b) => new Date(b.date) - new Date(a.date)),
      classBreakdown,
      staff: {
        staffId: staffIdentifier,
        email: staffEmail,
        name: staff.name
      },
      meetingsCount: meetings.length,
      activitiesCount: staffActivities.length
    });
  } catch (error) {
    console.error('Error fetching staff activity summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch staff activity summary: ' + error.message
    });
  }
});

// ANALYZE EXISTING CONTENT - FIXED
router.post('/analyze-existing/:staffId/:classId', async (req, res) => {
  try {
    const { staffId, classId } = req.params;
    
    console.log('Analyzing existing content:', { staffId, classId });

    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid class ID' 
      });
    }
    
    const staff = await Staff.findOne({ staffId });
    if (!staff) {
      return res.status(404).json({ 
        success: false,
        error: 'Staff not found' 
      });
    }
    
    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ 
        success: false,
        error: 'Class not found' 
      });
    }
    
    // Count units
    const unitsCount = await Unit.countDocuments({ 
      classId, 
      $or: [
        { createdBy: staffId },
        { createdByEmail: staff.email }
      ]
    });
    
    const units = await Unit.find({ 
      classId, 
      $or: [
        { createdBy: staffId },
        { createdByEmail: staff.email }
      ]
    }).select('title createdAt description');
    
    // Count meetings
    const meetingsCount = await Meeting.countDocuments({
      classId,
      $or: [
        { createdBy: staff._id.toString() },
        { createdBy: staff.email },
        { 'staffInfo.email': staff.email.toLowerCase() }
      ]
    });
    
    let activity = await StaffActivity.findOne({ staffId, classId });
    const now = new Date();
    
    if (!activity) {
      activity = new StaffActivity({
        staffId,
        staffEmail: staff.email,
        staffName: staff.name,
        classId,
        className: classData.name,
        classSubject: classData.subject || '',
        classSection: classData.section || '',
        classCreatedDate: classData.createdAt,
      });
    }
    
    // Update assessments from units
    activity.totalAssessments = unitsCount;
    
    // Ensure activities object exists
    if (!activity.activities) {
      activity.activities = {
        assessments: { items: [], count: 0, lastUpdated: now },
        assignments: { items: [], count: 0, lastUpdated: now },
        streams: { items: [], count: 0, lastUpdated: now }
      };
    }
    
    activity.activities.assessments = {
      count: unitsCount,
      lastUpdated: now,
      items: units.map(u => ({
        id: u._id || new mongoose.Types.ObjectId().toString(),
        title: u.title,
        createdAt: u.createdAt,
        type: 'unit',
        description: u.description || ''
      }))
    };
    
    // Update streams from meetings
    activity.totalStreams = meetingsCount;
    
    if (!activity.activities.streams) {
      activity.activities.streams = {
        count: meetingsCount,
        lastUpdated: now,
        items: []
      };
    } else {
      activity.activities.streams.count = meetingsCount;
      activity.activities.streams.lastUpdated = now;
    }
    
    activity.isHistoricalData = true;
    activity.notes = `Historical data: ${unitsCount} units (assessments) and ${meetingsCount} streams found`;
    
    await activity.save();
    
    console.log('Existing content analyzed successfully:', {
      staffId,
      classId,
      unitsCount,
      meetingsCount
    });
    
    res.status(200).json({
      success: true,
      message: 'Existing content analyzed successfully',
      data: {
        id: activity._id,
        staffId: activity.staffId,
        className: activity.className,
        streams: activity.totalStreams,
        assignments: activity.totalAssignments,
        assessments: activity.totalAssessments,
        isHistorical: activity.isHistoricalData
      }
    });
  } catch (error) {
    console.error('Error analyzing existing content:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze existing content: ' + error.message
    });
  }
});

// MANUAL UPDATE - FIXED
router.post('/manual-update', async (req, res) => {
  try {
    const { 
      staffId, 
      classId, 
      streams = 0, 
      assignments = 0, 
      assessments = 0,
      notes = '',
      isHistorical = false 
    } = req.body;
    
    console.log('Manual update:', { staffId, classId, streams, assignments, assessments });

    if (!staffId || !classId) {
      return res.status(400).json({
        success: false,
        error: 'Staff ID and Class ID are required'
      });
    }
    
    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }
    
    const staff = await Staff.findOne({ 
      $or: [
        { staffId: staffId },
        { email: staffId }
      ]
    });
    
    if (!staff) {
      return res.status(404).json({
        success: false,
        error: 'Staff not found'
      });
    }
    
    let activity = await StaffActivity.findOne({
      staffId: staff.staffId,
      classId
    });
    
    const now = new Date();
    
    if (!activity) {
      activity = new StaffActivity({
        staffId: staff.staffId,
        staffEmail: staff.email,
        staffName: staff.name,
        classId,
        className: classData.name,
        classSubject: classData.subject || '',
        classSection: classData.section || '',
        classCreatedDate: classData.createdAt,
        activities: {
          streams: {
            count: streams,
            lastUpdated: now,
            items: []
          },
          assignments: {
            count: assignments,
            lastUpdated: now,
            items: []
          },
          assessments: {
            count: assessments,
            lastUpdated: now,
            items: []
          }
        },
        totalStreams: streams,
        totalAssignments: assignments,
        totalAssessments: assessments,
        visitsCount: 1,
        lastClassVisit: now,
        isHistoricalData: isHistorical,
        notes: notes || 'Manually updated'
      });
    } else {
      const oldStreams = activity.totalStreams;
      const oldAssignments = activity.totalAssignments;
      const oldAssessments = activity.totalAssessments;
      
      activity.totalStreams = streams;
      activity.totalAssignments = assignments;
      activity.totalAssessments = assessments;
      
      // Ensure activities object exists
      if (!activity.activities) {
        activity.activities = {
          streams: { count: streams, lastUpdated: now, items: [] },
          assignments: { count: assignments, lastUpdated: now, items: [] },
          assessments: { count: assessments, lastUpdated: now, items: [] }
        };
      }
      
      activity.activities.streams.count = streams;
      activity.activities.assignments.count = assignments;
      activity.activities.assessments.count = assessments;
      
      activity.activities.streams.lastUpdated = now;
      activity.activities.assignments.lastUpdated = now;
      activity.activities.assessments.lastUpdated = now;
      
      activity.isHistoricalData = isHistorical;
      activity.notes = notes || `Updated from ${oldStreams}/${oldAssignments}/${oldAssessments} to ${streams}/${assignments}/${assessments}`;
    }
    
    await activity.save();
    
    console.log('Manual update successful:', {
      staffId: staff.staffId,
      classId,
      streams,
      assignments,
      assessments
    });
    
    res.status(200).json({
      success: true,
      message: 'Activity counts updated successfully',
      data: {
        id: activity._id,
        staffId: activity.staffId,
        className: activity.className,
        streams: activity.totalStreams,
        assignments: activity.totalAssignments,
        assessments: activity.totalAssessments,
        isHistorical: activity.isHistoricalData,
        notes: activity.notes
      }
    });
  } catch (error) {
    console.error('Error manually updating activity:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update activity: ' + error.message
    });
  }
});

// DELETE ACTIVITY - FIXED
router.delete('/:id', validateObjectId, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('Deleting activity:', id);
    
    const deleted = await StaffActivity.findByIdAndDelete(id);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Activity record not found'
      });
    }
    
    console.log('Activity deleted successfully:', id);
    
    res.status(200).json({
      success: true,
      message: 'Activity record deleted successfully',
      deletedId: id
    });
  } catch (error) {
    console.error('Error deleting activity:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete activity: ' + error.message
    });
  }
});

// GET ACTIVITY BY ID - FIXED
router.get('/:id', validateObjectId, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('Fetching activity:', id);
    
    const activity = await StaffActivity.findById(id);
    
    if (!activity) {
      return res.status(404).json({
        success: false,
        error: 'Activity not found'
      });
    }
    
    console.log('Activity fetched successfully:', id);
    
    res.status(200).json({
      success: true,
      data: activity
    });
  } catch (error) {
    console.error('Error fetching activity:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch activity: ' + error.message
    });
  }
});

// GET ALL ACTIVITIES
router.get('/', async (req, res) => {
  try {
    console.log('Fetching all activities');
    
    const activities = await StaffActivity.find({});
    
    console.log('Fetched', activities.length, 'activities');
    
    res.status(200).json({
      success: true,
      data: activities,
      count: activities.length
    });
  } catch (error) {
    console.error('Error fetching all activities:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch activities: ' + error.message
    });
  }
});

// GET SUMMARY FOR STAFF
router.get('/summary/:staffId', async (req, res) => {
  try {
    const { staffId } = req.params;
    
    console.log('Fetching summary for staff:', staffId);
    
    const activities = await StaffActivity.find({
      $or: [
        { staffId: staffId },
        { staffEmail: staffId }
      ]
    });
    
    let totalStreams = 0;
    let totalAssignments = 0;
    let totalAssessments = 0;
    let totalVisits = 0;
    
    activities.forEach(activity => {
      totalStreams += activity.totalStreams || 0;
      totalAssignments += activity.totalAssignments || 0;
      totalAssessments += activity.totalAssessments || 0;
      totalVisits += activity.visitsCount || 0;
    });
    
    console.log('Summary fetched successfully:', {
      staffId,
      totalStreams,
      totalAssignments,
      totalAssessments,
      totalVisits
    });
    
    res.status(200).json({
      success: true,
      data: {
        staffId,
        totalStreams,
        totalAssignments,
        totalAssessments,
        totalVisits,
        totalClasses: activities.length
      }
    });
  } catch (error) {
    console.error('Error fetching summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch summary: ' + error.message
    });
  }
});

module.exports = router;