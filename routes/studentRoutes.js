const express = require('express');
const router = express.Router();
const Student = require('../models/Students');
const Class = require('../models/Class');
const admin = require('firebase-admin');

const safeValue = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  return String(value).trim();
};

const buildStudentName = (student) => {
  const name = safeValue(student?.name);
  if (name) return name;

  const email = safeValue(student?.email);
  if (email && email.includes('@')) {
    return email.split('@')[0];
  }

  return 'Student';
};

const buildProgram = (student) => {
  return safeValue(student?.program) || 'No Program Assigned';
};

const buildStudentId = (student) => {
  return safeValue(student?.studentId) || `STD-${String(student?._id || '').slice(-6).toUpperCase() || Date.now()}`;
};

const buildPassword = (student) => {
  return safeValue(student?.password) || safeValue(student?.tempPassword) || 'Old account - reset required';
};

async function normalizeStudentRecord(student) {
  let changed = false;

  const fixedName = buildStudentName(student);
  if (student.name !== fixedName) {
    student.name = fixedName;
    changed = true;
  }

  const fixedProgram = buildProgram(student);
  if (student.program !== fixedProgram) {
    student.program = fixedProgram;
    changed = true;
  }

  const fixedStudentId = buildStudentId(student);
  if (!safeValue(student.studentId) || student.studentId !== fixedStudentId) {
    student.studentId = fixedStudentId;
    changed = true;
  }

  if (!safeValue(student.password) && !safeValue(student.tempPassword)) {
    student.tempPassword = 'Old account - reset required';
    changed = true;
  }

  if (changed) {
    student.updatedAt = new Date();
    await student.save();
  }

  return student;
}

async function createFirebaseUser(email, password, displayName = '') {
  try {
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
      displayName: displayName || undefined,
      emailVerified: false,
      disabled: false
    });
    return { success: true, uid: userRecord.uid, created: true };
  } catch (error) {
    if (error.code === 'auth/email-already-exists') {
      try {
        const existingUser = await admin.auth().getUserByEmail(email);
        await admin.auth().updateUser(existingUser.uid, {
          password: password,
          displayName: displayName || existingUser.displayName
        });
        return { success: true, uid: existingUser.uid, alreadyExists: true };
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

    const normalizedStudents = [];
    for (const student of students) {
      const normalized = await normalizeStudentRecord(student);
      normalizedStudents.push(normalized);
    }

    res.status(200).json(normalizedStudents);
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

    const normalizedStudents = students.map(student => ({
      ...student.toObject(),
      name: buildStudentName(student),
      program: buildProgram(student),
      studentId: safeValue(student.studentId) || 'Not assigned',
      password: safeValue(student.password),
      tempPassword: safeValue(student.tempPassword) || (!safeValue(student.password) ? 'Old account - reset required' : '')
    }));

    res.status(200).json(normalizedStudents);
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

    await normalizeStudentRecord(student);

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
        instructor: staffName || 'N/A',
        instructorEmail: staffEmail || 'N/A',
        staffId: cls.staffId || 'N/A',
        enrollmentDate: studentInClass ? studentInClass.joinedAt : cls.createdAt,
        classCreatedAt: cls.createdAt,
        studentData: studentInClass || {}
      });
    });

    res.status(200).json({
      success: true,
      student: {
        studentId: buildStudentId(student),
        name: buildStudentName(student),
        email: student.email || 'N/A',
        program: buildProgram(student),
        tempPassword: safeValue(student.tempPassword) || (!safeValue(student.password) ? 'Old account - reset required' : ''),
        password: safeValue(student.password),
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

/*
  FIXED:
  This route now creates the Firebase user first, then saves MongoDB.
*/
router.post('/', async (req, res) => {
  let firebaseUid = null;

  try {
    const { name, program, email, tempPassword, password } = req.body;
    const finalPassword = tempPassword || password;

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

    if (!finalPassword || finalPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters'
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

    const firebaseResult = await createFirebaseUser(lowerEmail, finalPassword, safeValue(name));
    if (!firebaseResult.success) {
      return res.status(400).json({
        success: false,
        error: 'Firebase error: ' + firebaseResult.error
      });
    }

    firebaseUid = firebaseResult.uid;

    const newStudent = new Student({
      studentId: firebaseUid,
      name: safeValue(name),
      program: safeValue(program) || 'No Program Assigned',
      email: lowerEmail,
      tempPassword: finalPassword,
      password: finalPassword,
      createdByAdmin: true,
      accountCreated: new Date(),
      createdAt: new Date(),
      isActive: true
    });

    await newStudent.save();

    res.status(201).json({
      success: true,
      message: 'Student added successfully',
      data: newStudent
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

        if (!email || !email.trim()) {
          results.failed++;
          results.errors.push(`Row ${i + 1}: Missing email for ${name || 'unknown'}`);
          continue;
        }

        if (!password || password.length < 6) {
          results.failed++;
          results.errors.push(`Row ${i + 1}: Password must be at least 6 characters for: ${email}`);
          continue;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
          results.failed++;
          results.errors.push(`Row ${i + 1}: Invalid email format: ${email}`);
          continue;
        }

        const cleanEmail = email.toLowerCase().trim();
        const cleanName = name.trim();
        const cleanProgram = (program || '').trim() || 'No Program Assigned';

        const firebaseResult = await createFirebaseUser(cleanEmail, password, cleanName);
        if (firebaseResult.success) {
          results.firebaseSuccess++;
        } else {
          results.firebaseFailed++;
          results.failed++;
          results.errors.push(`Row ${i + 1}: Firebase error for ${cleanEmail}: ${firebaseResult.error}`);
          continue;
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

          if (!safeValue(existingStudent.studentId)) {
            existingStudent.studentId = firebaseResult.uid || buildStudentId(existingStudent);
          }

          await existingStudent.save();
          results.updated++;
        } else {
          const newStudent = new Student({
            studentId: firebaseResult.uid,
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
    if (program !== undefined) updateData.program = safeValue(program) || 'No Program Assigned';
    if (tempPassword !== undefined) updateData.tempPassword = tempPassword;

    if (password !== undefined) {
      updateData.password = password;
      updateData.tempPassword = password;

      const firebaseUpdate = await updateFirebaseUserPassword(email.toLowerCase(), password);
      if (!firebaseUpdate.success) {
        return res.status(400).json({
          success: false,
          error: 'Failed to update Firebase password: ' + firebaseUpdate.error
        });
      }
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

    if (!safeValue(result.studentId)) {
      result.studentId = buildStudentId(result);
      await result.save();
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

/*
  Run once if needed:
  PUT /api/students/fix-old-students-data
*/
router.put('/fix-old-students-data', async (req, res) => {
  try {
    const students = await Student.find({});
    let updated = 0;

    for (const student of students) {
      let changed = false;

      const fixedName = buildStudentName(student);
      if (student.name !== fixedName) {
        student.name = fixedName;
        changed = true;
      }

      const fixedProgram = buildProgram(student);
      if (student.program !== fixedProgram) {
        student.program = fixedProgram;
        changed = true;
      }

      const fixedStudentId = buildStudentId(student);
      if (!safeValue(student.studentId) || student.studentId !== fixedStudentId) {
        student.studentId = fixedStudentId;
        changed = true;
      }

      if (!safeValue(student.password) && !safeValue(student.tempPassword)) {
        student.tempPassword = 'Old account - reset required';
        changed = true;
      }

      if (changed) {
        student.updatedAt = new Date();
        await student.save();
        updated++;
      }
    }

    res.json({
      success: true,
      message: `${updated} old student records fixed successfully`
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;