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

// Track class visit
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

    // Find existing activity using compound index
    let activity = await StaffActivity.findOne({ staffId, classId });

    const now = new Date();
    const newActivityItem = {
      id: new mongoose.Types.ObjectId(),
      title: 'Classroom Visit',
      type: 'visit',
      createdAt: now,
    };

    if (!activity) {
      // Create new activity
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
        lastClassVisit: now,
        activities: {
          streams: { items: [], count: 0, lastUpdated: now },
          assignments: { items: [], count: 0, lastUpdated: now },
          assessments: { items: [], count: 0, lastUpdated: now }
        }
      });
    } else {
      // Update existing activity
      activity.visitsCount = (activity.visitsCount || 0) + 1;
      activity.lastClassVisit = now;
      if (staffName) activity.staffName = staffName;
      if (staffEmail) activity.staffEmail = staffEmail;

      // Ensure activities object exists
      activity.activities = activity.activities || {};
      activity.activities.streams = activity.activities.streams || { items: [], count: 0, lastUpdated: now };
      activity.activities.assignments = activity.activities.assignments || { items: [], count: 0, lastUpdated: now };
      activity.activities.assessments = activity.activities.assessments || { items: [], count: 0, lastUpdated: now };
    }

    await activity.save();
    res.json({ success: true });
  } catch (err) {
    console.error('Error tracking visit:', err.stack);  
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Track assignment - FIXED DUPLICATION ISSUE
router.post('/track-assignment', async (req, res) => {
  try {
    const {
      staffId,
      staffEmail = '',
      staffName = '',
      classId,
      activityType = 'assignments',
      itemData = {}
    } = req.body;

    if (!staffId || !classId) {
      return res.status(400).json({ success: false, error: 'staffId and classId are required' });
    }

    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ success: false, error: 'Class not found' });
    }

    // Find existing activity using staffId and classId (compound index ensures uniqueness)
    let activity = await StaffActivity.findOne({ staffId, classId });

    const now = new Date();
    const itemId = itemData.id || new mongoose.Types.ObjectId();
    
    const item = {
      id: itemId,
      title: itemData.title || 'Untitled Assignment',
      type: itemData.type || 'assignment',
      assignmentType: itemData.assignmentType || 'text',
      createdAt: now,
    };

    if (!activity) {
      // Create new activity if none exists
      activity = new StaffActivity({
        staffId,
        staffEmail,
        staffName,
        classId,
        className: classData.name || 'Unnamed',
        classSubject: classData.subject || '',
        classSection: classData.section || '',
        classCreatedDate: classData.createdAt || now,
        totalAssignments: 1,
        lastAssignmentUpdate: now,
        activities: {
          streams: { items: [], count: 0, lastUpdated: now },
          assignments: { 
            items: [item], 
            count: 1, 
            lastUpdated: now 
          },
          assessments: { items: [], count: 0, lastUpdated: now }
        }
      });
    } else {
      // Check if this assignment already exists to prevent duplicates
      const existingAssignmentIndex = activity.activities.assignments?.items?.findIndex(
        a => a.id.toString() === itemId.toString()
      );

      if (existingAssignmentIndex === -1 || existingAssignmentIndex === undefined) {
        // New assignment - increment counts
        activity.totalAssignments = Number(activity.totalAssignments || 0) + 1;
        
        // Initialize activities if not present
        activity.activities = activity.activities || {};
        activity.activities.assignments = activity.activities.assignments || {
          items: [],
          count: 0,
          lastUpdated: now
        };

        // Add the new assignment
        activity.activities.assignments.items.push(item);
        activity.activities.assignments.count = activity.totalAssignments;
        activity.activities.assignments.lastUpdated = now;
        activity.lastAssignmentUpdate = now;

        // Update staff info if provided
        if (staffName) activity.staffName = staffName;
        if (staffEmail) activity.staffEmail = staffEmail;
      } else {
        // Assignment already exists - update it instead of creating duplicate
        if (existingAssignmentIndex >= 0) {
          activity.activities.assignments.items[existingAssignmentIndex] = {
            ...activity.activities.assignments.items[existingAssignmentIndex],
            ...item,
            updatedAt: now
          };
        }
        activity.lastAssignmentUpdate = now;
      }
    }

    await activity.save();

    res.json({
      success: true,
      message: 'Assignment activity tracked',
      totalAssignments: activity.totalAssignments,
      isNewAssignment: !activity.activities.assignments?.items?.some(
        a => a.id.toString() === itemId.toString()
      )
    });

  } catch (err) {
    console.error('track-assignment error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Internal server error'
    });
  }
});

// Track assessment
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
    
    if (!staffId || !classId) {
      return res.status(400).json({ error: 'Staff ID and Class ID are required' });
    }
    
    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }
    
    let activity = await StaffActivity.findOne({ staffId, classId });
    const itemId = assessmentId || new mongoose.Types.ObjectId();
    
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
        totalAssessments: 1,
        lastAssessmentUpdate: new Date(),
        activities: {
          streams: { items: [], count: 0, lastUpdated: new Date() },
          assignments: { items: [], count: 0, lastUpdated: new Date() },
          assessments: { 
            items: [{
              id: itemId,
              title: assessmentTitle || itemData.title || 'Untitled Assessment',
              type: assessmentType || itemData.type || 'material',
              createdAt: new Date(),
            }], 
            count: 1, 
            lastUpdated: new Date() 
          }
        }
      });
    } else {
      // Check for duplicate
      const existingAssessmentIndex = activity.activities.assessments?.items?.findIndex(
        a => a.id.toString() === itemId.toString()
      );
      
      if (existingAssessmentIndex === -1 || existingAssessmentIndex === undefined) {
        activity.totalAssessments = (activity.totalAssessments || 0) + 1;
        activity.lastAssessmentUpdate = new Date();
        
        activity.activities = activity.activities || {};
        activity.activities.assessments = activity.activities.assessments || { 
          items: [], 
          count: 0, 
          lastUpdated: new Date() 
        };
        
        activity.activities.assessments.items.push({
          id: itemId,
          title: assessmentTitle || itemData.title || 'Untitled Assessment',
          type: assessmentType || itemData.type || 'material',
          createdAt: new Date(),
        });
        activity.activities.assessments.count = activity.totalAssessments;
        activity.activities.assessments.lastUpdated = new Date();
      }
    }
    
    await activity.save();
    res.json({ success: true });
  } catch (err) {
    console.error('Error tracking assessment:', err);
    res.status(500).json({ error: err.message });
  }
});

// Track stream/meeting
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

    if (!staffId || !meetingId) {
      return res.status(400).json({ error: 'Staff ID and meeting ID are required' });
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
    const item = {
      id: meetingId,
      title: meetingTitle || 'Untitled Meeting/Stream',
      type: meetingType,
      scheduledTime: scheduledTime || now,
      duration: duration || 60,
      createdAt: now,
    };

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
            items: [item],
            count: 1,
            lastUpdated: now
          },
          assignments: { items: [], count: 0, lastUpdated: now },
          assessments: { items: [], count: 0, lastUpdated: now }
        }
      });
    } else {
      // Check for duplicate stream
      const existingStreamIndex = activity.activities.streams?.items?.findIndex(
        s => s.id.toString() === meetingId.toString()
      );
      
      if (existingStreamIndex === -1 || existingStreamIndex === undefined) {
        activity.totalStreams = (activity.totalStreams || 0) + 1;
        activity.lastStreamUpdate = now;
        
        activity.activities = activity.activities || {};
        activity.activities.streams = activity.activities.streams || {
          items: [],
          count: 0,
          lastUpdated: now
        };

        activity.activities.streams.items.push(item);
        activity.activities.streams.count = activity.totalStreams;
        activity.activities.streams.lastUpdated = now;
      }
      
      if (staffName) activity.staffName = staffName;
      if (staffEmail) activity.staffEmail = staffEmail;
    }

    await activity.save();

    res.json({ 
      success: true, 
      message: 'Stream/Meeting tracked successfully',
      streamCount: activity.totalStreams 
    });
  } catch (err) {
    console.error('Error tracking stream:', err);
    res.status(500).json({ error: err.message });
  }
});

// Generic activity update endpoint
router.post('/update-activity', async (req, res) => {
  try {
    const { staffId, staffEmail, staffName, classId, activityType, itemData = {} } = req.body;
    
    if (!staffId || !classId || !activityType) {
      return res.status(400).json({ error: 'Staff ID, Class ID, and activityType are required' });
    }
    
    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }
    
    let activity = await StaffActivity.findOne({ staffId, classId });
    const now = new Date();
    const itemId = itemData.id || new mongoose.Types.ObjectId();
    
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
        lastActivityUpdate: now,
      });
      
      // Initialize all activity types
      activity.activities = {
        streams: { items: [], count: 0, lastUpdated: now },
        assignments: { items: [], count: 0, lastUpdated: now },
        assessments: { items: [], count: 0, lastUpdated: now }
      };
    } else {
      activity.lastActivityUpdate = now;
      if (staffEmail) activity.staffEmail = staffEmail;
      if (staffName) activity.staffName = staffName;
    }
    
    // Ensure activities object exists
    activity.activities = activity.activities || {};
    
    switch (activityType) {
      case 'assessments':
        activity.activities.assessments = activity.activities.assessments || { 
          items: [], 
          count: 0, 
          lastUpdated: now 
        };
        
        // Check for duplicate
        const existingAssessmentIndex = activity.activities.assessments.items.findIndex(
          a => a.id.toString() === itemId.toString()
        );
        
        if (existingAssessmentIndex === -1) {
          activity.totalAssessments = (activity.totalAssessments || 0) + 1;
          activity.lastAssessmentUpdate = now;
          
          activity.activities.assessments.items.push({
            id: itemId,
            title: itemData.title || 'Untitled Assessment',
            type: itemData.type || 'material',
            createdAt: now,
          });
          activity.activities.assessments.count = activity.totalAssessments;
          activity.activities.assessments.lastUpdated = now;
        }
        break;
        
      case 'assignments':
        activity.activities.assignments = activity.activities.assignments || { 
          items: [], 
          count: 0, 
          lastUpdated: now 
        };
        
        // Check for duplicate
        const existingAssignmentIndex = activity.activities.assignments.items.findIndex(
          a => a.id.toString() === itemId.toString()
        );
        
        if (existingAssignmentIndex === -1) {
          activity.totalAssignments = (activity.totalAssignments || 0) + 1;
          activity.lastAssignmentUpdate = now;
          
          activity.activities.assignments.items.push({
            id: itemId,
            title: itemData.title || 'Untitled Assignment',
            type: itemData.type || 'assignment',
            createdAt: now,
          });
          activity.activities.assignments.count = activity.totalAssignments;
          activity.activities.assignments.lastUpdated = now;
        }
        break;
        
      case 'streams':
        activity.activities.streams = activity.activities.streams || { 
          items: [], 
          count: 0, 
          lastUpdated: now 
        };
        
        // Check for duplicate
        const existingStreamIndex = activity.activities.streams.items.findIndex(
          s => s.id.toString() === itemId.toString()
        );
        
        if (existingStreamIndex === -1) {
          activity.totalStreams = (activity.totalStreams || 0) + 1;
          activity.lastStreamUpdate = now;
          
          activity.activities.streams.items.push({
            id: itemId,
            title: itemData.title || 'Untitled Stream',
            type: itemData.type || 'stream',
            createdAt: now,
          });
          activity.activities.streams.count = activity.totalStreams;
          activity.activities.streams.lastUpdated = now;
        }
        break;
        
      default:
        return res.status(400).json({ error: 'Invalid activityType' });
    }
    
    await activity.save();
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating activity:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get staff timeline
router.get('/staff/:staffId/timeline', async (req, res) => {
  try {
    const { staffId } = req.params;
    const { startDate, endDate } = req.query;
    
    let staffIdentifier = staffId;
    let staffEmail = staffId;
    let staff = null;
    
    // Find staff by email or staffId
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
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
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
    let totalClasses = new Set();
    
    staffActivities.forEach(activity => {
      totalAssignments += activity.totalAssignments || 0;
      totalAssessments += activity.totalAssessments || 0;
      totalVisits += activity.visitsCount || 0;
      if (activity.classId) totalClasses.add(activity.classId.toString());
    });
    
    const totalStreams = meetings.length;
    const totalClassesCount = totalClasses.size;
    
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
              subject: classData.subject || activity.classSubject || activity.subject || 'N/A',
              section: classData.section || activity.classSection || activity.section || 'N/A',
              streams: 0,
              assignments: activity.totalAssignments || 0,
              assessments: activity.totalAssessments || 0,
              visits: activity.visitsCount || 0
            };
            classBreakdown.push(entry);
          } else {
            entry.assignments += activity.totalAssignments || 0;
            entry.assessments += activity.totalAssessments || 0;
            entry.visits += activity.visitsCount || 0;
          }
        }
      }
    }
    
    // Add streams from meetings
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
    
    // Sort by total activity
    classBreakdown.sort((a, b) =>
      (b.streams + b.assignments + b.assessments + b.visits) -
      (a.streams + a.assignments + a.assessments + a.visits)
    );
    
    // Build timeline
    const timeline = [
      ...staffActivities.map(activity => ({
        type: 'activity',
        date: activity.lastActivityUpdate || activity.createdAt || activity.updatedAt,
        title: `${activity.className || 'Class'} Activity`,
        description: `Updated activities in ${activity.className || 'class'}`,
        className: activity.className,
        classId: activity.classId
      })),
      ...meetings.map(meeting => ({
        type: 'stream',
        date: meeting.scheduledTime || meeting.createdAt || meeting.updatedAt,
        title: meeting.title || 'Untitled Meeting',
        description: `Created ${meeting.meetType || 'live stream'}`,
        className: meeting.className || 'General Meeting',
        classId: meeting.classId,
        meetingId: meeting._id
      }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));
    
    res.status(200).json({
      success: true,
      summary: {
        totalStreams,
        totalAssignments,
        totalAssessments,
        totalVisits,
        totalClasses: totalClassesCount,
        totalActivities: timeline.length
      },
      timeline,
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

// Analyze existing content
router.post('/analyze-existing/:staffId/:classId', async (req, res) => {
  try {
    const { staffId, classId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ error: 'Invalid class ID' });
    }
    
    const staff = await Staff.findOne({ staffId });
    if (!staff) {
      return res.status(404).json({ error: 'Staff not found' });
    }
    
    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }
    
    // Get existing units and meetings
    const unitsCount = await Unit.countDocuments({ classId, createdBy: staffId });
    const units = await Unit.find({ classId, createdBy: staffId }).select('title createdAt description');
    const meetingsCount = await Meeting.countDocuments({
      classId,
      $or: [
        { createdBy: staff._id.toString() },
        { createdBy: staff.email },
        { 'staffInfo.email': staff.email.toLowerCase() }
      ]
    });
    
    // Find or create activity
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
        activities: {
          streams: { items: [], count: 0, lastUpdated: now },
          assignments: { items: [], count: 0, lastUpdated: now },
          assessments: { items: [], count: 0, lastUpdated: now }
        }
      });
    }
    
    // Update counts without duplicates
    if (unitsCount > 0) {
      activity.totalAssessments = unitsCount;
      activity.activities.assessments = {
        count: unitsCount,
        lastUpdated: now,
        items: units.map(u => ({
          id: u._id,
          title: u.title,
          createdAt: u.createdAt,
          type: 'unit',
          description: u.description || ''
        }))
      };
    }
    
    if (meetingsCount > 0) {
      activity.totalStreams = meetingsCount;
      activity.activities.streams = {
        count: meetingsCount,
        lastUpdated: now,
        items: []
      };
    }
    
    activity.isHistoricalData = true;
    activity.notes = `Historical data: ${unitsCount} units (assessments) and ${meetingsCount} streams found`;
    
    await activity.save();
    
    res.status(200).json({
      success: true,
      message: 'Existing content analyzed successfully',
      activity: {
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

// Manual update
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
    
    res.status(200).json({
      success: true,
      message: 'Activity counts updated successfully',
      activity: {
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

// Delete activity
router.delete('/:id', validateObjectId, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await StaffActivity.findByIdAndDelete(id);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Activity record not found'
      });
    }
    
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

// Get single activity
router.get('/:id', validateObjectId, async (req, res) => {
  try {
    const { id } = req.params;
    const activity = await StaffActivity.findById(id);
    
    if (!activity) {
      return res.status(404).json({
        success: false,
        error: 'Activity not found'
      });
    }
    
    res.status(200).json({
      success: true,
      activity
    });
  } catch (error) {
    console.error('Error fetching activity:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch activity: ' + error.message
    });
  }
});

// Delete assignment tracking
router.post('/delete-assignment', async (req, res) => {
  try {
    const {
      staffId,
      staffEmail = '',
      staffName = '',
      classId,
      assignmentId,
      assignmentTitle = 'Deleted Assignment'
    } = req.body;

    if (!staffId || !classId || !assignmentId) {
      return res.status(400).json({ 
        success: false, 
        error: 'staffId, classId, and assignmentId are required' 
      });
    }

    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ 
        success: false, 
        error: 'Class not found' 
      });
    }

    // Find the staff activity record
    let activity = await StaffActivity.findOne({ staffId, classId });

    if (activity) {
      // Decrement assignment count
      if (activity.totalAssignments > 0) {
        activity.totalAssignments -= 1;
      }
      
      // Remove the assignment from activities items
      if (activity.activities?.assignments?.items) {
        activity.activities.assignments.items = activity.activities.assignments.items.filter(
          item => item.id.toString() !== assignmentId.toString()
        );
        activity.activities.assignments.count = activity.activities.assignments.items.length;
        activity.activities.assignments.lastUpdated = new Date();
      }
      
      await activity.save();
      
      res.json({
        success: true,
        message: 'Assignment deletion tracked',
        totalAssignments: activity.totalAssignments
      });
    } else {
      // No activity record found, nothing to update
      res.json({
        success: true,
        message: 'No activity record found for this staff/class',
        totalAssignments: 0
      });
    }

  } catch (err) {
    console.error('delete-assignment error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Internal server error'
    });
  }
});

// Clean up duplicate activities
router.post('/cleanup-duplicates', async (req, res) => {
  try {
    const duplicates = await StaffActivity.aggregate([
      {
        $group: {
          _id: { staffId: "$staffId", classId: "$classId" },
          count: { $sum: 1 },
          ids: { $push: "$_id" }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]);

    let deletedCount = 0;
    let mergedCount = 0;

    for (const dup of duplicates) {
      if (dup.ids.length > 1) {
        // Keep the first one, merge others into it
        const keepId = dup.ids[0];
        const deleteIds = dup.ids.slice(1);
        
        const keepDoc = await StaffActivity.findById(keepId);
        
        // Merge data from duplicates
        for (const deleteId of deleteIds) {
          const deleteDoc = await StaffActivity.findById(deleteId);
          
          if (deleteDoc) {
            // Merge counts
            keepDoc.totalStreams += deleteDoc.totalStreams || 0;
            keepDoc.totalAssignments += deleteDoc.totalAssignments || 0;
            keepDoc.totalAssessments += deleteDoc.totalAssessments || 0;
            keepDoc.visitsCount += deleteDoc.visitsCount || 0;
            
            // Merge last dates
            if (deleteDoc.lastClassVisit > keepDoc.lastClassVisit) {
              keepDoc.lastClassVisit = deleteDoc.lastClassVisit;
            }
            if (deleteDoc.lastAssignmentUpdate > keepDoc.lastAssignmentUpdate) {
              keepDoc.lastAssignmentUpdate = deleteDoc.lastAssignmentUpdate;
            }
            if (deleteDoc.lastAssessmentUpdate > keepDoc.lastAssessmentUpdate) {
              keepDoc.lastAssessmentUpdate = deleteDoc.lastAssessmentUpdate;
            }
            if (deleteDoc.lastStreamUpdate > keepDoc.lastStreamUpdate) {
              keepDoc.lastStreamUpdate = deleteDoc.lastStreamUpdate;
            }
            
            // Merge activities items (avoid duplicates)
            for (const type of ['streams', 'assignments', 'assessments']) {
              if (deleteDoc.activities?.[type]?.items) {
                keepDoc.activities[type] = keepDoc.activities[type] || { items: [], count: 0, lastUpdated: new Date() };
                
                for (const item of deleteDoc.activities[type].items) {
                  const exists = keepDoc.activities[type].items.some(
                    existing => existing.id.toString() === item.id.toString()
                  );
                  
                  if (!exists) {
                    keepDoc.activities[type].items.push(item);
                  }
                }
                
                // Update count
                keepDoc.activities[type].count = keepDoc.activities[type].items.length;
                keepDoc.activities[type].lastUpdated = new Date();
              }
            }
            
            // Delete the duplicate
            await StaffActivity.findByIdAndDelete(deleteId);
            deletedCount++;
          }
        }
        
        // Save the merged document
        await keepDoc.save();
        mergedCount++;
      }
    }

    res.status(200).json({
      success: true,
      message: `Cleaned up ${deletedCount} duplicate records, merged into ${mergedCount} records`,
      stats: {
        duplicatesFound: duplicates.length,
        deleted: deletedCount,
        merged: mergedCount
      }
    });
  } catch (error) {
    console.error('Error cleaning up duplicates:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clean up duplicates: ' + error.message
    });
  }
});

module.exports = router;