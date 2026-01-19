const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Use mongoose to get the already registered models
const StaffActivity = mongoose.models.StaffActivity || require('../models/StaffActivity');
const Class = mongoose.models.Class || require('../models/Class');
const Staff = mongoose.models.Staff || require('../models/Staff');
const Unit = mongoose.models.Unit || require('../models/unit');

// Middleware to validate ObjectId
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

// CORS headers for all routes
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ============================================
// ACTIVITY TRACKING ROUTES
// ============================================

// Track staff visit to classroom
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
        staffEmail,
        staffName,
        classId,
        className: classData.name,
        classSubject: classData.subject || '',
        classSection: classData.section || '',
        classCreatedDate: classData.createdAt,
        visitsCount: 1,
        lastClassVisit: new Date(),
      });
    } else {
      activity.visitsCount = (activity.visitsCount || 0) + 1;
      activity.lastClassVisit = new Date();
      if (staffName) activity.staffName = staffName;
      if (staffEmail) activity.staffEmail = staffEmail;
    }

    await activity.save();
    res.json({ success: true });
  } catch (err) {
    console.error('Error tracking visit:', err);
    res.status(500).json({ error: err.message });
  }
});

// Track assessment activity (increments totalAssessments for new units/files)
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
        lastAssessmentUpdate: new Date(),
      });
    } else {
      activity.totalAssessments = (activity.totalAssessments || 0) + 1;
      activity.lastAssessmentUpdate = new Date();
    }

    // Add to assessments items log
    activity.activities = activity.activities || {};
    activity.activities.assessments = activity.activities.assessments || { items: [], count: 0, lastUpdated: new Date() };
    activity.activities.assessments.items.push({
      id: assessmentId || new mongoose.Types.ObjectId().toString(),
      title: assessmentTitle || itemData.title || 'Untitled Assessment',
      type: assessmentType || itemData.type || 'material',
      createdAt: new Date(),
    });
    activity.activities.assessments.count = activity.totalAssessments;
    activity.activities.assessments.lastUpdated = new Date();

    await activity.save();
    res.json({ success: true });
  } catch (err) {
    console.error('Error tracking assessment:', err);
    res.status(500).json({ error: err.message });
  }
});

// Enhanced update activity (general update) - Combined version
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
        lastActivityUpdate: new Date(),
      });
    } else {
      activity.lastActivityUpdate = new Date();
      if (staffEmail) activity.staffEmail = staffEmail;
      if (staffName) activity.staffName = staffName;
    }

    activity.activities = activity.activities || {};
    const now = new Date();

    switch (activityType) {
      case 'assessments':
        activity.totalAssessments = (activity.totalAssessments || 0) + 1;
        activity.lastAssessmentUpdate = now;
        activity.activities.assessments = activity.activities.assessments || { items: [], count: 0, lastUpdated: now };
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
        activity.activities.assignments = activity.activities.assignments || { items: [], count: 0, lastUpdated: now };
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
        activity.activities.streams = activity.activities.streams || { items: [], count: 0, lastUpdated: now };
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
        return res.status(400).json({ error: 'Invalid activityType' });
    }

    await activity.save();
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating activity:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// STAFF ACTIVITY DATA RETRIEVAL ROUTES
// ============================================

// NEW: Get detailed activity timeline for staff (Enhanced version)
router.get('/staff/:staffId/timeline', async (req, res) => {
  try {
    const { staffId } = req.params;
    const { startDate, endDate } = req.query;
    
    // First, try to get staff by email if staffId looks like an email
    let staffIdentifier = staffId;
    let staffEmail = staffId;
    if (staffId.includes('@')) {
      const staff = await Staff.findOne({ email: staffId.toLowerCase() });
      if (staff) {
        staffIdentifier = staff.staffId;
        staffEmail = staff.email;
      }
    }
    
    // Build date filter
    let dateFilter = {};
    if (startDate) {
      dateFilter.createdAt = { $gte: new Date(startDate) };
    }
    if (endDate) {
      dateFilter.createdAt = dateFilter.createdAt || {};
      dateFilter.createdAt.$lte = new Date(endDate);
    }
    
    // Get all staff activities with populated class details
    const activities = await StaffActivity.find({
      $or: [
        { staffId: staffIdentifier },
        { staffEmail: { $regex: staffEmail, $options: 'i' } }
      ],
      ...dateFilter
    })
    .populate('classId', 'name subject section createdAt')
    .sort({ updatedAt: -1 });
    
    // Get staff details
    const staff = await Staff.findOne({
      $or: [
        { staffId: staffIdentifier },
        { email: staffEmail }
      ]
    });
    
    if (!staff) {
      return res.status(404).json({
        success: false,
        error: 'Staff not found'
      });
    }
    
    // Calculate totals
    let totalStreams = 0;
    let totalAssignments = 0;
    let totalAssessments = 0;
    let totalVisits = 0;
    let totalClasses = 0;
    
    const timeline = [];
    
    activities.forEach(activity => {
      totalStreams += activity.totalStreams || 0;
      totalAssignments += activity.totalAssignments || 0;
      totalAssessments += activity.totalAssessments || 0;
      totalVisits += activity.visitsCount || 0;
      
      if (activity.classId) {
        totalClasses += 1;
      }
      
      // Add to timeline
      if (activity.totalStreams > 0) {
        timeline.push({
          date: activity.updatedAt || activity.createdAt,
          type: 'stream',
          className: activity.className || (activity.classId?.name || 'Unknown Class'),
          subject: activity.classSubject || (activity.classId?.subject || ''),
          section: activity.classSection || (activity.classId?.section || ''),
          count: activity.totalStreams,
          description: `Created ${activity.totalStreams} streaming content(s)`
        });
      }
      
      if (activity.totalAssignments > 0) {
        timeline.push({
          date: activity.updatedAt || activity.createdAt,
          type: 'assignment',
          className: activity.className || (activity.classId?.name || 'Unknown Class'),
          subject: activity.classSubject || (activity.classId?.subject || ''),
          section: activity.classSection || (activity.classId?.section || ''),
          count: activity.totalAssignments,
          description: `Created ${activity.totalAssignments} assignment(s)`
        });
      }
      
      if (activity.totalAssessments > 0) {
        timeline.push({
          date: activity.updatedAt || activity.createdAt,
          type: 'assessment',
          className: activity.className || (activity.classId?.name || 'Unknown Class'),
          subject: activity.classSubject || (activity.classId?.subject || ''),
          section: activity.classSection || (activity.classId?.section || ''),
          count: activity.totalAssessments,
          description: `Created ${activity.totalAssessments} assessment(s)`
        });
      }
      
      if (activity.visitsCount > 0) {
        timeline.push({
          date: activity.lastClassVisit || activity.updatedAt || activity.createdAt,
          type: 'visit',
          className: activity.className || (activity.classId?.name || 'Unknown Class'),
          subject: activity.classSubject || (activity.classId?.subject || ''),
          section: activity.classSection || (activity.classId?.section || ''),
          count: activity.visitsCount,
          description: `Visited class ${activity.visitsCount} time(s)`
        });
      }
    });
    
    // Sort timeline by date (newest first)
    timeline.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // Get class-wise breakdown
    const classBreakdown = [];
    const classMap = new Map();
    
    activities.forEach(activity => {
      if (activity.classId) {
        const classId = activity.classId._id.toString();
        if (!classMap.has(classId)) {
          classMap.set(classId, {
            className: activity.className || activity.classId.name,
            subject: activity.classSubject || activity.classId.subject,
            section: activity.classSection || activity.classId.section,
            streams: 0,
            assignments: 0,
            assessments: 0,
            visits: 0,
            firstActivity: activity.createdAt,
            lastActivity: activity.updatedAt
          });
        }
        
        const classData = classMap.get(classId);
        classData.streams += activity.totalStreams || 0;
        classData.assignments += activity.totalAssignments || 0;
        classData.assessments += activity.totalAssessments || 0;
        classData.visits += activity.visitsCount || 0;
        
        if (activity.createdAt < classData.firstActivity) {
          classData.firstActivity = activity.createdAt;
        }
        if (activity.updatedAt > classData.lastActivity) {
          classData.lastActivity = activity.updatedAt;
        }
      }
    });
    
    classMap.forEach((data, classId) => {
      classBreakdown.push({
        ...data,
        totalActivities: data.streams + data.assignments + data.assessments
      });
    });
    
    // Sort class breakdown by total activities (highest first)
    classBreakdown.sort((a, b) => b.totalActivities - a.totalActivities);
    
    res.status(200).json({
      success: true,
      staff: {
        staffId: staff.staffId,
        name: staff.name,
        email: staff.email,
        department: staff.department || staff.program || 'N/A'
      },
      summary: {
        totalStreams,
        totalAssignments,
        totalAssessments,
        totalVisits,
        totalClasses: classBreakdown.length,
        totalActivities: totalStreams + totalAssignments + totalAssessments
      },
      timeline: timeline.slice(0, 50), // Limit to 50 most recent activities
      classBreakdown,
      activityCount: activities.length
    });
    
  } catch (error) {
    console.error('Error fetching staff timeline:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch staff timeline: ' + error.message
    });
  }
});

// Sync existing assessments for all staff
router.post('/sync-existing-assessments', async (req, res) => {
  try {
    console.log('Starting assessment sync...');
    
    let syncedCount = 0;
    let errorCount = 0;
    
    // Get all staff
    const allStaff = await Staff.find({});
    
    for (const staff of allStaff) {
      try {
        // Find units created by this staff
        if (mongoose.models.Unit) {
          const Unit = mongoose.models.Unit;
          const units = await Unit.find({
            $or: [
              { createdBy: staff.staffId },
              { createdByEmail: staff.email }
            ]
          });
          
          // For each unit, track it as assessment
          for (const unit of units) {
            try {
              // Count files in unit
              let fileCount = 0;
              if (mongoose.models.File && unit.files && unit.files.length > 0) {
                const File = mongoose.models.File;
                const files = await File.find({ _id: { $in: unit.files } });
                fileCount = files.filter(f => 
                  f.isAssessmentMaterial || 
                  f.type?.toLowerCase()?.includes('assessment') ||
                  f.type?.toLowerCase()?.includes('quiz') ||
                  f.type?.toLowerCase()?.includes('exam') ||
                  f.type?.toLowerCase()?.includes('test') ||
                  f.assessmentType
                ).length;
              }
              
              // Create or update activity record
              let activity = await StaffActivity.findOne({
                staffId: staff.staffId,
                classId: unit.classId
              });
              
              if (!activity) {
                // Find class details
                const classData = await Class.findById(unit.classId);
                if (!classData) continue;
                
                activity = new StaffActivity({
                  staffId: staff.staffId,
                  staffEmail: staff.email,
                  staffName: staff.name,
                  classId: unit.classId,
                  className: classData.name,
                  classSubject: classData.subject || '',
                  classSection: classData.section || '',
                  classCreatedDate: classData.createdAt,
                  visitsCount: 1,
                  lastClassVisit: new Date(),
                  totalStreams: 0,
                  totalAssignments: 0,
                  totalAssessments: Math.max(1, fileCount),
                  isHistoricalData: true,
                  notes: 'Synced from existing units'
                });
              } else {
                activity.totalAssessments = (activity.totalAssessments || 0) + Math.max(1, fileCount);
              }
              
              await activity.save();
              syncedCount++;
              
            } catch (unitErr) {
              console.error(`Error syncing unit ${unit._id}:`, unitErr.message);
              errorCount++;
            }
          }
        }
        
        // Find standalone assessment files
        if (mongoose.models.File) {
          const File = mongoose.models.File;
          const assessmentFiles = await File.find({
            $and: [
              {
                $or: [
                  { uploadedBy: staff.staffId },
                  { uploadedByEmail: staff.email }
                ]
              },
              {
                $or: [
                  { isAssessmentMaterial: true },
                  { type: { $regex: /quiz|exam|test|assessment/i } },
                  { assessmentType: { $exists: true, $ne: null } }
                ]
              }
            ]
          });
          
          // Group files by classId
          const filesByClass = {};
          assessmentFiles.forEach(file => {
            if (file.classId) {
              if (!filesByClass[file.classId]) {
                filesByClass[file.classId] = [];
              }
              filesByClass[file.classId].push(file);
            }
          });
          
          // Update activity records for each class
          for (const [classId, files] of Object.entries(filesByClass)) {
            try {
              let activity = await StaffActivity.findOne({
                staffId: staff.staffId,
                classId: classId
              });
              
              if (!activity) {
                const classData = await Class.findById(classId);
                if (!classData) continue;
                
                activity = new StaffActivity({
                  staffId: staff.staffId,
                  staffEmail: staff.email,
                  staffName: staff.name,
                  classId: classId,
                  className: classData.name,
                  classSubject: classData.subject || '',
                  classSection: classData.section || '',
                  classCreatedDate: classData.createdAt,
                  visitsCount: 1,
                  lastClassVisit: new Date(),
                  totalStreams: 0,
                  totalAssignments: 0,
                  totalAssessments: files.length,
                  isHistoricalData: true,
                  notes: 'Synced from existing assessment files'
                });
              } else {
                activity.totalAssessments = (activity.totalAssessments || 0) + files.length;
              }
              
              await activity.save();
              syncedCount++;
              
            } catch (fileErr) {
              console.error(`Error syncing files for class ${classId}:`, fileErr.message);
              errorCount++;
            }
          }
        }
        
        // Find assignments created by this staff
        if (mongoose.models.Assignment) {
          const Assignment = mongoose.models.Assignment;
          const assignments = await Assignment.find({
            staffId: staff.staffId
          });
          
          // Group assignments by classId
          const assignmentsByClass = {};
          assignments.forEach(assignment => {
            if (assignment.classId) {
              if (!assignmentsByClass[assignment.classId]) {
                assignmentsByClass[assignment.classId] = [];
              }
              assignmentsByClass[assignment.classId].push(assignment);
            }
          });
          
          // Update activity records for each class
          for (const [classId, classAssignments] of Object.entries(assignmentsByClass)) {
            try {
              let activity = await StaffActivity.findOne({
                staffId: staff.staffId,
                classId: classId
              });
              
              if (!activity) {
                const classData = await Class.findById(classId);
                if (!classData) continue;
                
                activity = new StaffActivity({
                  staffId: staff.staffId,
                  staffEmail: staff.email,
                  staffName: staff.name,
                  classId: classId,
                  className: classData.name,
                  classSubject: classData.subject || '',
                  classSection: classData.section || '',
                  classCreatedDate: classData.createdAt,
                  visitsCount: 1,
                  lastClassVisit: new Date(),
                  totalStreams: 0,
                  totalAssignments: classAssignments.length,
                  totalAssessments: 0,
                  isHistoricalData: true,
                  notes: 'Synced from existing assignments'
                });
              } else {
                activity.totalAssignments = (activity.totalAssignments || 0) + classAssignments.length;
              }
              
              await activity.save();
              syncedCount++;
              
            } catch (assignErr) {
              console.error(`Error syncing assignments for class ${classId}:`, assignErr.message);
              errorCount++;
            }
          }
        }
        
      } catch (staffErr) {
        console.error(`Error syncing staff ${staff.email}:`, staffErr.message);
        errorCount++;
      }
    }
    
    res.status(200).json({
      success: true,
      message: `Assessment sync completed`,
      syncedCount,
      errorCount,
      totalStaff: allStaff.length
    });
    
  } catch (error) {
    console.error('Error syncing assessments:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sync assessments: ' + error.message
    });
  }
});

// Add this route to check if staff activity exists
router.get('/check-staff-activity/:staffId', async (req, res) => {
  try {
    const { staffId } = req.params;
    
    // Try to find staff by email first
    let staff = await Staff.findOne({ 
      $or: [
        { staffId: staffId },
        { email: staffId }
      ]
    });
    
    if (!staff) {
      return res.status(200).json({
        success: true,
        exists: false,
        message: 'Staff not found'
      });
    }
    
    // Check for activity records
    const activities = await StaffActivity.find({
      $or: [
        { staffId: staff.staffId },
        { staffEmail: staff.email }
      ]
    });
    
    // Also check if staff has created any content
    let hasContent = false;
    let contentCounts = {
      streams: 0,
      assignments: 0,
      assessments: 0
    };
    
    if (activities.length > 0) {
      hasContent = true;
      activities.forEach(activity => {
        contentCounts.streams += activity.totalStreams || 0;
        contentCounts.assignments += activity.totalAssignments || 0;
        contentCounts.assessments += activity.totalAssessments || 0;
      });
    }
    
    res.status(200).json({
      success: true,
      exists: activities.length > 0,
      hasContent: hasContent,
      activityCount: activities.length,
      contentCounts: contentCounts,
      staff: {
        staffId: staff.staffId,
        email: staff.email,
        name: staff.name
      },
      activities: activities
    });
    
  } catch (error) {
    console.error('Error checking staff activity:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check staff activity: ' + error.message
    });
  }
});

// Route for comprehensive staff activity data
router.get('/staff/:staffId/comprehensive', async (req, res) => {
  try {
    const { staffId } = req.params;
    
    // First, try to get staff by email if staffId looks like an email
    let staffIdentifier = staffId;
    let staffEmail = staffId;
    if (staffId.includes('@')) {
      const staff = await Staff.findOne({ email: staffId.toLowerCase() });
      if (staff) {
        staffIdentifier = staff.staffId;
        staffEmail = staff.email;
      }
    }
    
    // Get staff activity data using staffId (Firebase UID)
    const staffActivities = await StaffActivity.find({
      $or: [
        { staffId: staffIdentifier },
        { staffEmail: { $regex: staffId, $options: 'i' } }
      ]
    }).populate('classId', 'name subject section');
    
    // Count different types of activities
    let totalStreams = 0;
    let totalAssignments = 0;
    let totalAssessments = 0;
    let totalVisits = 0;
    
    staffActivities.forEach(activity => {
      // Count streams
      totalStreams += activity.totalStreams || 0;
      
      // Count assignments
      totalAssignments += activity.totalAssignments || 0;
      
      // Count assessments - FIXED: Ensure we're counting from the right field
      totalAssessments += activity.totalAssessments || 0;
      
      // Count visits
      totalVisits += activity.visitsCount || 0;
    });
    
    // Get assessment units AND files created by this staff
    let unitAssessmentCount = 0;
    let unitsCount = 0;
    let filesCount = 0;
    let units = [];

    // FIXED: Check for Unit model AND File model
    if (mongoose.models.Unit && mongoose.models.File) {
      try {
        const Unit = mongoose.models.Unit;
        const File = mongoose.models.File;
        
        // Get units created by this staff
        units = await Unit.find({
          $or: [
            { createdBy: staffIdentifier },
            { createdByEmail: { $regex: staffEmail, $options: 'i' } }
          ]
        });
        
        unitsCount = units.length;
        
        // Count assessment files from units
        for (const unit of units) {
          if (unit.files && unit.files.length > 0) {
            // Get all files in this unit that are assessment materials
            const assessmentFiles = await File.find({
              _id: { $in: unit.files },
              $or: [
                { isAssessmentMaterial: true },
                { uploadedBy: staffIdentifier },
                { uploadedByEmail: { $regex: staffEmail, $options: 'i' } }
              ]
            });
            filesCount += assessmentFiles.length;
          }
        }
        
        // Also count standalone assessment files not in units
        const standaloneAssessmentFiles = await File.find({
          $and: [
            {
              $or: [
                { uploadedBy: staffIdentifier },
                { uploadedByEmail: { $regex: staffEmail, $options: 'i' } }
              ]
            },
            {
              $or: [
                { isAssessmentMaterial: true },
                { type: { $regex: /quiz|exam|test|assessment|assignment/i } },
                { assessmentType: { $exists: true, $ne: null } }
              ]
            }
          ]
        });
        
        filesCount += standaloneAssessmentFiles.length;
        
        console.log('Found assessment data:', {
          unitsCount,
          filesCount,
          totalUnitsFound: units.length,
          standaloneFiles: standaloneAssessmentFiles.length,
          staffIdentifier,
          staffEmail
        });
      } catch (unitErr) {
        console.error('Error fetching assessment data:', unitErr);
      }
    }

    // Update totalAssessments if direct count is higher
    const additionalAssessments = Math.max(0, (unitsCount + filesCount) - totalAssessments);
    totalAssessments += additionalAssessments;

    res.status(200).json({
      success: true,
      summary: {
        totalStreams,
        totalAssignments,
        totalAssessments,
        totalVisits,
        totalClasses: staffActivities.length
      },
      activities: staffActivities,
      additionalAssessments
    });
  } catch (error) {
    console.error('Error fetching comprehensive staff activity:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch comprehensive data: ' + error.message
    });
  }
});

// Get activity summary for dashboard
router.get('/summary', async (req, res) => {
  try {
    console.log('Generating activity summary...');
    
    let activities;
    try {
      activities = await StaffActivity.find().lean();
    } catch (err) {
      console.log('StaffActivity collection not available:', err.message);
      activities = [];
    }

    // Calculate overall statistics
    const summary = {
      totalStaff: new Set(activities.map(a => a.staffId)).size,
      totalClasses: new Set(activities.map(a => a.classId?.toString())).size,
      totalStreams: activities.reduce((sum, a) => sum + (a.totalStreams || 0), 0),
      totalAssignments: activities.reduce((sum, a) => sum + (a.totalAssignments || 0), 0),
      totalAssessments: activities.reduce((sum, a) => sum + (a.totalAssessments || 0), 0),
      totalVisits: activities.reduce((sum, a) => sum + (a.visitsCount || 0), 0),
      totalActivities: activities.reduce((sum, a) => sum + (a.totalStreams || 0) + (a.totalAssignments || 0) + (a.totalAssessments || 0), 0)
    };

    // Get recent activities
    let recentActivities = [];
    if (activities.length > 0) {
      recentActivities = await StaffActivity.find()
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean();
    }

    // Format recent activities
    const formattedRecentActivities = recentActivities.map(activity => ({
      staffName: activity.staffName || 'Unknown',
      staffEmail: activity.staffEmail || '',
      staffId: activity.staffId,
      className: activity.className || 'Unknown Class',
      totalStreams: activity.totalStreams || 0,
      totalAssignments: activity.totalAssignments || 0,
      totalAssessments: activity.totalAssessments || 0,
      visitsCount: activity.visitsCount || 0,
      updatedAt: activity.updatedAt
    }));

    // Get top active staff
    const staffMap = new Map();
    activities.forEach(activity => {
      const staffId = activity.staffId;
      if (!staffId) return;
      
      if (!staffMap.has(staffId)) {
        staffMap.set(staffId, {
          staffId,
          staffName: activity.staffName || 'Unknown',
          staffEmail: activity.staffEmail || '',
          totalStreams: 0,
          totalAssignments: 0,
          totalAssessments: 0,
          totalClasses: 0,
          totalVisits: 0,
          totalActivities: 0
        });
      }
      
      const staff = staffMap.get(staffId);
      staff.totalStreams += (activity.totalStreams || 0);
      staff.totalAssignments += (activity.totalAssignments || 0);
      staff.totalAssessments += (activity.totalAssessments || 0);
      staff.totalVisits += (activity.visitsCount || 0);
      staff.totalClasses += 1;
      staff.totalActivities += (activity.totalStreams || 0) + (activity.totalAssignments || 0) + (activity.totalAssessments || 0);
    });
    
    const topStaff = Array.from(staffMap.values())
      .sort((a, b) => b.totalActivities - a.totalActivities)
      .slice(0, 10);

    res.status(200).json({
      success: true,
      summary,
      topStaff,
      recentActivities: formattedRecentActivities
    });
    
  } catch (error) {
    console.error('Error generating activity summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate activity summary: ' + error.message
    });
  }
});

// Get class activities
router.get('/class/:classId', async (req, res) => {
  try {
    const { classId } = req.params;

    // Validate class
    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }

    // Get activities for this class
    const activities = await StaffActivity.find({ classId })
      .sort({ updatedAt: -1 });

    // Calculate class totals
    const classTotals = {
      totalStreams: 0,
      totalAssignments: 0,
      totalAssessments: 0,
      totalVisits: 0,
      staffCount: activities.length
    };

    activities.forEach(activity => {
      classTotals.totalStreams += activity.totalStreams || 0;
      classTotals.totalAssignments += activity.totalAssignments || 0;
      classTotals.totalAssessments += activity.totalAssessments || 0;
      classTotals.totalVisits += activity.visitsCount || 0;
    });

    res.status(200).json({
      success: true,
      class: {
        id: classData._id,
        name: classData.name,
        subject: classData.subject,
        section: classData.section
      },
      totals: classTotals,
      activities,
      count: activities.length
    });
  } catch (error) {
    console.error('Error fetching class activities:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch class activities: ' + error.message
    });
  }
});

// Route for comprehensive staff activity data (alternative version)
router.get('/staff/:staffId/comprehensive-v2', async (req, res) => {
  try {
    const { staffId } = req.params;
    
    // First, try to get staff by email if staffId looks like an email
    let staffIdentifier = staffId;
    let staffEmail = staffId;
    if (staffId.includes('@')) {
      const staff = await Staff.findOne({ email: staffId.toLowerCase() });
      if (staff) {
        staffIdentifier = staff.staffId;
        staffEmail = staff.email;
      }
    }
    
    // Get staff activity data using staffId (Firebase UID)
    const staffActivities = await StaffActivity.find({
      $or: [
        { staffId: staffIdentifier },
        { staffEmail: { $regex: staffId, $options: 'i' } }
      ]
    }).populate('classId', 'name subject section');
    
    // Count different types of activities
    let totalStreams = 0;
    let totalAssignments = 0;
    let totalAssessments = 0;
    let totalVisits = 0;
    let totalClasses = 0;
    
    staffActivities.forEach(activity => {
      // Count streams
      totalStreams += activity.totalStreams || 0;
      
      // Count assignments
      totalAssignments += activity.totalAssignments || 0;
      
      // Count assessments
      totalAssessments += activity.totalAssessments || 0;
      
      // Count visits
      totalVisits += activity.visitsCount || 0;
      
      // Count classes
      if (activity.classId) {
        totalClasses += 1;
      }
    });
    
    // Get detailed activity breakdown by class
    const activityBreakdown = staffActivities.map(activity => ({
      className: activity.className || 'Unknown Class',
      classSubject: activity.classSubject || '',
      classSection: activity.classSection || '',
      streams: activity.totalStreams || 0,
      assignments: activity.totalAssignments || 0,
      assessments: activity.totalAssessments || 0,
      visits: activity.visitsCount || 0,
      lastVisit: activity.lastClassVisit,
      lastAssessmentUpdate: activity.lastAssessmentUpdate
    }));

    res.status(200).json({
      success: true,
      summary: {
        totalStreams,
        totalAssignments,
        totalAssessments,
        totalVisits,
        totalClasses: totalClasses
      },
      breakdown: activityBreakdown,
      activities: staffActivities,
      staffInfo: {
        staffId: staffIdentifier,
        staffEmail: staffEmail
      }
    });
  } catch (error) {
    console.error('Error fetching comprehensive staff activity:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch comprehensive data: ' + error.message
    });
  }
});

// Route to get staff activity summary only (for PDF generation)
router.get('/staff/:staffId/summary', async (req, res) => {
  try {
    const { staffId } = req.params;
    const { startDate, endDate } = req.query;
    
    // First, try to get staff by email if staffId looks like an email
    let staffIdentifier = staffId;
    let staffEmail = staffId;
    if (staffId.includes('@')) {
      const staff = await Staff.findOne({ email: staffId.toLowerCase() });
      if (staff) {
        staffIdentifier = staff.staffId;
        staffEmail = staff.email;
      }
    }
    
    // Build date filter
    let dateFilter = {};
    if (startDate) {
      dateFilter.createdAt = { $gte: new Date(startDate) };
    }
    if (endDate) {
      dateFilter.createdAt = dateFilter.createdAt || {};
      dateFilter.createdAt.$lte = new Date(endDate);
    }
    
    // Get staff activity data
    const staffActivities = await StaffActivity.find({
      $or: [
        { staffId: staffIdentifier },
        { staffEmail: { $regex: staffId, $options: 'i' } }
      ],
      ...dateFilter
    });
    
    // Calculate totals
    let totalStreams = 0;
    let totalAssignments = 0;
    let totalAssessments = 0;
    let totalVisits = 0;
    let totalClasses = 0;
    
    staffActivities.forEach(activity => {
      totalStreams += activity.totalStreams || 0;
      totalAssignments += activity.totalAssignments || 0;
      totalAssessments += activity.totalAssessments || 0;
      totalVisits += activity.visitsCount || 0;
      if (activity.classId) {
        totalClasses += 1;
      }
    });
    
    // Get activity breakdown by class
    const classBreakdown = [];
    
    for (const activity of staffActivities) {
      if (activity.classId) {
        const classData = await Class.findById(activity.classId);
        if (classData) {
          classBreakdown.push({
            className: classData.name || activity.className || 'Unknown Class',
            subject: classData.subject || activity.classSubject || '',
            section: classData.section || activity.classSection || '',
            streams: activity.totalStreams || 0,
            assignments: activity.totalAssignments || 0,
            assessments: activity.totalAssessments || 0,
            visits: activity.visitsCount || 0
          });
        }
      }
    }
    
    // Get staff details
    const staff = await Staff.findOne({
      $or: [
        { staffId: staffIdentifier },
        { email: staffEmail }
      ]
    });
    
    res.status(200).json({
      success: true,
      summary: {
        totalStreams,
        totalAssignments,
        totalAssessments,
        totalVisits,
        totalClasses
      },
      classBreakdown,
      staff: {
        staffId: staffIdentifier,
        email: staffEmail,
        name: staff ? staff.name : 'Unknown'
      }
    });
    
  } catch (error) {
    console.error('Error fetching staff activity summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch staff activity summary: ' + error.message
    });
  }
});

// Analyze existing content for historical data (updated to count units as assessments)
router.post('/analyze-existing/:staffId/:classId', async (req, res) => {
  try {
    const { staffId, classId } = req.params;

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ error: 'Invalid class ID' });
    }

    // Find staff
    const staff = await Staff.findOne({ staffId });
    if (!staff) {
      return res.status(404).json({ error: 'Staff not found' });
    }

    // Find class
    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Count units created by this staff in this class as assessments
    const unitsCount = await Unit.countDocuments({ classId, createdBy: staffId });

    // Fetch unit details for items
    const units = await Unit.find({ classId, createdBy: staffId }).select('title createdAt description');

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

    // Update assessments with actual unit counts
    activity.totalAssessments = unitsCount;
    activity.activities = activity.activities || {};
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

    // You can add logic here to count streams/assignments if their models are available
    // For example:
    // const assignmentsCount = await Assignment.countDocuments({ classId, createdBy: staffId });
    // activity.totalAssignments = assignmentsCount;
    // ... etc.

    activity.isHistoricalData = true;
    activity.notes = `Historical data: ${unitsCount} units (assessments) found`;
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

// Manual update activity counts
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

    // Get class data
    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }

    // Get staff details
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
      // Create new activity
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
      // Update existing
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

// ============================================
// CRUD OPERATIONS
// ============================================

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

// Get activity by ID
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

module.exports = router;