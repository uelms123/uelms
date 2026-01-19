const express = require('express');
const router = express.Router();
const Student = require('../models/Students');
const Class = require('../models/Class');

// Get all students (without passwords for security)
router.get('/', async (req, res) => {
  try {
    const students = await Student.find({}, '-tempPassword -__v');
    res.status(200).json(students);
  } catch (err) {
    console.error('Error fetching students:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch students: ' + err.message 
    });
  }
});

// Get students with passwords (for admin PDF generation)
router.get('/with-passwords', async (req, res) => {
  try {
    // Verify admin authentication if needed
    const students = await Student.find({}, '-_id -__v');
    res.status(200).json(students);
  } catch (err) {
    console.error('Error fetching students with passwords:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch students with passwords: ' + err.message 
    });
  }
});

// Get student with enrollment details and classes for PDF generation
router.get('/:email/enrollment-details', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    
    // Get student details
    const student = await Student.findOne({ email: email });
    
    if (!student) {
      return res.status(404).json({ 
        success: false,
        error: 'Student not found' 
      });
    }
    
    // Get classes where this student is enrolled
    const classes = await Class.find({
      'students.email': email
    }).select('name subject teacher staffId staff students createdAt');
    
    // Extract enrollment details
    const enrolledClasses = [];
    
    classes.forEach(cls => {
      // Find this specific student in the class
      const studentInClass = cls.students.find(s => s.email === email);
      
      // Get staff details from the class
      let staffEmail = '';
      let staffName = '';
      
      if (cls.staff && cls.staff.length > 0) {
        // Get the primary staff (first one)
        const primaryStaff = cls.staff[0];
        staffEmail = primaryStaff.email || '';
        staffName = primaryStaff.name || cls.teacher || '';
      } else {
        staffName = cls.teacher || '';
      }
      
      enrolledClasses.push({
        className: cls.name || 'N/A',
        subject: cls.subject || 'N/A',
        instructor: staffName,
        instructorEmail: staffEmail,
        staffId: cls.staffId || 'N/A',
        enrollmentDate: studentInClass ? studentInClass.joinedAt : cls.createdAt,
        classCreatedAt: cls.createdAt,
        studentData: studentInClass || {}
      });
    });
    
    res.status(200).json({
      success: true,
      student: {
        studentId: student.studentId,
        name: student.name,
        email: student.email,
        program: student.program,
        tempPassword: student.tempPassword,
        password: student.password,
        createdAt: student.createdAt,
        createdByAdmin: student.createdByAdmin,
        enrollmentDate: student.createdAt // Fallback to account creation date
      },
      enrollments: enrolledClasses,
      totalClasses: enrolledClasses.length
    });
    
  } catch (err) {
    console.error('Error fetching student enrollment details:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch student enrollment details: ' + err.message 
    });
  }
});

// Add new student with password
router.post('/', async (req, res) => {
  try {
    const { name, program, email, tempPassword } = req.body;
    
    if (!name) {
      return res.status(400).json({ 
        success: false,
        error: 'Name is required' 
      });
    }
    
    if (!program) {
      return res.status(400).json({ 
        success: false,
        error: 'Program is required' 
      });
    }
    
    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: 'Email is required' 
      });
    }

    const existingStudent = await Student.findOne({ email: email.toLowerCase() });
    if (existingStudent) {
      return res.status(400).json({ 
        success: false,
        error: 'Student email already exists in database' 
      });
    }

    const newStudent = new Student({ 
      name: name,
      program: program,
      email: email.toLowerCase(),
      tempPassword: tempPassword || null, // Store temporary password for PDF
      createdAt: new Date()
    });
    await newStudent.save();
    
    res.status(201).json({ 
      success: true,
      message: 'Student added successfully',
      data: newStudent
    });
  } catch (err) {
    console.error('Error adding student:', err);
    if (err.code === 11000) {
      return res.status(400).json({ 
        success: false,
        error: 'Student email already exists in database' 
      });
    }
    res.status(500).json({ 
      success: false,
      error: 'Failed to add student: ' + err.message 
    });
  }
});

// Delete student by email
router.delete('/:email', async (req, res) => {
  try {
    const email = req.params.email;
    
    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: 'Email parameter is required' 
      });
    }

    const result = await Student.deleteOne({ email: email.toLowerCase() });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Student not found with the provided email' 
      });
    }

    res.status(200).json({ 
      success: true,
      message: 'Student deleted successfully',
      deletedCount: result.deletedCount
    });
  } catch (err) {
    console.error('Error deleting student:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to delete student: ' + err.message 
    });
  }
});

// Update student by email
router.put('/:email', async (req, res) => {
  try {
    const email = req.params.email;
    const { name, program, newEmail, tempPassword } = req.body;
    
    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: 'Email parameter is required' 
      });
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (program) updateData.program = program;
    if (tempPassword !== undefined) updateData.tempPassword = tempPassword;
    if (newEmail) {
      // Check if new email already exists
      const existingStudent = await Student.findOne({ email: newEmail.toLowerCase() });
      if (existingStudent && existingStudent.email !== email.toLowerCase()) {
        return res.status(400).json({ 
          success: false,
          error: 'New email already exists in database' 
        });
      }
      updateData.email = newEmail.toLowerCase();
    }

    const result = await Student.findOneAndUpdate(
      { email: email.toLowerCase() },
      updateData,
      { new: true }
    );
    
    if (!result) {
      return res.status(404).json({ 
        success: false,
        error: 'Student not found with the provided email' 
      });
    }

    res.status(200).json({ 
      success: true,
      message: 'Student updated successfully',
      data: result
    });
  } catch (err) {
    console.error('Error updating student:', err);
    if (err.code === 11000) {
      return res.status(400).json({ 
        success: false,
        error: 'Email already exists in database' 
      });
    }
    res.status(500).json({ 
      success: false,
      error: 'Failed to update student: ' + err.message 
    });
  }
});

module.exports = router;