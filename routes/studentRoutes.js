const express = require('express');
const router = express.Router();
const Student = require('../models/Students');
const Class = require('../models/Class');
const bcrypt = require('bcryptjs');
const { getAuth, createUserWithEmailAndPassword } = require('firebase/auth');
const { initializeApp } = require('firebase/app');

// Initialize Firebase if not already initialized
let auth;
try {
  const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
  };
  
  const firebaseApp = initializeApp(firebaseConfig, 'studentBulkUpload');
  auth = getAuth(firebaseApp);
} catch (error) {
  console.warn('Firebase initialization failed for bulk upload:', error.message);
  auth = null;
}

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
    const { name, program, email, tempPassword, password } = req.body;
    
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
      tempPassword: tempPassword || password || null, // Store temporary password for PDF
      password: password || tempPassword || null, // Store actual password
      createdByAdmin: true,
      accountCreated: new Date(),
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

// NEW: Bulk upload students from CSV/XLSX
router.post('/bulk-upload', async (req, res) => {
  try {
    const { users, chunkNumber, totalChunks } = req.body;
    
    if (!users || !Array.isArray(users)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid data format. Expected array of users.' 
      });
    }

    console.log(`Processing bulk upload chunk ${chunkNumber || 1}/${totalChunks || 1} with ${users.length} users`);

    const results = {
      success: 0,
      failed: 0,
      errors: [],
      chunkNumber: chunkNumber || 1,
      totalChunks: totalChunks || 1,
      created: [],
      updated: []
    };

    // Process users sequentially to avoid database conflicts
    for (const user of users) {
      try {
        const { name, program, email, password } = user;
        
        // Validate required fields
        if (!name || !name.trim()) {
          results.failed++;
          results.errors.push(`Missing name for user with email: ${email || 'unknown'}`);
          continue;
        }
        
        if (!program || !program.trim()) {
          results.failed++;
          results.errors.push(`Missing program for user: ${email || 'unknown'}`);
          continue;
        }
        
        if (!email || !email.trim()) {
          results.failed++;
          results.errors.push(`Missing email for user: ${name || 'unknown'}`);
          continue;
        }
        
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
          results.failed++;
          results.errors.push(`Invalid email format: ${email}`);
          continue;
        }
        
        if (!password || password.length < 6) {
          results.failed++;
          results.errors.push(`Password must be at least 6 characters for: ${email}`);
          continue;
        }

        const cleanEmail = email.toLowerCase().trim();
        const cleanName = name.trim();
        const cleanProgram = program.trim();
        
        // Check if user already exists
        const existingStudent = await Student.findOne({ email: cleanEmail });

        if (existingStudent) {
          // Update existing student
          existingStudent.name = cleanName;
          existingStudent.program = cleanProgram;
          existingStudent.password = password;
          existingStudent.tempPassword = password;
          existingStudent.updatedAt = new Date();
          existingStudent.updatedBy = 'bulk-upload';
          
          await existingStudent.save();
          results.updated.push(cleanEmail);
          results.success++;
          console.log(`Updated student: ${cleanEmail}`);
        } else {
          // Create new student
          const newStudent = new Student({
            name: cleanName,
            program: cleanProgram,
            email: cleanEmail,
            password: password,
            tempPassword: password,
            createdByAdmin: true,
            accountCreated: new Date(),
            createdAt: new Date(),
            isActive: true
          });

          await newStudent.save();
          results.created.push(cleanEmail);
          results.success++;
          console.log(`Created new student: ${cleanEmail}`);
        }
      } catch (error) {
        results.failed++;
        const errorMsg = error.code === 11000 
          ? `Duplicate email: ${user.email || 'unknown'}` 
          : `Error processing ${user.email || 'unknown'}: ${error.message}`;
        results.errors.push(errorMsg);
        console.error(`Error processing user ${user.email}:`, error.message);
      }
    }

    console.log(`Chunk ${results.chunkNumber}/${results.totalChunks} completed: ${results.success} success, ${results.failed} failed`);

    res.status(200).json({
      success: true,
      message: `Processed chunk ${results.chunkNumber}/${results.totalChunks}`,
      results: {
        totalProcessed: users.length,
        success: results.success,
        failed: results.failed,
        created: results.created.length,
        updated: results.updated.length,
        errors: results.errors.slice(0, 20) // Return first 20 errors only
      }
    });

  } catch (error) {
    console.error('Bulk upload error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error during bulk upload',
      message: error.message 
    });
  }
});

// Alternative: Bulk upload without Firebase (faster for large datasets)
router.post('/bulk-upload-simple', async (req, res) => {
  try {
    const { users } = req.body;
    
    if (!users || !Array.isArray(users)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid data format. Expected array of users.' 
      });
    }

    console.log(`Processing bulk upload with ${users.length} users`);

    const results = {
      total: users.length,
      created: 0,
      updated: 0,
      failed: 0,
      errors: []
    };

    // Process in batches to avoid memory issues
    const batchSize = 50;
    const operations = [];

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      
      try {
        const { name, program, email, password } = user;
        
        // Validate required fields
        if (!name || !name.trim()) {
          results.failed++;
          results.errors.push(`Row ${i + 1}: Missing name`);
          continue;
        }
        
        if (!program || !program.trim()) {
          results.failed++;
          results.errors.push(`Row ${i + 1}: Missing program for ${email || 'unknown'}`);
          continue;
        }
        
        if (!email || !email.trim()) {
          results.failed++;
          results.errors.push(`Row ${i + 1}: Missing email for ${name || 'unknown'}`);
          continue;
        }
        
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
          results.failed++;
          results.errors.push(`Row ${i + 1}: Invalid email format: ${email}`);
          continue;
        }
        
        if (!password || password.length < 6) {
          results.failed++;
          results.errors.push(`Row ${i + 1}: Password must be at least 6 characters for: ${email}`);
          continue;
        }

        const cleanEmail = email.toLowerCase().trim();
        const cleanName = name.trim();
        const cleanProgram = program.trim();
        
        // Prepare update or insert operation
        operations.push({
          updateOne: {
            filter: { email: cleanEmail },
            update: {
              $set: {
                name: cleanName,
                program: cleanProgram,
                email: cleanEmail,
                password: password,
                tempPassword: password,
                createdByAdmin: true,
                accountCreated: { $ifNull: ["$accountCreated", new Date()] },
                updatedAt: new Date(),
                updatedBy: 'bulk-upload',
                isActive: true
              }
            },
            upsert: true // Create if doesn't exist
          }
        });

      } catch (error) {
        results.failed++;
        results.errors.push(`Row ${i + 1}: ${error.message}`);
      }
      
      // Execute batch when batchSize is reached
      if (operations.length >= batchSize || i === users.length - 1) {
        try {
          const batchResult = await Student.bulkWrite(operations);
          results.created += batchResult.upsertedCount || 0;
          results.updated += batchResult.modifiedCount || 0;
          operations.length = 0; // Clear array
        } catch (batchError) {
          results.failed += operations.length;
          results.errors.push(`Batch error: ${batchError.message}`);
        }
      }
    }

    results.success = results.created + results.updated;
    
    console.log(`Bulk upload completed: ${results.success} success, ${results.failed} failed`);

    res.status(200).json({
      success: true,
      message: `Bulk upload completed successfully`,
      results: {
        total: results.total,
        created: results.created,
        updated: results.updated,
        failed: results.failed,
        success: results.success,
        errors: results.errors.slice(0, 30) // Return first 30 errors only
      }
    });

  } catch (error) {
    console.error('Bulk upload simple error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error during bulk upload',
      message: error.message 
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
    const { name, program, newEmail, tempPassword, password } = req.body;
    
    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: 'Email parameter is required' 
      });
    }

    const updateData = { updatedAt: new Date() };
    if (name) updateData.name = name;
    if (program) updateData.program = program;
    if (tempPassword !== undefined) updateData.tempPassword = tempPassword;
    if (password !== undefined) updateData.password = password;
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

// Bulk delete students (for admin panel)
router.post('/bulk-delete', async (req, res) => {
  try {
    const { emails } = req.body;
    
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Email array is required' 
      });
    }

    // Convert all emails to lowercase
    const lowerEmails = emails.map(email => email.toLowerCase());
    
    const result = await Student.deleteMany({ email: { $in: lowerEmails } });
    
    res.status(200).json({ 
      success: true,
      message: 'Bulk delete completed successfully',
      deletedCount: result.deletedCount,
      totalRequested: emails.length
    });
  } catch (err) {
    console.error('Error in bulk delete:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to delete students: ' + err.message 
    });
  }
});

module.exports = router;