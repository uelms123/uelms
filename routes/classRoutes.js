
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Class = require('../models/Class');
const Staff = require('../models/Staff');
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

// Helper function to check staff access
// classRoutes.js - Update the checkStaffAccess helper function (around line 20)
const checkStaffAccess = (classData, staffId, userEmail) => {
  if (!classData) return false;
  
  // Normalize email to lowercase
  const normalizedEmail = userEmail ? userEmail.toLowerCase() : null;
  
  // Check if staff has access to the class
  const hasAccess = 
    classData.staffId === staffId || // Is the creator
    (classData.staff && Array.isArray(classData.staff) && classData.staff.some(s => 
      s.staffId === staffId || // In staff array by staffId
      (normalizedEmail && s.email && s.email.toLowerCase() === normalizedEmail) // In staff array by email
    ));
  
  console.log('Access check:', {
    classId: classData._id,
    className: classData.name,
    staffId,
    userEmail: normalizedEmail,
    classStaffId: classData.staffId,
    staffArray: classData.staff ? classData.staff.map(s => ({ 
      email: s.email, 
      staffId: s.staffId,
      name: s.name 
    })) : [],
    hasAccess
  });
  
  return hasAccess;
};

// Create a new class
router.post('/', async (req, res) => {
  try {
    const { name, section, subject, teacher, staffId, email, position, department, phone } = req.body;

    if (!name || !staffId || !email) {
      return res.status(400).json({ 
        success: false,
        error: 'Class name, staff ID, and email are required' 
      });
    }

    const newClass = new Class({
      name,
      section,
      subject,
      teacher: teacher || '',
      staffId,
      color: req.body.color || 'blue',
      staff: [{
        staffId,
        name: teacher || email.split('@')[0] || 'Unknown',
        email,
        position: position || '',
        department: department || '',
        phone: phone || '',
        joinedAt: new Date()
      }],
      students: []
    });

    await newClass.save();
    
    try {
      const staff = await Staff.findOne({ staffId: staffId });
      if (staff) {
        staff.createdClasses.push(newClass._id);
        await staff.save();
      }
    } catch (err) {
      console.log('Note: Could not update staff classes array:', err.message);
    }
    
    res.status(201).json({
      success: true,
      class: newClass
    });
  } catch (error) {
    console.error('Error creating class:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to create class: ${error.message}`
    });
  }
});

// Get all classes (with optional staffId filter)
router.get('/', async (req, res) => {
  try {
    const { staffId } = req.query;
    const { email } = req.query; // Add email parameter for shared classes
    
    let query = {};
    if (staffId) {
      // If email is provided, check both staffId and email
      if (email) {
        query.$or = [
          { staffId },
          { 'staff.staffId': staffId },
          { 'staff.email': email.toLowerCase() }
        ];
      } else {
        query.$or = [
          { staffId },
          { 'staff.staffId': staffId }
        ];
      }
    }

    const classes = await Class.find(query).sort({ createdAt: -1 });
    res.json({ 
      success: true,
      classes 
    });
  } catch (error) {
    console.error('Error fetching classes:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to fetch classes: ${error.message}`
    });
  }
});

// Get all classes for a staff member (including shared ones)
router.get('/staff/:staffId/all', async (req, res) => {
  try {
    const { staffId } = req.params;
    const { email } = req.query;
    
    if (!staffId) {
      return res.status(400).json({ 
        success: false,
        error: 'Staff ID is required' 
      });
    }

    // Query for all classes where staff has access
    const classes = await Class.find({
      $or: [
        { staffId: staffId },
        { 'staff.staffId': staffId },
        { 'staff.email': email ? email.toLowerCase() : null }
      ].filter(condition => {
        // Remove null conditions
        if (condition && typeof condition === 'object') {
          const key = Object.keys(condition)[0];
          const value = condition[key];
          return value !== null && value !== undefined;
        }
        return true;
      })
    }).sort({ createdAt: -1 });

    res.json({ 
      success: true,
      classes,
      count: classes.length
    });
  } catch (error) {
    console.error('Error fetching all classes for staff:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to fetch classes: ${error.message}`
    });
  }
});

// Join a class (for students)
router.post('/join', async (req, res) => {
  try {
    const { classCode, studentId, name, email, rollNumber, batch, major } = req.body;
    if (!classCode || !studentId || !email) {
      return res.status(400).json({ 
        success: false,
        error: 'Class code, student ID, and email are required' 
      });
    }

    const classToJoin = await Class.findById(classCode);
    if (!classToJoin) {
      return res.status(404).json({ 
        success: false,
        error: 'Class not found' 
      });
    }

    const alreadyJoined = classToJoin.students.some(
      student => student.studentId === studentId
    );

    if (alreadyJoined) {
      return res.status(400).json({  
        success: false,
        error: 'Student already joined this class' 
      });
    }
    
    classToJoin.students.push({
      studentId,
      name: name || email.split('@')[0] || 'Unknown',
      email,
      rollNumber: rollNumber || '',
      batch: batch || '',
      major: major || '',
      joinedAt: new Date()
    });

    await classToJoin.save();

    res.status(200).json({ 
      success: true,
      class: classToJoin,
      message: 'Successfully joined class'
    });
  } catch (error) {
    console.error('Error joining class:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to join class: ${error.message}`
    });
  }
});

// Verify class for sharing
router.get('/:id/verify', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid ID format' 
      });
    }

    const classToShare = await Class.findById(req.params.id);
    if (!classToShare) {
      return res.status(404).json({ 
        success: false,
        error: 'Class not found' 
      });
    }

    res.json({ 
      success: true,
      class: classToShare,
      message: 'Class verified and ready for sharing'
    });
  } catch (error) {
    console.error('Error verifying class:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to verify class: ${error.message}`
    });
  }
});

// Get class details for a specific staff member
router.get('/:classId/staff/:staffId', async (req, res) => {
  try {
    const { classId, staffId } = req.params;
    const { email } = req.query;

    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid class ID format' 
      });
    }

    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ 
        success: false,
        error: 'Class not found' 
      });
    }

    // Use helper function
    const isAuthorized = checkStaffAccess(classData, staffId, email);
    
    if (!isAuthorized) {
      return res.status(403).json({ 
        success: false,
        error: 'Unauthorized: Staff member does not have access to this class',
        debug: {
          staffId,
          userEmail: email,
          classStaffId: classData.staffId,
          staffInClass: classData.staff ? classData.staff.map(s => ({ email: s.email, staffId: s.staffId })) : []
        }
      });
    }

    res.json({ 
      success: true,
      class: classData 
    });
  } catch (error) {
    console.error('Error fetching class details:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to fetch class details: ${error.message}`
    });
  }
});

// Get people in a class (for staff)
router.get('/:classId/people/staff/:staffId', async (req, res) => {
  try {
    const { classId, staffId } = req.params;
    const { email } = req.query;

    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid class ID format' 
      });
    }

    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ 
        success: false,
        error: 'Class not found' 
      });
    }

    // Use helper function
    const isAuthorized = checkStaffAccess(classData, staffId, email);
    
    if (!isAuthorized) {
      return res.status(403).json({ 
        success: false,
        error: 'Unauthorized: Staff member does not have access to this class' 
      });
    }

    // Combine staff and students into a single people array
    const people = [
      ...(classData.staff || []).map(s => ({
        id: s.staffId,
        name: s.name || extractNameFromEmail(s.email),
        email: s.email || 'N/A',
        role: 'staff',
        position: s.position || '',
        department: s.department || '',
        phone: s.phone || '',
        pinned: false
      })),
      ...(classData.students || []).map(s => ({
        id: s.studentId,
        name: s.name || extractNameFromEmail(s.email),
        email: s.email || 'N/A',
        role: 'student',
        rollNumber: s.rollNumber || '',
        batch: s.batch || '',
        major: s.major || '',
        pinned: false
      }))
    ];

    res.json({ 
      success: true,
      people,
      className: classData.name
    });
  } catch (error) {
    console.error('Error fetching people:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to fetch people: ${error.message}`
    });
  }
});

// Invite a person to a class
router.post('/:classId/invite/staff/:staffId', async (req, res) => {
  try {
    const { classId, staffId } = req.params;
    const { email: inviteeEmail, role, name, inviteStaffId } = req.body;
    const { email: inviterEmail } = req.query;

    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid class ID format' 
      });
    }

    if (!inviteeEmail || !role) {
      return res.status(400).json({ 
        success: false,
        error: 'Email and role are required' 
      });
    }

    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ 
        success: false,
        error: 'Class not found' 
      });
    }

    // Use helper function with inviter's email
    const isAuthorized = checkStaffAccess(classData, staffId, inviterEmail);
    
    if (!isAuthorized) {
      return res.status(403).json({ 
        success: false,
        error: 'Unauthorized: Staff member does not have access to this class' 
      });
    }

    // Check if person already exists
    const alreadyExists = 
      (classData.staff && classData.staff.some(s => s.email === inviteeEmail.toLowerCase())) || 
      (classData.students && classData.students.some(s => s.email === inviteeEmail.toLowerCase()));
    
    if (alreadyExists) {
      return res.status(400).json({ 
        success: false,
        error: 'This person is already in the class' 
      });
    }

    let personId;
    let personName = name || inviteeEmail.split('@')[0] || 'Unknown';

    if (role === 'staff') {
      // Look up staff in Staff collection
      const staffMember = await Staff.findOne({ 
        $or: [
          { email: inviteeEmail.toLowerCase() },
          { staffId: inviteStaffId }
        ]
      });
      
      if (!staffMember) {
        return res.status(404).json({ 
          success: false,
          error: 'Staff member not found in the system' 
        });
      }
      
      personId = staffMember.staffId;
      personName = staffMember.name || personName;
      
      console.log('Adding staff to class:', {
        personId,
        personName,
        email: inviteeEmail.toLowerCase()
      });
      
      // Check if already in staff array
      const alreadyInStaff = classData.staff && classData.staff.some(s => 
        s.staffId === personId || s.email === inviteeEmail.toLowerCase()
      );
      
      if (alreadyInStaff) {
        return res.status(400).json({ 
          success: false,
          error: 'Staff member already in this class' 
        });
      }
      
      // Add staff to the class
      if (!classData.staff) classData.staff = [];
      
      classData.staff.push({
        staffId: personId,
        name: personName,
        email: inviteeEmail.toLowerCase(),
        position: req.body.position || staffMember.department || 'Teacher',
        department: staffMember.department || '',
        phone: '',
        joinedAt: new Date()
      });
    } else {
      // For students, find them in Student collection
      const student = await Student.findOne({ email: inviteeEmail.toLowerCase() });
      if (!student) {
        return res.status(404).json({ 
          success: false,
          error: 'Student not found in the system' 
        });
      }
      
      personId = student._id.toString();
      personName = student.name || personName;
      
      if (!classData.students) classData.students = [];
      
      classData.students.push({
        studentId: personId,
        name: personName,
        email: inviteeEmail.toLowerCase(),
        rollNumber: student.rollNumber || '',
        batch: student.batch || '',
        major: student.major || '',
        joinedAt: new Date()
      });
    }

    await classData.save();

    const person = {
      id: personId,
      name: personName,
      email: inviteeEmail.toLowerCase(),
      role,
      pinned: false
    };

    res.json({ 
      success: true,
      person,
      message: `${role === 'staff' ? 'Staff member' : 'Student'} added successfully to the class`
    });
  } catch (error) {
    console.error('Error inviting person:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to invite person: ${error.message}`
    });
  }
});

// Remove a person from a class
router.delete('/:classId/people/:personId/staff/:staffId', async (req, res) => {
  try {
    const { classId, personId, staffId } = req.params;
    const { email } = req.query;

    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid class ID format' 
      });
    }

    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ 
        success: false,
        error: 'Class not found' 
      });
    }

    // Use helper function
    const isAuthorized = checkStaffAccess(classData, staffId, email);
    
    if (!isAuthorized) {
      return res.status(403).json({ 
        success: false,
        error: 'Unauthorized: Staff member does not have access to this class' 
      });
    }

    // Check if person exists in staff or students
    const staffIndex = classData.staff ? classData.staff.findIndex(s => s.staffId === personId) : -1;
    const studentIndex = classData.students ? classData.students.findIndex(s => s.studentId === personId) : -1;

    if (staffIndex === -1 && studentIndex === -1) {
      return res.status(404).json({ 
        success: false,
        error: 'Person not found in this class' 
      });
    }

    if (staffIndex !== -1) {
      classData.staff.splice(staffIndex, 1);
    } else {
      classData.students.splice(studentIndex, 1);
    }

    await classData.save();

    res.json({ 
      success: true,
      message: 'Person removed successfully'
    });
  } catch (error) {
    console.error('Error removing person:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to remove person: ${error.message}`
    });
  }
});

// Update a class
router.put('/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid ID format' 
      });
    }

    const updatedClass = await Class.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!updatedClass) {
      return res.status(404).json({ 
        success: false,
        error: 'Class not found' 
      });
    }

    res.json({ 
      success: true,
      class: updatedClass 
    });
  } catch (error) {
    console.error('Error updating class:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to update class: ${error.message}`
    });
  }
});

// Delete a class
router.delete('/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid ID format' 
      });
    }

    const deletedClass = await Class.findByIdAndDelete(req.params.id);
    if (!deletedClass) {
      return res.status(404).json({ 
        success: false,
        error: 'Class not found' 
      });
    }

    res.json({ 
      success: true,
      message: 'Class deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting class:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to delete class: ${error.message}`
    });
  }
});

// Check if student is enrolled
router.get('/:classId/students/:studentId', async (req, res) => {
  try {
    const { classId, studentId } = req.params;
    const { email } = req.query;

    const classData = await Class.findById(classId);
    if (!classData) {
      return res.json({ isEnrolled: false });
    }

    const isEnrolled = classData.students && classData.students.some(s => 
      s.studentId === studentId || s.email === email
    );

    res.json({ isEnrolled });
    
  } catch (err) {
    res.status(500).json({ 
      success: false,
      error: 'Enrollment check failed' 
    });
  }
});

// Get people in class (for students)
router.get('/:classId/people/student/:studentId', async (req, res) => {
  try {
    const { classId, studentId } = req.params;
    const { email } = req.query;

    // Validate inputs
    if (!email || email === 'undefined') {
      return res.status(400).json({ 
        success: false,
        error: 'Valid email is required' 
      });
    }

    // Find class and validate
    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ 
        success: false,
        error: 'Class not found' 
      });
    }

    // Verify student enrollment
    const isEnrolled = classData.students && classData.students.some(student => 
      (student.studentId === studentId || student.email === email)
    );

    if (!isEnrolled) {
      return res.status(403).json({ 
        success: false,
        error: 'Unauthorized: Student not enrolled in this class' 
      });
    }

    // Prepare response data
    const response = {
      success: true,
      people: [
        ...(classData.staff || []).map(s => ({
          id: s.staffId,
          name: s.name,
          email: s.email,
          role: 'staff'
        })),
        ...(classData.students || []).map(s => ({
          id: s.studentId,
          name: s.name,
          email: s.email,
          role: 'student'
        }))
      ],
      className: classData.name
    };

    res.json(response);

  } catch (error) {
    console.error('Error in /people route:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error while fetching class people' 
    });
  }
});

// Add a single student to a classroom
router.post('/:classId/people/staff/:staffId', async (req, res) => {
  try {
    const { classId, staffId } = req.params;
    const { studentEmail } = req.body;
    const { email: staffEmail } = req.query;

    // Validate input
    if (!studentEmail) {
      return res.status(400).json({ 
        success: false,
        error: 'Student email is required' 
      });
    }

    // Check if the classroom exists
    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ 
        success: false,
        error: 'Class not found' 
      });
    }

    // Verify if the staffId is part of the class
    const isAuthorized = checkStaffAccess(classData, staffId, staffEmail);
    if (!isAuthorized) {
      return res.status(403).json({ 
        success: false,
        error: 'Unauthorized: Staff member does not have access to this class' 
      });
    }

    // Find the student by email
    const student = await Student.findOne({ email: studentEmail.toLowerCase() });
    if (!student) {
      return res.status(404).json({ 
        success: false,
        error: 'Student not found with the provided email' 
      });
    }

    // Check if the student is already in the classroom
    const alreadyJoined = classData.students && classData.students.some(s => 
      s.studentId === student._id.toString() || 
      s.email.toLowerCase() === studentEmail.toLowerCase()
    );
    
    if (alreadyJoined) {
      return res.status(400).json({ 
        success: false,
        error: 'Student is already in the classroom' 
      });
    }

    // Add the student to the classroom
    if (!classData.students) classData.students = [];
    
    classData.students.push({
      studentId: student._id.toString(),
      name: student.name || studentEmail.split('@')[0] || 'Unknown',
      email: studentEmail.toLowerCase(),
      rollNumber: student.rollNumber || '',
      batch: student.batch || '',
      major: student.major || '',
      joinedAt: new Date()
    });
    
    await classData.save();

    res.status(200).json({ 
      success: true,
      message: `Student ${student.email} successfully added to class ${classId}`,
      data: { 
        studentId: student._id, 
        classroomId: classId,
        name: student.name || studentEmail.split('@')[0]
      }
    });
  } catch (err) {
    console.error('Error adding student to classroom:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to add student: ' + err.message 
    });
  }
});

// Get student's classes
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { email } = req.query;
    console.log('GET /student/:studentId - studentId:', studentId, 'email:', email);

    if (!email || email === 'undefined') {
      console.error('Invalid email provided:', email);
      return res.status(400).json({ 
        success: false,
        error: 'Valid email query parameter is required' 
      });
    }

    // Find classes where the student's email is in the students array
    const studentClasses = await Class.find({
      'students.email': email.toLowerCase()
    }).sort({ createdAt: -1 });

    console.log('Found classes:', studentClasses.length);
    res.json({ 
      success: true,
      classes: studentClasses 
    });
  } catch (error) {
    console.error('Error fetching student classes:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to fetch student classes: ${error.message}`
    });
  }
});

// Bulk add students to a class
router.post('/:classId/people/bulk/staff/:staffId', async (req, res) => {
  try {
    const { classId, staffId } = req.params;
    const { studentEmails } = req.body;
    const { email: staffEmail } = req.query;

    // Validate input
    if (!studentEmails || !Array.isArray(studentEmails)) {
      return res.status(400).json({ 
        success: false,
        error: 'Student emails array is required' 
      });
    }

    // Remove duplicates from studentEmails array
    const uniqueEmails = [...new Set(studentEmails.map(email => email?.toLowerCase()))].filter(email => email);

    // Check if the classroom exists
    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ 
        success: false,
        error: 'Class not found' 
      });
    }

    // Verify if the staffId is part of the class
    const isAuthorized = checkStaffAccess(classData, staffId, staffEmail);
    if (!isAuthorized) {
      return res.status(403).json({ 
        success: false,
        error: 'Unauthorized: Staff member does not have access to this class' 
      });
    }

    const addedStudents = [];
    const skippedEmails = [];

    // Process each unique email
    for (const email of uniqueEmails) {
      try {
        // Validate email format
        if (!email || !email.includes('@')) {
          skippedEmails.push(email);
          continue;
        }

        // Find the student by email
        const student = await Student.findOne({ email: email.toLowerCase() });
        if (!student) {
          skippedEmails.push(email);
          continue;
        }

        // Check if the student is already in the classroom
        const alreadyJoined = classData.students && classData.students.some(s => 
          s.studentId === student._id.toString() || 
          s.email.toLowerCase() === email.toLowerCase()
        );
        
        if (alreadyJoined) {
          skippedEmails.push(email);
          continue;
        }

        // Add the student to the classroom
        if (!classData.students) classData.students = [];
        
        classData.students.push({
          studentId: student._id.toString(),
          name: student.name || email.split('@')[0] || 'Unknown',
          email: email.toLowerCase(),
          rollNumber: student.rollNumber || '',
          batch: student.batch || '',
          major: student.major || '',
          joinedAt: new Date()
        });

        addedStudents.push({
          studentId: student._id.toString(),
          email: email.toLowerCase(),
          name: student.name || email.split('@')[0] || 'Unknown'
        });
      } catch (error) {
        console.error(`Error processing email ${email}:`, error.message);
        skippedEmails.push(email);
      }
    }

    // Save the updated class data
    await classData.save();

    res.status(200).json({ 
      success: true,
      addedStudents,
      skippedEmails,
      message: `${addedStudents.length} student${addedStudents.length === 1 ? '' : 's'} added successfully`
    });
  } catch (error) {
    console.error('Error in bulk student addition:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to add students: ${error.message}`
    });
  }
});

// Get all students in a class
router.get('/:classId/students', async (req, res) => {
  try {
    const { classId } = req.params;
    const { email: staffEmail, staffId } = req.query;

    if (!mongoose.Types.ObjectId.isValid(classId)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid class ID format' 
      });
    }

    const classData = await Class.findById(classId);
    if (!classData) {
      return res.status(404).json({ 
        success: false, 
        error: 'Class not found' 
      });
    }

    // Check access if staffId is provided
    if (staffId) {
      const isAuthorized = checkStaffAccess(classData, staffId, staffEmail);
      if (!isAuthorized) {
        return res.status(403).json({ 
          success: false, 
          error: 'Unauthorized access' 
        });
      }
    }

    res.json({ 
      success: true, 
      students: classData.students || [] 
    });
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get classes by staff email (for shared classes)
router.get('/staff/email/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: 'Email is required' 
      });
    }

    // Find classes where staff email is in the staff array
    const classes = await Class.find({
      'staff.email': email.toLowerCase()
    }).sort({ createdAt: -1 });

    res.json({ 
      success: true,
      classes 
    });
  } catch (error) {
    console.error('Error fetching classes by staff email:', error.message, error.stack);
    res.status(500).json({ 
      success: false,
      error: `Failed to fetch classes: ${error.message}`
    });
  }
});

// Debug endpoint to check staff access
router.get('/:classId/access/:staffId', async (req, res) => {
  try {
    const { classId, staffId } = req.params;
    const { email } = req.query;
    
    const classData = await Class.findById(classId);
    if (!classData) {
      return res.json({ hasAccess: false, reason: 'Class not found' });
    }
    
    const isCreator = classData.staffId === staffId;
    const isInStaffArray = classData.staff && classData.staff.some(s => 
      s.staffId === staffId || 
      s.email === email?.toLowerCase()
    );
    
    res.json({
      hasAccess: isCreator || isInStaffArray,
      isCreator,
      isInStaffArray,
      classData: {
        name: classData.name,
        staffId: classData.staffId,
        staff: classData.staff ? classData.staff.map(s => ({ email: s.email, staffId: s.staffId })) : []
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
