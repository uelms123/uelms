const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

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

staffActivitySchema.index({ staffEmail: 1, createdAt: -1 });
staffActivitySchema.index({ staffId: 1 });
staffActivitySchema.index({ classId: 1 });
staffActivitySchema.index({ activityType: 1 });

const StaffActivity = mongoose.model('StaffActivity', staffActivitySchema);

router.post('/track-visit', async (req, res) => {
  try {
    const { staffId, staffEmail, staffName, classId } = req.body;

    if (!staffId || !staffEmail || !staffName || !classId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields' 
      });
    }

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

    const validActivityTypes = ['streams', 'assignments', 'assessments'];
    if (!validActivityTypes.includes(activityType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid activity type. Must be: streams, assignments, or assessments'
      });
    }

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

    let activity = await StaffActivity.findOne({ staffId, classId: classId || null });

    if (!activity) {
      activity = new StaffActivity({
        staffId,
        staffEmail,
        staffName,
        classId: classId || null,
        className,
        subject,
        section,
        activityType,
        itemData
      });
    } else {
      activity.activityType = activityType;
      activity.itemData = itemData;
      activity.updatedAt = new Date();
    }

    await activity.save();

    res.status(201).json({
      success: true,
      message: 'Activity updated successfully',
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

router.get('/staff/:email/timeline', async (req, res) => {
  try {
    const { email } = req.params;
    const { limit = 50, startDate, endDate } = req.query;

    const staff = await Staff.findOne({ email: email.toLowerCase() });
    if (!staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found'
      });
    }

    let dateFilter = {};
    if (startDate || endDate) {
      dateFilter = { createdAt: {} };
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    const activities = await StaffActivity.find({
      staffEmail: email.toLowerCase(),
      ...dateFilter
    })
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .populate('classId', 'name subject section');

    const summary = {
      totalActivities: activities.length,
      totalStreams: activities.filter(a => a.activityType === 'streams').length,
      totalAssignments: activities.filter(a => a.activityType === 'assignments').length,
      totalAssessments: activities.filter(a => a.activityType === 'assessments').length,
      totalVisits: activities.filter(a => a.activityType === 'visit').length
    };

    res.status(200).json({
      success: true,
      staff: {
        name: staff.name,
        email: staff.email,
        staffId: staff.staffId
      },
      summary,
      timeline: activities.map(activity => ({
        id: activity._id,
        type: activity.activityType,
        className: activity.className || activity.classId?.name || 'N/A',
        subject: activity.subject || activity.classId?.subject || 'N/A',
        section: activity.section || activity.classId?.section || 'N/A',
        title: activity.itemData?.title || `${activity.activityType} activity`,
        description: activity.itemData?.description || '',
        createdAt: activity.createdAt,
        updatedAt: activity.updatedAt
      }))
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