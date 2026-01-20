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

// ============ HELPER FUNCTIONS ============
const calculateMCQResults = async (assignment, mcqAnswers) => {
  if (!assignment || assignment.assignmentType !== 'mcq' || !assignment.mcqQuestions || !mcqAnswers) {
    return null;
  }

  let score = 0;
  const results = [];

  assignment.mcqQuestions.forEach((question, qIndex) => {
    const studentAnswer = mcqAnswers[qIndex];
    const correctIndex = question.options.findIndex(opt => opt.isCorrect);
    const isCorrect = studentAnswer === correctIndex;

    if (isCorrect) score++;

    results.push({
      question: question.question,
      studentAnswer: studentAnswer,
      correctAnswer: correctIndex,
      isCorrect: isCorrect,
      options: question.options.map((opt, idx) => ({
        text: opt.text,
        isCorrect: opt.isCorrect,
        isSelected: studentAnswer === idx
      }))
    });
  });

  return {
    score,
    totalQuestions: assignment.mcqQuestions.length,
    results
  };
};

// ============ ROUTES ============

// Get submission status for a student in a class
router.get('/status/:classId/student/:studentId', async (req, res) => {
  try {
    const { classId, studentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ message: 'Invalid class ID' });
    }

    const submissions = await Submission.find({ classId, studentId })
      .select('assignmentId submissionDate answer files grading mcqAnswers mcqResults mcqScore mcqTotalQuestions')
      .populate('files', 'name url type size _id')
      .sort({ submissionDate: -1 });

    const latestSubmissions = {};
    submissions.forEach(sub => {
      const aid = sub.assignmentId.toString();
      if (!latestSubmissions[aid] || sub.submissionDate > latestSubmissions[aid].submissionDate) {
        latestSubmissions[aid] = sub;
      }
    });

    const assignments = await Assignment.find({ classId }).select('_id title assignmentType mcqQuestions');

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
        mcqResults: sub?.mcqResults || [],
        mcqScore: sub?.mcqScore || 0,
        mcqTotalQuestions: sub?.mcqTotalQuestions || 0,
        files: sub?.files || []
      };
    });

    res.json(status);
  } catch (err) {
    console.error('Error fetching submission status:', err);
    res.status(500).json({
      message: 'Failed to fetch submission status',
      error: err.message
    });
  }
});

// Create a new submission with automatic MCQ grading
router.post('/', upload.array('files', 10), async (req, res) => {
  try {
    const { assignmentId, classId, studentId, answer, studentName, mcqAnswers } = req.body;

    if (!assignmentId || !classId || !studentId) {
      return res.status(400).json({ 
        message: 'Missing required fields: assignmentId, classId, studentId' 
      });
    }

    if (!mongoose.Types.ObjectId.isValid(assignmentId) || !mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ 
        message: 'Invalid assignment or class ID format' 
      });
    }

    let parsedMcqAnswers = [];
    if (mcqAnswers) {
      try {
        parsedMcqAnswers = typeof mcqAnswers === 'string' ? JSON.parse(mcqAnswers) : mcqAnswers;
      } catch (e) {
        return res.status(400).json({ 
          message: 'Invalid mcqAnswers format' 
        });
      }
    }

    const hasText = answer && answer.trim().length > 0;
    const hasFiles = req.files && req.files.length > 0;
    const hasMcq = Array.isArray(parsedMcqAnswers) && parsedMcqAnswers.length > 0;

    if (!hasText && !hasFiles && !hasMcq) {
      return res.status(400).json({ 
        message: 'Submission must include an answer, files, or MCQ responses' 
      });
    }

    // Get assignment to check if it's MCQ and calculate results
    const assignment = await Assignment.findById(assignmentId);
    if (!assignment) {
      return res.status(404).json({ 
        message: 'Assignment not found' 
      });
    }

    // Calculate MCQ results if this is an MCQ assignment
    let mcqResults = null;
    let mcqScore = 0;
    let mcqTotalQuestions = 0;
    
    if (assignment.assignmentType === 'mcq' && hasMcq) {
      const calculatedResults = await calculateMCQResults(assignment, parsedMcqAnswers);
      if (calculatedResults) {
        mcqResults = calculatedResults.results;
        mcqScore = calculatedResults.score;
        mcqTotalQuestions = calculatedResults.totalQuestions;
      }
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

    // Prepare answer text
    let finalAnswer = '';
    if (hasText) {
      finalAnswer = answer.trim();
    } else if (hasMcq && assignment.assignmentType === 'mcq') {
      finalAnswer = `MCQ Submission: ${mcqScore}/${mcqTotalQuestions} correct`;
    } else if (hasMcq) {
      finalAnswer = JSON.stringify(parsedMcqAnswers);
    }

    const submission = new Submission({
      assignmentId,
      classId,
      studentId,
      studentName: studentName || 'Student',
      answer: finalAnswer,
      mcqAnswers: hasMcq ? parsedMcqAnswers : [],
      mcqResults: mcqResults || [],
      mcqScore: mcqScore,
      mcqTotalQuestions: mcqTotalQuestions,
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
      success: true,
      message: 'Submission created successfully',
      submission: submission.toObject(),
      mcqResults: mcqResults,
      mcqScore: mcqScore,
      mcqTotalQuestions: mcqTotalQuestions
    });
  } catch (err) {
    console.error('Submission error:', err);
    res.status(400).json({
      success: false,
      message: 'Failed to create submission',
      error: err.message
    });
  }
});

// Delete a submission
router.delete('/:id', async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({ 
        success: false,
        message: 'Submission not found' 
      });
    }

    const bucket = getBucket();

    // Delete all files from Firebase Storage
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
    
    res.json({ 
      success: true,
      message: 'Submission deleted successfully' 
    });
  } catch (err) {
    console.error('Error deleting submission:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to delete submission', 
      error: err.message 
    });
  }
});

// Delete a specific file from a submission
router.delete('/:submissionId/file/:fileId', async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.submissionId);
    if (!submission) {
      return res.status(404).json({ 
        success: false,
        message: 'Submission not found' 
      });
    }

    const fileIndex = submission.files.findIndex(f => f._id.toString() === req.params.fileId);
    if (fileIndex === -1) {
      return res.status(404).json({ 
        success: false,
        message: 'File not found' 
      });
    }

    const file = submission.files[fileIndex];
    const bucket = getBucket();

    // Delete file from Firebase Storage
    if (file.url) {
      try {
        const fileName = decodeURIComponent(file.url.split('/o/')[1].split('?')[0]);
        await bucket.file(fileName).delete();
      } catch (err) {
        console.error('Error deleting file from Firebase:', err);
      }
    }

    // Remove file from submission
    submission.files.splice(fileIndex, 1);
    await submission.save();

    // Check if submission is now empty
    const hasContent = submission.answer || submission.files.length > 0 || submission.mcqAnswers.length > 0;
    if (!hasContent) {
      await submission.deleteOne();
      return res.json({ 
        success: true,
        message: 'File and empty submission deleted' 
      });
    }

    res.json({ 
      success: true,
      message: 'File deleted successfully' 
    });
  } catch (err) {
    console.error('Error deleting file:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to delete file', 
      error: err.message 
    });
  }
});

// Grade a submission
router.put('/:id/grade', async (req, res) => {
  try {
    const { marks, comments, gradedBy, maxMarks = 100 } = req.body;

    if (marks !== undefined && (isNaN(marks) || marks < 0 || marks > maxMarks)) {
      return res.status(400).json({ 
        success: false,
        message: `Marks must be between 0 and ${maxMarks}` 
      });
    }

    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({ 
        success: false,
        message: 'Submission not found' 
      });
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
    console.error('Error grading submission:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to save grade',
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
      .populate('assignmentId', 'title assignmentType mcqQuestions')
      .populate('classId', 'name section')
      .sort({ 'grading.gradedAt': -1 });

    res.json({
      success: true,
      submissions: submissions
    });
  } catch (err) {
    console.error('Error fetching graded submissions:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch graded submissions',
      error: err.message
    });
  }
});

// Get submissions for a specific assignment
router.get('/:assignmentId/submissions', async (req, res) => {
  try {
    const { assignmentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid assignment ID format' 
      });
    }

    const submissions = await Submission.find({ assignmentId })
      .populate('files', 'name url type size _id')
      .sort({ submissionDate: -1 });

    // Get assignment details to include MCQ questions
    const assignment = await Assignment.findById(assignmentId)
      .select('title assignmentType mcqQuestions');

    res.json({
      success: true,
      submissions: submissions,
      assignment: assignment
    });
  } catch (err) {
    console.error('Error fetching submissions:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch submissions',
      error: err.message
    });
  }
});

// Recalculate MCQ results for a submission
router.post('/:submissionId/recalculate-mcq', async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.submissionId);
    if (!submission) {
      return res.status(404).json({ 
        success: false,
        message: 'Submission not found' 
      });
    }

    const assignment = await Assignment.findById(submission.assignmentId);
    if (!assignment || assignment.assignmentType !== 'mcq') {
      return res.status(400).json({ 
        success: false,
        message: 'Assignment is not an MCQ type' 
      });
    }

    // Calculate MCQ results
    const calculatedResults = await calculateMCQResults(assignment, submission.mcqAnswers);
    if (!calculatedResults) {
      return res.status(400).json({ 
        success: false,
        message: 'Failed to calculate MCQ results' 
      });
    }

    // Update submission with new results
    submission.mcqResults = calculatedResults.results;
    submission.mcqScore = calculatedResults.score;
    submission.mcqTotalQuestions = calculatedResults.totalQuestions;
    
    // Update answer field with score summary
    if (!submission.answer || submission.answer.trim() === '') {
      submission.answer = `MCQ Submission: ${calculatedResults.score}/${calculatedResults.totalQuestions} correct`;
    }

    await submission.save();

    res.json({
      success: true,
      message: 'MCQ results recalculated successfully',
      submission: {
        mcqResults: submission.mcqResults,
        mcqScore: submission.mcqScore,
        mcqTotalQuestions: submission.mcqTotalQuestions
      }
    });
  } catch (err) {
    console.error('Error recalculating MCQ:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to recalculate MCQ results',
      error: err.message
    });
  }
});

module.exports = router;