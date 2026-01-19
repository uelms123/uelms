// routes/staff-activity.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Staff Activity Schema
const staffActivitySchema = new mongoose.Schema({
  staffId: {
    type: String,
    required: true
  },
  staffEmail: {
    type: String,
    required: true,
    lowercase: true
  },
  staffName: {
    type: String,
    required: true
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class'
  },
  className: {
    type: String
  },
  subject: {
    type: String
  },
  section: {
    type: String
  },
  activityType: {
    type: String,
    enum: ['streams', 'assignments', 'assessments', 'visit'],
    required: true
  },
  itemData: {
    title: String,
    type: String,
    description: String,
    createdAt: Date,
    updatedAt: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Create indexes for faster queries
staffActivitySchema.index({ staffEmail: 1, createdAt: -1 });
staffActivitySchema.index({ staffId: 1 });
staffActivitySchema.index({ classId: 1 });
staffActivitySchema.index({ activityType: 1 });

const StaffActivity = mongoose.model('StaffActivity', staffActivitySchema);

// Track staff visit to a classroom
router.post('/track-visit', async (req, res) => {
  try {
    const { staffId, staffEmail, staffName, classId } = req.body;

    if (!staffId || !staffEmail || !staffName || !classId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields' 
      });
    }

    // Optional: Fetch class details to get className, subject, section
    let className = '', subject = '', section = '';
    try {
      const Class = mongoose.model('Class');
      const classData = await Class.findById(classId).select('name subject section');
      if (classData) {
        className = classData.name || '';
        subject = classData.subject || '';
        section = classData.section || '';
      }
    } catch (error) {
      console.log('Could not fetch class details:', error.message);
    }

    const activity = new StaffActivity({
      staffId,
      staffEmail,
      staffName,
      classId,
      className,
      subject,
      section,
      activityType: 'visit',
      itemData: {
        title: 'Classroom Visit',
        type: 'visit',
        description: `Visited classroom: ${className || classId}`,
        createdAt: new Date()
      }
    });

    await activity.save();

    res.status(201).json({
      success: true,
      message: 'Staff visit tracked successfully',
      data: activity
    });
  } catch (error) {
    console.error('Error tracking staff visit:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to track staff visit',
      error: error.message
    });
  }
});

// Update staff activity (for streams, assignments, assessments)
router.post('/update-activity', async (req, res) => {
  try {
    const { 
      staffId, 
      staffEmail, 
      staffName, 
      classId, 
      activityType, 
      itemData 
    } = req.body;

    if (!staffId || !staffEmail || !staffName || !activityType || !itemData) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields' 
      });
    }

    // Validate activity type
    const validActivityTypes = ['streams', 'assignments', 'assessments'];
    if (!validActivityTypes.includes(activityType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid activity type. Must be: streams, assignments, or assessments'
      });
    }

    // Optional: Fetch class details if classId provided
    let className = '', subject = '', section = '';
    if (classId) {
      try {
        const Class = mongoose.model('Class');
        const classData = await Class.findById(classId).select('name subject section');
        if (classData) {
          className = classData.name || '';
          subject = classData.subject || '';
          section = classData.section || '';
        }
      } catch (error) {
        console.log('Could not fetch class details:', error.message);
      }
    }

    // Determine title based on activity type
    let title = '';
    switch (activityType) {
      case 'streams':
        title = itemData.title || 'Live Stream Created';
        break;
      case 'assignments':
        title = itemData.title || 'Assignment Created';
        if (itemData.assignmentType === 'question') {
          title = 'Question Assignment Created';
        } else if (itemData.assignmentType === 'form') {
          title = 'Form Assignment Created';
        }
        break;
      case 'assessments':
        title = itemData.title || 'Assessment Created';
        break;
    }

    const activity = new StaffActivity({
      staffId,
      staffEmail,
      staffName,
      classId: classId || null,
      className,
      subject,
      section,
      activityType,
      itemData: {
        title,
        type: activityType,
        description: itemData.description || `Created ${activityType.slice(0, -1)}`,
        createdAt: itemData.createdAt || new Date(),
        updatedAt: itemData.updatedAt || new Date()
      }
    });

    await activity.save();

    res.status(201).json({
      success: true,
      message: `${activityType} activity tracked successfully`,
      data: activity
    });
  } catch (error) {
    console.error('Error updating staff activity:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update staff activity',
      error: error.message
    });
  }
});

// Get staff activity by email
router.get('/staff/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const { limit = 50, skip = 0, type } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Staff email is required'
      });
    }

    // Build query
    const query = { staffEmail: email.toLowerCase() };
    if (type) {
      query.activityType = type;
    }

    // Get activities
    const activities = await StaffActivity.find(query)
      .sort({ createdAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .lean();

    // Get activity summary
    const summary = await StaffActivity.aggregate([
      { $match: { staffEmail: email.toLowerCase() } },
      {
        $group: {
          _id: '$activityType',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get class breakdown
    const classBreakdown = await StaffActivity.aggregate([
      { $match: { staffEmail: email.toLowerCase(), classId: { $ne: null } } },
      {
        $group: {
          _id: '$classId',
          className: { $first: '$className' },
          subject: { $first: '$subject' },
          section: { $first: '$section' },
          streams: {
            $sum: { $cond: [{ $eq: ['$activityType', 'streams'] }, 1, 0] }
          },
          assignments: {
            $sum: { $cond: [{ $eq: ['$activityType', 'assignments'] }, 1, 0] }
          },
          assessments: {
            $sum: { $cond: [{ $eq: ['$activityType', 'assessments'] }, 1, 0] }
          },
          visits: {
            $sum: { $cond: [{ $eq: ['$activityType', 'visit'] }, 1, 0] }
          },
          total: { $sum: 1 }
        }
      },
      { $sort: { total: -1 } }
    ]);

    // Format summary
    const summaryObj = {
      totalStreams: 0,
      totalAssignments: 0,
      totalAssessments: 0,
      totalVisits: 0,
      totalClasses: classBreakdown.length,
      totalActivities: activities.length
    };

    summary.forEach(item => {
      switch(item._id) {
        case 'streams':
          summaryObj.totalStreams = item.count;
          break;
        case 'assignments':
          summaryObj.totalAssignments = item.count;
          break;
        case 'assessments':
          summaryObj.totalAssessments = item.count;
          break;
        case 'visit':
          summaryObj.totalVisits = item.count;
          break;
      }
    });

    // Format timeline
    const timeline = activities.map(activity => ({
      id: activity._id,
      date: activity.createdAt,
      type: activity.activityType,
      title: activity.itemData?.title || activity.activityType,
      description: activity.itemData?.description || `${activity.activityType} activity`,
      className: activity.className,
      subject: activity.subject,
      section: activity.section
    }));

    res.status(200).json({
      success: true,
      data: {
        summary: summaryObj,
        classBreakdown: classBreakdown.map(cls => ({
          classId: cls._id,
          className: cls.className,
          subject: cls.subject,
          section: cls.section,
          streams: cls.streams,
          assignments: cls.assignments,
          assessments: cls.assessments,
          visits: cls.visits,
          total: cls.total
        })),
        timeline,
        activities
      }
    });
  } catch (error) {
    console.error('Error fetching staff activity:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch staff activity',
      error: error.message
    });
  }
});

// Get staff activity timeline
router.get('/staff/:email/timeline', async (req, res) => {
  try {
    const { email } = req.params;
    const { limit = 20 } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Staff email is required'
      });
    }

    const activities = await StaffActivity.find({ 
      staffEmail: email.toLowerCase() 
    })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    const timeline = activities.map(activity => ({
      date: activity.createdAt,
      type: activity.activityType,
      description: activity.itemData?.description || 
                  `${activity.activityType} activity`,
      className: activity.className,
      classId: activity.classId
    }));

    res.status(200).json({
      success: true,
      timeline
    });
  } catch (error) {
    console.error('Error fetching staff timeline:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch staff timeline',
      error: error.message
    });
  }
});

// Get all staff activities (admin only)
router.get('/all', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      search = '',
      activityType,
      startDate,
      endDate 
    } = req.query;

    const query = {};
    
    // Search by staff name or email
    if (search) {
      query.$or = [
        { staffName: { $regex: search, $options: 'i' } },
        { staffEmail: { $regex: search, $options: 'i' } },
        { className: { $regex: search, $options: 'i' } }
      ];
    }

    // Filter by activity type
    if (activityType) {
      query.activityType = activityType;
    }

    // Filter by date range
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [activities, total] = await Promise.all([
      StaffActivity.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      StaffActivity.countDocuments(query)
    ]);

    // Get staff statistics
    const staffStats = await StaffActivity.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$staffEmail',
          staffName: { $first: '$staffName' },
          totalActivities: { $sum: 1 },
          streams: { $sum: { $cond: [{ $eq: ['$activityType', 'streams'] }, 1, 0] } },
          assignments: { $sum: { $cond: [{ $eq: ['$activityType', 'assignments'] }, 1, 0] } },
          assessments: { $sum: { $cond: [{ $eq: ['$activityType', 'assessments'] }, 1, 0] } },
          visits: { $sum: { $cond: [{ $eq: ['$activityType', 'visit'] }, 1, 0] } },
          lastActivity: { $max: '$createdAt' }
        }
      },
      { $sort: { totalActivities: -1 } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        activities,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        },
        staffStats: staffStats.map(staff => ({
          staffEmail: staff._id,
          staffName: staff.staffName,
          totalActivities: staff.totalActivities,
          streams: staff.streams,
          assignments: staff.assignments,
          assessments: staff.assessments,
          visits: staff.visits,
          lastActivity: staff.lastActivity
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching all activities:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch activities',
      error: error.message
    });
  }
});

// Get activity statistics
router.get('/stats', async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    
    let dateFilter = {};
    const now = new Date();
    
    switch(period) {
      case 'day':
        dateFilter = {
          $gte: new Date(now.setHours(0, 0, 0, 0)),
          $lte: new Date(now.setHours(23, 59, 59, 999))
        };
        break;
      case 'week':
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        weekStart.setHours(0, 0, 0, 0);
        dateFilter = { $gte: weekStart };
        break;
      case 'month':
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        dateFilter = { $gte: monthStart };
        break;
      case 'year':
        const yearStart = new Date(now.getFullYear(), 0, 1);
        dateFilter = { $gte: yearStart };
        break;
    }

    const stats = await StaffActivity.aggregate([
      { $match: { createdAt: dateFilter } },
      {
        $group: {
          _id: '$activityType',
          count: { $sum: 1 },
          staffCount: { $addToSet: '$staffEmail' }
        }
      },
      {
        $project: {
          activityType: '$_id',
          count: 1,
          uniqueStaff: { $size: '$staffCount' }
        }
      }
    ]);

    // Get top active staff
    const topStaff = await StaffActivity.aggregate([
      { $match: { createdAt: dateFilter } },
      {
        $group: {
          _id: '$staffEmail',
          staffName: { $first: '$staffName' },
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    res.status(200).json({
      success: true,
      data: {
        period,
        stats,
        topStaff,
        totalActivities: stats.reduce((sum, item) => sum + item.count, 0),
        uniqueStaff: [...new Set(stats.flatMap(s => s.staffCount))].length
      }
    });
  } catch (error) {
    console.error('Error fetching activity stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch activity statistics',
      error: error.message
    });
  }
});

// Delete staff activity (admin only)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid activity ID'
      });
    }

    const activity = await StaffActivity.findByIdAndDelete(id);

    if (!activity) {
      return res.status(404).json({
        success: false,
        message: 'Activity not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Activity deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting activity:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete activity',
      error: error.message
    });
  }
});

// Bulk delete staff activities
router.delete('/staff/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const { activityType, startDate, endDate } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Staff email is required'
      });
    }

    const query = { staffEmail: email.toLowerCase() };
    
    if (activityType) {
      query.activityType = activityType;
    }
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const result = await StaffActivity.deleteMany(query);

    res.status(200).json({
      success: true,
      message: `Deleted ${result.deletedCount} activities`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error bulk deleting activities:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete activities',
      error: error.message
    });
  }
});

module.exports = router;