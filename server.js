// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

// Load environment variables
dotenv.config();

const app = express();

// At the very top of server.js, after requires
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']); // Google + Cloudflare DNS
// ============================================
// FIREBASE INITIALIZATION (from second file)
// ============================================
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
  storageBucket: 'uelms-378db.firebasestorage.app',
});

const bucket = admin.storage().bucket();

// ============================================
// DIRECTORY CREATION (merged from both files)
// ============================================

// Ensure uploads directory exists (from first file)
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('📁 Uploads directory created');
}

// Create temp directory for file uploads (from second file)
const tempDir = path.join(__dirname, 'temp_uploads');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
  console.log('Created temp uploads directory:', tempDir);
}

// Clean up temp files periodically (from second file)
setInterval(() => {
  if (fs.existsSync(tempDir)) {
    fs.readdir(tempDir, (err, files) => {
      if (err) return;
      const now = Date.now();
      files.forEach(file => {
        const filePath = path.join(tempDir, file);
        fs.stat(filePath, (err, stat) => {
          if (err) return;
          // Delete files older than 1 hour
          if (now - stat.mtimeMs > 3600000) {
            fs.unlink(filePath, () => {});
          }
        });
      });
    });
  }
}, 3600000); // Run every hour

// ============================================
// MIDDLEWARE CONFIGURATION (merged from both files)
// ============================================

// CORS configuration (merged from both files)
// CORS configuration (merged from both files)
app.use(cors({
  origin: [
    'http://localhost:3000', 
    'http://localhost:5000', 
    'http://127.0.0.1:3000', 
    'https://plagiarism-checker-olive.vercel.app', 
    'https://uelms.com'
  ],
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With', 
    'Accept',
    'x-user-id',           // Add this
    'x-user-email'         // Add this
  ],
  exposedHeaders: ['Content-Disposition'], // Add this for file downloads
  credentials: true,
  optionsSuccessStatus: 200
}));

// Body parsing middleware (merged from both files - using higher limits)
app.use(express.json({ limit: '10gb' }));
app.use(express.urlencoded({ extended: true, limit: '10gb' }));

// Static files (from both files)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ============================================
// REQUEST LOGGING MIDDLEWARE (from first file, enhanced)
// ============================================
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url} - ${new Date().toISOString()}`);
  
  // Set timeout for long requests (plagiarism checks)
  req.setTimeout(1800000, () => { // 30 minutes
    console.error(`⏰ Request timeout: ${req.method} ${req.url}`);
  });
  
  // Response timeout
  res.setTimeout(1800000, () => { // 30 minutes
    console.error(`⏰ Response timeout: ${req.method} ${req.url}`);
    if (!res.headersSent) {
      res.status(504).json({ 
        success: false, 
        message: 'Request timeout - The operation is taking longer than expected. Please try again.' 
      });
    }
  });
  
  next();
});

// Simple logging middleware (from second file)
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// ============================================
// MONGODB CONNECTION (merged from both files)
// ============================================

// MongoDB Connection with options (from first file)
const mongooseOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 1800000, // 30 minutes
  family: 4
};

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(
      process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/plagiarism-detector',
      mongooseOptions
    );

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    
    // Create indexes (from first file)
    await conn.connection.db.collection('reports').createIndex({ createdAt: -1 });
    await conn.connection.db.collection('reports').createIndex({ fileName: 1 });
    console.log('📊 Database indexes created');
    
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    console.log('⚠️  Make sure MongoDB is running on your system');
    setTimeout(connectDB, 5000);
  }
};

connectDB();

// MongoDB listeners (from first file)
mongoose.connection.on('error', err => {
  console.error('❌ MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('⚠️  MongoDB disconnected, attempting to reconnect...');
  setTimeout(connectDB, 5000);
});

// ============================================
// ROUTE IMPORTS (from second file)
// ============================================
const classRoutes = require('./routes/classRoutes');
const announcementRoutes = require('./routes/announcementRoutes');
const unitRoutes = require('./routes/unitRoutes');
const assignmentRoutes = require('./routes/assignments');
const submissionRoutes = require('./routes/submissions');
const staffRoutes = require('./routes/staffRoutes');
const studentRoutes = require('./routes/studentRoutes');
const messageRoutes = require('./routes/messages');
const studLogin = require('./routes/activityRoutes');
const meetingRoutes = require('./routes/meetings');
const programRoutes = require('./routes/programRoutes');
const staffActivityRoutes = require('./routes/staffActivityRoutes');
const googleMeetAttendanceRoutes = require('./routes/googleMeetAttendance');
const staffMeetingsRoutes = require('./routes/staffMeetings');
const ebookRoutes = require('./routes/ebookRoutes');

// Model imports (from second file)
require('./models/files');
require('./models/unit');
require('./models/DailyUpload');
const Staff = require('./models/Staff');
const Student = require('./models/Students');
const Class = require('./models/Class');
const StaffActivity = require('./models/StaffActivity');

// ============================================
// API ROUTES (from first file - plagiarism detector)
// ============================================
// ============================================
// API ROUTES (from first file - plagiarism detector)
// ============================================
try {
  // Add middleware to extract user info from headers for plagiarism routes
  app.use('/api/plagiarism', (req, res, next) => {
    // Extract user info from headers or query
    const userId = req.headers['x-user-id'] || req.query.userId;
    const userEmail = req.headers['x-user-email'] || req.query.userEmail;
    
    if (userId) req.userId = userId;
    if (userEmail) req.userEmail = userEmail;
    
    next();
  });
  
  app.use('/api/plagiarism', require('./routes/plagiarismRoutes'));
  app.use('/api/reports', require('./routes/reportRoutes'));
  console.log('✅ Plagiarism routes loaded successfully (with user history support)');
} catch (error) {
  console.error('❌ Error loading plagiarism routes:', error.message);
}

// ============================================
// API ROUTES (from second file - LMS)
// ============================================
app.use('/api/classes', classRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/units', unitRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/activity', studLogin);
app.use('/api/meetings', meetingRoutes);
app.use('/api/programs', programRoutes);
app.use('/api/staff-activity', staffActivityRoutes);
app.use('/api/google-meet', require('./routes/googleMeetAttendance'));
app.use('/api/staff-meetings', staffMeetingsRoutes);
app.use(ebookRoutes); 

// ============================================
// API STATUS ENDPOINTS (from first file)
// ============================================

// API Key status endpoint
app.get('/api/status', (req, res) => {
  const apiStatus = {
    google: {
      enabled: !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CX),
      keyPresent: !!process.env.GOOGLE_API_KEY,
      cxPresent: !!process.env.GOOGLE_CX
    },
    serpapi: {
      enabled: !!process.env.SERPAPI_KEY,
      keyPresent: !!process.env.SERPAPI_KEY
    },
    core: {
      enabled: !!process.env.CORE_API_KEY,
      keyPresent: !!process.env.CORE_API_KEY
    },
    crossref: {
      enabled: !!process.env.CROSSREF_EMAIL,
      emailPresent: !!process.env.CROSSREF_EMAIL
    }
  };
  
  res.json({
    success: true,
    message: 'API Status',
    server: {
      status: 'running',
      port: process.env.PORT || 5000,
      environment: process.env.NODE_ENV || 'development'
    },
    apis: apiStatus,
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date()
  });
});

// Health check (from first file - enhanced)
app.get('/health', (req, res) => {
  res.json({ 
    success: true,
    message: 'Plagiarism Detector API Running ✅', 
    status: 'OK', 
    timestamp: new Date(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Health check (from second file)
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

// Root endpoint (from first file - enhanced)
app.get('/', (req, res) => {
  res.json({ 
    success: true,
    message: '📚 Combined API Server', 
    version: '2.0.0',
    endpoints: {
      // Plagiarism detector endpoints
      plagiarism: {
        health: '/health',
        status: '/api/status',
        checkFile: '/api/plagiarism/check-file (POST)',
        checkText: '/api/plagiarism/check-text (POST)',
        history: '/api/plagiarism/history (GET)',
        report: '/api/plagiarism/report/:id (GET)',
        reports: '/api/reports (GET)',
        download: '/api/reports/download/:id (GET)',
        delete: '/api/reports/:id (DELETE)'
      },
      // LMS endpoints
      lms: {
        classes: '/api/classes',
        announcements: '/api/announcements',
        units: '/api/units',
        assignments: '/api/assignments',
        submissions: '/api/submissions',
        staff: '/api/staff',
        students: '/api/students',
        messages: '/api/messages',
        activity: '/api/activity',
        meetings: '/api/meetings',
        programs: '/api/programs',
        staffActivity: '/api/staff-activity',
        googleMeet: '/api/google-meet',
        staffMeetings: '/api/staff-meetings',
        ebooks: '/ebooks'
      }
    },
    apis: {
      google: !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CX) ? '✅ Configured' : '❌ Not configured',
      serpapi: !!process.env.SERPAPI_KEY ? '✅ Configured' : '❌ Not configured',
      core: !!process.env.CORE_API_KEY ? '✅ Configured' : '❌ Not configured',
      crossref: !!process.env.CROSSREF_EMAIL ? '✅ Configured' : '❌ Not configured',
      firebase: '✅ Configured'
    },
    timestamp: new Date()
  });
});

// ============================================
// STAFF AND STUDENT MANAGEMENT ENDPOINTS (from second file)
// ============================================

app.get('/api/staff-with-passwords', async (req, res) => {
  try {
    console.log('Fetching staff with passwords...');
    let staff = await Staff.find({}, '-__v').lean();
    console.log(`Found ${staff.length} staff members`);
    
    for (let s of staff) {
      if (s.staffId) {
        const summary = await StaffActivity.getStaffSummary(s.staffId);
        s.activity = {
          streams: summary.totalStreams || 0,
          assignments: summary.totalAssignments || 0,
          assessments: summary.totalAssessments || 0,
          visits: summary.totalVisits || 0,
        };
        
        const classes = await Class.find({ staffId: s.staffId }).select('name subject section createdAt').lean();
        s.classes = classes || [];
      } else {
        s.activity = { streams: 0, assignments: 0, assessments: 0, visits: 0 };
        s.classes = [];
      }
    }

    res.status(200).json(staff);
  } catch (err) {
    console.error('Error fetching staff with passwords:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch staff with passwords: ' + err.message 
    });
  }
});

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

app.get('/api/staff/:identifier/classes', async (req, res) => {
  try {
    const { identifier } = req.params;
    console.log('Fetching classes for staff identifier:', identifier);
    
    let staff = null;
    
    if (identifier.length > 20) {
      staff = await Staff.findOne({ staffId: identifier });
    }
    
    if (!staff && identifier.includes('@')) {
      staff = await Staff.findOne({ email: identifier.toLowerCase() });
    }
    
    if (!staff && mongoose.Types.ObjectId.isValid(identifier)) {
      staff = await Staff.findById(identifier);
    }
    
    let classes = [];
    
    if (staff && staff.staffId) {
      classes = await Class.find({ staffId: staff.staffId }).sort({ createdAt: -1 });
    } else {
      classes = await Class.find({ 
        $or: [
          { createdBy: identifier.toLowerCase() },
          { 'staff.email': identifier.toLowerCase() }
        ]
      }).sort({ createdAt: -1 });
    }
    
    console.log(`Found ${classes.length} classes for ${identifier}`);
    
    res.status(200).json({
      success: true,
      classes,
      count: classes.length,
      staffFound: !!staff
    });
  } catch (err) {
    console.error('Error fetching staff classes:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch staff classes: ' + err.message 
    });
  }
});

app.get('/api/staff/email/:email/classes', async (req, res) => {
  try {
    const { email } = req.params;
    console.log('Fetching classes for staff email:', email);
    
    const classes = await Class.find({ 
      $or: [
        { createdBy: email.toLowerCase() },
        { 'staff.email': email.toLowerCase() }
      ]
    }).sort({ createdAt: -1 });
    
    console.log(`Found ${classes.length} classes for email ${email}`);
    
    res.status(200).json({
      success: true,
      classes,
      count: classes.length
    });
  } catch (err) {
    console.error('Error fetching classes by email:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch classes by email: ' + err.message 
    });
  }
});

app.get('/api/classes', async (req, res) => {
  try {
    const { staffId, email, search, limit = 100 } = req.query;
    
    const query = {};
    
    if (staffId) {
      query.staffId = staffId;
    }
    
    if (email) {
      query.$or = [
        { createdBy: email.toLowerCase() },
        { 'staff.email': email.toLowerCase() }
      ];
    }
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { subject: { $regex: search, $options: 'i' } },
        { section: { $regex: search, $options: 'i' } }
      ];
    }
    
    const classes = await Class.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));
    
    res.status(200).json({
      success: true,
      classes,
      count: classes.length
    });
  } catch (err) {
    console.error('Error fetching classes:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch classes: ' + err.message 
    });
  }
});

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
    
    const existingStaff = await Staff.findOne({ email: lowerEmail });
    if (existingStaff) {
      return res.status(400).json({ 
        success: false,
        error: 'Staff email already exists in database' 
      });
    }
    
    try {
      firebaseUser = await admin.auth().getUserByEmail(lowerEmail);
      console.log('Firebase user already exists:', firebaseUser.uid);
    } catch (firebaseErr) {
      if (firebaseErr.code === 'auth/user-not-found') {
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
    
    const staff = new Staff({ 
      staffId: firebaseUser.uid,
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
    
    const existingStudent = await Student.findOne({ email: lowerEmail });
    if (existingStudent) {
      return res.status(400).json({ 
        success: false,
        error: 'Student email already exists in database' 
      });
    }
    
    try {
      firebaseUser = await admin.auth().getUserByEmail(lowerEmail);
      console.log('Firebase user already exists:', firebaseUser.uid);
    } catch (firebaseErr) {
      if (firebaseErr.code === 'auth/user-not-found') {
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
    
    const student = new Student({ 
      studentId: firebaseUser.uid,
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

// Enhanced bulk upload endpoint - FIXED VERSION (from second file)
app.post('/api/bulk-users-enhanced', async (req, res) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  try {
    const type = req.query.type; 
    const users = req.body.users;

    console.log('Enhanced bulk upload:', { 
      type, 
      userCount: users?.length,
      sampleUser: users?.[0]
    });

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
    const createdFirebaseUsers = [];
    
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      
      // Normalize field names
      const normalizedUser = {
        name: user.name || user.Name || '',
        program: user.program || user.Program || user.department || user.Department || '',
        email: user.email || user.Email || '',
        password: user.password || user.Password || user.tempPassword || ''
      };
      
      const { name, program, email, password } = normalizedUser;
      
      // Row tracking
      const rowNumber = user.rowNumber || i + 1;
      
      // Validate email
      if (!email || typeof email !== 'string') {
        results.push({ 
          row: rowNumber,
          email: email || 'unknown',
          name: name || 'unknown',
          success: false, 
          error: 'Email is required' 
        });
        continue;
      }
      
      // Validate password
      if (!password || typeof password !== 'string') {
        results.push({ 
          row: rowNumber,
          email: email,
          name: name || 'unknown',
          success: false, 
          error: 'Password is required' 
        });
        continue;
      }
      
      // Validate name
      if (!name || !name.trim()) {
        results.push({ 
          row: rowNumber,
          email: email,
          name: name || 'unknown',
          success: false, 
          error: 'Name is required' 
        });
        continue;
      }
      
      // Validate program/department for staff
      const cleanProgram = (program || '').trim();
      if (type === 'staff' && !cleanProgram) {
        results.push({ 
          row: rowNumber,
          email: email,
          name: name,
          success: false, 
          error: 'Department/Program is required' 
        });
        continue;
      }
      
      // Validate password length
      if (password.length < 6) {
        results.push({ 
          row: rowNumber,
          email: email,
          name: name,
          success: false, 
          error: 'Password must be at least 6 characters' 
        });
        continue;
      }
      
      // Validate email format
      if (!emailRegex.test(email)) {
        results.push({ 
          row: rowNumber,
          email: email,
          name: name,
          success: false, 
          error: 'Invalid email format' 
        });
        continue;
      }

      let lowerEmail = email.toLowerCase();
      let firebaseUser = null;
      let action = 'skipped';

      try {
        // Check Firebase first
        try {
          firebaseUser = await admin.auth().getUserByEmail(lowerEmail);
          console.log(`User ${lowerEmail} exists in Firebase, will update`);
          action = 'update_firebase';
        } catch (err) {
          if (err.code === 'auth/user-not-found') {
            // Create new Firebase user
            try {
              firebaseUser = await admin.auth().createUser({ 
                email: lowerEmail, 
                password: password,
                displayName: name.trim(),
                emailVerified: false,
                disabled: false
              });
              createdFirebaseUsers.push({ uid: firebaseUser.uid, email: lowerEmail });
              action = 'create_firebase';
            } catch (createErr) {
              results.push({ 
                row: rowNumber,
                email: lowerEmail,
                name: name,
                success: false, 
                error: 'Firebase creation failed: ' + createErr.message 
              });
              continue;
            }
          } else {
            throw err;
          }
        }

        // Handle database operations
        if (type === 'staff') {
          const existingStaff = await Staff.findOne({ email: lowerEmail });
          
          if (existingStaff) {
            // UPDATE EXISTING STAFF
            existingStaff.name = name;
            existingStaff.department = cleanProgram || 'General';
            existingStaff.tempPassword = password;
            
            // Add to password history
            if (!existingStaff.passwordHistory) {
              existingStaff.passwordHistory = [];
            }
            existingStaff.passwordHistory.push({
              password: password,
              createdAt: new Date(),
              createdBy: 'admin_bulk_update'
            });
            
            await existingStaff.save();
            action = 'updated';
            
            results.push({ 
              row: rowNumber,
              email: lowerEmail,
              name: name,
              success: true,
              action: 'updated'
            });
          } else {
            // CREATE NEW STAFF
            const staffId = `staff_${Date.now().toString().slice(-6)}_${Math.random().toString(36).substr(2, 5)}`;
            const staffData = {
              staffId: staffId,
              name: name.trim(),
              department: cleanProgram || 'General',
              email: lowerEmail,
              tempPassword: password,
              createdAt: new Date(),
              createdByAdmin: true,
              createdTimestamp: new Date().toISOString(),
              passwordHistory: [{
                password: password,
                createdAt: new Date(),
                createdBy: 'admin_bulk_create'
              }]
            };
            
            await Staff.create(staffData);
            action = 'created';
            
            results.push({ 
              row: rowNumber,
              email: lowerEmail,
              name: name,
              success: true,
              action: 'created'
            });
          }
        } else {
          // Student logic
          const existingStudent = await Student.findOne({ email: lowerEmail });
          if (existingStudent) {
            existingStudent.name = name;
            existingStudent.program = program;
            existingStudent.tempPassword = password;
            await existingStudent.save();
            action = 'updated';
            
            results.push({ 
              row: rowNumber,
              email: lowerEmail,
              name: name,
              success: true,
              action: 'updated'
            });
          } else {
            const studentId = `student_${Date.now().toString().slice(-6)}_${Math.random().toString(36).substr(2, 5)}`;
            const studentData = {
              studentId: studentId,
              name: name.trim(),
              program: program,
              email: lowerEmail,
              tempPassword: password,
              createdAt: new Date(),
              createdByAdmin: true,
              createdTimestamp: new Date().toISOString()
            };
            await Student.create(studentData);
            action = 'created';
            
            results.push({ 
              row: rowNumber,
              email: lowerEmail,
              name: name,
              success: true,
              action: 'created'
            });
          }
        }
      } catch (err) {
        console.error(`Error processing user ${lowerEmail}:`, err.message);
        results.push({ 
          row: rowNumber,
          email: lowerEmail,
          name: name,
          success: false, 
          error: err.message 
        });
        
        // Cleanup Firebase user if created and failed
        if (action === 'create_firebase' && firebaseUser) {
          try {
            await admin.auth().deleteUser(firebaseUser.uid);
          } catch (cleanupErr) {
            console.error('Error cleaning up Firebase user:', cleanupErr);
          }
        }
      }
    }

    // Calculate statistics
    const successCount = results.filter(r => r.success).length;
    const createdCount = results.filter(r => r.success && r.action === 'created').length;
    const updatedCount = results.filter(r => r.success && r.action === 'updated').length;
    
    console.log(`Enhanced bulk upload completed: ${successCount}/${users.length} successful`);
    
    res.status(200).json({ 
      success: true,
      message: `Bulk ${type} upload completed`,
      stats: {
        total: users.length,
        successful: successCount,
        failed: users.length - successCount,
        created: createdCount,
        updated: updatedCount
      },
      results 
    });
  } catch (err) {
    console.error('Error in enhanced bulk upload:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to process bulk upload: ' + err.message 
    });
  }
});

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
    const createdFirebaseUsers = [];
    
    for (const user of users) {
      const { name, program, email, password } = user;
      
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
        try {
          firebaseUser = await admin.auth().getUserByEmail(lowerEmail);
          console.log('Firebase user already exists:', firebaseUser.uid);
        } catch (err) {
          if (err.code === 'auth/user-not-found') {
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
        
        if (firebaseUser && !createdFirebaseUsers.some(u => u.uid === firebaseUser.uid)) {
          try {
            await admin.auth().deleteUser(firebaseUser.uid);
          } catch (cleanupErr) {
            console.error('Error cleaning up Firebase user:', cleanupErr);
          }
        }
      }
    }

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

app.post('/api/clear-temp-passwords', async (req, res) => {
  try {
    console.log('Clearing temporary passwords...');
    
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

app.put('/api/users', async (req, res) => {
  try {
    const { oldEmail, newEmail, type, name, program, newPassword, tempPassword } = req.body;
    
    if (!oldEmail || !type) {
      return res.status(400).json({
        success: false,
        error: 'Old email and type are required'
      });
    }
    
    let Model, queryField;
    if (type === 'staff') {
      Model = Staff;
      queryField = 'email';
    } else {
      Model = Student;
      queryField = 'email';
    }
    
    const user = await Model.findOne({ [queryField]: oldEmail.toLowerCase() });
    if (!user) {
      return res.status(404).json({
        success: false,
        error: `${type} not found`
      });
    }
    
    if (name) user.name = name;
    if (program !== undefined) user.program = program;
    if (newEmail && newEmail !== oldEmail) {
      const existing = await Model.findOne({ [queryField]: newEmail.toLowerCase() });
      if (existing && existing._id.toString() !== user._id.toString()) {
        return res.status(400).json({
          success: false,
          error: 'New email already exists'
        });
      }
      user.email = newEmail.toLowerCase();
    }
    
    if (tempPassword) {
      user.tempPassword = tempPassword;
      user.tempPasswordSetAt = new Date();
    }
    
    await user.save();
    
    res.status(200).json({
      success: true,
      message: `${type} updated successfully`,
      data: user
    });
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update user: ' + err.message
    });
  }
});

app.delete('/api/users', async (req, res) => {
  try {
    const { email, type } = req.body;
    
    if (!email || !type) {
      return res.status(400).json({
        success: false,
        error: 'Email and type are required'
      });
    }
    
    let Model;
    if (type === 'staff') {
      Model = Staff;
    } else {
      Model = Student;
    }
    
    const result = await Model.findOneAndDelete({ email: email.toLowerCase() });
    
    if (!result) {
      return res.status(404).json({
        success: false,
        error: `${type} not found`
      });
    }
    
    res.status(200).json({
      success: true,
      message: `${type} deleted successfully`
    });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to delete user: ' + err.message
    });
  }
});

// ============================================
// 404 HANDLER (from both files, merged)
// ============================================
// ============================================
// 404 HANDLER (from both files, merged)
// ============================================
// Catch-all route for undefined routes
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: `Route ${req.originalUrl} not found`,
    path: req.path,
    availableEndpoints: [
      '/',
      '/health',
      '/api/health',
      '/api/status',
      '/api/plagiarism/check-file (POST)',
      '/api/plagiarism/check-text (POST)',
      '/api/plagiarism/history (GET)',
      '/api/plagiarism/report/:id (GET)',
      '/api/reports (GET)',
      '/api/classes',
      '/api/announcements',
      '/api/units',
      '/api/assignments',
      '/api/submissions',
      '/api/staff',
      '/api/students',
      '/api/messages',
      '/api/activity',
      '/api/meetings',
      '/api/programs',
      '/api/staff-activity',
      '/api/google-meet',
      '/api/staff-meetings',
      '/ebooks'
    ]
  });
});

// ============================================
// ERROR HANDLING MIDDLEWARE (from first file, enhanced)
// ============================================
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err.stack);
  
  if (err.code === 'ECONNABORTED') {
    return res.status(504).json({ 
      success: false, 
      message: 'Request timeout - The operation took too long. Please try again.' 
    });
  }
  
  if (err.name === 'MulterError') {
    return res.status(400).json({ 
      success: false, 
      message: `File upload error: ${err.message}` 
    });
  }
  
  res.status(err.status || 500).json({ 
    success: false, 
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// ============================================
// SERVER INITIALIZATION (merged from both files)
// ============================================
const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`
┌─────────────────────────────────────┐
│  🚀 COMBINED API SERVER             │
├─────────────────────────────────────┤
│  📡 Port: ${PORT}                         │
│  🌐 URL: http://localhost:${PORT}        │
│  ⏰ Timeout: 30 minutes              │
│  📁 Uploads: ${uploadDir}     │
│  📁 Temp: ${tempDir}         │
├─────────────────────────────────────┤
│  🔑 Plagiarism APIs: ${Object.entries({
    Google: !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CX),
    SerpAPI: !!process.env.SERPAPI_KEY,
    CORE: !!process.env.CORE_API_KEY,
    Crossref: !!process.env.CROSSREF_EMAIL
  }).filter(([_, v]) => v).map(([k]) => k).join(', ') || 'None'}
│  🔥 Firebase: ✅ Configured
├─────────────────────────────────────┤
│  📝 LMS Endpoints:                   │
│  📚 Classes | Announcements | Units  │
│  📝 Assignments | Submissions        │
│  👥 Staff | Students | Messages      │
│  📊 Activity | Meetings | Programs   │
│  📖 Ebooks | Google Meet              │
├─────────────────────────────────────┤
│  ✅ Server is ready                  │
│  📝 Check /health for status         │
└─────────────────────────────────────┘
  `);
  
  console.log(`CORS enabled for: http://localhost:3000, https://uelms.com`);
  console.log(`Activity Dashboard endpoints:`);
  console.log(`  GET  /api/staff-activity/summary`);
  console.log(`  GET  /api/staff-activity/all`);
  console.log(`  GET  /api/staff-activity/staff/:staffId`);
  console.log(`  GET  /api/staff/:identifier/classes`);
});

// Server timeout configuration (from first file)
server.timeout = 1800000;        // 30 minutes
server.keepAliveTimeout = 1800000;
server.headersTimeout = 1810000; // slightly higher

// ============================================
// GRACEFUL SHUTDOWN (from first file)
// ============================================
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received: closing HTTP server...');
  server.close(() => {
    console.log('🔴 HTTP server closed');
    mongoose.connection.close()
      .then(() => {
        console.log('🔴 MongoDB connection closed');
        process.exit(0);
      })
      .catch((err) => {
        console.error('❌ Error closing MongoDB connection:', err);
        process.exit(1);
      });
  });
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT received: closing HTTP server...');
  server.close(() => {
    console.log('🔴 HTTP server closed');
    mongoose.connection.close()
      .then(() => {
        console.log('🔴 MongoDB connection closed');
        process.exit(0);
      })
      .catch((err) => {
        console.error('❌ Error closing MongoDB connection:', err);
        process.exit(1);
      });
  });
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  server.close(() => {
    mongoose.connection.close()
      .then(() => process.exit(1))
      .catch(() => process.exit(1));
  });
});

process.on('unhandledRejection', (err) => {
  console.error('💥 Unhandled Rejection:', err);
  console.error('This rejection was not handled, but server continues running');
});

module.exports = app;