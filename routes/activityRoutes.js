const express = require('express');
const router = express.Router();
const Activity = require('../models/StudentActivity');
const Class = require('../models/Class');
const Student = require('../models/Students');

// Helper function to extract name from email
function extractNameFromEmail(email) {
  if (!email) return 'Unknown User';
  const username = email.split('@')[0];
  const cleanName = username.replace(/[0-9._-]+/g, ' ');
  return cleanName.split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .trim() || 'Unknown User';
}

// Build sessions only from LOGIN records
function buildSessionsFromLoginRecords(loginActivities, studentNameMap = {}) {
  const sessions = loginActivities
    .filter(act => act && act.timestamp)
    .map(act => ({
      userId: act.userId,
      email: act.email,
      name: studentNameMap[act.email?.toLowerCase()] || extractNameFromEmail(act.email),
      inTime: act.timestamp,
      outTime: act.loggedOut ? (act.logoutTime || null) : null,
      sessionId: act._id
    }))
    .sort((a, b) => new Date(b.inTime) - new Date(a.inTime));

  return sessions;
}

router.post('/log', async (req, res) => {
  const { userId, email, type } = req.body;

  if (!userId || !email || !['login', 'logout', 'password_reset'].includes(type)) {
    console.error('Invalid request data:', { userId, email, type });
    return res.status(400).json({ error: 'Invalid request data' });
  }

  const normalizedEmail = email.toLowerCase();

  try {
    if (type === 'login') {
      // Check if already has active login by userId OR email
      const activeSession = await Activity.findOne({
        type: 'login',
        loggedOut: false,
        $or: [
          { userId },
          { email: normalizedEmail }
        ]
      }).sort({ timestamp: -1 });

      if (activeSession) {
        console.log(`User ${userId} already logged in at ${activeSession.timestamp}`);
        return res.status(200).json({
          message: 'User already logged in',
          activeSession
        });
      }

      // Create a single login record = one session
      const activity = new Activity({
        userId,
        email: normalizedEmail,
        type: 'login',
        loggedOut: false
      });

      await activity.save();
      console.log(`Login recorded for user ${userId} at ${activity.timestamp}`);

      return res.status(201).json({ message: 'Activity logged', activity });
    }

    if (type === 'logout') {
      // Find latest active login by userId OR email
      let lastLogin = null;
      let attempts = 0;
      const maxAttempts = 3;

      while (!lastLogin && attempts < maxAttempts) {
        lastLogin = await Activity.findOneAndUpdate(
          {
            type: 'login',
            loggedOut: false,
            $or: [
              { userId },
              { email: normalizedEmail }
            ]
          },
          {
            $set: {
              loggedOut: true,
              logoutTime: new Date()
            }
          },
          {
            sort: { timestamp: -1 },
            new: true
          }
        );

        attempts++;
        if (!lastLogin && attempts < maxAttempts) {
          console.warn(`Retry ${attempts} for updating logout time for user ${userId}`);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Keep logout record for audit history
      const activity = new Activity({
        userId,
        email: normalizedEmail,
        type: 'logout',
        relatedLogin: lastLogin ? lastLogin._id : null
      });

      await activity.save();

      console.log(
        `Logout recorded for user ${userId} at ${activity.timestamp}${
          lastLogin ? `, linked to login at ${lastLogin.timestamp}` : ', no active session found'
        }`
      );

      return res.status(200).json({
        message: lastLogin ? 'Logout recorded' : 'No active session, logout recorded'
      });
    }

    if (type === 'password_reset') {
      const activity = new Activity({
        userId,
        email: normalizedEmail,
        type
      });

      await activity.save();
      console.log(`Password reset recorded for user ${userId} at ${activity.timestamp}`);

      return res.status(201).json({ message: 'Activity logged' });
    }
  } catch (err) {
    console.error('Error logging activity:', err.message, err.stack);
    return res.status(500).json({ error: 'Failed to log activity' });
  }
});

router.get('/class/:classId', async (req, res) => {
  try {
    const { classId } = req.params;

    const classData = await Class.findById(classId).select('students');
    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const studentEmails = (classData.students || [])
      .map(s => s.email?.toLowerCase())
      .filter(Boolean);

    const studentIds = (classData.students || [])
      .map(s => s.studentId)
      .filter(Boolean);

    const studentsFromDB = await Student.find({ email: { $in: studentEmails } }).select('email name');
    const studentNameMap = {};
    studentsFromDB.forEach(student => {
      if (student.email) {
        studentNameMap[student.email.toLowerCase()] = student.name;
      }
    });

    // IMPORTANT: only login records represent sessions
    const loginActivities = await Activity.find({
      type: 'login',
      $or: [
        { email: { $in: studentEmails } },
        { userId: { $in: studentIds } }
      ]
    }).sort({ timestamp: -1 }).exec();

    const sessions = buildSessionsFromLoginRecords(loginActivities, studentNameMap);

    res.json(sessions);
  } catch (err) {
    console.error('Error fetching class sessions:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to fetch class sessions' });
  }
});

router.get('/all', async (req, res) => {
  try {
    const loginActivities = await Activity.find({ type: 'login' })
      .sort({ timestamp: -1 })
      .exec();

    const sessions = buildSessionsFromLoginRecords(loginActivities);

    res.json(sessions);
  } catch (err) {
    console.error('Error fetching sessions:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

module.exports = router;