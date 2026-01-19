const express = require('express');
const router = express.Router();
const Submission = require('../models/Submission');
const Assignment = require('../models/Assignment');
const multer = require('multer');
const admin = require('firebase-admin');
const mongoose = require('mongoose');

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

router.get('/status/:classId/student/:studentId', async (req, res) => {
  try {
    const { classId, studentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ message: 'Invalid class ID' });
    }

    const submissions = await Submission.find({ classId, studentId })
      .select('assignmentId submissionDate answer files grading mcqAnswers')
      .populate('files', 'name url type size _id')
      .sort({ submissionDate: -1 });

    const latestSubmissions = {};
    submissions.forEach(sub => {
      const aid = sub.assignmentId.toString();
      if (!latestSubmissions[aid] || sub.submissionDate > latestSubmissions[aid].submissionDate) {
        latestSubmissions[aid] = sub;
      }
    });

    const assignments = await Assignment.find({ classId }).select('_id title assignmentType');

    const status = {};
    assignments.forEach(assignment => {
      const sub = latestSubmissions[assignment._id.toString()];
      const hasContent = sub && (sub.answer || sub.files.length > 0 || (sub.mcqAnswers && sub.mcqAnswers.length > 0));

      status[assignment._id] = {
        assignmentTitle: assignment.title,
        assignmentType: assignment.assignmentType,
        submitted: !!hasContent,
        submissionDate: sub?.submissionDate || null,
        grading: sub?.grading || { marks: null },
        hasContent: !!hasContent,
        answer: sub?.answer || '',
        mcqAnswers: sub?.mcqAnswers || [],
        files: sub?.files || []
      };
    });

    res.json(status);
  } catch (err) {
    res.status(500).json({
      message: 'Failed to fetch submission status',
      error: err.message
    });
  }
});

router.post('/', upload.array('files', 10), async (req, res) => {
  try {
    const { assignmentId, classId, studentId, answer, studentName, mcqAnswers } = req.body;

    if (!assignmentId || !classId || !studentId) {
      return res.status(400).json({ message: 'Missing required fields: assignmentId, classId, studentId' });
    }

    if (!mongoose.Types.ObjectId.isValid(assignmentId) || !mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ message: 'Invalid assignment or class ID format' });
    }

    let parsedMcqAnswers = [];
    if (mcqAnswers) {
      try {
        parsedMcqAnswers = typeof mcqAnswers === 'string' ? JSON.parse(mcqAnswers) : mcqAnswers;
      } catch (e) {
        return res.status(400).json({ message: 'Invalid mcqAnswers format' });
      }
    }

    const hasText = answer && answer.trim().length > 0;
    const hasFiles = req.files && req.files.length > 0;
    const hasMcq = Array.isArray(parsedMcqAnswers) && parsedMcqAnswers.length > 0;

    if (!hasText && !hasFiles && !hasMcq) {
      return res.status(400).json({ message: 'Submission must include an answer, files, or MCQ responses' });
    }

    const bucket = getBucket();
    const uploadedFiles = [];

    if (hasFiles) {
      for (const file of req.files) {
        const fileName = `submissions/${assignmentId}/${studentId}/${Date.now()}-${Math.round(Math.random() * 1E9)}-${file.originalname}`;
        const fileRef = bucket.file(fileName);

        await fileRef.save(file.buffer, {
          metadata: { contentType: file.mimetype }
        });

        const [url] = await fileRef.getSignedUrl({
          action: 'read',
          expires: '03-01-2500'
        });

        uploadedFiles.push({
          name: file.originalname,
          type: file.mimetype,
          size: file.size,
          url
        });
      }
    }

    const submission = new Submission({
      assignmentId,
      classId,
      studentId,
      studentName: studentName || 'Student',
      answer: hasText ? answer.trim() : (hasMcq ? JSON.stringify(parsedMcqAnswers) : ''),
      mcqAnswers: hasMcq ? parsedMcqAnswers : [],
      files: uploadedFiles,
      submitted: true,
      submissionDate: new Date(),
      grading: {
        marks: null,
        comments: '',
        gradedBy: '',
        gradedAt: null,
        maxMarks: 100
      }
    });

    await submission.save();
    await submission.populate('files', 'name url type size _id');

    res.status(201).json({
      message: 'Submission created successfully',
      submission
    });
  } catch (err) {
    console.error('Submission error:', err);
    res.status(400).json({
      message: 'Failed to create submission',
      error: err.message
    });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    const bucket = getBucket();

    for (const file of submission.files) {
      if (file.url) {
        try {
          const fileName = decodeURIComponent(file.url.split('/o/')[1].split('?')[0]);
          await bucket.file(fileName).delete();
        } catch (err) {
          console.error('Error deleting file from Firebase:', err);
        }
      }
    }

    await submission.deleteOne();
    res.json({ message: 'Submission deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete submission', error: err.message });
  }
});

router.delete('/:submissionId/file/:fileId', async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.submissionId);
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    const fileIndex = submission.files.findIndex(f => f._id.toString() === req.params.fileId);
    if (fileIndex === -1) {
      return res.status(404).json({ message: 'File not found' });
    }

    const file = submission.files[fileIndex];
    const bucket = getBucket();

    if (file.url) {
      try {
        const fileName = decodeURIComponent(file.url.split('/o/')[1].split('?')[0]);
        await bucket.file(fileName).delete();
      } catch (err) {
        console.error('Error deleting file from Firebase:', err);
      }
    }

    submission.files.splice(fileIndex, 1);
    await submission.save();

    const hasContent = submission.answer || submission.files.length > 0 || submission.mcqAnswers.length > 0;
    if (!hasContent) {
      await submission.deleteOne();
      return res.json({ message: 'File and empty submission deleted' });
    }

    res.json({ message: 'File deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete file', error: err.message });
  }
});

router.put('/:id/grade', async (req, res) => {
  try {
    const { marks, comments, gradedBy, maxMarks = 100 } = req.body;

    if (marks !== undefined && (isNaN(marks) || marks < 0 || marks > maxMarks)) {
      return res.status(400).json({ message: `Marks must be between 0 and ${maxMarks}` });
    }

    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    submission.grading = {
      marks: marks !== undefined ? Number(marks) : submission.grading.marks,
      comments: comments || submission.grading.comments || '',
      gradedBy: gradedBy || submission.grading.gradedBy || 'Staff',
      gradedAt: new Date(),
      maxMarks: Number(maxMarks)
    };

    await submission.save();

    res.json({
      success: true,
      message: 'Grade saved successfully',
      grading: submission.grading
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to save grade',
      error: err.message
    });
  }
});

router.get('/graded/:studentId', async (req, res) => {
  try {
    const submissions = await Submission.find({
      studentId: req.params.studentId,
      'grading.marks': { $ne: null }
    })
      .populate('assignmentId', 'title assignmentType')
      .populate('classId', 'name section')
      .sort({ 'grading.gradedAt': -1 });

    res.json(submissions);
  } catch (err) {
    res.status(500).json({
      message: 'Failed to fetch graded submissions',
      error: err.message
    });
  }
});

module.exports = router;