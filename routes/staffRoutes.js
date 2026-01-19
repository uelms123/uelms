const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const Staff = require('../models/Staff');
const Student = require('../models/Students');
const Class = require('../models/Class'); // Add this import

// Add staff
// In staffRoutes.js, update the POST /staff route
router.post('/staff', async (req, res) => {
  try {
    const { name, program, email, password, department } = req.body;
    
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
    
    // CHANGED: Added validation for department/program
    if (!program && !department) {
      return res.status(400).json({ 
        success: false,
        error: 'Department/Program is required' 
      });
    }
    
    // Generate staff ID
    const staffId = `staff_${email.split('@')[0]}_${Date.now().toString().slice(-6)}`;
    
    const staff = new Staff({ 
      staffId,
      name: name,
      department: department || program || '', // Use department or program
      email: email.toLowerCase(),
      tempPassword: password || `temp_${Date.now().toString().slice(-6)}`,
      createdByAdmin: true
    });
    
    // Add to password history
    staff.passwordHistory = [{
      password: password || staff.tempPassword,
      createdAt: new Date(),
      createdBy: 'admin'
    }];
    
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

// NEW: Check if staff exists by email (for adding staff to classroom)
router.get('/email/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: 'Email is required' 
      });
    }
    
    // Find staff by email
    const staff = await Staff.findOne({ email: email.toLowerCase() });
    
    if (!staff) {
      return res.status(200).json({ 
        exists: false,
        message: 'Staff member not found in the system'
      });
    }
    
    res.status(200).json({ 
      exists: true,
      name: staff.name,
      staffId: staff.staffId,
      email: staff.email,
      department: staff.department,
      message: 'Staff member found'
    });
  } catch (error) {
    console.error('Error checking staff:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to check staff'
    });
  }
});

// Get staff with passwords (for admin)
router.get('/with-passwords', async (req, res) => {
  try {
    const staff = await Staff.find().select('+tempPassword +passwordHistory');
    
    // Format response to include password info
    const staffWithPasswords = staff.map(user => {
      const latestPassword = user.passwordHistory && user.passwordHistory.length > 0 
        ? user.passwordHistory[user.passwordHistory.length - 1].password
        : user.tempPassword || 'Not available';
      
      return {
        ...user.toObject(),
        displayPassword: latestPassword,
        hasPasswordHistory: user.passwordHistory && user.passwordHistory.length > 0,
        passwordHistoryCount: user.passwordHistory ? user.passwordHistory.length : 0,
        lastPasswordUpdate: user.lastPasswordUpdated || user.createdAt,
        // CHANGED: Map department to program for compatibility
        program: user.department || ''
      };
    });
    
    res.status(200).json({
      success: true,
      count: staffWithPasswords.length,
      staff: staffWithPasswords
    });
    
  } catch (err) {
    console.error('Error fetching staff with passwords:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch staff with passwords: ' + err.message
    });
  }
});

// Get single staff with password details
router.get('/:email/password-details', async (req, res) => {
  try {
    const { email } = req.params;
    
    const staff = await Staff.findOne({ email: email.toLowerCase() })
      .select('+tempPassword +passwordHistory');
    
    if (!staff) {
      return res.status(404).json({
        success: false,
        error: 'Staff not found'
      });
    }
    
    // Get the latest password
    const latestPassword = staff.passwordHistory && staff.passwordHistory.length > 0 
      ? staff.passwordHistory[staff.passwordHistory.length - 1].password
      : staff.tempPassword || 'Not available';
    
    // Format password history
    const formattedHistory = staff.passwordHistory ? staff.passwordHistory.map(record => ({
      password: record.password,
      date: record.createdAt.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }),
      createdBy: record.createdBy,
      note: record.note || ''
    })).reverse() : [];
    
    res.status(200).json({
      success: true,
      staff: {
        name: staff.name,
        email: staff.email,
        department: staff.department,
        program: staff.department, // For compatibility
        currentPassword: latestPassword,
        passwordHistory: formattedHistory,
        lastUpdated: staff.lastPasswordUpdated || staff.createdAt,
        hasPassword: !!latestPassword && latestPassword !== 'Not available'
      }
    });
    
  } catch (err) {
    console.error('Error fetching password details:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch password details: ' + err.message
    });
  }
});

// Get staff
router.get('/staff', async (req, res) => {
  try {
    const staff = await Staff.find();
    // CHANGED: Map department to program for compatibility
    const formattedStaff = staff.map(user => ({
      ...user.toObject(),
      program: user.department || ''
    }));
    res.status(200).json(formattedStaff);
  } catch (err) {
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch staff: ' + err.message 
    });
  }
});

// Add these routes to your staffRoutes.js file

// Get staff classes (for admin PDF generation)
// staffRoutes.js - Update the /:staffId/classes route (around line 96)
router.get('/:staffId/classes', async (req, res) => {
  try {
    const { staffId } = req.params;
    const { email } = req.query; // Add email parameter
    
    if (!staffId) {
      return res.status(400).json({
        success: false,
        error: 'Staff ID is required'
      });
    }

    // Try to find staff by multiple fields
    let staff = await Staff.findOne({
      $or: [
        { staffId: staffId },
        { email: staffId },
        { email: email } // Check by email query parameter
      ]
    });
    
    if (!staff && email) {
      // If still not found, try just by email
      staff = await Staff.findOne({ email: email.toLowerCase() });
    }
    
    if (!staff) {
      return res.status(404).json({
        success: false,
        error: 'Staff not found'
      });
    }
    
    // Now we have the staff object, fetch their classes
    let classes = [];
    
    // First try: Check if staff has createdClasses populated
    if (staff.createdClasses && staff.createdClasses.length > 0) {
      classes = await Class.find({ _id: { $in: staff.createdClasses } })
        .sort({ createdAt: -1 });
    }
    
    // If no classes found, fallback to querying Class collection
    if (classes.length === 0) {
      classes = await Class.find({
        $or: [
          { staffId: staff.staffId },
          { 'staff.staffId': staff.staffId },
          { 'staff.email': staff.email }
        ]
      }).sort({ createdAt: -1 });
    }
    
    res.status(200).json({
      success: true,
      staffId: staff.staffId,
      staffName: staff.name || 'Unknown',
      staffEmail: staff.email,
      staffDepartment: staff.department,
      classes: classes,
      count: classes.length
    });
    
  } catch (err) {
    console.error('Error fetching staff classes:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch staff classes: ' + err.message
    });
  }
});

// staffRoutes.js - Add new route for getting classes by email
router.get('/email/:email/classes', async (req, res) => {
  try {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    // Find staff by email
    const staff = await Staff.findOne({ email: email.toLowerCase() });
    
    if (!staff) {
      return res.status(404).json({
        success: false,
        error: 'Staff not found with this email'
      });
    }
    
    // Fetch classes
    let classes = [];
    
    // Try from createdClasses first
    if (staff.createdClasses && staff.createdClasses.length > 0) {
      classes = await Class.find({ _id: { $in: staff.createdClasses } })
        .sort({ createdAt: -1 });
    }
    
    // Fallback query
    if (classes.length === 0) {
      classes = await Class.find({
        $or: [
          { staffId: staff.staffId },
          { 'staff.staffId': staff.staffId },
          { 'staff.email': staff.email },
          { staffId: staff.email } // Some classes might use email as staffId
        ]
      }).sort({ createdAt: -1 });
    }
    
    res.status(200).json({
      success: true,
      staffId: staff.staffId,
      staffName: staff.name,
      staffEmail: staff.email,
      staffDepartment: staff.department,
      classes: classes,
      count: classes.length
    });
    
  } catch (err) {
    console.error('Error fetching staff classes by email:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch staff classes: ' + err.message
    });
  }
});

// Get all staff with their classes count
router.get('/with-classes', async (req, res) => {
  try {
    // Fetch all staff
    const allStaff = await Staff.find();
    
    // Create an array with staff info and their classes count
    const staffWithClasses = await Promise.all(allStaff.map(async (staff) => {
      const classesCount = await Class.countDocuments({
        $or: [
          { staffId: staff.staffId },
          { 'staff.staffId': staff.staffId }
        ]
      });
      
      return {
        ...staff.toObject(),
        program: staff.department || '', // For compatibility
        classesCount: classesCount
      };
    }));
    
    res.status(200).json({
      success: true,
      staff: staffWithClasses
    });
    
  } catch (err) {
    console.error('Error fetching staff with classes:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch staff with classes: ' + err.message
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
    const { oldEmail, newEmail, type, newPassword, name, program, department } = req.body;
    console.log('Update request received:', { oldEmail, newEmail, type, name, program, department });

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

    // CHANGED: For staff, require department/program
    if (type === 'staff' && !program && !department) {
      return res.status(400).json({ 
        success: false,
        error: 'Department/Program is required for staff' 
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
      if (program !== undefined) updateFields.department = program || department;
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

// Bulk user creation (staff or student)
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
      const { name, program, email, password, department } = user;
      
      // Basic validation
      if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
        results.push({ email: email || 'unknown', success: false, error: 'Email and password are required' });
        continue;
      }
      
      if (!name) {
        results.push({ email, success: false, error: 'Name is required' });
        continue;
      }
      
      // CHANGED: For staff, require department/program
      if (type === 'staff' && !program && !department) {
        results.push({ email, success: false, error: 'Department/Program is required for staff' });
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

        // Add to MongoDB
        if (type === 'staff') {
          const staffData = {
            name: name,
            department: department || program || '', // Use department or program
            email: lowerEmail
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
            email: lowerEmail
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

module.exports = router;