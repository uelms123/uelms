const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const Staff = require('../models/Staff');
const Student = require('../models/Students');
const Classroom = require('../models/Class');

// Add staff
router.post('/staff', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    const staff = new Staff({ email: email.toLowerCase() });
    await staff.save();
    res.status(201).json({ message: 'Staff email added successfully' });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Staff email already exists in database' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Get staff
router.get('/staff', async (req, res) => {
  try {
    const staff = await Staff.find();
    res.status(200).json(staff);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all users from Firebase
router.get('/users', async (req, res) => {
  try {
    const listUsersResult = await admin.auth().listUsers();
    const users = listUsersResult.users.map(user => ({ email: user.email }));
    res.status(200).json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete user (staff or student)
router.delete('/users', async (req, res) => {
  try {
    const { email, type } = req.body;
    console.log('Delete request received:', { email, type });

    if (!email || !type) {
      return res.status(400).json({ error: 'Email and type (staff/student) are required' });
    }

    if (type !== 'staff' && type !== 'student') {
      return res.status(400).json({ error: 'Type must be either "staff" or "student"' });
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
        return res.status(404).json({ error: 'Staff not found in database' });
      }
    } else if (type === 'student') {
      console.log('Attempting to delete student from MongoDB:', email.toLowerCase());
      const result = await Student.deleteOne({ email: email.toLowerCase() });
      console.log('Student deletion result:', result);
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'Student not found in database' });
      }
    }

    res.status(200).json({ message: `User ${email} deleted successfully` });
  } catch (err) {
    console.error('Error occurred:', err);
    if (err.code === 'auth/user-not-found') {
      res.status(404).json({ error: 'User not found in Firebase' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// Update user (staff or student)
router.put('/users', async (req, res) => {
  try {
    const { oldEmail, newEmail, type, newPassword } = req.body;
    console.log('Update request received:', { oldEmail, newEmail, type });

    if (!oldEmail || !newEmail || !type) {
      return res.status(400).json({ error: 'oldEmail, newEmail, and type (staff/student) are required' });
    }

    if (type !== 'staff' && type !== 'student') {
      return res.status(400).json({ error: 'Type must be either "staff" or "student"' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      return res.status(400).json({ error: 'Invalid new email format' });
    }

    if (newPassword && newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    // Get Firebase user by old email
    let user;
    try {
      user = await admin.auth().getUserByEmail(oldEmail);
      console.log('Firebase user found:', user.uid);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        return res.status(404).json({ error: 'User not found in Firebase' });
      }
      throw err;
    }

    // Check if new email is already in use in Firebase
    if (oldEmail.toLowerCase() !== newEmail.toLowerCase()) {
      try {
        await admin.auth().getUserByEmail(newEmail);
        return res.status(400).json({ error: 'New email is already in use' });
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

    // Update MongoDB
    if (type === 'staff') {
      if (oldEmail.toLowerCase() !== newEmail.toLowerCase()) {
        await Staff.updateOne(
          { email: oldEmail.toLowerCase() },
          { email: newEmail.toLowerCase() }
        );
      }
    } else if (type === 'student') {
      if (oldEmail.toLowerCase() !== newEmail.toLowerCase()) {
        await Student.updateOne(
          { email: oldEmail.toLowerCase() },
          { email: newEmail.toLowerCase() }
        );
      }
    }

    res.status(200).json({ message: `User ${newEmail} updated successfully` });
  } catch (err) {
    console.error('Error updating user:', err);
    if (err.code === 'auth/email-already-exists') {
      return res.status(400).json({ error: 'New email is already in use' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Bulk user creation (staff or student)
router.post('/bulk-users', async (req, res) => {
  try {
    const type = req.query.type; 
    const users = req.body.users;

    if (!type || !['staff', 'student'].includes(type)) {
      return res.status(400).json({ error: 'Invalid or missing type (staff|student).' });
    }
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ error: 'No users provided' });
    }

    const results = [];
    for (const { email, password } of users) {
      if (
        !email ||
        !password ||
        typeof email !== 'string' ||
        typeof password !== 'string' ||
        !email.endsWith('@gmail.com') ||
        password.length < 6
      ) {
        results.push({ email, success: false, error: 'Invalid email or password' });
        continue;
      }

      let lowerEmail = email.toLowerCase();

      // Try Firebase creation
      try {
        // Check if exists first (avoids error spam)
        let userRecord;
        try {
          userRecord = await admin.auth().getUserByEmail(lowerEmail);
          results.push({ email: lowerEmail, success: false, error: 'Email already exists in Firebase' });
          continue;
        } catch (err) {
          if (err.code !== 'auth/user-not-found') throw err;
        }

        // Create in Firebase
        await admin.auth().createUser({ email: lowerEmail, password });

        // Add to MongoDB
        if (type === 'staff') {
          await Staff.updateOne({ email: lowerEmail }, { email: lowerEmail }, { upsert: true });
        } else {
          await Student.updateOne({ email: lowerEmail }, { email: lowerEmail }, { upsert: true });
        }

        results.push({ email: lowerEmail, success: true });
      } catch (err) {
        results.push({ email: lowerEmail, success: false, error: err.message });
      }
    }

    res.status(200).json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;