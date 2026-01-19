const express = require('express');
const router = express.Router();
const Meeting = require('../models/Meeting');
const Class = require('../models/Class');
const axios = require('axios'); // Add axios import
const moment = require('moment');

// ========== BASIC MEETING CRUD ==========

// Create a new meeting
router.post('/', async (req, res) => {
  try {
    const { 
      classId, title, description, courseCode, meetLink, meetType, 
      scheduledTime, duration, createdBy, staffName, staffEmail 
    } = req.body;

    // Validate required fields
    if (!classId || !title || !meetLink || !meetType || !scheduledTime || !createdBy) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: classId, title, meetLink, meetType, scheduledTime, createdBy' 
      });
    }

    // Validate meetLink format
    if (!meetLink.startsWith('http://') && !meetLink.startsWith('https://')) {
      return res.status(400).json({ 
        success: false, 
        error: 'Meeting link must start with http:// or https://' 
      });
    }

    const meeting = new Meeting({
      classId,
      title,
      description: description || '',
      courseCode: courseCode || 'N/A',
      meetLink,
      meetType,
      scheduledTime: new Date(scheduledTime),
      duration: duration || 60,
      createdBy,
      staffInfo: {
        name: staffName || '',
        email: staffEmail || ''
      },
      status: 'scheduled',
      isMeetingActive: false,
      actualDuration: 0
    });

    await meeting.save();
    res.status(201).json({ success: true, meeting });
  } catch (error) {
    console.error('Error creating meeting:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get meetings for a class
router.get('/class/:classId', async (req, res) => {
  try {
    const { classId } = req.params;
    
    const meetings = await Meeting.find({ classId })
      .sort({ scheduledTime: -1 });

    res.json({ success: true, meetings });
  } catch (error) {
    console.error('Error fetching meetings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get meeting details
router.get('/:meetingId', async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.meetingId);

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    res.json({ success: true, meeting });
  } catch (error) {
    console.error('Error fetching meeting details:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update meeting
router.put('/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const updateData = req.body;

    // Handle scheduledTime conversion if present
    if (updateData.scheduledTime) {
      updateData.scheduledTime = new Date(updateData.scheduledTime);
    }

    const meeting = await Meeting.findByIdAndUpdate(
      meetingId,
      updateData,
      { new: true, runValidators: true }
    );

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    res.json({ success: true, meeting });
  } catch (error) {
    console.error('Error updating meeting:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete meeting
router.delete('/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;

    const meeting = await Meeting.findByIdAndDelete(meetingId);

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    res.json({ success: true, message: 'Meeting deleted successfully' });
  } catch (error) {
    console.error('Error deleting meeting:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== ATTENDANCE TRACKING ==========

// Join meeting and mark attendance
router.post('/:meetingId/join', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { studentId, email, name, isExternal = false } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email is required' 
      });
    }

    const meeting = await Meeting.findById(meetingId);
    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    // Check if user is already in attendees
    const existingAttendeeIndex = meeting.attendees.findIndex(a => 
      a.email && a.email.toLowerCase() === email.toLowerCase()
    );
    
    if (existingAttendeeIndex !== -1) {
      // Update existing attendee
      const attendee = meeting.attendees[existingAttendeeIndex];
      
      // If already joined and not left, just update heartbeat
      if (!attendee.leftAt) {
        attendee.lastHeartbeat = new Date();
        attendee.lastUpdated = new Date();
        await meeting.save();
        
        return res.json({ 
          success: true, 
          message: 'Already in meeting',
          attendeesCount: meeting.attendees.length,
          joinedAt: attendee.joinedAt,
          isExternal: attendee.isExternal
        });
      }
      
      // Re-join if previously left
      attendee.joinedAt = new Date();
      attendee.leftAt = null;
      attendee.duration = null;
      attendee.status = isExternal ? 'external' : 'attended';
      attendee.lastUpdated = new Date();
      attendee.lastHeartbeat = new Date();
      attendee.autoLeave = false;
      attendee.autoLeaveReason = null;
    } else {
      // Add new attendee
      meeting.attendees.push({
        studentId: isExternal ? null : studentId,
        email: email.toLowerCase(),
        name: name || (studentId ? `Student ${studentId}` : `Guest ${email.split('@')[0]}`),
        joinedAt: new Date(),
        status: isExternal ? 'external' : 'attended',
        isExternal: isExternal,
        lastHeartbeat: new Date()
      });
    }

    await meeting.save();

    res.json({ 
      success: true, 
      message: 'Attendance marked successfully',
      attendeesCount: meeting.attendees.length,
      joinedAt: new Date(),
      isExternal: isExternal,
      meetingLink: meeting.meetLink
    });
  } catch (error) {
    console.error('Error joining meeting:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Leave meeting
router.post('/:meetingId/leave', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { email, reason = 'manual' } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email is required' 
      });
    }

    const meeting = await Meeting.findById(meetingId);
    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    // Find the attendee by email
    const attendeeIndex = meeting.attendees.findIndex(a => 
      a.email && a.email.toLowerCase() === email.toLowerCase()
    );
    
    if (attendeeIndex === -1) {
      return res.status(404).json({ success: false, error: 'Attendee not found' });
    }

    // Update leave time and calculate duration
    const attendee = meeting.attendees[attendeeIndex];
    attendee.leftAt = new Date();
    
    if (attendee.joinedAt) {
      const durationMs = attendee.leftAt - attendee.joinedAt;
      attendee.duration = Math.round(durationMs / (1000 * 60));
    }
    
    attendee.lastUpdated = new Date();
    
    if (reason !== 'manual') {
      attendee.autoLeave = true;
      attendee.autoLeaveReason = reason;
    }

    await meeting.save();

    res.json({ 
      success: true, 
      message: 'Attendance updated successfully',
      duration: attendee.duration,
      joinedAt: attendee.joinedAt,
      leftAt: attendee.leftAt,
      email: email,
      autoLeave: attendee.autoLeave,
      autoLeaveReason: attendee.autoLeaveReason
    });
  } catch (error) {
    console.error('Error updating attendance:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Auto leave endpoint (for tab/browser close detection)
router.post('/:meetingId/auto-leave', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { email, reason, timestamp } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email is required' 
      });
    }

    const meeting = await Meeting.findById(meetingId);
    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    // Find the attendee by email
    const attendeeIndex = meeting.attendees.findIndex(a => 
      a.email && a.email.toLowerCase() === email.toLowerCase()
    );
    
    if (attendeeIndex === -1) {
      return res.status(404).json({ success: false, error: 'Attendee not found' });
    }

    // Update leave time and calculate duration
    const attendee = meeting.attendees[attendeeIndex];
    const leaveTime = timestamp ? new Date(timestamp) : new Date();
    
    // Only update if not already left
    if (!attendee.leftAt) {
      attendee.leftAt = leaveTime;
      
      if (attendee.joinedAt) {
        const durationMs = leaveTime - attendee.joinedAt;
        attendee.duration = Math.round(durationMs / (1000 * 60));
      }
      
      attendee.lastUpdated = new Date();
      attendee.autoLeave = true;
      attendee.autoLeaveReason = reason || 'unknown';
    }

    await meeting.save();

    res.json({ 
      success: true, 
      message: 'Auto leave recorded successfully',
      duration: attendee.duration,
      joinedAt: attendee.joinedAt,
      leftAt: attendee.leftAt,
      autoLeave: true,
      autoLeaveReason: reason
    });
  } catch (error) {
    console.error('Error recording auto leave:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Heartbeat endpoint
router.post('/:meetingId/heartbeat', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { email, timestamp } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email is required' 
      });
    }

    const meeting = await Meeting.findById(meetingId);
    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    // Find the attendee by email
    const attendeeIndex = meeting.attendees.findIndex(a => 
      a.email && a.email.toLowerCase() === email.toLowerCase()
    );
    
    if (attendeeIndex === -1) {
      return res.status(404).json({ success: false, error: 'Attendee not found' });
    }

    // Update last heartbeat
    const attendee = meeting.attendees[attendeeIndex];
    attendee.lastHeartbeat = new Date();
    attendee.lastUpdated = new Date();

    await meeting.save();

    res.json({ 
      success: true, 
      message: 'Heartbeat received',
      timestamp: attendee.lastHeartbeat
    });
  } catch (error) {
    console.error('Error processing heartbeat:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== MEETING CONTROL (STAFF ONLY) ==========

// Start meeting
router.post('/:meetingId/start', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { staffId, staffName, staffEmail } = req.body;

    if (!staffId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Staff ID is required' 
      });
    }

    const meeting = await Meeting.findById(meetingId);
    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    // Check if staff created this meeting
    if (meeting.createdBy !== staffId) {
      return res.status(403).json({ 
        success: false, 
        error: 'Only the meeting creator can start the meeting' 
      });
    }

    // Check if meeting is already active
    if (meeting.isMeetingActive) {
      return res.status(400).json({ 
        success: false, 
        error: 'Meeting is already active' 
      });
    }

    // Start the meeting
    meeting.actualStartTime = new Date();
    meeting.isMeetingActive = true;
    meeting.status = 'ongoing';
    
    // Update staff info if provided
    if (staffName || staffEmail) {
      meeting.staffInfo = {
        name: staffName || meeting.staffInfo?.name || '',
        email: staffEmail || meeting.staffInfo?.email || ''
      };
    }
    
    await meeting.save();

    res.json({ 
      success: true, 
      message: 'Meeting started successfully',
      actualStartTime: meeting.actualStartTime,
      meetingId: meeting._id,
      isMeetingActive: meeting.isMeetingActive,
      meetingLink: meeting.meetLink
    });
  } catch (error) {
    console.error('Error starting meeting:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// End meeting
router.post('/:meetingId/end', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { staffId } = req.body;

    if (!staffId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Staff ID is required' 
      });
    }

    const meeting = await Meeting.findById(meetingId);
    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    // Check if staff created this meeting
    if (meeting.createdBy !== staffId) {
      return res.status(403).json({ 
        success: false, 
        error: 'Only the meeting creator can end the meeting' 
      });
    }

    // Check if meeting is already ended
    if (!meeting.isMeetingActive) {
      return res.status(400).json({ 
        success: false, 
        error: 'Meeting is not active' 
      });
    }

    // End the meeting
    meeting.actualEndTime = new Date();
    meeting.isMeetingActive = false;
    meeting.status = 'completed';
    
    // Calculate actual duration in minutes
    if (meeting.actualStartTime) {
      const durationMs = meeting.actualEndTime - meeting.actualStartTime;
      meeting.actualDuration = Math.round(durationMs / (1000 * 60));
    }
    
    await meeting.save();

    res.json({ 
      success: true, 
      message: 'Meeting ended successfully',
      actualEndTime: meeting.actualEndTime,
      actualDuration: meeting.actualDuration,
      meetingId: meeting._id,
      isMeetingActive: meeting.isMeetingActive
    });
  } catch (error) {
    console.error('Error ending meeting:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get meeting status
router.get('/:meetingId/status', async (req, res) => {
  try {
    const { meetingId } = req.params;
    
    const meeting = await Meeting.findById(meetingId)
      .select('actualStartTime actualEndTime actualDuration isMeetingActive status createdBy staffInfo');

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    // Calculate current duration if meeting is active
    let currentDuration = meeting.actualDuration;
    if (meeting.isMeetingActive && meeting.actualStartTime) {
      const now = new Date();
      const durationMs = now - meeting.actualStartTime;
      currentDuration = Math.round(durationMs / (1000 * 60));
    }

    res.json({ 
      success: true, 
      meetingId: meeting._id,
      actualStartTime: meeting.actualStartTime,
      actualEndTime: meeting.actualEndTime,
      actualDuration: meeting.actualDuration,
      currentDuration: currentDuration,
      isMeetingActive: meeting.isMeetingActive,
      status: meeting.status,
      createdBy: meeting.createdBy,
      staffInfo: meeting.staffInfo
    });
  } catch (error) {
    console.error('Error fetching meeting status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Force end meeting for all participants
router.post('/:meetingId/force-end-all', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { staffId } = req.body;

    if (!staffId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Staff ID is required' 
      });
    }

    const meeting = await Meeting.findById(meetingId);
    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    // Check if staff created this meeting
    if (meeting.createdBy !== staffId) {
      return res.status(403).json({ 
        success: false, 
        error: 'Only the meeting creator can force end the meeting' 
      });
    }

    // Mark all active attendees as left
    const now = new Date();
    let endedCount = 0;
    
    meeting.attendees.forEach(attendee => {
      if (attendee.joinedAt && !attendee.leftAt) {
        attendee.leftAt = now;
        
        if (attendee.joinedAt) {
          const durationMs = now - attendee.joinedAt;
          attendee.duration = Math.round(durationMs / (1000 * 60));
        }
        
        attendee.autoLeave = true;
        attendee.autoLeaveReason = 'meeting_force_ended_by_staff';
        attendee.lastUpdated = now;
        endedCount++;
      }
    });

    // End the meeting
    meeting.actualEndTime = now;
    meeting.isMeetingActive = false;
    meeting.status = 'completed';
    
    if (meeting.actualStartTime) {
      const durationMs = meeting.actualEndTime - meeting.actualStartTime;
      meeting.actualDuration = Math.round(durationMs / (1000 * 60));
    }

    await meeting.save();

    res.json({ 
      success: true, 
      message: `Meeting force ended successfully. ${endedCount} attendees marked as left.`,
      meetingId: meeting._id,
      endedAttendees: endedCount,
      actualEndTime: meeting.actualEndTime,
      actualDuration: meeting.actualDuration
    });
  } catch (error) {
    console.error('Error force ending meeting:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== ATTENDANCE DATA ==========

// Get meeting attendance
router.get('/:meetingId/attendance', async (req, res) => {
  try {
    const { meetingId } = req.params;
    
    const meeting = await Meeting.findById(meetingId)
      .select('attendees title scheduledTime actualStartTime actualEndTime actualDuration staffInfo');

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    res.json({ 
      success: true, 
      title: meeting.title,
      scheduledTime: meeting.scheduledTime,
      actualStartTime: meeting.actualStartTime,
      actualEndTime: meeting.actualEndTime,
      actualDuration: meeting.actualDuration,
      staffInfo: meeting.staffInfo,
      attendees: meeting.attendees || [],
      totalAttendees: meeting.attendees.length
    });
  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get full attendance with class students
router.get('/:meetingId/full-attendance', async (req, res) => {
  try {
    const { meetingId } = req.params;

    const meeting = await Meeting.findById(meetingId)
      .select('attendees title scheduledTime classId actualStartTime actualEndTime actualDuration staffInfo');

    if (!meeting) return res.status(404).json({ success: false, error: 'Meeting not found' });

    const classData = await Class.findById(meeting.classId).select('students');

    if (!classData) return res.status(404).json({ success: false, error: 'Class not found' });

    const attendanceMap = {};
    meeting.attendees.forEach(att => {
      if (att.email) {
        attendanceMap[att.email.toLowerCase()] = {
          joinedAt: att.joinedAt,
          leftAt: att.leftAt,
          duration: att.duration,
          status: att.status,
          isExternal: att.isExternal,
          name: att.name,
          lastUpdated: att.lastUpdated
        };
      }
    });

    // Combine enrolled students and external attendees
    const enrolledAttendance = classData.students.map(student => ({
      studentId: student.studentId,
      name: student.name || 'Unknown',
      email: student.email,
      rollNumber: student.rollNumber,
      isExternal: false,
      ...(attendanceMap[student.email?.toLowerCase()] || { status: 'not-attended', joinedAt: null, leftAt: null, duration: null })
    }));

    // Add external attendees not in the class
    const externalAttendees = meeting.attendees
      .filter(att => att.isExternal && !classData.students.some(s => 
        s.email && s.email.toLowerCase() === att.email.toLowerCase()))
      .map(att => ({
        email: att.email,
        name: att.name,
        isExternal: true,
        joinedAt: att.joinedAt,
        leftAt: att.leftAt,
        duration: att.duration,
        status: att.status
      }));

    const fullAttendance = [...enrolledAttendance, ...externalAttendees];

    res.json({
      success: true,
      title: meeting.title,
      scheduledTime: meeting.scheduledTime,
      actualStartTime: meeting.actualStartTime,
      actualEndTime: meeting.actualEndTime,
      actualDuration: meeting.actualDuration,
      staffInfo: meeting.staffInfo,
      totalEnrolled: classData.students.length,
      totalAttended: meeting.attendees.length,
      totalExternal: externalAttendees.length,
      attendance: fullAttendance
    });
  } catch (error) {
    console.error('Error fetching full attendance:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== STAFF MEETING ENDPOINTS ==========

// Get all meetings for staff by staffId (CONSOLIDATED - removed duplicate)
router.get('/staff/:staffId', async (req, res) => {
  try {
    const { staffId } = req.params;
    
    const meetings = await Meeting.find({ createdBy: staffId })
      .populate('classId', 'name subject section')
      .sort({ scheduledTime: -1 });

    res.json({ 
      success: true, 
      meetings: meetings.map(m => ({
        _id: m._id,
        title: m.title,
        description: m.description,
        meetLink: m.meetLink,
        meetType: m.meetType,
        scheduledTime: m.scheduledTime,
        duration: m.duration,
        actualStartTime: m.actualStartTime,
        actualEndTime: m.actualEndTime,
        actualDuration: m.actualDuration,
        status: m.status,
        isMeetingActive: m.isMeetingActive,
        classId: m.classId,
        className: m.classId?.name || 'Unknown Class',
        subject: m.classId?.subject || 'N/A',
        section: m.classId?.section || 'N/A',
        createdBy: m.createdBy,
        staffInfo: m.staffInfo,
        attendeesCount: m.attendees?.length || 0
      }))
    });
  } catch (error) {
    console.error('Error fetching staff meetings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get meetings by staff email (CONSOLIDATED - removed duplicate)
router.get('/staff/email/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    const meetings = await Meeting.find({
      $or: [
        { 'staffInfo.email': email.toLowerCase() },
        { createdBy: email }
      ]
    })
    .populate('classId', 'name subject section')
    .sort({ scheduledTime: -1 });

    res.json({ 
      success: true, 
      meetings: meetings.map(m => ({
        _id: m._id,
        title: m.title,
        description: m.description,
        meetLink: m.meetLink,
        meetType: m.meetType,
        scheduledTime: m.scheduledTime,
        duration: m.duration,
        actualStartTime: m.actualStartTime,
        actualEndTime: m.actualEndTime,
        actualDuration: m.actualDuration,
        status: m.status,
        isMeetingActive: m.isMeetingActive,
        classId: m.classId,
        className: m.classId?.name || 'Unknown Class',
        subject: m.classId?.subject || 'N/A',
        section: m.classId?.section || 'N/A',
        createdBy: m.createdBy,
        staffInfo: m.staffInfo,
        attendeesCount: m.attendees?.length || 0
      })),
      count: meetings.length
    });
  } catch (error) {
    console.error('Error fetching meetings by staff email:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get detailed meetings for staff (KEPT)
router.get('/staff/:staffEmail/meetings-detailed', async (req, res) => {
  try {
    const { staffEmail } = req.params;
    const { limit = 50, page = 1 } = req.query;
    const skip = (page - 1) * limit;

    // Find meetings by staff
    const meetings = await Meeting.find({
      $or: [
        { 'staffInfo.email': staffEmail.toLowerCase() },
        { createdBy: staffEmail }
      ]
    })
    .populate('classId', 'name subject section students')
    .sort({ scheduledTime: -1 })
    .skip(skip)
    .limit(parseInt(limit));

    const total = await Meeting.countDocuments({
      $or: [
        { 'staffInfo.email': staffEmail.toLowerCase() },
        { createdBy: staffEmail }
      ]
    });

    // Process each meeting to include detailed attendance
    const detailedMeetings = await Promise.all(
      meetings.map(async (meeting) => {
        const meetingObj = meeting.toObject();
        
        // Calculate attendance statistics
        const attendees = meeting.attendees || [];
        const enrolledAttendees = attendees.filter(a => !a.isExternal);
        const externalAttendees = attendees.filter(a => a.isExternal);
        const activeAttendees = attendees.filter(a => a.joinedAt && !a.leftAt);
        
        // Get class students if class exists
        let classStudents = [];
        if (meeting.classId && meeting.classId.students) {
          classStudents = meeting.classId.students;
        }
        
        // Calculate attendance percentage
        const attendancePercentage = classStudents.length > 0 
          ? Math.round((enrolledAttendees.length / classStudents.length) * 100)
          : 0;

        // Format attendees for display
        const formattedAttendees = attendees.map(attendee => ({
          name: attendee.name,
          email: attendee.email,
          studentId: attendee.studentId,
          joinedAt: attendee.joinedAt,
          leftAt: attendee.leftAt,
          duration: attendee.duration,
          status: attendee.status,
          isExternal: attendee.isExternal,
          autoLeave: attendee.autoLeave,
          lastHeartbeat: attendee.lastHeartbeat
        }));

        return {
          ...meetingObj,
          className: meeting.classId?.name || 'Unknown Class',
          subject: meeting.classId?.subject || 'N/A',
          section: meeting.classId?.section || 'N/A',
          attendanceStats: {
            totalAttendees: attendees.length,
            enrolledAttendees: enrolledAttendees.length,
            externalAttendees: externalAttendees.length,
            activeAttendees: activeAttendees.length,
            classStudents: classStudents.length,
            attendancePercentage: attendancePercentage
          },
          formattedAttendees: formattedAttendees,
          meetingInfo: {
            scheduledDate: meeting.scheduledTime ? new Date(meeting.scheduledTime).toLocaleDateString() : 'N/A',
            scheduledTime: meeting.scheduledTime ? new Date(meeting.scheduledTime).toLocaleTimeString() : 'N/A',
            duration: `${meeting.duration || 60} minutes`,
            actualDuration: meeting.actualDuration ? `${meeting.actualDuration} minutes` : 'N/A',
            status: meeting.status,
            isActive: meeting.isMeetingActive
          }
        };
      })
    );

    res.json({
      success: true,
      meetings: detailedMeetings,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      },
      summary: {
        totalMeetings: total,
        upcomingMeetings: detailedMeetings.filter(m => m.status === 'scheduled').length,
        ongoingMeetings: detailedMeetings.filter(m => m.status === 'ongoing').length,
        completedMeetings: detailedMeetings.filter(m => m.status === 'completed').length,
        totalAttendance: detailedMeetings.reduce((sum, m) => sum + m.attendanceStats.totalAttendees, 0)
      }
    });
  } catch (error) {
    console.error('Error fetching detailed meetings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get staff meeting statistics (CONSOLIDATED)
router.get('/staff/:identifier/stats', async (req, res) => {
  try {
    const { identifier } = req.params;
    
    // Determine if identifier is email or ID
    const isEmail = identifier.includes('@');
    
    let query;
    if (isEmail) {
      query = {
        $or: [
          { 'staffInfo.email': identifier.toLowerCase() },
          { createdBy: identifier }
        ]
      };
    } else {
      query = { createdBy: identifier };
    }
    
    const meetings = await Meeting.find(query);

    const stats = {
      totalMeetings: meetings.length,
      byStatus: {
        scheduled: meetings.filter(m => m.status === 'scheduled').length,
        ongoing: meetings.filter(m => m.status === 'ongoing').length,
        completed: meetings.filter(m => m.status === 'completed').length,
        cancelled: meetings.filter(m => m.status === 'cancelled').length
      },
      byType: {},
      attendance: {
        totalAttendees: 0,
        averagePerMeeting: 0,
        totalDuration: 0
      },
      recentActivity: []
    };

    // Calculate type distribution
    meetings.forEach(meeting => {
      const type = meeting.meetType || 'unknown';
      stats.byType[type] = (stats.byType[type] || 0) + 1;
      
      // Calculate attendance
      stats.attendance.totalAttendees += meeting.attendees?.length || 0;
      stats.attendance.totalDuration += meeting.actualDuration || 0;
    });

    stats.attendance.averagePerMeeting = meetings.length > 0 
      ? Math.round(stats.attendance.totalAttendees / meetings.length)
      : 0;

    // Get recent meetings (last 5)
    const recentMeetings = await Meeting.find(query)
      .sort({ scheduledTime: -1 })
      .limit(5)
      .select('title scheduledTime status attendees.length');

    stats.recentActivity = recentMeetings.map(m => ({
      title: m.title,
      date: m.scheduledTime,
      status: m.status,
      attendees: m.attendees?.length || 0
    }));

    res.json({
      success: true,
      identifier,
      stats
    });
  } catch (error) {
    console.error('Error fetching staff meeting stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== ANALYTICS & REPORTS ==========

// Get meeting analytics
router.get('/:meetingId/analytics', async (req, res) => {
  try {
    const { meetingId } = req.params;
    
    const meeting = await Meeting.findById(meetingId)
      .select('title scheduledTime actualStartTime actualEndTime actualDuration attendees staffInfo');

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    // Calculate detailed analytics
    const attendees = meeting.attendees || [];
    const enrolledAttendees = attendees.filter(a => !a.isExternal);
    const externalAttendees = attendees.filter(a => a.isExternal);
    
    // Calculate attendance duration statistics
    const durations = attendees
      .filter(a => a.duration && a.duration > 0)
      .map(a => a.duration);
    
    const durationStats = {
      min: durations.length > 0 ? Math.min(...durations) : 0,
      max: durations.length > 0 ? Math.max(...durations) : 0,
      average: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      total: durations.reduce((a, b) => a + b, 0)
    };
    
    // Calculate class size if classId exists
    let totalEnrolled = 0;
    if (meeting.classId) {
      try {
        const classData = await Class.findById(meeting.classId).select('students');
        totalEnrolled = classData?.students?.length || 0;
      } catch (err) {
        console.error('Error fetching class data:', err);
      }
    }
    
    // Attendance score calculation
    const attendanceScores = attendees.map(attendee => {
      let score = 100;
      
      // Deduct for auto-leave
      if (attendee.autoLeave) {
        score -= 20;
      }
      
      return {
        email: attendee.email,
        name: attendee.name,
        score: Math.max(0, Math.min(100, score)),
        duration: attendee.duration,
        joinTime: attendee.joinedAt,
        leaveTime: attendee.leftAt,
        autoLeave: attendee.autoLeave
      };
    });
    
    const analytics = {
      meetingInfo: {
        title: meeting.title,
        scheduledTime: meeting.scheduledTime,
        actualStartTime: meeting.actualStartTime,
        actualEndTime: meeting.actualEndTime,
        actualDuration: meeting.actualDuration,
        staffInfo: meeting.staffInfo
      },
      attendance: {
        totalEnrolled: totalEnrolled,
        totalAttended: enrolledAttendees.length,
        totalExternal: externalAttendees.length,
        attendancePercentage: totalEnrolled > 0 ? Math.round((enrolledAttendees.length / totalEnrolled) * 100) : 0,
        enrolledAttendance: enrolledAttendees.length,
        externalAttendance: externalAttendees.length
      },
      duration: durationStats,
      attendanceScores: attendanceScores,
      summary: {
        averageScore: attendanceScores.length > 0
          ? Math.round(attendanceScores.reduce((sum, s) => sum + s.score, 0) / attendanceScores.length)
          : 0,
        topPerformers: attendanceScores
          .sort((a, b) => b.score - a.score)
          .slice(0, 5),
        lowPerformers: attendanceScores
          .sort((a, b) => a.score - b.score)
          .slice(0, 5)
      }
    };
    
    res.json({
      success: true,
      analytics
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== UTILITY ENDPOINTS ==========

// Check for inactive attendees
router.post('/:meetingId/check-inactive', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const meeting = await Meeting.findById(meetingId);

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const now = new Date();
    const inactiveThreshold = 5 * 60 * 1000; // 5 minutes
    let markedInactive = 0;

    meeting.attendees.forEach(attendee => {
      // If attendee has joined but hasn't left and no heartbeat in threshold
      if (attendee.joinedAt && !attendee.leftAt && attendee.lastHeartbeat) {
        const timeSinceHeartbeat = now - new Date(attendee.lastHeartbeat);
        if (timeSinceHeartbeat > inactiveThreshold) {
          // Auto leave due to inactivity
          attendee.leftAt = new Date(attendee.lastHeartbeat.getTime() + inactiveThreshold);
          const durationMs = attendee.leftAt - attendee.joinedAt;
          attendee.duration = Math.round(durationMs / (1000 * 60));
          attendee.autoLeave = true;
          attendee.autoLeaveReason = 'inactivity';
          attendee.lastUpdated = new Date();
          markedInactive++;
        }
      }
    });

    if (markedInactive > 0) {
      await meeting.save();
    }

    res.json({ 
      success: true, 
      message: `Marked ${markedInactive} attendees as inactive`,
      markedInactive
    });
  } catch (error) {
    console.error('Error checking inactive attendees:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Real-time meeting status
router.get('/:meetingId/real-time-status', async (req, res) => {
  try {
    const { meetingId } = req.params;
    
    const meeting = await Meeting.findById(meetingId)
      .select('title scheduledTime actualStartTime actualEndTime actualDuration isMeetingActive status attendees');

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    // Calculate active attendees
    const activeAttendees = meeting.attendees.filter(a => 
      a.joinedAt && !a.leftAt
    );

    res.json({
      success: true,
      meetingId: meeting._id,
      title: meeting.title,
      isActive: meeting.isMeetingActive,
      actualStartTime: meeting.actualStartTime,
      actualEndTime: meeting.actualEndTime,
      scheduledTime: meeting.scheduledTime,
      actualDuration: meeting.actualDuration,
      activeAttendees: activeAttendees.length,
      totalAttendees: meeting.attendees.length
    });
  } catch (error) {
    console.error('Error fetching real-time status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;