const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Message = require('../models/Message');
const Class = require('../models/Class');

// Get all messages for a class
router.get('/:classId/messages', async (req, res) => {
  try {
    const { classId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid class ID format'
      });
    }

    // Check if class exists
    const classExists = await Class.exists({ _id: classId });
    if (!classExists) {
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }

    // Fetch messages with proper population and sorting
    const messages = await Message.find({ classId })
      .sort({ timestamp: 1 })
      .lean();

    console.log(`Fetched ${messages.length} messages for class ${classId}`);

    res.json({
      success: true,
      messages,
      count: messages.length
    });
  } catch (error) {
    console.error('Error fetching messages:', error.message, error.stack);
    res.status(500).json({
      success: false,
      error: `Failed to fetch messages: ${error.message}`
    });
  }
});

// Post a new message
router.post('/:classId/messages', async (req, res) => {
  try {
    const { classId } = req.params;
    const { senderId, senderEmail, senderName, userType, text, photoURL } = req.body;

    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid class ID format'
      });
    }

    if (!senderId || !senderEmail || !senderName || !userType || !text) {
      return res.status(400).json({
        success: false,
        error: 'Sender ID, email, name, user type, and message text are required'
      });
    }

    // Find class with detailed query
    const classData = await Class.findById(classId).lean();
    if (!classData) {
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }

    // Verify user is part of the class with better error messages
    let isAuthorized = false;
    
    if (userType === 'staff') {
      // Check if user is the creator
      if (classData.staffId === senderId) {
        isAuthorized = true;
      }
      // Check if user is in staff array
      if (classData.staff && Array.isArray(classData.staff)) {
        const staffMatch = classData.staff.some(s => 
          s.staffId === senderId || 
          (s.email && s.email.toLowerCase() === senderEmail.toLowerCase())
        );
        if (staffMatch) {
          isAuthorized = true;
        }
      }
    } else if (userType === 'student') {
      if (classData.students && Array.isArray(classData.students)) {
        const studentMatch = classData.students.some(s => 
          s.studentId === senderId || 
          (s.email && s.email.toLowerCase() === senderEmail.toLowerCase())
        );
        if (studentMatch) {
          isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: User not part of this class',
        debug: {
          senderId,
          senderEmail,
          userType,
          classStaffId: classData.staffId,
          staffArray: classData.staff,
          studentsArray: classData.students
        }
      });
    }

    // Create and save message
    const newMessage = new Message({
      classId,
      senderId,
      senderEmail: senderEmail.toLowerCase(),
      senderName,
      userType,
      text,
      photoURL: photoURL || null,
      timestamp: new Date()
    });

    const savedMessage = await newMessage.save();
    
    console.log(`Message saved: ${savedMessage._id} for class ${classId}`);

    // Return the saved message with proper structure
    res.status(201).json({
      success: true,
      message: {
        _id: savedMessage._id,
        classId: savedMessage.classId,
        senderId: savedMessage.senderId,
        senderEmail: savedMessage.senderEmail,
        senderName: savedMessage.senderName,
        userType: savedMessage.userType,
        text: savedMessage.text,
        timestamp: savedMessage.timestamp,
        photoURL: savedMessage.photoURL
      }
    });
  } catch (error) {
    console.error('Error posting message:', error.message, error.stack);
    res.status(500).json({
      success: false,
      error: `Failed to post message: ${error.message}`
    });
  }
});

// Delete all messages for a class (staff only)
router.delete('/:classId/messages', async (req, res) => {
  try {
    const { classId } = req.params;
    const { staffId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid class ID format'
      });
    }

    if (!staffId) {
      return res.status(400).json({
        success: false,
        error: 'Staff ID is required'
      });
    }

    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }

    // Verify user is staff of this class
    let isStaff = false;
    if (classData.staffId === staffId) {
      isStaff = true;
    }
    if (classData.staff && Array.isArray(classData.staff)) {
      const staffMatch = classData.staff.some(s => s.staffId === staffId);
      if (staffMatch) {
        isStaff = true;
      }
    }

    if (!isStaff) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Only class staff can delete all messages'
      });
    }

    const result = await Message.deleteMany({ classId });

    console.log(`Deleted ${result.deletedCount} messages from class ${classId}`);

    res.json({
      success: true,
      deletedCount: result.deletedCount,
      message: 'All messages deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting all messages:', error.message, error.stack);
    res.status(500).json({
      success: false,
      error: `Failed to delete all messages: ${error.message}`
    });
  }
});

// Delete a specific message (staff can delete any message)
router.delete('/:classId/messages/:messageId', async (req, res) => {
  try {
    const { classId, messageId } = req.params;
    const { staffId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(classId) || !mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid ID format'
      });
    }

    if (!staffId) {
      return res.status(400).json({
        success: false,
        error: 'Staff ID is required'
      });
    }

    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({
        success: false,
        error: 'Class not found'
      });
    }

    // Verify message exists
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }

    // Verify user is staff of this class (staff can delete any message)
    let isStaff = false;
    if (classData.staffId === staffId) {
      isStaff = true;
    }
    if (classData.staff && Array.isArray(classData.staff)) {
      const staffMatch = classData.staff.some(s => s.staffId === staffId);
      if (staffMatch) {
        isStaff = true;
      }
    }

    if (!isStaff) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Only staff can delete messages'
      });
    }

    await Message.findByIdAndDelete(messageId);

    console.log(`Deleted message ${messageId} from class ${classId}`);

    res.json({
      success: true,
      message: 'Message deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting message:', error.message, error.stack);
    res.status(500).json({
      success: false,
      error: `Failed to delete message: ${error.message}`
    });
  }
});

module.exports = router;