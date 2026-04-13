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

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);

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
    // const File = m('File');

    const all = [];

    const push = (item) => {
      if (!item?.timestamp) return;
      const ts = new Date(item.timestamp);
      if (isNaN(ts.getTime())) return;
      all.push({ ...item, timestamp: ts });
    };

    // =========================
    // STUDENT SUBMISSIONS
    // =========================
    if (Submission) {
      try {
        const submissions = await Submission.find({})
          .populate('assignmentId', 'title')
          .sort({ submissionDate: -1 })
          .limit(50)
          .lean();

        submissions.forEach((s) => {
          const firstFile = Array.isArray(s.files) && s.files.length > 0 ? s.files[0] : null;
          const assignmentTitle =
            s.assignmentId?.title || s.assignmentTitle || 'an assignment';

          const safeStudentName = getSafeActorName(
            s.studentName,
            s.name,
            s.fullName,
            s.studentEmail,
            s.email,
            s.studentId,
            'Student'
          );

          const safeStudentEmail =
            cleanDisplayValue(s.studentEmail) ||
            cleanDisplayValue(s.email) ||
            cleanDisplayValue(s.studentId) ||
            '';

          push({
            type: 'student_submission',
            label: 'Submission',
            actorRole: 'Student',
            actorName: safeStudentName,
            actorEmail: safeStudentEmail,
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
    // STAFF ACTIVITY (legacy + nested people/visit)
    // =========================
    if (StaffActivity) {
      try {
        const docs = await StaffActivity.find({})
          .sort({ updatedAt: -1, createdAt: -1 })
          .limit(100)
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
              rawType: 'legacy'
            });
          }
        });
      } catch (e) {
        console.error('[recent-activities] StaffActivity:', e.message);
      }
    }

    // =========================
    // MEETINGS CREATED BY STAFF
    // =========================
    if (Meeting) {
      try {
        const meetings = await Meeting.find({})
          .sort({ createdAt: -1, scheduledTime: -1 })
          .limit(50)
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

            push({
              type: 'student_attended_meeting',
              label: 'Attendance',
              actorRole: attendee.isExternal ? 'Guest' : 'Student',
              actorName: getSafeActorName(attendee.name, attendee.email, 'Student'),
              actorEmail: cleanDisplayValue(attendee.email),
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
    // STAFF UNITS / ASSESSMENTS + FILES INSIDE UNIT
    // =========================
    if (Unit) {
      try {
        const units = await Unit.find({})
          .populate('files')
          .sort({ updatedAt: -1, createdAt: -1 })
          .limit(50)
          .lean();

        units.forEach((unit) => {
          const extractedFiles = extractUnitFiles(unit);
          const firstFile = extractedFiles.length > 0 ? extractedFiles[0] : null;

          // Original unit creation activity
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

          // NEW: separate file activities for files uploaded inside unit
          extractedFiles.forEach((file, index) => {
            if (!file.url) return;

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
              timestamp:
                getFileTimestamp(file, unit.updatedAt || unit.createdAt) ||
                unit.updatedAt ||
                unit.createdAt,
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
        const assignments = await Assignment.find({})
          .sort({ createdAt: -1 })
          .limit(50)
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

    all.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.status(200).json({
      success: true,
      activities: all.slice(0, limit),
      total: all.length
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