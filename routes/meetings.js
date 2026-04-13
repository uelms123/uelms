/* eslint-disable no-unused-vars */
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Meeting = require('../models/Meeting');
const Class = require('../models/Class');
const axios = require('axios');
const moment = require('moment');
const Staff = require('../models/Staff');
const Student = require('../models/Students');

// ========== HELPERS ==========

const normalizeEmail = (email = '') => String(email).trim().toLowerCase();

const safeObjectId = (value) => {
  try {
    return mongoose.Types.ObjectId.isValid(value);
  } catch {
    return false;
  }
};

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

const inferSubjectFromMeeting = (meeting) => {
  return (
    cleanDisplayValue(meeting.subject) ||
    cleanDisplayValue(meeting.courseCode) ||
    cleanDisplayValue(meeting.title) ||
    'General'
  );
};

const computeMeetingStatus = (meeting) => {
  const now = new Date();
  const scheduledStart = meeting.scheduledTime ? new Date(meeting.scheduledTime) : null;
  const actualStart = meeting.actualStartTime ? new Date(meeting.actualStartTime) : null;
  const actualEnd = meeting.actualEndTime ? new Date(meeting.actualEndTime) : null;

  if (meeting.status === 'completed' || actualEnd) return 'past';

  if ((meeting.isMeetingActive || meeting.status === 'ongoing') && actualStart && !actualEnd) {
    return 'live';
  }

  if (scheduledStart && scheduledStart > now && !meeting.isMeetingActive && !actualStart) {
    return 'upcoming';
  }

  if (scheduledStart && scheduledStart <= now && !meeting.isMeetingActive) {
    return 'past';
  }

  return 'upcoming';
};

const detectUserType = async (attendee) => {
  try {
    if (attendee.isExternal) return 'external';

    const email = normalizeEmail(attendee.email || '');
    if (!email) return 'student';

    const staffExists = await Staff.exists({ email });
    if (staffExists) return 'staff';

    const studentExists = await Student.exists({ email });
    if (studentExists) return 'student';

    return 'student';
  } catch (error) {
    console.error('detectUserType error:', error.message);
    return attendee.isExternal ? 'external' : 'student';
  }
};

const getMeetingClassInfo = async (meeting) => {
  try {
    if (meeting.classId && typeof meeting.classId === 'object' && meeting.classId.name) {
      return meeting.classId;
    }

    if (meeting.classId && safeObjectId(meeting.classId)) {
      const classInfo = await Class.findById(meeting.classId)
        .select('name subject section students')
        .lean();
      return classInfo || null;
    }

    return null;
  } catch (error) {
    console.error('Error resolving class info:', error.message);
    return null;
  }
};

const resolveMeetingShape = async (meeting, staffMap = {}) => {
  let classInfo = null;

  if (meeting.classId && typeof meeting.classId === 'object' && meeting.classId.name) {
    classInfo = meeting.classId;
  } else if (meeting.classId && safeObjectId(meeting.classId)) {
    classInfo = await Class.findById(meeting.classId)
      .select('name subject section students')
      .lean();
  }

  const staffEmail = normalizeEmail(meeting.staffInfo?.email || '');
  const staffDoc = staffMap[staffEmail];

  const resolvedStaffName =
    cleanDisplayValue(meeting.staffInfo?.name) ||
    cleanDisplayValue(staffDoc?.name) ||
    cleanDisplayValue(staffEmail ? staffEmail.split('@')[0] : '') ||
    'Unknown Staff';

  const resolvedStaffEmail =
    cleanDisplayValue(meeting.staffInfo?.email) ||
    cleanDisplayValue(staffDoc?.email) ||
    'N/A';

  const resolvedClassName =
    cleanDisplayValue(classInfo?.name) ||
    cleanDisplayValue(meeting.className) ||
    cleanDisplayValue(meeting.description) ||
    'Unknown Class';

  const resolvedSubject =
    cleanDisplayValue(classInfo?.subject) ||
    inferSubjectFromMeeting(meeting);

  const resolvedSection =
    cleanDisplayValue(classInfo?.section) ||
    cleanDisplayValue(meeting.section) ||
    'N/A';

  const attendees = Array.isArray(meeting.attendees) ? meeting.attendees : [];
  const studentAttendees = attendees.filter((a) => !a.isExternal);
  const totalStudents = Array.isArray(classInfo?.students) ? classInfo.students.length : 0;
  const computedStatus = computeMeetingStatus(meeting);

  return {
    ...meeting,
    classInfo: classInfo || null,
    className: resolvedClassName,
    subject: resolvedSubject,
    section: resolvedSection,
    totalStudents,
    computedStatus,
    staffInfo: {
      name: resolvedStaffName,
      email: resolvedStaffEmail
    },
    attendanceStats: {
      totalAttendees: attendees.length,
      classStudents: totalStudents,
      attendancePercentage:
        totalStudents > 0
          ? Math.round((studentAttendees.length / totalStudents) * 100)
          : 0
    }
  };
};

// ========== ADMIN / MAINTENANCE ==========

router.get('/admin/all-detailed', async (req, res) => {
  try {
    const meetings = await Meeting.find({})
      .populate('classId', 'name subject section students')
      .sort({ scheduledTime: -1 })
      .lean();

    const staffEmails = [
      ...new Set(
        meetings
          .map((m) => normalizeEmail(m.staffInfo?.email || ''))
          .filter(Boolean)
      )
    ];

    const staffDocs = await Staff.find({
      email: { $in: staffEmails }
    })
      .select('name email')
      .lean();

    const staffMap = {};
    staffDocs.forEach((s) => {
      staffMap[normalizeEmail(s.email)] = s;
    });

    const result = await Promise.all(meetings.map((meeting) => resolveMeetingShape(meeting, staffMap)));

    res.json({
      success: true,
      meetings: result
    });
  } catch (error) {
    console.error('Error fetching admin all detailed meetings:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/admin/fix-stuck-live-meetings', async (req, res) => {
  try {
    const now = new Date();

    const stuckMeetings = await Meeting.find({
      isMeetingActive: true,
      status: 'ongoing',
      $or: [
  { scheduledTime: { $lt: now } },
  { actualStartTime: { $lt: new Date(now.getTime() - 2 * 60 * 60 * 1000) } }
]
    });

    let fixed = 0;

    for (const meeting of stuckMeetings) {
      meeting.isMeetingActive = false;
      meeting.status = 'completed';

      if (!meeting.actualEndTime) {
        meeting.actualEndTime = now;
      }

      if (meeting.actualStartTime && meeting.actualEndTime) {
        const durationMs = new Date(meeting.actualEndTime) - new Date(meeting.actualStartTime);
        meeting.actualDuration = Math.max(0, Math.round(durationMs / (1000 * 60)));
      }

      await meeting.save();
      fixed++;
    }

    res.json({
      success: true,
      message: `Fixed ${fixed} stuck live meetings`,
      fixed
    });
  } catch (error) {
    console.error('Error fixing stuck live meetings:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ========== BASIC MEETING CRUD ==========

// Create a new meeting
router.post('/', async (req, res) => {
  try {
    const {
      classId,
      title,
      description,
      courseCode,
      meetLink,
      meetType,
      scheduledTime,
      duration,
      createdBy,
      staffName,
      staffEmail
    } = req.body;

    if (!classId || !title || !meetLink || !meetType || !scheduledTime || !createdBy) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: classId, title, meetLink, meetType, scheduledTime, createdBy'
      });
    }

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
        email: normalizeEmail(staffEmail || '')
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
      .populate('classId', 'name subject section students')
      .sort({ scheduledTime: -1 })
      .lean();

    const shaped = await Promise.all(meetings.map((meeting) => resolveMeetingShape(meeting)));

    res.json({ success: true, meetings: shaped });
  } catch (error) {
    console.error('Error fetching meetings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Duration info for reports
router.get('/:meetingId/duration-info', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const meeting = await Meeting.findById(meetingId).populate('classId', 'name subject section students');

    if (!meeting) {
      return res.status(404).json({
        success: false,
        error: 'Meeting not found'
      });
    }

    const attendees = Array.isArray(meeting.attendees) ? meeting.attendees : [];
    const attendeesWithDuration = attendees.filter((a) => a.duration && a.duration > 0);
    const avgAttendanceDuration =
      attendeesWithDuration.length > 0
        ? Math.round(
            attendeesWithDuration.reduce((sum, a) => sum + a.duration, 0) /
              attendeesWithDuration.length
          )
        : 0;

    const scheduledDuration = meeting.duration || 60;

    res.json({
      success: true,
      meetingId: meeting._id,
      title: meeting.title,
      scheduledTime: meeting.scheduledTime,
      actualStartTime: meeting.actualStartTime,
      actualEndTime: meeting.actualEndTime,
      actualDuration: meeting.actualDuration || 0,
      scheduledDuration,
      averageAttendanceDuration: avgAttendanceDuration,
      staffInfo: {
        name:
          cleanDisplayValue(meeting.staffInfo?.name) ||
          cleanDisplayValue(meeting.staffInfo?.email?.split('@')[0]) ||
          'Unknown Staff',
        email: cleanDisplayValue(meeting.staffInfo?.email) || 'N/A'
      },
      classInfo: {
        name: cleanDisplayValue(meeting.classId?.name) || 'Unknown Class',
        subject: cleanDisplayValue(meeting.classId?.subject) || inferSubjectFromMeeting(meeting),
        section: cleanDisplayValue(meeting.classId?.section) || 'N/A'
      }
    });
  } catch (error) {
    console.error('Error fetching duration info:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== STAFF MEETING ENDPOINTS ==========

// Get meetings by staff email
router.get('/staff/email/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const normalizedEmail = normalizeEmail(email);

    const meetings = await Meeting.find({
      $or: [
        { 'staffInfo.email': normalizedEmail },
        { createdBy: email },
        { createdBy: normalizedEmail }
      ]
    })
      .populate('classId', 'name subject section students')
      .sort({ scheduledTime: -1 })
      .lean();

    const shaped = await Promise.all(meetings.map((meeting) => resolveMeetingShape(meeting)));

    res.json({
      success: true,
      meetings: shaped,
      count: shaped.length
    });
  } catch (error) {
    console.error('Error fetching meetings by staff email:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all meetings for staff by staffId
router.get('/staff/:staffId', async (req, res) => {
  try {
    const { staffId } = req.params;

    const meetings = await Meeting.find({ createdBy: staffId })
      .populate('classId', 'name subject section students')
      .sort({ scheduledTime: -1 })
      .lean();

    const shaped = await Promise.all(meetings.map((meeting) => resolveMeetingShape(meeting)));

    res.json({
      success: true,
      meetings: shaped
    });
  } catch (error) {
    console.error('Error fetching staff meetings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get detailed meetings for staff
router.get('/staff/:staffEmail/meetings-detailed', async (req, res) => {
  try {
    const { staffEmail } = req.params;
    const normalizedEmail = normalizeEmail(staffEmail);
    const limit = Math.max(parseInt(req.query.limit, 10) || 50, 1);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const query = {
      $or: [
        { 'staffInfo.email': normalizedEmail },
        { createdBy: staffEmail },
        { createdBy: normalizedEmail }
      ]
    };

    const meetings = await Meeting.find(query)
      .populate('classId', 'name subject section students')
      .sort({ scheduledTime: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Meeting.countDocuments(query);

    const detailedMeetings = await Promise.all(
      meetings.map(async (meeting) => {
        const shaped = await resolveMeetingShape(meeting);
        const attendees = Array.isArray(meeting.attendees) ? meeting.attendees : [];
        const enrolledAttendees = attendees.filter((a) => !a.isExternal);
        const externalAttendees = attendees.filter((a) => a.isExternal);
        const activeAttendees = attendees.filter((a) => a.joinedAt && !a.leftAt);
        const classStudents = Array.isArray(shaped.classInfo?.students) ? shaped.classInfo.students : [];

        const attendancePercentage =
          classStudents.length > 0
            ? Math.round((enrolledAttendees.length / classStudents.length) * 100)
            : 0;

        const formattedAttendees = await Promise.all(
          attendees.map(async (attendee) => {
            const userType = await detectUserType(attendee);
            return {
              name: attendee.name || '',
              email: attendee.email || '',
              studentId: attendee.studentId || '',
              joinedAt: attendee.joinedAt || null,
              leftAt: attendee.leftAt || null,
              duration: attendee.duration ?? null,
              status: attendee.status || '',
              isExternal: !!attendee.isExternal,
              userType,
              autoLeave: !!attendee.autoLeave,
              autoLeaveReason: attendee.autoLeaveReason || null,
              lastHeartbeat: attendee.lastHeartbeat || null
            };
          })
        );

        return {
          ...shaped,
          attendanceStats: {
            totalAttendees: attendees.length,
            enrolledAttendees: enrolledAttendees.length,
            externalAttendees: externalAttendees.length,
            activeAttendees: activeAttendees.length,
            classStudents: classStudents.length,
            attendancePercentage
          },
          formattedAttendees,
          meetingInfo: {
            scheduledDate: meeting.scheduledTime
              ? new Date(meeting.scheduledTime).toLocaleDateString()
              : 'N/A',
            scheduledTime: meeting.scheduledTime
              ? new Date(meeting.scheduledTime).toLocaleTimeString()
              : 'N/A',
            duration: `${meeting.duration || 60} minutes`,
            actualDuration: meeting.actualDuration
              ? `${meeting.actualDuration} minutes`
              : 'N/A',
            status: meeting.status || 'scheduled',
            isActive: !!meeting.isMeetingActive
          }
        };
      })
    );

    res.json({
      success: true,
      meetings: detailedMeetings,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      },
      summary: {
        totalMeetings: total,
        upcomingMeetings: detailedMeetings.filter((m) => m.computedStatus === 'upcoming').length,
        ongoingMeetings: detailedMeetings.filter((m) => m.computedStatus === 'live').length,
        completedMeetings: detailedMeetings.filter((m) => m.computedStatus === 'past').length,
        totalAttendance: detailedMeetings.reduce(
          (sum, m) => sum + (m.attendanceStats?.totalAttendees || 0),
          0
        )
      }
    });
  } catch (error) {
    console.error('Error fetching detailed meetings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get staff meeting statistics
router.get('/staff/:identifier/stats', async (req, res) => {
  try {
    const { identifier } = req.params;
    const isEmail = identifier.includes('@');

    let query;
    if (isEmail) {
      query = {
        $or: [
          { 'staffInfo.email': normalizeEmail(identifier) },
          { createdBy: identifier },
          { createdBy: normalizeEmail(identifier) }
        ]
      };
    } else {
      query = { createdBy: identifier };
    }

    const meetings = await Meeting.find(query);

    const stats = {
      totalMeetings: meetings.length,
      byStatus: {
        scheduled: meetings.filter((m) => computeMeetingStatus(m) === 'upcoming').length,
        ongoing: meetings.filter((m) => computeMeetingStatus(m) === 'live').length,
        completed: meetings.filter((m) => computeMeetingStatus(m) === 'past').length,
        cancelled: meetings.filter((m) => m.status === 'cancelled').length
      },
      byType: {},
      attendance: {
        totalAttendees: 0,
        averagePerMeeting: 0,
        totalDuration: 0
      },
      recentActivity: []
    };

    meetings.forEach((meeting) => {
      const type = meeting.meetType || 'unknown';
      stats.byType[type] = (stats.byType[type] || 0) + 1;
      stats.attendance.totalAttendees += meeting.attendees?.length || 0;
      stats.attendance.totalDuration += meeting.actualDuration || 0;
    });

    stats.attendance.averagePerMeeting =
      meetings.length > 0
        ? Math.round(stats.attendance.totalAttendees / meetings.length)
        : 0;

    const recentMeetings = await Meeting.find(query)
      .sort({ scheduledTime: -1 })
      .limit(5)
      .select('title scheduledTime status attendees');

    stats.recentActivity = recentMeetings.map((m) => ({
      title: m.title,
      date: m.scheduledTime,
      status: computeMeetingStatus(m),
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

    const normalizedEmail = normalizeEmail(email);

    const existingAttendeeIndex = meeting.attendees.findIndex(
      (a) => a.email && normalizeEmail(a.email) === normalizedEmail
    );

    if (existingAttendeeIndex !== -1) {
      const attendee = meeting.attendees[existingAttendeeIndex];

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

      attendee.joinedAt = new Date();
      attendee.leftAt = null;
      attendee.duration = null;
      attendee.status = isExternal ? 'external' : 'attended';
      attendee.lastUpdated = new Date();
      attendee.lastHeartbeat = new Date();
      attendee.autoLeave = false;
      attendee.autoLeaveReason = null;
    } else {
      meeting.attendees.push({
        studentId: isExternal ? null : studentId,
        email: normalizedEmail,
        name: name || (studentId ? `Student ${studentId}` : `Guest ${normalizedEmail.split('@')[0]}`),
        joinedAt: new Date(),
        status: isExternal ? 'external' : 'attended',
        isExternal,
        lastHeartbeat: new Date()
      });
    }

    await meeting.save();

    res.json({
      success: true,
      message: 'Attendance marked successfully',
      attendeesCount: meeting.attendees.length,
      joinedAt: new Date(),
      isExternal,
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

    const normalizedEmail = normalizeEmail(email);

    const attendeeIndex = meeting.attendees.findIndex(
      (a) => a.email && normalizeEmail(a.email) === normalizedEmail
    );

    if (attendeeIndex === -1) {
      return res.status(404).json({ success: false, error: 'Attendee not found' });
    }

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
      email: normalizedEmail,
      autoLeave: attendee.autoLeave,
      autoLeaveReason: attendee.autoLeaveReason
    });
  } catch (error) {
    console.error('Error updating attendance:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Auto leave endpoint
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

    const normalizedEmail = normalizeEmail(email);

    const attendeeIndex = meeting.attendees.findIndex(
      (a) => a.email && normalizeEmail(a.email) === normalizedEmail
    );

    if (attendeeIndex === -1) {
      return res.status(404).json({ success: false, error: 'Attendee not found' });
    }

    const attendee = meeting.attendees[attendeeIndex];
    const leaveTime = timestamp ? new Date(timestamp) : new Date();

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
    const { email } = req.body;

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

    const normalizedEmail = normalizeEmail(email);

    const attendeeIndex = meeting.attendees.findIndex(
      (a) => a.email && normalizeEmail(a.email) === normalizedEmail
    );

    if (attendeeIndex === -1) {
      return res.status(404).json({ success: false, error: 'Attendee not found' });
    }

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

    if (meeting.createdBy !== staffId) {
      return res.status(403).json({
        success: false,
        error: 'Only the meeting creator can start the meeting'
      });
    }

    if (meeting.isMeetingActive) {
      return res.status(400).json({
        success: false,
        error: 'Meeting is already active'
      });
    }

    meeting.actualStartTime = new Date();
    meeting.isMeetingActive = true;
    meeting.status = 'ongoing';

    if (staffName || staffEmail) {
      meeting.staffInfo = {
        name: staffName || meeting.staffInfo?.name || '',
        email: normalizeEmail(staffEmail || meeting.staffInfo?.email || '')
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

    if (meeting.createdBy !== staffId) {
      return res.status(403).json({
        success: false,
        error: 'Only the meeting creator can end the meeting'
      });
    }

    if (!meeting.isMeetingActive) {
      return res.status(400).json({
        success: false,
        error: 'Meeting is not active'
      });
    }

    meeting.actualEndTime = new Date();
    meeting.isMeetingActive = false;
    meeting.status = 'completed';

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
      currentDuration,
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

    if (meeting.createdBy !== staffId) {
      return res.status(403).json({
        success: false,
        error: 'Only the meeting creator can force end the meeting'
      });
    }

    const now = new Date();
    let endedCount = 0;

    meeting.attendees.forEach((attendee) => {
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

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const classData = await Class.findById(meeting.classId).select('students');

    if (!classData) {
      return res.status(404).json({ success: false, error: 'Class not found' });
    }

    const attendanceMap = {};
    meeting.attendees.forEach((att) => {
      if (att.email) {
        attendanceMap[normalizeEmail(att.email)] = {
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

    const enrolledAttendance = classData.students.map((student) => ({
      studentId: student.studentId,
      name: student.name || 'Unknown',
      email: student.email,
      rollNumber: student.rollNumber,
      isExternal: false,
      ...(attendanceMap[normalizeEmail(student.email)] || {
        status: 'not-attended',
        joinedAt: null,
        leftAt: null,
        duration: null
      })
    }));

    const externalAttendees = meeting.attendees
      .filter(
        (att) =>
          att.isExternal &&
          !classData.students.some(
            (s) => s.email && normalizeEmail(s.email) === normalizeEmail(att.email)
          )
      )
      .map((att) => ({
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

// ========== ANALYTICS & REPORTS ==========

// Get meeting analytics
router.get('/:meetingId/analytics', async (req, res) => {
  try {
    const { meetingId } = req.params;

    const meeting = await Meeting.findById(meetingId)
      .select('title scheduledTime actualStartTime actualEndTime actualDuration attendees staffInfo classId');

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const attendees = meeting.attendees || [];
    const enrolledAttendees = attendees.filter((a) => !a.isExternal);
    const externalAttendees = attendees.filter((a) => a.isExternal);

    const durations = attendees
      .filter((a) => a.duration && a.duration > 0)
      .map((a) => a.duration);

    const durationStats = {
      min: durations.length > 0 ? Math.min(...durations) : 0,
      max: durations.length > 0 ? Math.max(...durations) : 0,
      average:
        durations.length > 0
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
          : 0,
      total: durations.reduce((a, b) => a + b, 0)
    };

    let totalEnrolled = 0;
    if (meeting.classId) {
      try {
        const classData = await Class.findById(meeting.classId).select('students');
        totalEnrolled = classData?.students?.length || 0;
      } catch (err) {
        console.error('Error fetching class data:', err);
      }
    }

    const attendanceScores = attendees.map((attendee) => {
      let score = 100;
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
        totalEnrolled,
        totalAttended: enrolledAttendees.length,
        totalExternal: externalAttendees.length,
        attendancePercentage:
          totalEnrolled > 0
            ? Math.round((enrolledAttendees.length / totalEnrolled) * 100)
            : 0,
        enrolledAttendance: enrolledAttendees.length,
        externalAttendance: externalAttendees.length
      },
      duration: durationStats,
      attendanceScores,
      summary: {
        averageScore:
          attendanceScores.length > 0
            ? Math.round(
                attendanceScores.reduce((sum, s) => sum + s.score, 0) /
                  attendanceScores.length
              )
            : 0,
        topPerformers: [...attendanceScores].sort((a, b) => b.score - a.score).slice(0, 5),
        lowPerformers: [...attendanceScores].sort((a, b) => a.score - b.score).slice(0, 5)
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
    const inactiveThreshold = 5 * 60 * 1000;
    let markedInactive = 0;

    meeting.attendees.forEach((attendee) => {
      if (attendee.joinedAt && !attendee.leftAt && attendee.lastHeartbeat) {
        const timeSinceHeartbeat = now - new Date(attendee.lastHeartbeat);
        if (timeSinceHeartbeat > inactiveThreshold) {
          attendee.leftAt = new Date(new Date(attendee.lastHeartbeat).getTime() + inactiveThreshold);
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

    const activeAttendees = meeting.attendees.filter((a) => a.joinedAt && !a.leftAt);

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

// ========== GENERIC MEETING ROUTES AT END ==========

// Get meeting details
router.get('/:meetingId', async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.meetingId).populate(
      'classId',
      'name subject section students'
    );

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const shaped = await resolveMeetingShape(meeting.toObject());

    res.json({ success: true, meeting: shaped });
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

    if (updateData.scheduledTime) {
      updateData.scheduledTime = new Date(updateData.scheduledTime);
    }

    const meeting = await Meeting.findByIdAndUpdate(meetingId, updateData, {
      new: true,
      runValidators: true
    });

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

module.exports = router;