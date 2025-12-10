const express = require('express');
const router = express.Router();
const Submission = require('../models/Submission');
const Assignment = require('../models/Assignment');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Get submission status for all assignments in a class for a student
router.get('/status/:classId/student/:studentId', async (req, res) => {
  try {
    const submissions = await Submission.find({
      classId: req.params.classId,
      studentId: req.params.studentId
    })
      .select('assignmentId submitted submissionDate answer files studentName grading')
      .populate('files', 'name url type size _id');

    const status = {};
    submissions.forEach(sub => {
      if (!status[sub.assignmentId]) {
        status[sub.assignmentId] = { submissions: [] };
      }
      // Only include submissions with content
      if (sub.answer || sub.files.length > 0) {
        status[sub.assignmentId].submissions.push({
          _id: sub._id,
          submitted: true,
          submissionDate: sub.submissionDate,
          answer: sub.answer,
          files: sub.files,
          studentName: sub.studentName,
          grading: sub.grading || {}
        });
      }
    });

    const assignments = await Assignment.find({ classId: req.params.classId });
    assignments.forEach(assignment => {
      if (!status[assignment._id]) {
        status[assignment._id] = { submissions: [] };
      }
    });

    res.json(status);
  } catch (err) {
    res.status(500).json({
      message: 'Failed to fetch submission status',
      error: err.message
    });
  }
});

// Create a new submission
router.post('/', upload.array('files'), async (req, res) => {
  try {
    const { assignmentId, classId, studentId, answer, studentName } = req.body;

    // Validate required fields
    if (!assignmentId || !classId || !studentId) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const files = req.files.map(file => ({
      name: file.originalname,
      path: file.path,
      type: file.mimetype,
      size: file.size,
      url: `/uploads/${file.filename}`
    }));

    // Only create submission if there's content
    if (!answer && files.length === 0) {
      return res.status(400).json({ message: 'Submission must include an answer or files' });
    }

    const submission = new Submission({
      assignmentId,
      classId,
      studentId,
      answer,
      files,
      submitted: true,
      submissionDate: new Date(),
      studentName,
      grading: {
        marks: null,
        comments: '',
        gradedBy: '',
        gradedAt: null,
        maxMarks: 100
      }
    });

    await submission.save();
    res.status(201).json(submission);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Delete a submission
router.delete('/:id', async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Delete associated files from the filesystem
    for (const file of submission.files) {
      try {
        if (file.path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      } catch (fileErr) {
        console.error(`Failed to delete file ${file.path}:`, fileErr.message);
      }
    }

    await submission.deleteOne();
    res.json({ message: 'Submission deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete a specific file from a submission
router.delete('/:submissionId/file/:fileId', async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.submissionId);
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    const fileIndex = submission.files.findIndex(file => file._id.toString() === req.params.fileId);
    if (fileIndex === -1) {
      return res.status(404).json({ message: 'File not found' });
    }

    const file = submission.files[fileIndex];
    try {
      if (file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (fileErr) {
      console.error(`Failed to delete file ${file.path}:`, fileErr.message);
    }

    submission.files.splice(fileIndex, 1);

    // Delete submission if it has no content left
    if (!submission.answer && submission.files.length === 0) {
      await submission.deleteOne();
      return res.json({ message: 'File and empty submission deleted successfully' });
    }

    await submission.save();
    res.json({ message: 'File deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Grade a submission (add marks and comments)
router.put('/:id/grade', async (req, res) => {
  try {
    const { marks, comments, gradedBy, maxMarks } = req.body;
    
    if (marks !== undefined && (marks < 0 || marks > (maxMarks || 100))) {
      return res.status(400).json({ 
        message: `Marks must be between 0 and ${maxMarks || 100}` 
      });
    }

    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    submission.grading = {
      marks: marks !== undefined ? Number(marks) : submission.grading.marks,
      comments: comments || submission.grading.comments,
      gradedBy: gradedBy || submission.grading.gradedBy,
      gradedAt: new Date(),
      maxMarks: maxMarks || submission.grading.maxMarks || 100
    };

    await submission.save();
    
    res.json({
      success: true,
      message: 'Submission graded successfully',
      submission
    });
  } catch (err) {
    console.error('Error grading submission:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to grade submission',
      error: err.message 
    });
  }
});

// Get graded submissions for a student
router.get('/graded/:studentId', async (req, res) => {
  try {
    const submissions = await Submission.find({
      studentId: req.params.studentId,
      'grading.marks': { $ne: null }
    })
    .populate('assignmentId', 'title')
    .populate('classId', 'name section')
    .sort({ 'grading.gradedAt': -1 });

    res.json(submissions);
  } catch (err) {
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch graded submissions',
      error: err.message 
    });
  }
});

module.exports = router;