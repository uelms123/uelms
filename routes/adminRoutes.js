const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const Staff = require('../models/Staff');
const Student = require('../models/Students');

// Add staff with password
router.post('/staff', async (req, res) => {
  try {
    const { name, program, email, tempPassword } = req.body;
    
    if (!name) {
      return res.status(400).json({ 
        success: false,
        error: 'Name is required' 
      });
    }
    
    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: 'Email is required' 
      });
    }
    
    const staff = new Staff({ 
      name: name,
      program: program || null, // Program is optional for staff
      email: email.toLowerCase(),
      tempPassword: tempPassword || null, // Store temporary password for PDF
      createdAt: new Date()
    });
    await staff.save();
    
    res.status(201).json({ 
      success: true,
      message: 'Staff added successfully',
      data: staff
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ 
        success: false,
        error: 'Staff email already exists in database' 
      });
    }
    res.status(500).json({ 
      success: false,
      error: 'Failed to add staff: ' + err.message 
    });
  }
});

// Get staff (without passwords for security)
router.get('/staff', async (req, res) => {
  try {
    const staff = await Staff.find({}, '-tempPassword -__v');
    res.status(200).json(staff);
  } catch (err) {
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch staff: ' + err.message 
    });
  }
});

// Get staff with passwords (for admin PDF generation)
router.get('/staff-with-passwords', async (req, res) => {
  try {
    // Verify admin authentication if needed
    const staff = await Staff.find({}, '-_id -__v');
    res.status(200).json(staff);
  } catch (err) {
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch staff with passwords: ' + err.message 
    });
  }
});

// Get all users from Firebase
router.get('/users', async (req, res) => {
  try {
    const listUsersResult = await admin.auth().listUsers();
    const users = listUsersResult.users.map(user => ({ 
      uid: user.uid,
      email: user.email,
      displayName: user.displayName 
    }));
    res.status(200).json(users);
  } catch (err) {
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch users: ' + err.message 
    });
  }
});

// Delete user (staff or student)
router.delete('/users', async (req, res) => {
  try {
    const { email, type } = req.body;
    console.log('Delete request received:', { email, type });

    if (!email || !type) {
      return res.status(400).json({ 
        success: false,
        error: 'Email and type (staff/student) are required' 
      });
    }

    if (type !== 'staff' && type !== 'student') {
      return res.status(400).json({ 
        success: false,
        error: 'Type must be either "staff" or "student"' 
      });
    }

    // Get Firebase user by email
    const user = await admin.auth().getUserByEmail(email);
    console.log('Firebase user found:', user.uid);

    // Delete from Firebase
    await admin.auth().deleteUser(user.uid);
    console.log('User deleted from Firebase:', user.uid);

    // Delete from MongoDB based on type
    if (type === 'staff') {
      const result = await Staff.deleteOne({ email: email.toLowerCase() });
      console.log('Staff deletion result:', result);
      if (result.deletedCount === 0) {
        return res.status(404).json({ 
          success: false,
          error: 'Staff not found in database' 
        });
      }
    } else if (type === 'student') {
      console.log('Attempting to delete student from MongoDB:', email.toLowerCase());
      const result = await Student.deleteOne({ email: email.toLowerCase() });
      console.log('Student deletion result:', result);
      if (result.deletedCount === 0) {
        return res.status(404).json({ 
          success: false,
          error: 'Student not found in database' 
        });
      }
    }

    res.status(200).json({ 
      success: true,
      message: `User ${email} deleted successfully` 
    });
  } catch (err) {
    console.error('Error occurred:', err);
    if (err.code === 'auth/user-not-found') {
      res.status(404).json({ 
        success: false,
        error: 'User not found in Firebase' 
      });
    } else {
      res.status(500).json({ 
        success: false,
        error: 'Failed to delete user: ' + err.message 
      });
    }
  }
});

// Update user (staff or student)
router.put('/users', async (req, res) => {
  try {
    const { oldEmail, newEmail, type, newPassword, name, program, tempPassword } = req.body;
    console.log('Update request received:', { oldEmail, newEmail, type, name, program });

    if (!oldEmail || !newEmail || !type) {
      return res.status(400).json({ 
        success: false,
        error: 'oldEmail, newEmail, and type (staff/student) are required' 
      });
    }

    if (type !== 'staff' && type !== 'student') {
      return res.status(400).json({ 
        success: false,
        error: 'Type must be either "staff" or "student"' 
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid new email format' 
      });
    }

    if (newPassword && newPassword.length < 6) {
      return res.status(400).json({ 
        success: false,
        error: 'New password must be at least 6 characters' 
      });
    }

    // Get Firebase user by old email
    let user;
    try {
      user = await admin.auth().getUserByEmail(oldEmail);
      console.log('Firebase user found:', user.uid);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        return res.status(404).json({ 
          success: false,
          error: 'User not found in Firebase' 
        });
      }
      throw err;
    }

    // Check if new email is already in use in Firebase
    if (oldEmail.toLowerCase() !== newEmail.toLowerCase()) {
      try {
        await admin.auth().getUserByEmail(newEmail);
        return res.status(400).json({ 
          success: false,
          error: 'New email is already in use' 
        });
      } catch (err) {
        if (err.code !== 'auth/user-not-found') throw err;
      }
    }

    // Update Firebase user
    const updateData = {};
    if (newEmail) updateData.email = newEmail;
    if (newPassword) updateData.password = newPassword;
    if (Object.keys(updateData).length > 0) {
      await admin.auth().updateUser(user.uid, updateData);
      console.log('User updated in Firebase:', user.uid);
    }

    // Update MongoDB based on type
    if (type === 'staff') {
      const updateFields = {};
      if (name) updateFields.name = name;
      if (program !== undefined) updateFields.program = program;
      if (tempPassword !== undefined) updateFields.tempPassword = tempPassword;
      if (oldEmail.toLowerCase() !== newEmail.toLowerCase()) {
        updateFields.email = newEmail.toLowerCase();
      }
      
      if (Object.keys(updateFields).length > 0) {
        await Staff.updateOne(
          { email: oldEmail.toLowerCase() },
          updateFields
        );
      }
    } else if (type === 'student') {
      const updateFields = {};
      if (name) updateFields.name = name;
      if (program) updateFields.program = program;
      if (tempPassword !== undefined) updateFields.tempPassword = tempPassword;
      if (oldEmail.toLowerCase() !== newEmail.toLowerCase()) {
        updateFields.email = newEmail.toLowerCase();
      }
      
      if (Object.keys(updateFields).length > 0) {
        await Student.updateOne(
          { email: oldEmail.toLowerCase() },
          updateFields
        );
      }
    }

    res.status(200).json({ 
      success: true,
      message: `User ${newEmail} updated successfully` 
    });
  } catch (err) {
    console.error('Error updating user:', err);
    if (err.code === 'auth/email-already-exists') {
      return res.status(400).json({ 
        success: false,
        error: 'New email is already in use' 
      });
    }
    res.status(500).json({ 
      success: false,
      error: 'Failed to update user: ' + err.message 
    });
  }
});

// Bulk user creation (staff or student) with passwords
router.post('/bulk-users', async (req, res) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  try {
    const type = req.query.type; 
    const users = req.body.users;

    if (!type || !['staff', 'student'].includes(type)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid or missing type (staff|student).' 
      });
    }
    
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'No users provided' 
      });
    }

    const results = [];
    for (const user of users) {
      const { name, program, email, password } = user;
      
      // Basic validation
      if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
        results.push({ email: email || 'unknown', success: false, error: 'Email and password are required' });
        continue;
      }
      
      if (!name) {
        results.push({ email, success: false, error: 'Name is required' });
        continue;
      }
      
      if (type === 'student' && !program) {
        results.push({ email, success: false, error: 'Program is required for students' });
        continue;
      }
      
      if (password.length < 6) {
        results.push({ email, success: false, error: 'Password must be at least 6 characters' });
        continue;
      }
      
      if (!emailRegex.test(email)) {
        results.push({ email, success: false, error: 'Invalid email format' });
        continue;
      }

      let lowerEmail = email.toLowerCase();

      try {
        // Check if exists first in Firebase
        try {
          const userRecord = await admin.auth().getUserByEmail(lowerEmail);
          results.push({ email: lowerEmail, success: false, error: 'Email already exists in Firebase' });
          continue;
        } catch (err) {
          if (err.code !== 'auth/user-not-found') throw err;
        }

        // Create in Firebase
        await admin.auth().createUser({ 
          email: lowerEmail, 
          password,
          displayName: name
        });

        // Add to MongoDB with password
        if (type === 'staff') {
          const staffData = {
            name: name,
            program: program || null,
            email: lowerEmail,
            tempPassword: password, // Store password for PDF
            createdAt: new Date()
          };
          await Staff.updateOne(
            { email: lowerEmail }, 
            staffData, 
            { upsert: true }
          );
        } else {
          const studentData = {
            name: name,
            program: program,
            email: lowerEmail,
            tempPassword: password, // Store password for PDF
            createdAt: new Date()
          };
          await Student.updateOne(
            { email: lowerEmail }, 
            studentData, 
            { upsert: true }
          );
        }

        results.push({ email: lowerEmail, success: true });
      } catch (err) {
        results.push({ email: lowerEmail, success: false, error: err.message });
      }
    }

    res.status(200).json({ 
      success: true,
      results 
    });
  } catch (err) {
    res.status(500).json({ 
      success: false,
      error: 'Failed to bulk create users: ' + err.message 
    });
  }
});

// Clear temporary passwords (security cleanup)
router.post('/clear-temp-passwords', async (req, res) => {
  try {
    // Clear passwords older than 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    await Staff.updateMany(
      { 
        tempPassword: { $exists: true },
        createdAt: { $lt: twentyFourHoursAgo }
      },
      { $unset: { tempPassword: "" } }
    );
    
    await Student.updateMany(
      { 
        tempPassword: { $exists: true },
        createdAt: { $lt: twentyFourHoursAgo }
      },
      { $unset: { tempPassword: "" } }
    );
    
    res.status(200).json({ 
      success: true,
      message: 'Temporary passwords cleared successfully'
    });
  } catch (err) {
    res.status(500).json({ 
      success: false,
      error: 'Failed to clear temporary passwords: ' + err.message 
    });
  }
});

module.exports = router;