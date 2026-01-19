// routes/staffMeetings.js
const express = require('express');
const router = express.Router();
const Meeting = require('../models/Meeting');
const Staff = require('../models/Staff');

// Get all meetings for a specific staff with detailed attendance
router.get('/:staffEmail/meetings-with-attendance', async (req, res) => {
  try {
    const { staffEmail } = req.params;
    
    // Find staff by email to get staffId
    const staff = await Staff.findOne({ email: staffEmail.toLowerCase() });
    if (!staff) {
      return res.status(404).json({ 
        success: false, 
        error: 'Staff not found' 
      });
    }
    
    // Find meetings created by this staff
    const meetings = await Meeting.find({ 
      $or: [
        { createdBy: staff._id.toString() },
        { createdBy: staffEmail },
        { 'staffInfo.email': staffEmail.toLowerCase() }
      ]
    })
    .sort({ scheduledTime: -1 });
    
    // Fetch attendance for each meeting
    const meetingsWithAttendance = await Promise.all(
      meetings.map(async (meeting) => {
        const meetingObj = meeting.toObject();
        
        // Calculate attendance stats
        const enrolledAttendees = meeting.attendees.filter(a => !a.isExternal);
        const externalAttendees = meeting.attendees.filter(a => a.isExternal);
        const activeAttendees = meeting.attendees.filter(a => 
          a.joinedAt && !a.leftAt
        );
        
        return {
          ...meetingObj,
          attendanceStats: {
            total: meeting.attendees.length,
            enrolled: enrolledAttendees.length,
            external: externalAttendees.length,
            active: activeAttendees.length,
            attendancePercentage: meeting.attendees.length > 0 ? 
              Math.round((enrolledAttendees.length / meeting.attendees.length) * 100) : 0
          },
          attendees: meeting.attendees.map(attendee => ({
            name: attendee.name,
            email: attendee.email,
            joinedAt: attendee.joinedAt,
            leftAt: attendee.leftAt,
            duration: attendee.duration,
            status: attendee.status,
            isExternal: attendee.isExternal
          }))
        };
      })
    );
    
    res.json({
      success: true,
      staff: {
        name: staff.name,
        email: staff.email,
        department: staff.department
      },
      meetings: meetingsWithAttendance,
      totalMeetings: meetingsWithAttendance.length,
      summary: {
        totalAttendees: meetingsWithAttendance.reduce((sum, m) => sum + m.attendees.length, 0),
        averageAttendance: meetingsWithAttendance.length > 0 ? 
          Math.round(meetingsWithAttendance.reduce((sum, m) => sum + m.attendees.length, 0) / meetingsWithAttendance.length) : 0,
        completedMeetings: meetingsWithAttendance.filter(m => m.status === 'completed').length,
        ongoingMeetings: meetingsWithAttendance.filter(m => m.status === 'ongoing').length
      }
    });
  } catch (error) {
    console.error('Error fetching staff meetings with attendance:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;