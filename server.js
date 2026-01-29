const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');
require('dotenv').config();

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

require('./models/files');
require('./models/DailyUpload');
require('./models/unit');
const Staff = require('./models/Staff');
const Student = require('./models/Students');
const Class = require('./models/Class');
const StaffActivity = require('./models/StaffActivity');

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

const app = express();
const port = process.env.PORT || 5000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '100mb' }));

app.use(cors({
  origin: [
    'https://uelms.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true
}));


const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
  });

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

// Enhanced bulk upload endpoint with better error handling
// Enhanced bulk upload endpoint - FIXED VERSION
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
            // UPDATE EXISTING STAFF (This was missing!)
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
          // Student logic (similar pattern)
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

app.use('/', (req, res, next) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.path
  });
});

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
  console.log(`Activity Dashboard endpoints:`);
  console.log(`  GET  /api/staff-activity/summary`);
  console.log(`  GET  /api/staff-activity/all`);
  console.log(`  GET  /api/staff-activity/staff/:staffId`);
  console.log(`  GET  /api/staff/:identifier/classes`);
});