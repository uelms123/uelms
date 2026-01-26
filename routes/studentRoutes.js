const express = require('express');
const router = express.Router();
const Student = require('../models/Students');
const Class = require('../models/Class');
const bcrypt = require('bcryptjs');
const admin = require('firebase-admin');

async function createFirebaseUser(email, password) {
  try {
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
      emailVerified: false
    });
    return { success: true, uid: userRecord.uid };
  } catch (error) {
    if (error.code === 'auth/email-already-exists') {
      try {
        const existingUser = await admin.auth().getUserByEmail(email);
        await admin.auth().updateUser(existingUser.uid, { password: password });
        return { success: true, alreadyExists: true, uid: existingUser.uid };
      } catch (updateError) {
        return { success: false, error: updateError.message };
      }
    }
    return { success: false, error: error.message };
  }
}

async function deleteFirebaseUser(email) {
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    await admin.auth().deleteUser(userRecord.uid);
    return { success: true };
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      return { success: true, notFound: true };
    }
    return { success: false, error: error.message };
  }
}

async function updateFirebaseUserPassword(email, newPassword) {
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(userRecord.uid, {
      password: newPassword
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

router.get('/', async (req, res) => {
  try {
    const students = await Student.find({}, '-tempPassword -__v');
    res.status(200).json(students);
  } catch (err) {
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch students: ' + err.message 
    });
  }
});

router.get('/with-passwords', async (req, res) => {
  try {
    const students = await Student.find({}, '-_id -__v');
    res.status(200).json(students);
  } catch (err) {
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch students with passwords: ' + err.message 
    });
  }
});

router.get('/:email/enrollment-details', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    
    const student = await Student.findOne({ email: email });
    
    if (!student) {
      return res.status(404).json({ 
        success: false,
        error: 'Student not found' 
      });
    }
    
    const classes = await Class.find({
      'students.email': email
    }).select('name subject teacher staffId staff students createdAt');
    
    const enrolledClasses = [];
    
    classes.forEach(cls => {
      const studentInClass = cls.students.find(s => s.email === email);
      
      let staffEmail = '';
      let staffName = '';
      
      if (cls.staff && cls.staff.length > 0) {
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
        enrollmentDate: student.createdAt
      },
      enrollments: enrolledClasses,
      totalClasses: enrolledClasses.length
    });
    
  } catch (err) {
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch student enrollment details: ' + err.message 
    });
  }
});

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
      tempPassword: tempPassword || password || null,
      password: password || tempPassword || null,
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

router.post('/bulk-upload-simple', async (req, res) => {
  try {
    const { users } = req.body;
    
    if (!users || !Array.isArray(users)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid data format. Expected array of users.' 
      });
    }

    const results = {
      total: users.length,
      created: 0,
      updated: 0,
      failed: 0,
      errors: [],
      firebaseSuccess: 0,
      firebaseFailed: 0
    };

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      
      try {
        const { name, program, email, password } = user;
        
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
        
        const firebaseResult = await createFirebaseUser(cleanEmail, password);
        if (firebaseResult.success) {
          results.firebaseSuccess++;
        } else {
          results.firebaseFailed++;
        }
        
        const existingStudent = await Student.findOne({ email: cleanEmail });
        
        if (existingStudent) {
          existingStudent.name = cleanName;
          existingStudent.program = cleanProgram;
          existingStudent.password = password;
          existingStudent.tempPassword = password;
          existingStudent.updatedAt = new Date();
          existingStudent.updatedBy = 'bulk-upload';
          existingStudent.isActive = true;
          
          await existingStudent.save();
          results.updated++;
        } else {
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
          results.created++;
        }

      } catch (error) {
        results.failed++;
        results.errors.push(`Row ${i + 1} (${user.email || 'unknown'}): ${error.message}`);
      }
    }

    results.success = results.created + results.updated;

    res.status(200).json({
      success: true,
      message: `Bulk upload completed successfully`,
      results: {
        total: results.total,
        created: results.created,
        updated: results.updated,
        failed: results.failed,
        success: results.success,
        firebaseSuccess: results.firebaseSuccess,
        firebaseFailed: results.firebaseFailed,
        errors: results.errors.slice(0, 30)
      }
    });

  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Server error during bulk upload',
      message: error.message 
    });
  }
});

router.delete('/:email', async (req, res) => {
  try {
    const email = req.params.email;
    
    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: 'Email parameter is required' 
      });
    }

    const cleanEmail = email.toLowerCase();
    
    const firebaseResult = await deleteFirebaseUser(cleanEmail);
    
    const result = await Student.deleteOne({ email: cleanEmail });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Student not found with the provided email' 
      });
    }

    res.status(200).json({ 
      success: true,
      message: 'Student deleted successfully from both Firebase and MongoDB',
      deletedCount: result.deletedCount,
      firebaseDeleted: firebaseResult.success
    });
  } catch (err) {
    res.status(500).json({ 
      success: false,
      error: 'Failed to delete student: ' + err.message 
    });
  }
});

router.post('/bulk-delete', async (req, res) => {
  try {
    const { emails } = req.body;
    
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Email array is required' 
      });
    }

    const lowerEmails = emails.map(email => email.toLowerCase());
    
    let firebaseDeletedCount = 0;
    let firebaseFailedCount = 0;
    
    for (const email of lowerEmails) {
      const firebaseResult = await deleteFirebaseUser(email);
      if (firebaseResult.success) {
        firebaseDeletedCount++;
      } else {
        firebaseFailedCount++;
      }
    }
    
    const mongoResult = await Student.deleteMany({ email: { $in: lowerEmails } });
    
    res.status(200).json({ 
      success: true,
      message: 'Bulk delete completed successfully',
      deletedCount: mongoResult.deletedCount,
      totalRequested: emails.length,
      firebaseDeleted: firebaseDeletedCount,
      firebaseFailed: firebaseFailedCount
    });
  } catch (err) {
    res.status(500).json({ 
      success: false,
      error: 'Failed to delete students: ' + err.message 
    });
  }
});

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
    if (password !== undefined) {
      updateData.password = password;
      await updateFirebaseUserPassword(email.toLowerCase(), password);
    }
    if (newEmail) {
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