
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const classRoutes = require('./routes/classRoutes');
const announcementRoutes = require('./routes/announcementRoutes');
const unitRoutes = require('./routes/unitRoutes');
const assignmentRoutes = require('./routes/assignments');
const submissionRoutes = require('./routes/submissions');
const staffRoutes = require('./routes/staffRoutes');
const studentRoutes = require('./routes/studentRoutes');
const admin = require('firebase-admin');
const messageRoutes = require('./routes/messages');
const studLogin = require('./routes/activityRoutes');
require('dotenv').config();

console.log('FIREBASE_PRIVATE_KEY:', process.env.FIREBASE_PRIVATE_KEY ? 'Defined' : 'Undefined');

const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined,
};

if (!firebaseConfig.projectId || !firebaseConfig.clientEmail || !firebaseConfig.privateKey) {
  console.error('Missing Firebase configuration variables');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(firebaseConfig),
});

const app = express();
const port = process.env.PORT || 5000;

app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
  });

const path = require('path');
const fs = require('fs');

// Create 'uploads' directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve static files from the 'uploads' directory
app.use('/uploads', express.static(uploadsDir));

// Log all requests for debugging
app.use((req, res, next) => {
  console.log(`${req.method} request to ${req.path}`);
  next();
});

// Import models
const Staff = require('./models/Staff');
const Student = require('./models/Students');
const Class = require('./models/Class'); // Added for class tracking

// Import routes
app.use('/api/classes', classRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/units', unitRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api', staffRoutes); // This includes adminRoutes functionality
app.use('/api/students', studentRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/activity', studLogin);

// NEW ROUTES FOR PASSWORD FUNCTIONALITY

// Get staff with passwords (for admin PDF generation)
app.get('/api/staff-with-passwords', async (req, res) => {
  try {
    console.log('Fetching staff with passwords...');
    const staff = await Staff.find({}, '-_id -__v');
    console.log(`Found ${staff.length} staff members`);
    res.status(200).json(staff);
  } catch (err) {
    console.error('Error fetching staff with passwords:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch staff with passwords: ' + err.message 
    });
  }
});

// Get students with passwords (for admin PDF generation)
app.get('/api/students-with-passwords', async (req, res) => {
  try {
    console.log('Fetching students with passwords...');
    const students = await Student.find({}, '-_id -__v');
    console.log(`Found ${students.length} students`);
    res.status(200).json(students);
  } catch (err) {
    console.error('Error fetching students with passwords:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch students with passwords: ' + err.message 
    });
  }
});

// NEW ROUTE: Get staff classes for PDF
app.get('/api/staff/:staffId/classes', async (req, res) => {
  try {
    const { staffId } = req.params;
    console.log('Fetching classes for staff:', staffId);
    
    const classes = await Class.find({ staffId }).sort({ createdAt: -1 });
    
    res.status(200).json({
      success: true,
      classes,
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

// FIXED: Add staff with password (with Firebase user creation)
app.post('/api/staff-with-password', async (req, res) => {
  let firebaseUser = null;
  
  try {
    const { name, program, email, tempPassword } = req.body;
    
    console.log('Adding staff with password:', { name, email });
    
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
    
    if (!tempPassword || tempPassword.length < 6) {
      return res.status(400).json({ 
        success: false,
        error: 'Password is required and must be at least 6 characters' 
      });
    }
    
    const lowerEmail = email.toLowerCase().trim();
    
    // Check if staff already exists in MongoDB
    const existingStaff = await Staff.findOne({ email: lowerEmail });
    if (existingStaff) {
      return res.status(400).json({ 
        success: false,
        error: 'Staff email already exists in database' 
      });
    }
    
    // Check if user exists in Firebase
    try {
      firebaseUser = await admin.auth().getUserByEmail(lowerEmail);
      console.log('Firebase user already exists:', firebaseUser.uid);
    } catch (firebaseErr) {
      if (firebaseErr.code === 'auth/user-not-found') {
        // Create Firebase user if doesn't exist
        try {
          firebaseUser = await admin.auth().createUser({
            email: lowerEmail,
            password: tempPassword,
            displayName: name.trim(),
            emailVerified: false,
            disabled: false
          });
          console.log('Firebase user created:', firebaseUser.uid);
        } catch (createErr) {
          console.error('Error creating Firebase user:', createErr);
          if (createErr.code === 'auth/email-already-exists') {
            return res.status(400).json({ 
              success: false,
              error: 'Email already exists in Firebase' 
            });
          }
          throw createErr;
        }
      } else {
        throw firebaseErr;
      }
    }
    
    // Create staff in MongoDB with Firebase UID as staffId
    const staff = new Staff({ 
      staffId: firebaseUser.uid, // Use Firebase UID
      name: name,
      program: program || null,
      email: lowerEmail,
      tempPassword: tempPassword,
      createdAt: new Date(),
      createdByAdmin: true,
      createdTimestamp: new Date().toISOString()
    });
    
    await staff.save();
    
    console.log('Staff added successfully:', staff.email);
    
    res.status(201).json({ 
      success: true,
      message: 'Staff added successfully',
      data: staff
    });
  } catch (err) {
    console.error('Error adding staff with password:', err);
    
    // Cleanup Firebase user if MongoDB save fails
    if (firebaseUser) {
      try {
        await admin.auth().deleteUser(firebaseUser.uid);
        console.log('Cleaned up Firebase user after error:', firebaseUser.uid);
      } catch (cleanupErr) {
        console.error('Error cleaning up Firebase user:', cleanupErr);
      }
    }
    
    if (err.code === 11000) {
      return res.status(400).json({ 
        success: false,
        error: 'Staff email already exists in database' 
      });
    }
    
    if (err.code === 'auth/email-already-exists') {
      return res.status(400).json({ 
        success: false,
        error: 'Email already registered in Firebase' 
      });
    }
    
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(val => val.message);
      return res.status(400).json({ 
        success: false,
        error: 'Validation error: ' + messages.join(', ') 
      });
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to add staff: ' + err.message 
    });
  }
});

// FIXED: Add student with password (with Firebase user creation)
app.post('/api/students-with-password', async (req, res) => {
  let firebaseUser = null;
  
  try {
    const { name, program, email, tempPassword } = req.body;
    
    console.log('Adding student with password:', { name, email });
    
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
    
    if (!tempPassword || tempPassword.length < 6) {
      return res.status(400).json({ 
        success: false,
        error: 'Password is required and must be at least 6 characters' 
      });
    }
    
    const lowerEmail = email.toLowerCase().trim();
    
    // Check if student already exists in MongoDB
    const existingStudent = await Student.findOne({ email: lowerEmail });
    if (existingStudent) {
      return res.status(400).json({ 
        success: false,
        error: 'Student email already exists in database' 
      });
    }
    
    // Check if user exists in Firebase
    try {
      firebaseUser = await admin.auth().getUserByEmail(lowerEmail);
      console.log('Firebase user already exists:', firebaseUser.uid);
    } catch (firebaseErr) {
      if (firebaseErr.code === 'auth/user-not-found') {
        // Create Firebase user if doesn't exist
        try {
          firebaseUser = await admin.auth().createUser({
            email: lowerEmail,
            password: tempPassword,
            displayName: name.trim(),
            emailVerified: false,
            disabled: false
          });
          console.log('Firebase user created:', firebaseUser.uid);
        } catch (createErr) {
          console.error('Error creating Firebase user:', createErr);
          if (createErr.code === 'auth/email-already-exists') {
            return res.status(400).json({ 
              success: false,
              error: 'Email already exists in Firebase' 
            });
          }
          throw createErr;
        }
      } else {
        throw firebaseErr;
      }
    }
    
    // Create student in MongoDB with Firebase UID as studentId
    const student = new Student({ 
      studentId: firebaseUser.uid, // Use Firebase UID
      name: name,
      program: program,
      email: lowerEmail,
      tempPassword: tempPassword,
      createdAt: new Date(),
      createdByAdmin: true,
      createdTimestamp: new Date().toISOString()
    });
    
    await student.save();
    
    console.log('Student added successfully:', student.email);
    
    res.status(201).json({ 
      success: true,
      message: 'Student added successfully',
      data: student
    });
  } catch (err) {
    console.error('Error adding student with password:', err);
    
    // Cleanup Firebase user if MongoDB save fails
    if (firebaseUser) {
      try {
        await admin.auth().deleteUser(firebaseUser.uid);
        console.log('Cleaned up Firebase user after error:', firebaseUser.uid);
      } catch (cleanupErr) {
        console.error('Error cleaning up Firebase user:', cleanupErr);
      }
    }
    
    if (err.code === 11000) {
      return res.status(400).json({ 
        success: false,
        error: 'Student email already exists in database' 
      });
    }
    
    if (err.code === 'auth/email-already-exists') {
      return res.status(400).json({ 
        success: false,
        error: 'Email already registered in Firebase' 
      });
    }
    
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(val => val.message);
      return res.status(400).json({ 
        success: false,
        error: 'Validation error: ' + messages.join(', ') 
      });
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Failed to add student: ' + err.message 
    });
  }
});

// Clear temporary passwords (security cleanup)
app.post('/api/clear-temp-passwords', async (req, res) => {
  try {
    console.log('Clearing temporary passwords...');
    
    // Clear passwords older than 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const staffResult = await Staff.updateMany(
      { 
        tempPassword: { $exists: true, $ne: null },
        createdAt: { $lt: twentyFourHoursAgo }
      },
      { $unset: { tempPassword: "" } }
    );
    
    const studentResult = await Student.updateMany(
      { 
        tempPassword: { $exists: true, $ne: null },
        createdAt: { $lt: twentyFourHoursAgo }
      },
      { $unset: { tempPassword: "" } }
    );
    
    console.log('Password cleanup completed:', {
      staffCleared: staffResult.modifiedCount,
      studentCleared: studentResult.modifiedCount
    });
    
    res.status(200).json({ 
      success: true,
      message: 'Temporary passwords cleared successfully',
      stats: {
        staffCleared: staffResult.modifiedCount,
        studentCleared: studentResult.modifiedCount
      }
    });
  } catch (err) {
    console.error('Error clearing temporary passwords:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to clear temporary passwords: ' + err.message 
    });
  }
});

// FIXED: Bulk user creation with passwords (staff or student)
app.post('/api/bulk-users-with-passwords', async (req, res) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  try {
    const type = req.query.type; 
    const users = req.body.users;

    console.log('Bulk user creation with passwords:', { type, userCount: users?.length });

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
    const createdFirebaseUsers = []; // Track created users for cleanup
    
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
      let firebaseUser = null;

      try {
        // Check if user already exists in Firebase
        try {
          firebaseUser = await admin.auth().getUserByEmail(lowerEmail);
          console.log('Firebase user already exists:', firebaseUser.uid);
        } catch (err) {
          if (err.code === 'auth/user-not-found') {
            // Create Firebase user
            try {
              firebaseUser = await admin.auth().createUser({ 
                email: lowerEmail, 
                password,
                displayName: name,
                emailVerified: false,
                disabled: false
              });
              createdFirebaseUsers.push({ uid: firebaseUser.uid, email: lowerEmail });
              console.log('Firebase user created:', firebaseUser.uid);
            } catch (createErr) {
              results.push({ email: lowerEmail, success: false, error: 'Firebase creation failed: ' + createErr.message });
              continue;
            }
          } else {
            throw err;
          }
        }

        // Check if exists in MongoDB
        if (type === 'staff') {
          const existingStaff = await Staff.findOne({ email: lowerEmail });
          if (existingStaff) {
            results.push({ email: lowerEmail, success: false, error: 'Staff already exists in database' });
            continue;
          }
        } else {
          const existingStudent = await Student.findOne({ email: lowerEmail });
          if (existingStudent) {
            results.push({ email: lowerEmail, success: false, error: 'Student already exists in database' });
            continue;
          }
        }

        // Add to MongoDB with Firebase UID
        if (type === 'staff') {
          const staffData = {
            staffId: firebaseUser.uid,
            name: name,
            program: program || null,
            email: lowerEmail,
            tempPassword: password,
            createdAt: new Date(),
            createdByAdmin: true,
            createdTimestamp: new Date().toISOString()
          };
          await Staff.create(staffData);
        } else {
          const studentData = {
            studentId: firebaseUser.uid,
            name: name,
            program: program,
            email: lowerEmail,
            tempPassword: password,
            createdAt: new Date(),
            createdByAdmin: true,
            createdTimestamp: new Date().toISOString()
          };
          await Student.create(studentData);
        }

        results.push({ email: lowerEmail, success: true });
      } catch (err) {
        console.error(`Error creating user ${lowerEmail}:`, err.message);
        results.push({ email: lowerEmail, success: false, error: err.message });
        
        // Cleanup Firebase user if created
        if (firebaseUser && !createdFirebaseUsers.some(u => u.uid === firebaseUser.uid)) {
          try {
            await admin.auth().deleteUser(firebaseUser.uid);
          } catch (cleanupErr) {
            console.error('Error cleaning up Firebase user:', cleanupErr);
          }
        }
      }
    }

    // Cleanup any Firebase users that were created but MongoDB failed
    if (results.some(r => !r.success) && createdFirebaseUsers.length > 0) {
      console.log('Cleaning up Firebase users due to errors...');
      for (const fbUser of createdFirebaseUsers) {
        const correspondingResult = results.find(r => r.email === fbUser.email);
        if (!correspondingResult || !correspondingResult.success) {
          try {
            await admin.auth().deleteUser(fbUser.uid);
            console.log('Cleaned up Firebase user:', fbUser.uid);
          } catch (cleanupErr) {
            console.error('Failed to cleanup Firebase user:', cleanupErr);
          }
        }
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`Bulk creation completed: ${successCount}/${users.length} successful`);
    
    res.status(200).json({ 
      success: true,
      message: `Bulk ${type} creation completed`,
      stats: {
        total: users.length,
        successful: successCount,
        failed: users.length - successCount
      },
      results 
    });
  } catch (err) {
    console.error('Error in bulk user creation:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to bulk create users: ' + err.message 
    });
  }
});

// Schedule cleanup job for temporary passwords (optional - using node-cron)
const cron = require('node-cron');

// Cleanup function
const cleanupTempPasswords = async () => {
  try {
    console.log('Running scheduled temporary password cleanup...');
    
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const staffResult = await Staff.updateMany(
      { 
        tempPassword: { $exists: true, $ne: null },
        createdAt: { $lt: twentyFourHoursAgo }
      },
      { $unset: { tempPassword: "" } }
    );
    
    const studentResult = await Student.updateMany(
      { 
        tempPassword: { $exists: true, $ne: null },
        createdAt: { $lt: twentyFourHoursAgo }
      },
      { $unset: { tempPassword: "" } }
    );
    
    console.log('Scheduled password cleanup completed:', {
      staffCleared: staffResult.modifiedCount,
      studentCleared: studentResult.modifiedCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in scheduled password cleanup:', error);
  }
};

// Schedule cleanup to run every day at 3 AM (if you want automatic cleanup)
// Uncomment the next line if you want automatic cleanup
// cron.schedule('0 3 * * *', cleanupTempPasswords);

// Test route for password functionality
app.get('/api/test-passwords', async (req, res) => {
  try {
    const staffCount = await Staff.countDocuments({ tempPassword: { $exists: true, $ne: null } });
    const studentCount = await Student.countDocuments({ tempPassword: { $exists: true, $ne: null } });
    
    res.status(200).json({
      success: true,
      message: 'Password system is working',
      stats: {
        staffWithPasswords: staffCount,
        studentsWithPasswords: studentCount,
        serverTime: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    services: {
      mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      firebase: 'initialized'
    }
  });
});

// 404 handler (fixed without '*')
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.path
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error handler:', err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Password functionality endpoints:`);
  console.log(`  GET  /api/staff-with-passwords`);
  console.log(`  GET  /api/students-with-passwords`);
  console.log(`  GET  /api/staff/:staffId/classes (NEW)`);
  console.log(`  POST /api/staff-with-password`);
  console.log(`  POST /api/students-with-password`);
  console.log(`  POST /api/bulk-users-with-passwords?type=staff|student`);
  console.log(`  POST /api/clear-temp-passwords`);
  console.log(`  GET  /api/test-passwords`);
  console.log(`  GET  /api/health`);
});