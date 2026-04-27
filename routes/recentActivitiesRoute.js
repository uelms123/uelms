const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

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

const getSafeActorName = (...values) => {
  for (const value of values) {
    const cleaned = cleanDisplayValue(value);
    if (cleaned) return cleaned;
  }
  return 'Unknown User';
};

const getSafeFileUrl = (file) => {
  if (!file) return '';

  return (
    cleanDisplayValue(file.url) ||
    cleanDisplayValue(file.fileUrl) ||
    cleanDisplayValue(file.path) ||
    cleanDisplayValue(file.location) ||
    cleanDisplayValue(file.secure_url) ||
    cleanDisplayValue(file.downloadUrl) ||
    ''
  );
};

const getSafeFileName = (file, fallback = 'file') => {
  if (!file) return fallback;

  return (
    cleanDisplayValue(file.name) ||
    cleanDisplayValue(file.fileName) ||
    cleanDisplayValue(file.originalName) ||
    cleanDisplayValue(file.filename) ||
    fallback
  );
};

const getFileTimestamp = (file, fallbackDate = null) => {
  if (!file) return fallbackDate;

  const possibleDates = [
    file.createdAt,
    file.uploadedAt,
    file.updatedAt,
    file.date,
    fallbackDate
  ];

  for (const value of possibleDates) {
    if (!value) continue;
    const dt = new Date(value);
    if (!isNaN(dt.getTime())) return dt;
  }

  return fallbackDate;
};

const extractUnitFiles = (unit) => {
  const collected = [];

  const possibleSources = [
    unit?.files,
    unit?.attachments,
    unit?.resources,
    unit?.documents,
    unit?.materials
  ];

  possibleSources.forEach((source) => {
    if (!source) return;

    if (Array.isArray(source)) {
      source.forEach((item) => {
        if (!item) return;

        if (typeof item === 'string') {
          collected.push({
            name: 'file',
            url: item,
            createdAt: unit?.updatedAt || unit?.createdAt
          });
        } else if (typeof item === 'object') {
          const url = getSafeFileUrl(item);
          const name = getSafeFileName(item, 'file');

          if (url) {
            collected.push({
              ...item,
              name,
              url,
              createdAt: getFileTimestamp(item, unit?.updatedAt || unit?.createdAt)
            });
          }
        }
      });
    }
  });

  return collected;
};

const getDefaultDateRange = () => {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 3);
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  return { startDate, endDate };
};

const getRequestDateRange = (req) => {
  const defaults = getDefaultDateRange();

  const startDate = req.query.startDate
    ? new Date(`${req.query.startDate}T00:00:00.000Z`)
    : defaults.startDate;

  const endDate = req.query.endDate
    ? new Date(`${req.query.endDate}T23:59:59.999Z`)
    : defaults.endDate;

  return { startDate, endDate };
};

const buildOrDateQuery = (fields, startDate, endDate) => {
  const validFields = Array.isArray(fields) ? fields.filter(Boolean) : [];
  if (!validFields.length) return {};

  return {
    $or: validFields.map((field) => ({
      [field]: { $gte: startDate, $lte: endDate }
    }))
  };
};

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20000, 50000);
    const audience = cleanDisplayValue(req.query.audience || 'all').toLowerCase();
    const programFilter = cleanDisplayValue(req.query.program || '').toLowerCase();
    const classFilter = cleanDisplayValue(req.query.className || '').toLowerCase();

    const { startDate, endDate } = getRequestDateRange(req);

    const m = (name) => {
      try {
        return mongoose.model(name);
      } catch (_) {
        return null;
      }
    };

    const Submission = m('Submission');
    const StaffActivity = m('StaffActivity');
    const Meeting = m('Meeting');
    const Unit = m('Unit') || m('unit');
    const Assignment = m('Assignment');
    const StudentActivity = m('StudentActivity');
    const Student = m('Students') || m('Student');
    const Class = m('Class');

    const all = [];

    const emailStudentMap = new Map();
    const idStudentMap = new Map();
    const studentClassMap = new Map();

    if (Student) {
      try {
        const students = await Student.find({})
          .select('name fullName email studentId program course department password tempPassword')
          .lean();

        students.forEach((student) => {
          const email = cleanDisplayValue(student.email).toLowerCase();
          const studentId = cleanDisplayValue(student.studentId);
          const program =
            cleanDisplayValue(student.program) ||
            cleanDisplayValue(student.course) ||
            cleanDisplayValue(student.department) ||
            'No Program Assigned';

          const passwordValue =
            cleanDisplayValue(student.password) ||
            cleanDisplayValue(student.tempPassword) ||
            'Old account - reset required';

          const mapped = {
            name: getSafeActorName(student.name, student.fullName, student.email, 'Student'),
            email,
            studentId,
            program,
            passwordValue
          };

          if (email) emailStudentMap.set(email, mapped);
          if (studentId) idStudentMap.set(studentId, mapped);
        });
      } catch (e) {
        console.error('[recent-activities] Students:', e.message);
      }
    }

    if (Class) {
      try {
        const classes = await Class.find({})
          .select('name title className students')
          .lean();

        classes.forEach((cls) => {
          const resolvedClassName =
            cleanDisplayValue(cls.name) ||
            cleanDisplayValue(cls.title) ||
            cleanDisplayValue(cls.className) ||
            'Class';

          (cls.students || []).forEach((studentItem) => {
            const email = cleanDisplayValue(studentItem?.email).toLowerCase();
            if (!email) return;

            if (!studentClassMap.has(email)) {
              studentClassMap.set(email, new Set());
            }

            studentClassMap.get(email).add(resolvedClassName);
          });
        });
      } catch (e) {
        console.error('[recent-activities] Classes:', e.message);
      }
    }

    const getStudentInfo = ({ email, userId, fallbackName = 'Student' }) => {
      const normalizedEmail = cleanDisplayValue(email).toLowerCase();
      const normalizedUserId = cleanDisplayValue(userId);

      const byEmail = normalizedEmail ? emailStudentMap.get(normalizedEmail) : null;
      const byId = normalizedUserId ? idStudentMap.get(normalizedUserId) : null;
      const student = byEmail || byId || null;

      const enrolledClasses =
        normalizedEmail && studentClassMap.has(normalizedEmail)
          ? Array.from(studentClassMap.get(normalizedEmail))
          : [];

      return {
        actorName: getSafeActorName(student?.name, fallbackName, normalizedEmail, 'Student'),
        actorEmail: cleanDisplayValue(student?.email) || normalizedEmail || '',
        program: cleanDisplayValue(student?.program) || 'No Program Assigned',
        passwordValue:
          cleanDisplayValue(student?.passwordValue) || 'Old account - reset required',
        enrolledClasses
      };
    };

    const isWithinDateRange = (value) => {
      if (!value) return false;
      const dt = new Date(value);
      if (isNaN(dt.getTime())) return false;
      if (dt < startDate) return false;
      if (dt > endDate) return false;
      return true;
    };

    const matchesAudience = (item) => {
      const role = cleanDisplayValue(item.actorRole).toLowerCase();

      if (audience === 'student') {
        return role === 'student' || role === 'guest';
      }

      if (audience === 'staff') {
        return role === 'staff';
      }

      return true;
    };

    const matchesProgramAndClass = (item) => {
      if (programFilter) {
        const itemProgram = cleanDisplayValue(item.program).toLowerCase();
        if (!itemProgram.includes(programFilter)) return false;
      }

      if (classFilter) {
        const itemClassName = cleanDisplayValue(item.className).toLowerCase();
        const enrolledClasses = Array.isArray(item.enrolledClasses)
          ? item.enrolledClasses.join(', ').toLowerCase()
          : '';

        if (!itemClassName.includes(classFilter) && !enrolledClasses.includes(classFilter)) {
          return false;
        }
      }

      return true;
    };

    const push = (item) => {
      if (!item?.timestamp) return;
      const ts = new Date(item.timestamp);
      if (isNaN(ts.getTime())) return;
      if (!isWithinDateRange(ts)) return;
      if (!matchesAudience(item)) return;
      if (!matchesProgramAndClass(item)) return;

      all.push({
        ...item,
        timestamp: ts
      });
    };

    // =========================
    // STUDENT SUBMISSIONS
    // =========================
    if (Submission) {
      try {
        const submissions = await Submission.find(
          buildOrDateQuery(['submissionDate', 'createdAt'], startDate, endDate)
        )
          .populate('assignmentId', 'title')
          .sort({ submissionDate: -1, createdAt: -1 })
          .lean();

        submissions.forEach((s) => {
          const firstFile = Array.isArray(s.files) && s.files.length > 0 ? s.files[0] : null;
          const assignmentTitle = s.assignmentId?.title || s.assignmentTitle || 'an assignment';

          const studentInfo = getStudentInfo({
            email: s.studentEmail || s.email,
            userId: s.studentId,
            fallbackName: getSafeActorName(
              s.studentName,
              s.name,
              s.fullName,
              s.studentEmail,
              s.email,
              s.studentId,
              'Student'
            )
          });

          push({
            type: 'student_submission',
            label: 'Submission',
            actorRole: 'Student',
            actorName: studentInfo.actorName,
            actorEmail: studentInfo.actorEmail,
            program: studentInfo.program,
            passwordValue: studentInfo.passwordValue,
            enrolledClasses: studentInfo.enrolledClasses,
            actionText: `submitted "${assignmentTitle}"`,
            meta: firstFile?.name ? `File: ${firstFile.name}` : 'Assignment submission',
            icon: '📤',
            color: '#8b5cf6',
            timestamp: s.submissionDate || s.createdAt,
            link: firstFile?.url || '',
            linkLabel: firstFile?.name ? `Open ${firstFile.name}` : '',
            rawType: 'submission'
          });
        });
      } catch (e) {
        console.error('[recent-activities] Submission:', e.message);
      }
    }

    // =========================
    // STAFF ACTIVITY
    // =========================
    if (StaffActivity) {
      try {
        const docs = await StaffActivity.find(
          buildOrDateQuery(
            ['lastClassVisit', 'lastPeopleUpdate', 'updatedAt', 'createdAt'],
            startDate,
            endDate
          )
        )
          .sort({ updatedAt: -1, createdAt: -1 })
          .lean();

        docs.forEach((doc) => {
          const actorName = getSafeActorName(doc.staffName, doc.staffEmail, 'Staff Member');
          const actorEmail = cleanDisplayValue(doc.staffEmail);
          const className = cleanDisplayValue(doc.className) || 'Class';

          if (doc.lastClassVisit) {
            push({
              type: 'staff_visit',
              label: 'Class Visit',
              actorRole: 'Staff',
              actorName,
              actorEmail,
              actionText: `visited classroom "${className}"`,
              meta: doc.subject ? `Subject: ${doc.subject}` : '',
              icon: '👀',
              color: '#0ea5e9',
              timestamp: doc.lastClassVisit,
              className,
              rawType: 'visit'
            });
          }

          (doc.activities?.people?.items || []).forEach((item) => {
            push({
              type: 'staff_people',
              label: 'People Added',
              actorRole: 'Staff',
              actorName,
              actorEmail,
              actionText: `added ${item.title || 'a user'} to "${className}"`,
              meta: item.email ? `${item.type || 'Member'} • ${item.email}` : item.type || 'Member',
              icon: '👥',
              color: '#14b8a6',
              timestamp: item.createdAt || doc.lastPeopleUpdate || doc.updatedAt,
              className,
              rawType: 'people'
            });
          });

          if (doc.activityType && doc.itemData) {
            push({
              type: `legacy_${doc.activityType}`,
              label: doc.activityType,
              actorRole: 'Staff',
              actorName,
              actorEmail,
              actionText: `${doc.activityType} - ${doc.itemData.title || 'activity'}`,
              meta: `Class: ${className}`,
              icon: '⚡',
              color: '#6366f1',
              timestamp: doc.itemData.createdAt || doc.createdAt || doc.updatedAt,
              className,
              rawType: 'legacy'
            });
          }
        });
      } catch (e) {
        console.error('[recent-activities] StaffActivity:', e.message);
      }
    }

    // =========================
    // MEETINGS + STUDENT ATTENDANCE
    // =========================
    if (Meeting) {
      try {
        const meetings = await Meeting.find({
          $or: [
            { createdAt: { $gte: startDate, $lte: endDate } },
            { scheduledTime: { $gte: startDate, $lte: endDate } },
            { 'attendees.joinedAt': { $gte: startDate, $lte: endDate } }
          ]
        })
          .sort({ createdAt: -1, scheduledTime: -1 })
          .lean();

        meetings.forEach((meeting) => {
          push({
            type: 'staff_stream',
            label: 'Meeting',
            actorRole: 'Staff',
            actorName: getSafeActorName(
              meeting.staffInfo?.name,
              meeting.staffInfo?.email,
              'Staff Member'
            ),
            actorEmail: cleanDisplayValue(meeting.staffInfo?.email),
            actionText: `posted meeting "${meeting.title || 'Untitled Meeting'}"`,
            meta: meeting.classId ? `Class ID: ${meeting.classId}` : 'Meeting activity',
            icon: '📹',
            color: '#10b981',
            timestamp: meeting.createdAt || meeting.scheduledTime,
            link: meeting.meetLink || '',
            linkLabel: meeting.meetLink ? 'Open meeting link' : '',
            rawType: 'meeting'
          });
        });

        meetings.forEach((meeting) => {
          (meeting.attendees || []).forEach((attendee) => {
            if (!attendee.joinedAt) return;
            if (!isWithinDateRange(attendee.joinedAt)) return;

            const studentInfo = getStudentInfo({
              email: attendee.email,
              fallbackName: getSafeActorName(attendee.name, attendee.email, 'Student')
            });

            push({
              type: 'student_attended_meeting',
              label: 'Attendance',
              actorRole: attendee.isExternal ? 'Guest' : 'Student',
              actorName: studentInfo.actorName,
              actorEmail: studentInfo.actorEmail,
              program: studentInfo.program,
              passwordValue: studentInfo.passwordValue,
              enrolledClasses: studentInfo.enrolledClasses,
              actionText: `joined meeting "${meeting.title || 'Untitled Meeting'}"`,
              meta: attendee.duration
                ? `Duration: ${attendee.duration} min`
                : 'Meeting attendance',
              icon: '🎥',
              color: '#3b82f6',
              timestamp: attendee.joinedAt,
              link: meeting.meetLink || '',
              linkLabel: meeting.meetLink ? 'Open meeting link' : '',
              rawType: 'meeting_attendance'
            });
          });
        });
      } catch (e) {
        console.error('[recent-activities] Meeting:', e.message);
      }
    }

    // =========================
    // UNITS / FILES
    // =========================
    if (Unit) {
      try {
        const units = await Unit.find(
          buildOrDateQuery(['updatedAt', 'createdAt'], startDate, endDate)
        )
          .populate('files')
          .sort({ updatedAt: -1, createdAt: -1 })
          .lean();

        units.forEach((unit) => {
          const extractedFiles = extractUnitFiles(unit);
          const firstFile = extractedFiles.length > 0 ? extractedFiles[0] : null;

          push({
            type: 'staff_assessment',
            label: unit.isAssessmentUnit ? 'Assessment' : 'Unit',
            actorRole: 'Staff',
            actorName: getSafeActorName(
              unit.createdByName,
              unit.createdByEmail,
              unit.createdBy,
              'Staff Member'
            ),
            actorEmail: cleanDisplayValue(unit.createdByEmail),
            actionText: `created ${unit.isAssessmentUnit ? 'assessment' : 'unit'} "${unit.title || 'Untitled'}"`,
            meta: firstFile?.name
              ? `File: ${firstFile.name}`
              : unit.classId
              ? `Class ID: ${unit.classId}`
              : 'Unit activity',
            icon: unit.isAssessmentUnit ? '📋' : '📚',
            color: unit.isAssessmentUnit ? '#ef4444' : '#06b6d4',
            timestamp: unit.createdAt,
            link: firstFile?.url || '',
            linkLabel: firstFile?.name ? `Open ${firstFile.name}` : '',
            rawType: 'unit'
          });

          extractedFiles.forEach((file, index) => {
            if (!file.url) return;

            const fileTs =
              getFileTimestamp(file, unit.updatedAt || unit.createdAt) ||
              unit.updatedAt ||
              unit.createdAt;

            if (!isWithinDateRange(fileTs)) return;

            push({
              type: 'staff_unit_file',
              label: unit.isAssessmentUnit ? 'Assessment File' : 'Unit File',
              actorRole: 'Staff',
              actorName: getSafeActorName(
                unit.createdByName,
                unit.createdByEmail,
                unit.createdBy,
                'Staff Member'
              ),
              actorEmail: cleanDisplayValue(unit.createdByEmail),
              actionText: `uploaded file "${file.name}" in "${unit.title || 'Untitled'}"`,
              meta: unit.isAssessmentUnit ? 'Assessment resource' : 'Unit resource',
              icon: '📎',
              color: '#2563eb',
              timestamp: fileTs,
              link: file.url,
              linkLabel: `Open ${file.name || `file ${index + 1}`}`,
              rawType: 'unit_file'
            });
          });
        });
      } catch (e) {
        console.error('[recent-activities] Unit:', e.message);
      }
    }

    // =========================
    // STAFF ASSIGNMENTS
    // =========================
    if (Assignment) {
      try {
        const assignments = await Assignment.find(
          buildOrDateQuery(['createdAt', 'updatedAt'], startDate, endDate)
        )
          .sort({ createdAt: -1 })
          .lean();

        assignments.forEach((assignment) => {
          const firstAttachment =
            Array.isArray(assignment.attachments) && assignment.attachments.length > 0
              ? assignment.attachments[0]
              : null;

          push({
            type: 'staff_assignment',
            label: 'Assignment',
            actorRole: 'Staff',
            actorName: getSafeActorName(
              assignment.staffName,
              assignment.staffEmail,
              assignment.staffId,
              'Staff Member'
            ),
            actorEmail: cleanDisplayValue(assignment.staffEmail),
            actionText: `posted assignment "${assignment.title || 'Untitled Assignment'}"`,
            meta: firstAttachment?.name
              ? `Attachment: ${firstAttachment.name}`
              : assignment.classId
              ? `Class ID: ${assignment.classId}`
              : 'Assignment activity',
            icon: '📝',
            color: '#f59e0b',
            timestamp: assignment.createdAt,
            link: firstAttachment?.url || assignment.meetLink || '',
            linkLabel: firstAttachment?.url
              ? `Open ${firstAttachment.name || 'attachment'}`
              : assignment.meetLink
              ? 'Open assignment link'
              : '',
            rawType: 'assignment'
          });
        });
      } catch (e) {
        console.error('[recent-activities] Assignment:', e.message);
      }
    }

    // =========================
    // STUDENT LOGIN + PASSWORD RESET
    // =========================
    if (StudentActivity) {
      try {
        const studentActivities = await StudentActivity.find({
          type: { $in: ['login', 'password_reset'] },
          timestamp: { $gte: startDate, $lte: endDate }
        })
          .sort({ timestamp: -1 })
          .lean();

        studentActivities.forEach((act) => {
          const studentInfo = getStudentInfo({
            email: act.email,
            userId: act.userId,
            fallbackName: act.email || 'Student'
          });

          if (act.type === 'login') {
            push({
              type: 'student_login',
              label: 'Recently Active',
              actorRole: 'Student',
              actorName: studentInfo.actorName,
              actorEmail: studentInfo.actorEmail,
              program: studentInfo.program,
              passwordValue: studentInfo.passwordValue,
              enrolledClasses: studentInfo.enrolledClasses,
              actionText: 'logged in to the portal',
              meta: act.loggedOut
                ? `Logged out at: ${act.logoutTime ? new Date(act.logoutTime).toLocaleString() : 'N/A'}`
                : 'Active session',
              icon: '🔐',
              color: '#22c55e',
              timestamp: act.timestamp,
              rawType: 'student_login'
            });
          }

          if (act.type === 'password_reset') {
            push({
              type: 'student_password_reset',
              label: 'Password Reset',
              actorRole: 'Student',
              actorName: studentInfo.actorName,
              actorEmail: studentInfo.actorEmail,
              program: studentInfo.program,
              passwordValue: studentInfo.passwordValue,
              enrolledClasses: studentInfo.enrolledClasses,
              actionText: 'updated password',
              meta: 'Password reset activity',
              icon: '🔑',
              color: '#f97316',
              timestamp: act.timestamp,
              rawType: 'password_reset'
            });
          }
        });
      } catch (e) {
        console.error('[recent-activities] StudentActivity:', e.message);
      }
    }

    all.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.status(200).json({
      success: true,
      activities: all.slice(0, limit),
      total: all.length,
      range: {
        startDate,
        endDate
      }
    });
  } catch (error) {
    console.error('Error in /api/recent-activities:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
});

module.exports = router;