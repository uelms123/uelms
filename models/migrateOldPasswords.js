// migrateOldPasswords.js
const mongoose = require('mongoose');
const Staff = require('./models/Staff');
const Student = require('./models/Students');
const admin = require('firebase-admin');

// Initialize Firebase Admin if not already done
const serviceAccount = require('./path-to-your-firebase-adminsdk.json'); // Update path

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

async function migrateOldPasswords() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/uelms', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('Connected to MongoDB for password migration...');

    // Get all staff from MongoDB
    const allStaff = await Staff.find();
    console.log(`Found ${allStaff.length} staff records to process`);

    let staffUpdated = 0;
    let staffErrors = 0;

    // Process each staff member
    for (const staff of allStaff) {
      try {
        console.log(`\nProcessing staff: ${staff.email}`);
        
        // Try to get Firebase user by email
        let firebaseUser;
        try {
          firebaseUser = await admin.auth().getUserByEmail(staff.email);
          console.log(`✓ Found Firebase user for ${staff.email}`);
        } catch (firebaseErr) {
          if (firebaseErr.code === 'auth/user-not-found') {
            console.log(`✗ Firebase user not found for ${staff.email}`);
            staffErrors++;
            continue;
          }
          throw firebaseErr;
        }

        // Generate a random password for display (we can't retrieve actual passwords from Firebase)
        // Since Firebase doesn't store plain text passwords, we'll show a placeholder
        const displayPassword = `ue_${staff.email.split('@')[0]}_${Date.now().toString().slice(-4)}`;
        
        // Update staff with temporary password display
        staff.tempPassword = displayPassword;
        
        // Add to password history
        if (!staff.passwordHistory) {
          staff.passwordHistory = [];
        }
        
        staff.passwordHistory.push({
          password: displayPassword,
          createdAt: new Date(),
          createdBy: 'system',
          note: 'Migrated from Firebase - actual password not retrievable'
        });
        
        staff.lastPasswordUpdated = new Date();
        
        await staff.save();
        staffUpdated++;
        console.log(`✓ Updated ${staff.email} with password placeholder`);
        
      } catch (err) {
        console.error(`Error processing ${staff.email}:`, err.message);
        staffErrors++;
      }
    }

    // Process Students
    const allStudents = await Student.find();
    console.log(`\nFound ${allStudents.length} student records to process`);

    let studentsUpdated = 0;
    let studentErrors = 0;

    for (const student of allStudents) {
      try {
        console.log(`\nProcessing student: ${student.email}`);
        
        // Try to get Firebase user by email
        let firebaseUser;
        try {
          firebaseUser = await admin.auth().getUserByEmail(student.email);
          console.log(`✓ Found Firebase user for ${student.email}`);
        } catch (firebaseErr) {
          if (firebaseErr.code === 'auth/user-not-found') {
            console.log(`✗ Firebase user not found for ${student.email}`);
            studentErrors++;
            continue;
          }
          throw firebaseErr;
        }

        // Generate display password for student
        const displayPassword = `ue_student_${student.email.split('@')[0]}_${Date.now().toString().slice(-4)}`;
        
        // Update student with temporary password display
        student.tempPassword = displayPassword;
        
        // If Student model doesn't have passwordHistory, add it
        if (!student.passwordHistory) {
          student.passwordHistory = [];
        }
        
        student.passwordHistory.push({
          password: displayPassword,
          createdAt: new Date(),
          createdBy: 'system',
          note: 'Migrated from Firebase - actual password not retrievable'
        });
        
        await student.save();
        studentsUpdated++;
        console.log(`✓ Updated ${student.email} with password placeholder`);
        
      } catch (err) {
        console.error(`Error processing ${student.email}:`, err.message);
        studentErrors++;
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log('MIGRATION SUMMARY:');
    console.log('='.repeat(50));
    console.log(`Staff: ${staffUpdated} updated, ${staffErrors} errors`);
    console.log(`Students: ${studentsUpdated} updated, ${studentErrors} errors`);
    console.log('='.repeat(50));
    console.log('\nNote: Actual passwords cannot be retrieved from Firebase.');
    console.log('Display passwords are placeholders for PDF generation.');
    
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrateOldPasswords();