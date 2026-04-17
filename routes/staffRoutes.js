/* eslint-disable no-unused-vars */
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const Staff = require('../models/Staff');
const Student = require('../models/Students');
const Class = require('../models/Class');

const safeValue = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  return String(value).trim();
};

const buildStaffName = (staff) => {
  const name = safeValue(staff?.name);
  if (name) return name;

  const email = safeValue(staff?.email);
  if (email && email.includes('@')) {
    return email.split('@')[0];
  }

  return 'Staff';
};

const buildDepartment = (staff) => {
  return safeValue(staff?.department) || safeValue(staff?.program) || 'No Department Assigned';
};

const buildStaffId = (staff) => {
  return safeValue(staff?.staffId) || `STAFF-${String(staff?._id || '').slice(-6).toUpperCase() || Date.now()}`;
};

const buildPassword = (staff) => {
  if (staff?.passwordHistory && staff.passwordHistory.length > 0) {
    const latest = staff.passwordHistory[staff.passwordHistory.length - 1]?.password;
    if (safeValue(latest)) return latest;
  }
  return safeValue(staff?.tempPassword) || safeValue(staff?.password) || 'Old account - reset required';
};

async function createOrUpdateFirebaseUser(email, password, displayName = '') {
  try {
    const created = await admin.auth().createUser({
      email,
      password,
      displayName: displayName || undefined,
      emailVerified: false,
      disabled: false
    });
    return { success: true, uid: created.uid, created: true };
  } catch (error) {
    if (error.code === 'auth/email-already-exists') {
      try {
        const existing = await admin.auth().getUserByEmail(email);
        const updatePayload = {};

        if (password) updatePayload.password = password;
        if (displayName) updatePayload.displayName = displayName;

        if (Object.keys(updatePayload).length > 0) {
          await admin.auth().updateUser(existing.uid, updatePayload);
        }

        return { success: true, uid: existing.uid, alreadyExists: true };
      } catch (updateError) {
        return { success: false, error: updateError.message };
      }
    }
    return { success: false, error: error.message };
  }
}

/* =====================================================
   UPDATE PASSWORD IN FIREBASE
   POST /api/staff/update-password
===================================================== */
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
   GET ALL STAFF
   GET /api/staff
===================================================== */
router.get('/', async (req, res) => {
  try {
    const staff = await Staff.find().lean();
    const formattedStaff = staff.map(s => ({
      ...s,
      name: buildStaffName(s),
      staffId: buildStaffId(s),
      department: buildDepartment(s),
      program: buildDepartment(s),
      displayPassword: buildPassword(s)
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
   GET ALL STAFF WITH PASSWORDS
   GET /api/staff/with-passwords
===================================================== */
router.get('/with-passwords', async (req, res) => {
  try {
    const staff = await Staff.find().select('+tempPassword +passwordHistory');
    const staffWithPasswords = staff.map(user => ({
      ...user.toObject(),
      name: buildStaffName(user),
      staffId: buildStaffId(user),
      department: buildDepartment(user),
      program: buildDepartment(user),
      displayPassword: buildPassword(user),
      hasPasswordHistory: user.passwordHistory && user.passwordHistory.length > 0,
      passwordHistoryCount: user.passwordHistory ? user.passwordHistory.length : 0,
      lastPasswordUpdate: user.lastPasswordUpdated || user.createdAt
    }));

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
   FIX OLD STAFF DATA
   PUT /api/staff/fix-old-staff-data
===================================================== */
router.put('/fix-old-staff-data', async (req, res) => {
  try {
    const staffList = await Staff.find({});
    let updated = 0;

    for (const staff of staffList) {
      let changed = false;

      const fixedName = buildStaffName(staff);
      if (staff.name !== fixedName) {
        staff.name = fixedName;
        changed = true;
      }

      const fixedDepartment = buildDepartment(staff);
      if (staff.department !== fixedDepartment) {
        staff.department = fixedDepartment;
        changed = true;
      }

      const fixedStaffId = buildStaffId(staff);
      if (!safeValue(staff.staffId) || staff.staffId !== fixedStaffId) {
        staff.staffId = fixedStaffId;
        changed = true;
      }

      if ((!staff.passwordHistory || staff.passwordHistory.length === 0) && !safeValue(staff.tempPassword)) {
        staff.tempPassword = 'Old account - reset required';
        changed = true;
      }

      if (changed) {
        await staff.save();
        updated++;
      }
    }

    res.json({
      success: true,
      message: `${updated} old staff records fixed successfully`
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
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
   GET ALL STAFF WITH CLASSES COUNT
   GET /api/staff/with-classes
===================================================== */
router.get('/with-classes', async (req, res) => {
  try {
    const allStaff = await Staff.find();
    const staffWithClasses = await Promise.all(allStaff.map(async (staff) => {
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

/* =====================================================
   ADD STAFF
   POST /api/staff
   FIXED: now creates Firebase user too
===================================================== */
router.post('/', async (req, res) => {
  let firebaseUid = null;

  try {
    const { name, email, program, department, password } = req.body;
    const finalDepartment = department || program;
    const finalPassword = password;

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        error: 'Name and Email are required'
      });
    }

    if (!finalDepartment) {
      return res.status(400).json({
        success: false,
        error: 'Department / Program is required'
      });
    }

    if (!finalPassword || finalPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters'
      });
    }

    const lowerEmail = email.toLowerCase().trim();
    const exists = await Staff.findOne({ email: lowerEmail });

    if (exists) {
      return res.status(400).json({
        success: false,
        error: 'Staff already exists'
      });
    }

    const firebaseResult = await createOrUpdateFirebaseUser(lowerEmail, finalPassword, name.trim());
    if (!firebaseResult.success) {
      return res.status(400).json({
        success: false,
        error: 'Firebase error: ' + firebaseResult.error
      });
    }

    firebaseUid = firebaseResult.uid;

    const staffId = firebaseUid;
    const staff = new Staff({
      staffId,
      uid: firebaseUid,
      name,
      email: lowerEmail,
      department: finalDepartment,
      tempPassword: finalPassword,
      createdByAdmin: true,
      createdAt: new Date(),
      passwordHistory: [{
        password: finalPassword,
        createdAt: new Date(),
        createdBy: 'admin'
      }]
    });

    await staff.save();

    res.status(201).json({
      success: true,
      message: 'Staff added successfully',
      data: staff
    });
  } catch (err) {
    if (firebaseUid) {
      try {
        await admin.auth().deleteUser(firebaseUid);
      } catch (cleanupErr) {
        console.error('Failed to cleanup Firebase user:', cleanupErr.message);
      }
    }

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
   GET /api/staff/identifier/:identifier/classes
===================================================== */
router.get('/identifier/:identifier/classes', async (req, res) => {
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
   GET /api/staff/staff-id/:staffId/classes
===================================================== */
router.get('/staff-id/:staffId/classes', async (req, res) => {
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
   DELETE STAFF
   DELETE /api/staff/:email
===================================================== */
router.delete('/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();

    const staff = await Staff.findOne({ email: email });
    if (!staff) {
      return res.status(404).json({
        success: false,
        error: 'Staff not found in database'
      });
    }

    try {
      const user = await admin.auth().getUserByEmail(email);
      await admin.auth().deleteUser(user.uid);
      console.log('Staff deleted from Firebase:', user.uid);
    } catch (firebaseErr) {
      if (firebaseErr.code !== 'auth/user-not-found') {
        console.warn('Firebase delete warning:', firebaseErr.message);
      }
    }

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
   UPDATE STAFF
   PUT /api/staff/:email
===================================================== */
router.put('/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    const { name, program, department, password, tempPassword } = req.body;

    console.log('Update staff request received:', { email, name, program, department });

    const staff = await Staff.findOne({ email: email });
    if (!staff) {
      return res.status(404).json({
        success: false,
        error: 'Staff not found'
      });
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (program || department) {
      updateData.department = department || program;
    }

    const newPassword = password || tempPassword;

    if (newPassword) {
      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'Password must be at least 6 characters'
        });
      }

      updateData.tempPassword = newPassword;
      updateData.lastPasswordUpdated = new Date();

      const passwordRecord = {
        password: newPassword,
        createdAt: new Date(),
        createdBy: 'admin'
      };

      if (!staff.passwordHistory) {
        staff.passwordHistory = [];
      }
      staff.passwordHistory.push(passwordRecord);
      updateData.passwordHistory = staff.passwordHistory;
    }

    if (Object.keys(updateData).length > 0) {
      await Staff.updateOne(
        { email: email },
        { $set: updateData }
      );
      console.log('Staff updated in MongoDB:', email);
    }

    if (newPassword) {
      try {
        const user = await admin.auth().getUserByEmail(email);
        await admin.auth().updateUser(user.uid, {
          password: newPassword
        });
        console.log('Staff password updated in Firebase:', email);
      } catch (firebaseErr) {
        console.warn('Failed to update Firebase password:', firebaseErr.message);
        return res.status(400).json({
          success: false,
          error: 'MongoDB updated but Firebase password update failed: ' + firebaseErr.message
        });
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
   DELETE USER (STAFF OR STUDENT)
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

    try {
      const user = await admin.auth().getUserByEmail(email.toLowerCase());
      await admin.auth().deleteUser(user.uid);
      console.log('User deleted from Firebase:', user.uid);
    } catch (firebaseErr) {
      if (firebaseErr.code !== 'auth/user-not-found') {
        console.warn('Firebase delete warning:', firebaseErr.message);
      }
    }

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

/* =====================================================
   UPDATE USER (STAFF OR STUDENT)
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
   BULK USER CREATION
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

      const lowerEmail = email.toLowerCase();

      try {
        const firebaseResult = await createOrUpdateFirebaseUser(lowerEmail, password, name);
        if (!firebaseResult.success) {
          results.push({ email: lowerEmail, success: false, error: firebaseResult.error });
          continue;
        }

        if (type === 'staff') {
          const staffData = {
            staffId: firebaseResult.uid,
            uid: firebaseResult.uid,
            name: name,
            department: department || program || '',
            email: lowerEmail,
            tempPassword: password,
            createdByAdmin: true
          };

          await Staff.updateOne(
            { email: lowerEmail },
            {
              $set: staffData,
              $push: {
                passwordHistory: {
                  password: password,
                  createdAt: new Date(),
                  createdBy: 'bulk-admin'
                }
              }
            },
            { upsert: true }
          );
        } else {
          const studentData = {
            studentId: firebaseResult.uid,
            name: name,
            program: program,
            email: lowerEmail,
            tempPassword: password,
            password: password,
            createdByAdmin: true
          };

          await Student.updateOne(
            { email: lowerEmail },
            { $set: studentData },
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

/* =====================================================
   GET STAFF BY UID (put at bottom to avoid route conflicts)
   GET /api/staff/:uid
===================================================== */
router.get('/:uid', async (req, res) => {
  try {
    const { uid } = req.params;

    let staff = await Staff.findOne({ uid: uid });

    if (!staff) {
      try {
        const firebaseUser = await admin.auth().getUser(uid);

        staff = await Staff.findOne({ email: firebaseUser.email.toLowerCase() });

        if (!staff) {
          staff = new Staff({
            staffId: uid,
            uid: uid,
            name: firebaseUser.displayName || 'Staff Member',
            email: firebaseUser.email.toLowerCase(),
            department: '',
            createdAt: new Date()
          });

          await staff.save();
        } else if (!staff.uid) {
          staff.uid = uid;
          if (!staff.staffId) staff.staffId = uid;
          await staff.save();
        }
      } catch (firebaseErr) {
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

module.exports = router;