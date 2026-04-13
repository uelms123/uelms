const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const StaffActivity =
  mongoose.models.StaffActivity || require('../models/StaffActivity');
const Class = mongoose.models.Class || require('../models/Class');
const Staff = mongoose.models.Staff || require('../models/Staff');
const Unit = mongoose.models.Unit || require('../models/unit');
const Meeting = mongoose.models.Meeting || require('../models/Meeting');

const validateObjectId = (req, res, next) => {
  const { id } = req.params;
  if (id && !mongoose.Types.ObjectId.isValid(id)) {
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

  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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

const isBadDisplayValue = (value) => {
  if (value === null || value === undefined) return true;

  const normalized = String(value).trim().toLowerCase();

  return (
    normalized === '' ||
    normalized === 'loading...' ||
    normalized === 'loading' ||
    normalized === 'undefined' ||
    normalized === 'null' ||
    normalized === 'n/a'
  );
};

const cleanDisplayValue = (value) => {
  return isBadDisplayValue(value) ? '' : String(value).trim();
};

const ensureActivityBuckets = (activity, now = new Date()) => {
  if (!activity.activities) activity.activities = {};

  if (!activity.activities.streams) {
    activity.activities.streams = { items: [], count: 0, lastUpdated: now };
  }

  if (!activity.activities.assignments) {
    activity.activities.assignments = { items: [], count: 0, lastUpdated: now };
  }

  if (!activity.activities.assessments) {
    activity.activities.assessments = { items: [], count: 0, lastUpdated: now };
  }

  if (!activity.activities.people) {
    activity.activities.people = { items: [], count: 0, lastUpdated: now };
  }

  return activity;
};

const getClassMeta = async (classId) => {
  if (!classId || !mongoose.Types.ObjectId.isValid(classId)) {
    return {
      classData: null,
      className: '',
      subject: '',
      section: ''
    };
  }

  const classData = await Class.findById(classId).select('name subject section createdAt');
  return {
    classData,
    className: classData?.name || '',
    subject: classData?.subject || '',
    section: classData?.section || ''
  };
};

const findOrCreateStaffActivity = async ({
  staffId,
  staffEmail = '',
  staffName = '',
  classId = null
}) => {
  let activity = await StaffActivity.findOne({
    staffId,
    classId: classId || null
  });

  const now = new Date();
  const cleanedStaffEmail = cleanDisplayValue(staffEmail).toLowerCase();
  const cleanedStaffName = cleanDisplayValue(staffName);

  if (!activity) {
    const { classData, className, subject, section } = await getClassMeta(classId);

    activity = new StaffActivity({
      staffId,
      staffEmail: cleanedStaffEmail,
      staffName: cleanedStaffName || cleanedStaffEmail || 'Staff Member',
      classId: classId || null,
      className,
      subject,
      section,
      classSubject: subject,
      classSection: section,
      classCreatedDate: classData?.createdAt || now,
      totalStreams: 0,
      totalAssignments: 0,
      totalAssessments: 0,
      totalPeople: 0,
      visitsCount: 0,
      lastClassVisit: null,
      lastStreamUpdate: null,
      lastAssignmentUpdate: null,
      lastAssessmentUpdate: null,
      lastPeopleUpdate: null,
      lastActivityUpdate: now,
      activities: {
        streams: { items: [], count: 0, lastUpdated: now },
        assignments: { items: [], count: 0, lastUpdated: now },
        assessments: { items: [], count: 0, lastUpdated: now },
        people: { items: [], count: 0, lastUpdated: now }
      }
    });
  } else {
    if (cleanedStaffEmail) activity.staffEmail = cleanedStaffEmail;
    if (cleanedStaffName) activity.staffName = cleanedStaffName;
    activity.lastActivityUpdate = now;
    ensureActivityBuckets(activity, now);
  }

  return activity;
};

// Track class visit
router.post('/track-visit', async (req, res) => {
  try {
    const { staffId, staffEmail = '', staffName = '', classId } = req.body;

    if (!staffId || !classId) {
      return res.status(400).json({
        success: false,
        error: 'staffId and classId are required'
      });
    }

    const activity = await findOrCreateStaffActivity({
      staffId,
      staffEmail,
      staffName,
      classId
    });

    const now = new Date();
    activity.visitsCount = Number(activity.visitsCount || 0) + 1;
    activity.lastClassVisit = now;
    activity.lastActivityUpdate = now;

    await activity.save();

    res.status(200).json({
      success: true,
      message: 'Staff visit tracked successfully',
      data: activity
    });
  } catch (error) {
    console.error('Error tracking staff visit:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to track staff visit'
    });
  }
});

// Track assignment
router.post('/track-assignment', async (req, res) => {
  try {
    const {
      staffId,
      staffEmail = '',
      staffName = '',
      classId,
      itemData = {}
    } = req.body;

    if (!staffId || !classId) {
      return res.status(400).json({
        success: false,
        error: 'staffId and classId are required'
      });
    }

    const activity = await findOrCreateStaffActivity({
      staffId,
      staffEmail,
      staffName,
      classId
    });

    const now = new Date();
    ensureActivityBuckets(activity, now);

    const itemId = itemData.id || new mongoose.Types.ObjectId();
    const exists = activity.activities.assignments.items.some(
      (a) => a.id?.toString() === itemId.toString()
    );

    if (!exists) {
      activity.activities.assignments.items.push({
        id: itemId,
        title: itemData.title || 'Untitled Assignment',
        type: itemData.type || 'assignment',
        assignmentType: itemData.assignmentType || 'assignment',
        description: itemData.description || '',
        createdAt: now,
        updatedAt: now
      });

      activity.totalAssignments = Number(activity.totalAssignments || 0) + 1;
      activity.activities.assignments.count = activity.totalAssignments;
    }

    activity.activities.assignments.lastUpdated = now;
    activity.lastAssignmentUpdate = now;
    activity.lastActivityUpdate = now;

    await activity.save();

    res.status(200).json({
      success: true,
      message: 'Assignment activity tracked successfully',
      totalAssignments: activity.totalAssignments
    });
  } catch (error) {
    console.error('track-assignment error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Track assessment / unit
router.post('/track-assessment', async (req, res) => {
  try {
    const {
      staffId,
      staffEmail = '',
      staffName = '',
      classId,
      itemData = {},
      assessmentType,
      assessmentTitle,
      assessmentId
    } = req.body;

    if (!staffId || !classId) {
      return res.status(400).json({
        success: false,
        error: 'staffId and classId are required'
      });
    }

    const activity = await findOrCreateStaffActivity({
      staffId,
      staffEmail,
      staffName,
      classId
    });

    const now = new Date();
    ensureActivityBuckets(activity, now);

    const itemId = assessmentId || itemData.id || new mongoose.Types.ObjectId();

    const exists = activity.activities.assessments.items.some(
      (a) => a.id?.toString() === itemId.toString()
    );

    if (!exists) {
      activity.activities.assessments.items.push({
        id: itemId,
        title: assessmentTitle || itemData.title || 'Untitled Assessment',
        type: assessmentType || itemData.type || 'assessment',
        description: itemData.description || '',
        createdAt: now,
        updatedAt: now
      });

      activity.totalAssessments = Number(activity.totalAssessments || 0) + 1;
      activity.activities.assessments.count = activity.totalAssessments;
    }

    activity.activities.assessments.lastUpdated = now;
    activity.lastAssessmentUpdate = now;
    activity.lastActivityUpdate = now;

    await activity.save();

    res.status(200).json({
      success: true,
      message: 'Assessment activity tracked successfully',
      totalAssessments: activity.totalAssessments
    });
  } catch (error) {
    console.error('Error tracking assessment:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Track stream / meeting
router.post('/track-stream', async (req, res) => {
  try {
    const {
      staffId,
      staffEmail = '',
      staffName = '',
      classId = null,
      meetingId,
      meetingTitle,
      meetingType = 'live_stream',
      scheduledTime,
      duration
    } = req.body;

    if (!staffId || !meetingId) {
      return res.status(400).json({
        success: false,
        error: 'staffId and meetingId are required'
      });
    }

    const activity = await findOrCreateStaffActivity({
      staffId,
      staffEmail,
      staffName,
      classId
    });

    const now = new Date();
    ensureActivityBuckets(activity, now);

    const exists = activity.activities.streams.items.some(
      (s) => s.id?.toString() === meetingId.toString()
    );

    if (!exists) {
      activity.activities.streams.items.push({
        id: meetingId,
        title: meetingTitle || 'Untitled Meeting',
        type: meetingType,
        scheduledTime: scheduledTime || now,
        duration: duration || 60,
        createdAt: now,
        updatedAt: now
      });

      activity.totalStreams = Number(activity.totalStreams || 0) + 1;
      activity.activities.streams.count = activity.totalStreams;
    }

    activity.activities.streams.lastUpdated = now;
    activity.lastStreamUpdate = now;
    activity.lastActivityUpdate = now;

    await activity.save();

    res.status(200).json({
      success: true,
      message: 'Stream activity tracked successfully',
      totalStreams: activity.totalStreams
    });
  } catch (error) {
    console.error('Error tracking stream:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Track people added
router.post('/track-people', async (req, res) => {
  try {
    const {
      staffId,
      staffEmail = '',
      staffName = '',
      classId,
      personId,
      personName,
      personEmail,
      personRole = 'student'
    } = req.body;

    if (!staffId || !classId || !personId) {
      return res.status(400).json({
        success: false,
        error: 'staffId, classId and personId are required'
      });
    }

    const activity = await findOrCreateStaffActivity({
      staffId,
      staffEmail,
      staffName,
      classId
    });

    const now = new Date();
    ensureActivityBuckets(activity, now);

    const exists = activity.activities.people.items.some(
      (p) => p.id?.toString() === personId.toString()
    );

    if (!exists) {
      activity.activities.people.items.push({
        id: personId,
        title: personName || personEmail || 'Unnamed User',
        type: personRole,
        email: personEmail || '',
        createdAt: now,
        updatedAt: now
      });

      activity.totalPeople = Number(activity.totalPeople || 0) + 1;
      activity.activities.people.count = activity.totalPeople;
    }

    activity.activities.people.lastUpdated = now;
    activity.lastPeopleUpdate = now;
    activity.lastActivityUpdate = now;

    await activity.save();

    res.status(200).json({
      success: true,
      message: 'People activity tracked successfully',
      totalPeople: activity.totalPeople
    });
  } catch (error) {
    console.error('Error tracking people:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Generic update activity
router.post('/update-activity', async (req, res) => {
  try {
    const { staffId, staffEmail = '', staffName = '', classId, activityType, itemData = {} } = req.body;

    if (!staffId || !activityType) {
      return res.status(400).json({
        success: false,
        error: 'staffId and activityType are required'
      });
    }

    switch (activityType) {
      case 'assignments':
        return router.handle(
          { ...req, url: '/track-assignment', method: 'POST', body: { staffId, staffEmail, staffName, classId, itemData } },
          res
        );
      case 'assessments':
        return router.handle(
          { ...req, url: '/track-assessment', method: 'POST', body: { staffId, staffEmail, staffName, classId, itemData } },
          res
        );
      case 'streams':
        return router.handle(
          { ...req, url: '/track-stream', method: 'POST', body: { staffId, staffEmail, staffName, classId, meetingId: itemData.id, meetingTitle: itemData.title, meetingType: itemData.type } },
          res
        );
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid activityType'
        });
    }
  } catch (error) {
    console.error('Error updating activity:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Get summary
router.get('/summary', async (req, res) => {
  try {
    const docs = await StaffActivity.find({}).lean();

    const summary = {
      totalStaff: new Set(docs.map((d) => d.staffEmail).filter(Boolean)).size,
      totalClasses: new Set(docs.map((d) => String(d.classId)).filter(Boolean)).size,
      totalStreams: docs.reduce((sum, d) => sum + Number(d.totalStreams || d.activities?.streams?.count || 0), 0),
      totalAssignments: docs.reduce((sum, d) => sum + Number(d.totalAssignments || d.activities?.assignments?.count || 0), 0),
      totalAssessments: docs.reduce((sum, d) => sum + Number(d.totalAssessments || d.activities?.assessments?.count || 0), 0),
      totalPeople: docs.reduce((sum, d) => sum + Number(d.totalPeople || d.activities?.people?.count || 0), 0),
      totalVisits: docs.reduce((sum, d) => sum + Number(d.visitsCount || 0), 0),
      totalActivities: docs.length
    };

    res.status(200).json({
      success: true,
      summary
    });
  } catch (error) {
    console.error('Error fetching activity summary:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch summary'
    });
  }
});

// Get all staff activities
router.get('/all', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      sortBy = 'updatedAt',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = Number(page);
    const limitNum = Number(limit);

    const query = {};

    if (search?.trim()) {
      query.$or = [
        { staffName: { $regex: search, $options: 'i' } },
        { staffEmail: { $regex: search, $options: 'i' } },
        { className: { $regex: search, $options: 'i' } }
      ];
    }

    const total = await StaffActivity.countDocuments(query);

    const activities = await StaffActivity.find(query)
      .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean();

    const formatted = activities.map((activity) => ({
      ...activity,
      staffName: cleanDisplayValue(activity.staffName) || cleanDisplayValue(activity.staffEmail) || 'Staff Member',
      staffEmail: cleanDisplayValue(activity.staffEmail),
      action:
        `Streams: ${activity.totalStreams || 0}, ` +
        `Assignments: ${activity.totalAssignments || 0}, ` +
        `Assessments: ${activity.totalAssessments || 0}, ` +
        `People: ${activity.totalPeople || 0}, ` +
        `Visits: ${activity.visitsCount || 0}`,
      timestamp:
        activity.lastActivityUpdate ||
        activity.updatedAt ||
        activity.createdAt
    }));

    res.status(200).json({
      success: true,
      activities: formatted,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      total
    });
  } catch (error) {
    console.error('Error fetching all staff activities:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch activities'
    });
  }
});

// Staff timeline
router.get('/staff/:staffId/timeline', async (req, res) => {
  try {
    const { staffId } = req.params;

    let staff = null;
    if (staffId.includes('@')) {
      staff = await Staff.findOne({ email: staffId.toLowerCase() });
    } else {
      staff = await Staff.findOne({ staffId });
    }

    if (!staff) {
      return res.status(404).json({
        success: false,
        error: 'Staff not found'
      });
    }

    const docs = await StaffActivity.find({
      $or: [{ staffId: staff.staffId }, { staffEmail: staff.email.toLowerCase() }]
    }).lean();

    const timeline = [];

    docs.forEach((doc) => {
      if (doc.lastClassVisit) {
        timeline.push({
          type: 'visit',
          title: 'Visited classroom',
          description: `Visited ${doc.className || 'classroom'}`,
          className: doc.className || 'N/A',
          createdAt: doc.lastClassVisit
        });
      }

      (doc.activities?.streams?.items || []).forEach((item) => {
        timeline.push({
          type: 'stream',
          title: item.title || 'Untitled Stream',
          description: `Created stream in ${doc.className || 'class'}`,
          className: doc.className || 'N/A',
          createdAt: item.createdAt || doc.lastStreamUpdate
        });
      });

      (doc.activities?.assignments?.items || []).forEach((item) => {
        timeline.push({
          type: 'assignment',
          title: item.title || 'Untitled Assignment',
          description: `Created assignment in ${doc.className || 'class'}`,
          className: doc.className || 'N/A',
          createdAt: item.createdAt || doc.lastAssignmentUpdate
        });
      });

      (doc.activities?.assessments?.items || []).forEach((item) => {
        timeline.push({
          type: 'assessment',
          title: item.title || 'Untitled Assessment',
          description: `Created assessment/unit in ${doc.className || 'class'}`,
          className: doc.className || 'N/A',
          createdAt: item.createdAt || doc.lastAssessmentUpdate
        });
      });

      (doc.activities?.people?.items || []).forEach((item) => {
        timeline.push({
          type: 'people',
          title: item.title || 'Added person',
          description: `Added ${item.type || 'member'} to ${doc.className || 'class'}`,
          className: doc.className || 'N/A',
          createdAt: item.createdAt || doc.lastPeopleUpdate
        });
      });
    });

    timeline.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.status(200).json({
      success: true,
      staff: {
        staffId: staff.staffId,
        email: staff.email,
        name: staff.name
      },
      summary: {
        totalActivities: timeline.length,
        totalStreams: timeline.filter((t) => t.type === 'stream').length,
        totalAssignments: timeline.filter((t) => t.type === 'assignment').length,
        totalAssessments: timeline.filter((t) => t.type === 'assessment').length,
        totalPeople: timeline.filter((t) => t.type === 'people').length,
        totalVisits: timeline.filter((t) => t.type === 'visit').length
      },
      timeline
    });
  } catch (error) {
    console.error('Error fetching staff timeline:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch timeline'
    });
  }
});

// Analyze existing
router.post('/analyze-existing/:staffId/:classId', async (req, res) => {
  try {
    const { staffId, classId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ success: false, error: 'Invalid class ID' });
    }

    const staff = await Staff.findOne({ staffId });
    if (!staff) {
      return res.status(404).json({ success: false, error: 'Staff not found' });
    }

    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ success: false, error: 'Class not found' });
    }

    const units = await Unit.find({ classId }).select('title createdAt description');
    const meetings = await Meeting.find({ classId }).select('title createdAt meetType');

    const activity = await findOrCreateStaffActivity({
      staffId: staff.staffId,
      staffEmail: staff.email,
      staffName: staff.name,
      classId
    });

    const now = new Date();
    ensureActivityBuckets(activity, now);

    activity.activities.assessments.items = units.map((u) => ({
      id: u._id,
      title: u.title,
      type: 'unit',
      description: u.description || '',
      createdAt: u.createdAt || now,
      updatedAt: u.createdAt || now
    }));
    activity.activities.assessments.count = units.length;
    activity.activities.assessments.lastUpdated = now;
    activity.totalAssessments = units.length;
    activity.lastAssessmentUpdate = now;

    activity.activities.streams.items = meetings.map((m) => ({
      id: m._id,
      title: m.title || 'Untitled Meeting',
      type: m.meetType || 'stream',
      createdAt: m.createdAt || now,
      updatedAt: m.createdAt || now
    }));
    activity.activities.streams.count = meetings.length;
    activity.activities.streams.lastUpdated = now;
    activity.totalStreams = meetings.length;
    activity.lastStreamUpdate = now;

    activity.isHistoricalData = true;
    activity.notes = `Historical data synced: ${units.length} units and ${meetings.length} streams`;
    activity.lastActivityUpdate = now;

    await activity.save();

    res.status(200).json({
      success: true,
      message: 'Existing content analyzed successfully',
      activity
    });
  } catch (error) {
    console.error('Error analyzing existing content:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to analyze existing content'
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
      people = 0,
      notes = '',
      isHistorical = false
    } = req.body;

    if (!staffId || !classId) {
      return res.status(400).json({
        success: false,
        error: 'staffId and classId are required'
      });
    }

    const staff = await Staff.findOne({
      $or: [{ staffId }, { email: staffId }]
    });

    if (!staff) {
      return res.status(404).json({
        success: false,
        error: 'Staff not found'
      });
    }

    const activity = await findOrCreateStaffActivity({
      staffId: staff.staffId,
      staffEmail: staff.email,
      staffName: staff.name,
      classId
    });

    const now = new Date();
    ensureActivityBuckets(activity, now);

    activity.totalStreams = Number(streams || 0);
    activity.totalAssignments = Number(assignments || 0);
    activity.totalAssessments = Number(assessments || 0);
    activity.totalPeople = Number(people || 0);

    activity.activities.streams.count = activity.totalStreams;
    activity.activities.assignments.count = activity.totalAssignments;
    activity.activities.assessments.count = activity.totalAssessments;
    activity.activities.people.count = activity.totalPeople;

    activity.activities.streams.lastUpdated = now;
    activity.activities.assignments.lastUpdated = now;
    activity.activities.assessments.lastUpdated = now;
    activity.activities.people.lastUpdated = now;

    activity.lastStreamUpdate = now;
    activity.lastAssignmentUpdate = now;
    activity.lastAssessmentUpdate = now;
    activity.lastPeopleUpdate = now;
    activity.lastActivityUpdate = now;

    activity.isHistoricalData = isHistorical;
    activity.notes = notes || 'Manually updated';

    await activity.save();

    res.status(200).json({
      success: true,
      message: 'Activity counts updated successfully',
      activity
    });
  } catch (error) {
    console.error('Error manually updating activity:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update activity'
    });
  }
});

// Delete assignment tracking
router.post('/delete-assignment', async (req, res) => {
  try {
    const { staffId, classId, assignmentId } = req.body;

    if (!staffId || !classId || !assignmentId) {
      return res.status(400).json({
        success: false,
        error: 'staffId, classId and assignmentId are required'
      });
    }

    const activity = await StaffActivity.findOne({ staffId, classId });

    if (!activity) {
      return res.status(200).json({
        success: true,
        message: 'No activity record found',
        totalAssignments: 0
      });
    }

    ensureActivityBuckets(activity);

    activity.activities.assignments.items = activity.activities.assignments.items.filter(
      (item) => item.id?.toString() !== assignmentId.toString()
    );

    activity.totalAssignments = activity.activities.assignments.items.length;
    activity.activities.assignments.count = activity.totalAssignments;
    activity.activities.assignments.lastUpdated = new Date();
    activity.lastAssignmentUpdate = new Date();
    activity.lastActivityUpdate = new Date();

    await activity.save();

    res.status(200).json({
      success: true,
      message: 'Assignment deletion tracked successfully',
      totalAssignments: activity.totalAssignments
    });
  } catch (error) {
    console.error('delete-assignment error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Cleanup duplicates
router.post('/cleanup-duplicates', async (req, res) => {
  try {
    const duplicates = await StaffActivity.aggregate([
      {
        $group: {
          _id: { staffId: '$staffId', classId: '$classId' },
          count: { $sum: 1 },
          ids: { $push: '$_id' }
        }
      },
      { $match: { count: { $gt: 1 } } }
    ]);

    let deletedCount = 0;
    let mergedCount = 0;

    for (const dup of duplicates) {
      const [keepId, ...deleteIds] = dup.ids;
      const keepDoc = await StaffActivity.findById(keepId);
      if (!keepDoc) continue;

      ensureActivityBuckets(keepDoc);

      for (const deleteId of deleteIds) {
        const delDoc = await StaffActivity.findById(deleteId);
        if (!delDoc) continue;

        ensureActivityBuckets(delDoc);

        keepDoc.totalStreams = Number(keepDoc.totalStreams || 0) + Number(delDoc.totalStreams || 0);
        keepDoc.totalAssignments = Number(keepDoc.totalAssignments || 0) + Number(delDoc.totalAssignments || 0);
        keepDoc.totalAssessments = Number(keepDoc.totalAssessments || 0) + Number(delDoc.totalAssessments || 0);
        keepDoc.totalPeople = Number(keepDoc.totalPeople || 0) + Number(delDoc.totalPeople || 0);
        keepDoc.visitsCount = Number(keepDoc.visitsCount || 0) + Number(delDoc.visitsCount || 0);

        ['streams', 'assignments', 'assessments', 'people'].forEach((type) => {
          delDoc.activities[type].items.forEach((item) => {
            const exists = keepDoc.activities[type].items.some(
              (existing) => existing.id?.toString() === item.id?.toString()
            );
            if (!exists) keepDoc.activities[type].items.push(item);
          });

          keepDoc.activities[type].count = keepDoc.activities[type].items.length;
          keepDoc.activities[type].lastUpdated = new Date();
        });

        await StaffActivity.findByIdAndDelete(deleteId);
        deletedCount++;
      }

      await keepDoc.save();
      mergedCount++;
    }

    res.status(200).json({
      success: true,
      message: `Cleaned ${deletedCount} duplicates`,
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
      error: error.message || 'Failed to clean up duplicates'
    });
  }
});

// Get single activity
router.get('/:id', validateObjectId, async (req, res) => {
  try {
    const activity = await StaffActivity.findById(req.params.id);

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
      error: error.message || 'Failed to fetch activity'
    });
  }
});

// Delete activity
router.delete('/:id', validateObjectId, async (req, res) => {
  try {
    const deleted = await StaffActivity.findByIdAndDelete(req.params.id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Activity record not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Activity record deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting activity:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete activity'
    });
  }
});

// One-time cleanup for old bad names
router.post('/fix-loading-names', async (req, res) => {
  try {
    const docs = await StaffActivity.find({
      $or: [
        { staffName: { $in: ['Loading...', 'loading...', 'Loading', 'loading', 'undefined', 'null', 'N/A', ''] } },
        { staffName: { $exists: false } }
      ]
    });

    let updated = 0;

    for (const doc of docs) {
      const safeEmail = cleanDisplayValue(doc.staffEmail);
      const safeName = cleanDisplayValue(doc.staffName);

      const nextName = safeName || safeEmail || 'Staff Member';

      if (doc.staffName !== nextName) {
        doc.staffName = nextName;
        await doc.save();
        updated += 1;
      }
    }

    res.status(200).json({
      success: true,
      message: 'Bad loading names fixed successfully',
      updated
    });
  } catch (error) {
    console.error('Error fixing loading names:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fix loading names'
    });
  }
});

module.exports = router;