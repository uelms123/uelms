const express = require('express');
const router = express.Router();
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const multer = require('multer');
const admin = require('firebase-admin');
const crypto = require('crypto');
const fs = require('fs');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  }
});

const getBucket = () => admin.storage().bucket();

// ✅ PERMANENT URL GENERATOR — uses Firebase download token (never expires)
const generatePermanentUrl = (fileName) => {
  return `https://firebasestorage.googleapis.com/v0/b/${process.env.FIREBASE_STORAGE_BUCKET}/o/${encodeURIComponent(fileName)}?alt=media`;
};

router.get('/:classId', async (req, res) => {
  try {
    const assignments = await Assignment.find({
      classId: req.params.classId
    }).sort({ createdAt: -1 });

    const assignmentsWithStudentCount = await Promise.all(
      assignments.map(async (assignment) => {
        const submissions = await Submission.find({ assignmentId: assignment._id });
        const uniqueStudentIds = [...new Set(submissions.map(sub => sub.studentId))];
        return {
          ...assignment.toObject(),
          uniqueStudentCount: uniqueStudentIds.length
        };
      })
    );

    const filteredAssignments = assignmentsWithStudentCount.filter(item => 
      item.type === 'assignment'
    );

    res.json(filteredAssignments);
  } catch (err) {
    console.error('Error fetching assignments:', err);
    res.status(500).json({
      message: 'Failed to fetch assignments',
      error: err.message
    });
  }
});

router.get('/:classId/student/:studentId', async (req, res) => {
  try {
    const assignments = await Assignment.find({
      classId: req.params.classId
    }).sort({ createdAt: -1 });
    
    res.json(assignments);
  } catch (err) {
    console.error('Error fetching student assignments:', err);
    res.status(500).json({
      message: 'Failed to fetch assignments',
      error: err.message
    });
  }
});

router.post('/', upload.array('attachments', 5), async (req, res) => {
  try {
    const { meetLink, type, staffId, title, description, assignmentType, question, mcqQuestions, meetTime } = req.body;

    let validatedMeetLink = meetLink;
    if (type?.includes('meet')) {
      if (!meetLink) {
        if (type === 'meet-google') {
          validatedMeetLink = 'https://meet.google.com/new';
        } else if (type === 'meet-zoom') {
          return res.status(400).json({ message: 'Zoom meeting link is required.' });
        } else if (type === 'meet-teams') {
          return res.status(400).json({ message: 'Microsoft Teams meeting link is required.' });
        }
      } else {
        const urlRegex = /^(https?:\/\/[^\s$.?#].[^\s]*)$/;
        if (!urlRegex.test(meetLink)) {
          return res.status(400).json({ message: 'Invalid meeting link provided.' });
        }
        if (type === 'meet-zoom' && !meetLink.includes('zoom.us')) {
          return res.status(400).json({ message: 'Invalid Zoom meeting link.' });
        }
        if (type === 'meet-teams' && !meetLink.includes('teams.microsoft.com')) {
          return res.status(400).json({ message: 'Invalid Microsoft Teams meeting link.' });
        }
      }
    }

    const uploadedAttachments = [];
    if (req.files && req.files.length > 0) {
      const bucket = getBucket();
      for (const file of req.files) {
        const timestamp = Date.now();
        const randomStr = Math.round(Math.random() * 1E9);
        const fileName = `assignments/${req.body.classId}/${timestamp}-${randomStr}-${file.originalname}`;
        const fileRef = bucket.file(fileName);

        // ✅ Generate permanent download token
        const downloadToken = crypto.randomBytes(16).toString('hex');

        const metadata = {
          contentType: file.mimetype,
          metadata: {
            firebaseStorageDownloadTokens: downloadToken,
            uploadedAt: new Date().toISOString(),
            originalName: file.originalname
          }
        };

        await fileRef.save(file.buffer, {
          metadata: metadata,
          resumable: true
        });

        // ✅ Permanent Firebase Storage URL with download token (never expires)
        const storageUrl = `https://firebasestorage.googleapis.com/v0/b/${process.env.FIREBASE_STORAGE_BUCKET}/o/${encodeURIComponent(fileName)}?alt=media&token=${downloadToken}`;
        const directUrl = `https://storage.googleapis.com/${process.env.FIREBASE_STORAGE_BUCKET}/${encodeURIComponent(fileName)}`;

        uploadedAttachments.push({
          name: file.originalname,
          type: file.mimetype,
          size: file.size,
          url: storageUrl,
          directUrl: directUrl,
          downloadToken: downloadToken,
          filePath: fileName
        });
      }
    }
    

    const assignment = new Assignment({
      classId: req.body.classId,
      staffId: staffId,
      type: assignmentType ? 'assignment' : (type || 'assignment'),
      title: title,
      description: description || '',
      assignmentType: assignmentType,
      question: assignmentType === 'question' ? question : null,
      mcqQuestions: assignmentType === 'mcq' ? (mcqQuestions ? JSON.parse(mcqQuestions) : []) : [],
      meetTime: meetTime,
      meetLink: validatedMeetLink,
      attachments: uploadedAttachments
    });

    const newAssignment = await assignment.save();
    res.status(201).json(newAssignment);
  } catch (err) {
    console.error('Error creating assignment:', err);
    res.status(400).json({
      message: 'Failed to create assignment',
      error: err.message,
    });
  }
});

router.put('/:id', upload.array('attachments', 5), async (req, res) => {
  try {
    const assignment = await Assignment.findOne({
      _id: req.params.id
    });
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    const { meetLink, type, title, description, assignmentType, question, mcqQuestions, meetTime } = req.body;

    let validatedMeetLink = meetLink || assignment.meetLink;
    if ((type || assignment.type).includes('meet')) {
      if (!validatedMeetLink) {
        if (type === 'meet-google') {
          validatedMeetLink = 'https://meet.google.com/new';
        } else if (type === 'meet-zoom') {
          return res.status(400).json({ message: 'Zoom meeting link is required.' });
        } else if (type === 'meet-teams') {
          return res.status(400).json({ message: 'Microsoft Teams meeting link is required.' });
        }
      } else {
        const urlRegex = /^(https?:\/\/[^\s$.?#].[^\s]*)$/;
        if (!urlRegex.test(validatedMeetLink)) {
          return res.status(400).json({ message: 'Invalid meeting link provided.' });
        }
        if ((type || assignment.type) === 'meet-zoom' && !validatedMeetLink.includes('zoom.us')) {
          return res.status(400).json({ message: 'Invalid Zoom meeting link.' });
        }
        if ((type || assignment.type) === 'meet-teams' && !validatedMeetLink.includes('teams.microsoft.com')) {
          return res.status(400).json({ message: 'Invalid Microsoft Teams meeting link.' });
        }
      }
    }

    assignment.title = title || assignment.title;
    assignment.description = description || assignment.description;
    assignment.assignmentType = assignmentType || assignment.assignmentType;
    assignment.question = assignmentType === 'question' ? (question !== undefined ? question : assignment.question) : null;
    assignment.mcqQuestions = assignmentType === 'mcq' ? (mcqQuestions ? JSON.parse(mcqQuestions) : assignment.mcqQuestions) : [];
    assignment.meetTime = meetTime || assignment.meetTime;
    assignment.meetLink = validatedMeetLink;
    assignment.updatedAt = Date.now();

    if (req.files && req.files.length > 0) {
      const bucket = getBucket();
      for (const file of req.files) {
        const timestamp = Date.now();
        const randomStr = Math.round(Math.random() * 1E9);
        const fileName = `assignments/${assignment.classId}/${timestamp}-${randomStr}-${file.originalname}`;
        const fileRef = bucket.file(fileName);

        // ✅ Generate permanent download token (FIXED: was using getSignedUrl before)
        const downloadToken = crypto.randomBytes(16).toString('hex');

        const metadata = {
          contentType: file.mimetype,
          metadata: {
            firebaseStorageDownloadTokens: downloadToken,
            uploadedAt: new Date().toISOString(),
            originalName: file.originalname
          }
        };

        await fileRef.save(file.buffer, {
          metadata: metadata,
          resumable: true
        });

        // ✅ Permanent Firebase Storage URL with download token (never expires)
        const storageUrl = `https://firebasestorage.googleapis.com/v0/b/${process.env.FIREBASE_STORAGE_BUCKET}/o/${encodeURIComponent(fileName)}?alt=media&token=${downloadToken}`;

        assignment.attachments.push({
          name: file.originalname,
          type: file.mimetype,
          size: file.size,
          url: storageUrl,
          downloadToken: downloadToken,
          filePath: fileName
        });
      }
    }

    const updatedAssignment = await assignment.save();
    res.json(updatedAssignment);
  } catch (err) {
    console.error('Error updating assignment:', err);
    res.status(400).json({
      message: 'Failed to update assignment',
      error: err.message,
    });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const assignment = await Assignment.findOne({
      _id: req.params.id
    });
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    const submissions = await Submission.find({ assignmentId: req.params.id });
    const bucket = getBucket();

    for (const submission of submissions) {
      for (const file of submission.files) {
        try {
          // ✅ Use filePath first, fallback to parsing URL
          const filePath = file.filePath || (file.url ? decodeURIComponent(file.url.split('/o/')[1].split('?')[0]) : null);
          if (filePath) {
            await bucket.file(filePath).delete();
          }
        } catch (fileErr) {
          console.error(`Failed to delete submission file:`, fileErr);
        }
      }
    }

    for (const attachment of assignment.attachments || []) {
      try {
        // ✅ Use filePath first, fallback to parsing URL
        const filePath = attachment.filePath || (attachment.url ? decodeURIComponent(attachment.url.split('/o/')[1].split('?')[0]) : null);
        if (filePath) {
          await bucket.file(filePath).delete();
        }
      } catch (fileErr) {
        console.error(`Failed to delete attachment:`, fileErr);
      }
    }

    await Submission.deleteMany({ assignmentId: req.params.id });
    await Assignment.deleteOne({ _id: req.params.id });

    res.json({
      success: true,
      message: 'Assignment and associated submissions deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting assignment:', err);
    res.status(500).json({
      message: 'Failed to delete assignment',
      error: err.message
    });
  }
});

router.get('/:id/submissions', async (req, res) => {
  try {
    const submissions = await Submission.find({ assignmentId: req.params.id })
      .sort({ submissionDate: -1 });
    res.json(submissions);
  } catch (err) {
    console.error('Error fetching submissions:', err);
    res.status(500).json({
      message: 'Failed to fetch submissions',
      error: err.message
    });
  }
});

module.exports = router;