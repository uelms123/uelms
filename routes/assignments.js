const express = require('express');
const router = express.Router();
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const fs = require('fs');

router.get('/:classId', async (req, res) => {
  try {
    // Find all assignments for this class
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

    // Filter to only show assignments (not meetings)
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

router.post('/', async (req, res) => {
  try {
    const { meetLink, type, staffId } = req.body;

    // Ensure type is set to 'assignment' for regular assignments
    const assignmentType = req.body.assignmentType ? 'assignment' : (type || 'assignment');
    
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

    const assignment = new Assignment({
      classId: req.body.classId,
      staffId: staffId,
      type: assignmentType, // This should be 'assignment' for text/mcq assignments
      title: req.body.title,
      description: req.body.description,
      assignmentType: req.body.assignmentType, // This is 'question' or 'mcq'
      question: req.body.question || null,
      mcqQuestions: req.body.mcqQuestions || [],
      meetTime: req.body.meetTime,
      meetLink: validatedMeetLink,
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

router.put('/:id', async (req, res) => {
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
    assignment.question = question !== undefined ? question : assignment.question;
    assignment.mcqQuestions = mcqQuestions || assignment.mcqQuestions;
    assignment.meetTime = meetTime || assignment.meetTime;
    assignment.meetLink = validatedMeetLink;
    assignment.updatedAt = Date.now();

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
    for (const submission of submissions) {
      for (const file of submission.files) {
        try {
          if (file.path && fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        } catch (fileErr) {
          console.error(`Failed to delete file ${file.path}:`, fileErr.message);
        }
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