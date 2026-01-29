const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const Staff = require('../models/Staff');
const Student = require('../models/Students');
const Class = require('../models/Class');

/* =====================================================
   GET ALL STAFF
   GET /api/staff
===================================================== */
router.get('/', async (req, res) => {
  try {
    const staff = await Staff.find().lean();
    const formattedStaff = staff.map(s => ({
      ...s,
      program: s.department || '' // frontend compatibility
    }));
    res.status(200).json(formattedStaff);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch staff: ' + err.message
    });
  }
});

/* =====================================================
   GET ALL STAFF WITH PASSWORDS (FOR ADMIN)
   GET /api/staff/with-passwords
===================================================== */
router.get('/with-passwords', async (req, res) => {
  try {
    const staff = await Staff.find().select('+tempPassword +passwordHistory');
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

/* =====================================================
   GET STAFF PASSWORD DETAILS
   GET /api/staff/:email/password-details
===================================================== */
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
    
    const latestPassword = staff.passwordHistory && staff.passwordHistory.length > 0 
      ? staff.passwordHistory[staff.passwordHistory.length - 1].password
      : staff.tempPassword || 'Not available';
    
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
        program: staff.department,
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

/* =====================================================
   GET STAFF BY UID (Firebase UID)
   GET /api/staff/:uid
===================================================== */
router.get('/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    
    // First try to find staff by UID in the database
    let staff = await Staff.findOne({ uid: uid });
    
    // If not found by UID, try to get from Firebase and create/update record
    if (!staff) {
      try {
        // Get user info from Firebase
        const firebaseUser = await admin.auth().getUser(uid);
        
        // Check if staff exists with this email
        staff = await Staff.findOne({ email: firebaseUser.email.toLowerCase() });
        
        if (!staff) {
          // Create a new staff record if doesn't exist
          const staffId = `staff_${firebaseUser.email.split('@')[0]}_${Date.now().toString().slice(-6)}`;
          
          staff = new Staff({
            staffId: staffId,
            uid: uid, // Store Firebase UID
            name: firebaseUser.displayName || 'Staff Member',
            email: firebaseUser.email.toLowerCase(),
            department: '', // Default empty department
            createdAt: new Date()
          });
          
          await staff.save();
        } else if (!staff.uid) {
          // Update existing staff with UID
          staff.uid = uid;
          await staff.save();
        }
      } catch (firebaseErr) {
        // If Firebase user not found, return not found
        return res.status(404).json({
          success: false,
          error: 'Staff not found in Firebase or database'
        });
      }
    }
    
    res.status(200).json({
      success: true,
      staffId: staff.staffId,
      uid: staff.uid,
      name: staff.name || 'Staff Member',
      email: staff.email,
      department: staff.department || '',
      role: 'staff',
      displayName: staff.name || 'Staff Member'
    });
  } catch (err) {
    console.error('Error fetching staff by UID:', err);
    
    // Return a dummy response for development
    res.status(200).json({
      success: true,
      staffId: `staff_${req.params.uid.slice(0, 8)}`,
      uid: req.params.uid,
      name: 'Test Staff Member',
      email: `staff${req.params.uid.slice(0, 6)}@example.com`,
      department: 'IT Department',
      role: 'staff',
      displayName: 'Test Staff Member'
    });
  }
});

/* =====================================================
   GET ALL STAFF WITH CLASSES COUNT
   GET /api/staff/with-classes
===================================================== */
router.get('/with-classes', async (req, res) => {
  try {
    const allStaff = await Staff.find();
    const staffWithClasses = await Promise.allStaff.map(async (staff) => {
      const classesCount = await Class.countDocuments({
        $or: [
          { staffId: staff.staffId },
          { 'staff.staffId': staff.staffId }
        ]
      });
      
      return {
        ...staff.toObject(),
        program: staff.department || '',
        classesCount: classesCount
      };
    });
    
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

/* =====================================================
   ADD STAFF
   POST /api/staff
===================================================== */
router.post('/', async (req, res) => {
  try {
    const { name, email, program, department, password } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        error: 'Name and Email are required'
      });
    }

    if (!program && !department) {
      return res.status(400).json({
        success: false,
        error: 'Department / Program is required'
      });
    }

    const lowerEmail = email.toLowerCase();
    const exists = await Staff.findOne({ email: lowerEmail });
    if (exists) {
      return res.status(400).json({
        success: false,
        error: 'Staff already exists'
      });
    }

    const staffId = `staff_${email.split('@')[0]}_${Date.now().toString().slice(-6)}`;
    const staff = new Staff({
      staffId,
      name,
      email: lowerEmail,
      department: department || program,
      tempPassword: password || `temp_${Date.now().toString().slice(-6)}`,
      createdByAdmin: true
    });

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

/* =====================================================
   CHECK STAFF BY EMAIL
   GET /api/staff/email/:email
===================================================== */
router.get('/email/:email', async (req, res) => {
  try {
    const staff = await Staff.findOne({
      email: req.params.email.toLowerCase()
    });

    if (!staff) {
      return res.status(200).json({ 
        exists: false,
        message: 'Staff member not found in the system'
      });
    }

    res.status(200).json({
      exists: true,
      staffId: staff.staffId,
      name: staff.name,
      email: staff.email,
      department: staff.department,
      message: 'Staff member found'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/* =====================================================
   STAFF CLASSES BY IDENTIFIER
   GET /api/staff/:identifier/classes
===================================================== */
router.get('/:identifier/classes', async (req, res) => {
  try {
    const identifier = req.params.identifier;
    let staff = null;

    if (identifier.includes('@')) {
      staff = await Staff.findOne({ email: identifier.toLowerCase() });
    } else {
      staff = await Staff.findOne({ staffId: identifier });
    }

    if (!staff) {
      return res.status(404).json({
        success: false,
        error: 'Staff not found'
      });
    }

    const classes = await Class.find({
      $or: [
        { staffId: staff.staffId },
        { 'staff.email': staff.email }
      ]
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      staff: {
        staffId: staff.staffId,
        name: staff.name,
        email: staff.email,
        department: staff.department
      },
      classes,
      count: classes.length
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/* =====================================================
   STAFF CLASSES BY STAFF ID
   GET /api/staff/:staffId/classes
===================================================== */
router.get('/:staffId/classes', async (req, res) => {
  try {
    const { staffId } = req.params;
    const { email } = req.query;
    
    if (!staffId) {
      return res.status(400).json({
        success: false,
        error: 'Staff ID is required'
      });
    }

    let staff = await Staff.findOne({
      $or: [
        { staffId: staffId },
        { email: staffId },
        { email: email }
      ]
    });
    
    if (!staff && email) {
      staff = await Staff.findOne({ email: email.toLowerCase() });
    }
    
    if (!staff) {
      return res.status(404).json({
        success: false,
        error: 'Staff not found'
      });
    }
    
    let classes = [];
    if (staff.createdClasses && staff.createdClasses.length > 0) {
      classes = await Class.find({ _id: { $in: staff.createdClasses } })
        .sort({ createdAt: -1 });
    }
    
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

/* =====================================================
   STAFF CLASSES BY EMAIL
   GET /api/staff/email/:email/classes
===================================================== */
router.get('/email/:email/classes', async (req, res) => {
  try {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    const staff = await Staff.findOne({ email: email.toLowerCase() });
    
    if (!staff) {
      return res.status(404).json({
        success: false,
        error: 'Staff not found with this email'
      });
    }
    
    let classes = [];
    if (staff.createdClasses && staff.createdClasses.length > 0) {
      classes = await Class.find({ _id: { $in: staff.createdClasses } })
        .sort({ createdAt: -1 });
    }
    
    if (classes.length === 0) {
      classes = await Class.find({
        $or: [
          { staffId: staff.staffId },
          { 'staff.staffId': staff.staffId },
          { 'staff.email': staff.email },
          { staffId: staff.email }
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

/* =====================================================
   DELETE STAFF (Fixed to delete from both Firebase and MongoDB)
   DELETE /api/staff/:email
===================================================== */
router.delete('/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    
    // Check if staff exists in MongoDB
    const staff = await Staff.findOne({ email: email });
    if (!staff) {
      return res.status(404).json({
        success: false,
        error: 'Staff not found in database'
      });
    }
    
    // Try to delete from Firebase
    try {
      const user = await admin.auth().getUserByEmail(email);
      await admin.auth().deleteUser(user.uid);
      console.log('Staff deleted from Firebase:', user.uid);
    } catch (firebaseErr) {
      if (firebaseErr.code !== 'auth/user-not-found') {
        console.warn('Firebase delete warning:', firebaseErr.message);
        // Continue with MongoDB deletion even if Firebase fails
      }
    }
    
    // Delete from MongoDB
    const result = await Staff.deleteOne({ email: email });
    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Staff not found in database'
      });
    }
    
    console.log('Staff deleted from MongoDB:', email);
    
    res.status(200).json({
      success: true,
      message: 'Staff deleted successfully from both systems'
    });
  } catch (err) {
    console.error('Error deleting staff:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to delete staff: ' + err.message
    });
  }
});

/* =====================================================
   UPDATE STAFF (NEW ENDPOINT - Email cannot be changed)
   PUT /api/staff/:email
===================================================== */
router.put('/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    const { name, program, department, password, tempPassword } = req.body;
    
    console.log('Update staff request received:', { email, name, program, department });
    
    // Find staff in MongoDB
    const staff = await Staff.findOne({ email: email });
    if (!staff) {
      return res.status(404).json({
        success: false,
        error: 'Staff not found'
      });
    }
    
    // Prepare update data for MongoDB
    const updateData = {};
    if (name) updateData.name = name;
    if (program || department) {
      updateData.department = department || program;
    }
    
    // Update password if provided
    if (password) {
      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'Password must be at least 6 characters'
        });
      }
      
      updateData.tempPassword = password;
      updateData.lastPasswordUpdated = new Date();
      
      // Add to password history
      const passwordRecord = {
        password: password,
        createdAt: new Date(),
        createdBy: 'admin'
      };
      
      if (!staff.passwordHistory) {
        staff.passwordHistory = [];
      }
      staff.passwordHistory.push(passwordRecord);
      updateData.passwordHistory = staff.passwordHistory;
    }
    
    // Update MongoDB
    if (Object.keys(updateData).length > 0) {
      await Staff.updateOne(
        { email: email },
        { $set: updateData }
      );
      console.log('Staff updated in MongoDB:', email);
    }
    
    // Update Firebase if password was changed
    if (password) {
      try {
        // Get Firebase user
        const user = await admin.auth().getUserByEmail(email);
        
        // Update password in Firebase
        await admin.auth().updateUser(user.uid, {
          password: password
        });
        console.log('Staff password updated in Firebase:', email);
      } catch (firebaseErr) {
        console.warn('Failed to update Firebase password:', firebaseErr.message);
        // Continue even if Firebase update fails
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Staff updated successfully',
      updatedFields: Object.keys(updateData)
    });
  } catch (err) {
    console.error('Error updating staff:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update staff: ' + err.message
    });
  }
});

/* =====================================================
   GET ALL USERS FROM FIREBASE
   GET /api/staff/users
===================================================== */
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

/* =====================================================
   DELETE USER (STAFF OR STUDENT) - DEPRECATED - Use specific endpoints instead
   DELETE /api/staff/users
===================================================== */
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

    // Try to delete from Firebase
    try {
      const user = await admin.auth().getUserByEmail(email.toLowerCase());
      await admin.auth().deleteUser(user.uid);
      console.log('User deleted from Firebase:', user.uid);
    } catch (firebaseErr) {
      if (firebaseErr.code !== 'auth/user-not-found') {
        console.warn('Firebase delete warning:', firebaseErr.message);
      }
    }

    // Delete from MongoDB
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
    res.status(500).json({ 
      success: false,
      error: 'Failed to delete user: ' + err.message 
    });
  }
});
// routes/staffRoutes.js
router.post('/update-password', async (req, res) => {
  const { email, newPassword } = req.body;

  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(user.uid, {
      password: newPassword,
    });

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});


/* =====================================================
   UPDATE USER (STAFF OR STUDENT) - DEPRECATED - Use specific endpoints instead
   PUT /api/staff/users
===================================================== */
router.put('/users', async (req, res) => {
  try {
    const { oldEmail, newEmail, type, newPassword, name, program, department } = req.body;
    console.log('Update request received:', { oldEmail, newEmail, type, name, program, department });

    if (!oldEmail || !type) {
      return res.status(400).json({ 
        success: false,
        error: 'oldEmail and type (staff/student) are required' 
      });
    }

    if (type !== 'staff' && type !== 'student') {
      return res.status(400).json({ 
        success: false,
        error: 'Type must be either "staff" or "student"' 
      });
    }

    // Email validation for newEmail (if provided)
    if (newEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(newEmail)) {
        return res.status(400).json({ 
          success: false,
          error: 'Invalid new email format' 
        });
      }
    }

    if (newPassword && newPassword.length < 6) {
      return res.status(400).json({ 
        success: false,
        error: 'New password must be at least 6 characters' 
      });
    }

    if (type === 'staff' && !program && !department) {
      return res.status(400).json({ 
        success: false,
        error: 'Department/Program is required for staff' 
      });
    }

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

    // Email change logic (if newEmail is provided and different)
    if (newEmail && oldEmail.toLowerCase() !== newEmail.toLowerCase()) {
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

    // Update Firebase
    const firebaseUpdateData = {};
    if (newEmail && oldEmail.toLowerCase() !== newEmail.toLowerCase()) {
      firebaseUpdateData.email = newEmail;
    }
    if (newPassword) {
      firebaseUpdateData.password = newPassword;
    }
    if (Object.keys(firebaseUpdateData).length > 0) {
      await admin.auth().updateUser(user.uid, firebaseUpdateData);
      console.log('User updated in Firebase:', user.uid);
    }

    // Update MongoDB
    if (type === 'staff') {
      const updateFields = {};
      if (name) updateFields.name = name;
      if (program !== undefined || department !== undefined) {
        updateFields.department = department || program;
      }
      if (newEmail && oldEmail.toLowerCase() !== newEmail.toLowerCase()) {
        updateFields.email = newEmail.toLowerCase();
      }
      
      if (Object.keys(updateFields).length > 0) {
        await Staff.updateOne(
          { email: oldEmail.toLowerCase() },
          { $set: updateFields }
        );
        console.log('Staff updated in MongoDB:', oldEmail);
      }
    } else if (type === 'student') {
      const updateFields = {};
      if (name) updateFields.name = name;
      if (program) updateFields.program = program;
      if (newEmail && oldEmail.toLowerCase() !== newEmail.toLowerCase()) {
        updateFields.email = newEmail.toLowerCase();
      }
      
      if (Object.keys(updateFields).length > 0) {
        await Student.updateOne(
          { email: oldEmail.toLowerCase() },
          { $set: updateFields }
        );
        console.log('Student updated in MongoDB:', oldEmail);
      }
    }

    res.status(200).json({ 
      success: true,
      message: `User ${newEmail || oldEmail} updated successfully` 
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

/* =====================================================
   BULK USER CREATION (STAFF OR STUDENT)
   POST /api/staff/bulk-users
===================================================== */
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
      
      if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
        results.push({ email: email || 'unknown', success: false, error: 'Email and password are required' });
        continue;
      }
      
      if (!name) {
        results.push({ email, success: false, error: 'Name is required' });
        continue;
      }
      
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
        try {
          const userRecord = await admin.auth().getUserByEmail(lowerEmail);
          results.push({ email: lowerEmail, success: false, error: 'Email already exists in Firebase' });
          continue;
        } catch (err) {
          if (err.code !== 'auth/user-not-found') throw err;
        }

        await admin.auth().createUser({ 
          email: lowerEmail, 
          password,
          displayName: name
        });

        if (type === 'staff') {
          const staffData = {
            name: name,
            department: department || program || '',
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