const express = require('express');
const router = express.Router();
const Meeting = require('../models/Meeting');
const Class = require('../models/Class');
const { fetchGoogleMeetAttendance } = require('../services/googleMeetService');

router.post('/sync/:meetingId', async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.meetingId);
    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }

    // Extract Meet Space ID from link
    const match = meeting.meetLink.match(/meet.google.com\/([a-zA-Z0-9-]+)/);
    if (!match) {
      return res.status(400).json({ success: false, error: 'Invalid Meet link' });
    }

    const meetSpaceId = match[1];
    const googleAttendance = await fetchGoogleMeetAttendance(meetSpaceId);

    const classData = await Class.findById(meeting.classId);
    if (!classData) {
      return res.status(404).json({ success: false, error: 'Class not found' });
    }

    meeting.attendees = [];

    classData.students.forEach(student => {
      const record = googleAttendance.find(
        g => g.email?.toLowerCase() === student.email?.toLowerCase()
      );

      if (record) {
        meeting.attendees.push({
          studentId: student.studentId,
          joinedAt: record.joinTime,
          leftAt: record.leaveTime,
          duration: record.duration,
          status: 'attended'
        });
      }
    });

    meeting.actualDuration = Math.max(
      ...meeting.attendees.map(a => a.duration || 0),
      0
    );
    meeting.status = 'completed';
    meeting.isMeetingActive = false;

    await meeting.save();

    res.json({
      success: true,
      syncedCount: meeting.attendees.length
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
