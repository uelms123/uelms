const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const admin = require('firebase-admin');
const { getStorage } = require('firebase-admin/storage');

const Unit = require('../models/unit');
const File = require('../models/files');
const StaffActivity = require('../models/StaffActivity');
const Class = require('../models/Class');
const Staff = require('../models/Staff');
const DailyUpload = require('../models/DailyUpload'); // ✅ NEW - Daily upload tracking

/* =====================================================
   CONFIG
===================================================== */

// 🔴 DAILY UPLOAD LIMIT (CHANGE HERE)
const DAILY_UPLOAD_LIMIT = 10 * 1024 * 1024 * 1024; // 10 GB/day

/* =====================================================
   CORS MIDDLEWARE
===================================================== */
const setCorsHeaders = (req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://uelms.com');
  res.header('Access-Control-Allow-Origin', 'http://localhost:3000'); // For local development
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
};

// Apply CORS to all routes in this router
router.use(setCorsHeaders);

/* =====================================================
   HELPERS
===================================================== */

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// ✅ DAILY LIMIT CHECK (New Feature)
const checkDailyLimit = async (uploadSize) => {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  let record = await DailyUpload.findOne({ date: today });

  if (!record) {
    record = new DailyUpload({ date: today, totalBytes: 0 });
  }

  if (record.totalBytes + uploadSize > DAILY_UPLOAD_LIMIT) {
    const remaining = DAILY_UPLOAD_LIMIT - record.totalBytes;
    throw new Error(
      `Daily upload limit exceeded. Remaining: ${formatFileSize(remaining)}`
    );
  }

  record.totalBytes += uploadSize;
  await record.save();
  console.log(`Daily limit updated: ${formatFileSize(record.totalBytes)} used of ${formatFileSize(DAILY_UPLOAD_LIMIT)}`);
};

/* =====================================================
   MULTER CONFIG
===================================================== */

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { 
    fileSize: 10 * 1024 * 1024 * 1024,   // 10 GB in bytes
    fieldSize: 100 * 1024 * 1024,       // 100 MB for form fields
    fields: 50,                         // Max number of fields
    parts: 100,                         // Max number of parts (files + fields)
    headerPairs: 2000                   // Max number of header key=>value pairs
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/mpeg', 'video/webm', 'video/ogg',
      'audio/mpeg', 'audio/wav', 'audio/ogg',
      'application/pdf',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain', 'application/json', 'text/html', 'text/css',
      'application/javascript', 'text/markdown', 'application/zip',
      'application/x-zip-compressed',
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Supported types: ${allowedTypes.join(', ')}`));
    }
  },
});

// Upload middleware with better error handling
const uploadMiddleware = (req, res, next) => {
  // Increase timeout for file uploads
  req.setTimeout(300000); // 5 minutes
  
  upload.single('fileUpload')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error('Multer Error:', err.code, err.message);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: `File too large. Maximum allowed size is 10 GB.`
        });
      } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({
          error: 'Unexpected file field. Please use "fileUpload" as the field name.'
        });
      } else if (err.code === 'LIMIT_PART_COUNT') {
        return res.status(400).json({
          error: 'Too many parts in the form.'
        });
      }
      return res.status(400).json({ 
        error: `Upload error: ${err.message}`,
        code: err.code 
      });
    }
    if (err) {
      console.error('Upload Error:', err.message);
      return res.status(400).json({ 
        error: err.message,
        details: 'File upload validation failed'
      });
    }
    
    console.log('File uploaded:', req.file ? `${req.file.originalname} (${formatFileSize(req.file.size)})` : 'No file');
    next();
  });
};

/* =====================================================
   ROUTES
===================================================== */

// Get all units for a class
router.get('/:classId', async (req, res) => {
  try {
    console.log(`Fetching units for class: ${req.params.classId}`);
    const units = await Unit.find({ classId: req.params.classId }).populate('files');
    console.log(`Found ${units.length} units`);
    res.json(units);
  } catch (err) {
    console.error('GET units error:', err);
    res.status(500).json({ error: 'Failed to fetch units', details: err.message });
  }
});

// Create new unit with StaffActivity tracking
router.post('/', async (req, res) => {
  try {
    const { unitTitle, unitDescription, classId, staffId, staffEmail, staffName } = req.body;
    console.log('Creating unit:', { unitTitle, classId, staffId });

    if (!unitTitle || !classId) {
      return res.status(400).json({ error: 'Unit title and class ID are required' });
    }

    const newUnit = new Unit({
      title: unitTitle,
      description: unitDescription || '',
      classId: classId,
      createdBy: staffId || null,
      createdByEmail: staffEmail || null,
      createdByName: staffName || null,
      files: []
    });

    const savedUnit = await newUnit.save();
    console.log('Unit created:', savedUnit._id);

    // StaffActivity tracking
    if (staffId && classId) {
      try {
        const classData = await Class.findById(classId);
        if (classData) {
          let activity = await StaffActivity.findOne({ staffId, classId });

          let finalStaffName = staffName;
          if (!finalStaffName) {
            const staffData = await Staff.findOne({ staffId });
            finalStaffName = staffData ? staffData.name : 'Unknown Staff';
          }

          if (!activity) {
            activity = new StaffActivity({
              staffId,
              staffEmail: staffEmail || '',
              staffName: finalStaffName,
              classId,
              className: classData.name,
              classSubject: classData.subject || '',
              classSection: classData.section || '',
              classCreatedDate: classData.createdAt,
            });
          }

          activity.totalAssessments = (activity.totalAssessments || 0) + 1;
          activity.activities.assessments = activity.activities.assessments || { 
            count: 0, 
            lastUpdated: new Date(), 
            items: [] 
          };
          activity.activities.assessments.count += 1;
          activity.activities.assessments.lastUpdated = new Date();
          activity.activities.assessments.items.push({
            title: unitTitle,
            createdAt: new Date(),
            type: 'unit',
            description: unitDescription || ''
          });

          await activity.save();
          console.log('StaffActivity updated for staff:', staffId);
        }
      } catch (activityError) {
        console.error('StaffActivity update failed:', activityError);
        // Don't fail the whole request if activity tracking fails
      }
    }

    res.status(201).json(savedUnit);
  } catch (error) {
    console.error('POST unit error:', error);
    res.status(500).json({ error: 'Failed to create unit', details: error.message });
  }
});

// 🔥 ADD FILE TO UNIT (WITH DAILY LIMIT & improved error handling)
router.post('/:unitId/files', uploadMiddleware, async (req, res) => {
  try {
    console.log('Starting file upload...');
    const { unitId } = req.params;
    const { fileName, notesContent, fileType, linkUrl, uploadedBy, uploadedByEmail } = req.body;

    console.log('Upload data:', { 
      unitId, 
      fileName, 
      fileType, 
      hasFile: !!req.file,
      fileSize: req.file ? formatFileSize(req.file.size) : 'No file'
    });

    if (!fileName) {
      return res.status(400).json({ error: 'File name is required' });
    }

    const unit = await Unit.findById(unitId);
    if (!unit) {
      return res.status(404).json({ error: 'Unit not found' });
    }

    let fileData;
    const bucket = getStorage().bucket();

    /* ========== FILE UPLOAD ========== */
    if (fileType === 'upload' && req.file) {
      console.log(`Processing file: ${req.file.originalname}, Size: ${formatFileSize(req.file.size)}`);

      // 🔐 DAILY LIMIT ENFORCEMENT
      await checkDailyLimit(req.file.size);

      const originalName = req.file.originalname;
      const ext = path.extname(originalName);
      const firebasePath = `units/${unitId}/files/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      const fileRef = bucket.file(firebasePath);

      console.log('Uploading to Firebase:', firebasePath);
      
      // Add metadata including content type
      const metadata = {
        contentType: req.file.mimetype,
        metadata: {
          originalName: originalName,
          uploadedBy: uploadedBy || unit.createdByEmail || 'unknown',
          unitId: unitId,
          fileName: fileName,
          uploadedAt: new Date().toISOString()
        }
      };

      await fileRef.save(req.file.buffer, { metadata });
      console.log('File saved to Firebase');

      // Generate signed URL
      const [url] = await fileRef.getSignedUrl({
        action: 'read',
        expires: '03-01-2500', // Very long expiry
      });
      console.log('Signed URL generated');

      const isText = req.file.mimetype.startsWith('text/') ||
                    req.file.mimetype === 'application/json' ||
                    originalName.match(/\.(txt|js|html|css|md|json)$/i);

      fileData = new File({
        title: fileName,
        name: originalName,
        type: req.file.mimetype,
        size: formatFileSize(req.file.size),
        content: isText ? req.file.buffer.toString('utf8') : null,
        lastModified: new Date().toLocaleDateString(),
        isUploadedFile: true,
        isNotes: false,
        isLink: false,
        filePath: firebasePath,
        url: url,
        uploadedBy: uploadedBy || unit.createdBy,
        uploadedByEmail: uploadedByEmail || unit.createdByEmail,
        unitId: unitId
      });
    }
    /* ========== NOTES ========== */
    else if (fileType === 'notes' && notesContent) {
      console.log('Creating notes file');
      const blob = Buffer.from(notesContent);
      fileData = new File({
        title: fileName,
        name: fileName + '.txt',
        type: 'text/plain',
        size: formatFileSize(blob.length),
        content: notesContent,
        lastModified: new Date().toLocaleDateString(),
        isUploadedFile: false,
        isNotes: true,
        isLink: false,
        filePath: '',
        url: '',
        uploadedBy: uploadedBy || unit.createdBy,
        uploadedByEmail: uploadedByEmail || unit.createdByEmail,
        unitId: unitId
      });
    }
    /* ========== LINK ========== */
    else if (fileType === 'link' && linkUrl) {
      console.log('Creating link file');
      if (!linkUrl.match(/^https?:\/\/[^\s/$.?#].[^\s]*$/)) {
        return res.status(400).json({ error: 'Invalid URL format' });
      }
      fileData = new File({
        title: fileName,
        name: fileName,
        type: 'text/link',
        size: formatFileSize(Buffer.from(linkUrl).length),
        content: linkUrl,
        lastModified: new Date().toLocaleDateString(),
        isUploadedFile: false,
        isNotes: false,
        isLink: true,
        filePath: '',
        url: linkUrl,
        uploadedBy: uploadedBy || unit.createdBy,
        uploadedByEmail: uploadedByEmail || unit.createdByEmail,
        unitId: unitId
      });
    } else {
      return res.status(400).json({ 
        error: 'Invalid file data. Please provide either a file, notes content, or a valid link URL.' 
      });
    }

    console.log('Saving file to database...');
    const savedFile = await fileData.save();
    unit.files.push(savedFile._id);
    await unit.save();

    const populatedUnit = await Unit.findById(unitId).populate('files');
    console.log('File upload completed successfully');
    res.status(201).json(populatedUnit);
  } catch (err) {
    console.error('File upload error:', err);
    if (err.message.includes('Daily upload limit')) {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === 403 || err.message.includes('permission')) {
      return res.status(403).json({ 
        error: 'Firebase Storage permission denied. Check your Firebase rules.' 
      });
    }
    res.status(500).json({ 
      error: 'Failed to add file', 
      details: err.message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  }
});

// Serve file info / URL
router.get('/files/:fileId', async (req, res) => {
  try {
    const file = await File.findById(req.params.fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (file.isUploadedFile && file.url) {
      return res.json({ 
        url: file.url, 
        name: file.name, 
        type: file.type,
        size: file.size,
        title: file.title
      });
    }

    if (file.isNotes || file.isLink) {
      return res.json({
        content: file.content,
        name: file.name,
        type: file.type,
        size: file.size,
        title: file.title
      });
    }

    res.status(404).json({ error: 'File not accessible' });
  } catch (err) {
    console.error('Get file error:', err);
    res.status(500).json({ error: 'Failed to serve file info', details: err.message });
  }
});

// Update unit with Overview notes handling
router.put('/:unitId', async (req, res) => {
  try {
    const { unitId } = req.params;
    const { unitTitle, unitDescription } = req.body;

    if (!unitTitle) {
      return res.status(400).json({ error: 'Unit title is required' });
    }

    const unit = await Unit.findById(unitId).populate('files');
    if (!unit) {
      return res.status(404).json({ error: 'Unit not found' });
    }

    unit.title = unitTitle;

    if (unitDescription !== undefined) {
      const overviewFile = unit.files.find(f => f.title === 'Overview' && f.isNotes);
      if (overviewFile) {
        overviewFile.content = unitDescription;
        overviewFile.size = formatFileSize(Buffer.from(unitDescription).length);
        overviewFile.lastModified = new Date().toLocaleDateString();
        await overviewFile.save();
      } else if (unitDescription) {
        const newFile = new File({
          title: 'Overview',
          name: 'overview.txt',
          type: 'text/plain',
          size: formatFileSize(Buffer.from(unitDescription).length),
          content: unitDescription,
          lastModified: new Date().toLocaleDateString(),
          isNotes: true,
          isUploadedFile: false,
          isLink: false,
          filePath: '',
          url: '',
          uploadedBy: unit.createdBy,
          uploadedByEmail: unit.createdByEmail,
          unitId: unitId
        });
        const savedFile = await newFile.save();
        unit.files.push(savedFile._id);
      }
    }

    await unit.save();
    const populatedUnit = await Unit.findById(unitId).populate('files');
    res.json(populatedUnit);
  } catch (err) {
    console.error('Update unit error:', err);
    res.status(500).json({ error: 'Failed to update unit', details: err.message });
  }
});

// Update file in unit (WITH DAILY LIMIT for file uploads)
router.put('/:unitId/files/:fileId', uploadMiddleware, async (req, res) => {
  try {
    const { unitId, fileId } = req.params;
    const { fileName, notesContent, fileType, linkUrl } = req.body;

    if (!fileName) {
      return res.status(400).json({ error: 'File name is required' });
    }

    const unit = await Unit.findById(unitId);
    if (!unit) {
      return res.status(404).json({ error: 'Unit not found' });
    }

    const file = await File.findById(fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    file.title = fileName;
    file.lastModified = new Date().toLocaleDateString();

    const bucket = getStorage().bucket();

    if (fileType === 'upload' && req.file) {
      console.log('Updating file with new upload');

      // 🔐 DAILY LIMIT ENFORCEMENT for updates with new files
      await checkDailyLimit(req.file.size);

      // Delete old file from Firebase if it exists
      if (file.url) {
        try {
          const oldFileName = file.url.split('/').pop().split('?')[0];
          const oldFileRef = bucket.file(`units/${unitId}/files/${decodeURIComponent(oldFileName)}`);
          await oldFileRef.delete();
          console.log('Old file deleted from Firebase');
        } catch (deleteErr) {
          console.warn('Could not delete old file:', deleteErr.message);
          // Continue even if delete fails
        }
      }

      const originalName = req.file.originalname;
      const fileExtension = path.extname(originalName);
      const firebaseFileName = `units/${unitId}/files/${Date.now()}-${Math.random().toString(36).slice(2)}${fileExtension}`;
      const fileRef = bucket.file(firebaseFileName);

      const metadata = {
        contentType: req.file.mimetype,
        metadata: {
          originalName: originalName,
          uploadedBy: file.uploadedBy || unit.createdBy,
          unitId: unitId,
          fileName: fileName,
          updatedAt: new Date().toISOString()
        }
      };

      await fileRef.save(req.file.buffer, { metadata });

      const [downloadURL] = await fileRef.getSignedUrl({
        action: 'read',
        expires: '03-01-2500',
      });

      const isTextFile = req.file.mimetype.startsWith('text/') ||
                        req.file.mimetype === 'application/json' ||
                        originalName.match(/\.(txt|js|html|css|md|json)$/i);

      const fileContent = isTextFile ? req.file.buffer.toString('utf8') : null;

      file.name = originalName;
      file.type = req.file.mimetype;
      file.size = formatFileSize(req.file.size);
      file.content = fileContent;
      file.isUploadedFile = true;
      file.isNotes = false;
      file.isLink = false;
      file.filePath = firebaseFileName;
      file.url = downloadURL;
    } else if (fileType === 'notes' && notesContent) {
      const blob = Buffer.from(notesContent);
      file.name = fileName + '.txt';
      file.type = 'text/plain';
      file.size = formatFileSize(blob.length);
      file.content = notesContent;
      file.isUploadedFile = false;
      file.isNotes = true;
      file.isLink = false;
      file.url = '';
    } else if (fileType === 'link' && linkUrl) {
      if (!linkUrl.match(/^https?:\/\/[^\s/$.?#].[^\s]*$/)) {
        return res.status(400).json({ error: 'Invalid URL format' });
      }
      file.name = fileName;
      file.type = 'text/link';
      file.size = formatFileSize(Buffer.from(linkUrl).length);
      file.content = linkUrl;
      file.isUploadedFile = false;
      file.isNotes = false;
      file.isLink = true;
      file.url = linkUrl;
    } else {
      return res.status(400).json({ error: 'Invalid file, notes content, or link URL' });
    }

    await file.save();
    const populatedUnit = await Unit.findById(unitId).populate('files');
    res.json(populatedUnit);
  } catch (err) {
    console.error('Update file error:', err);
    if (err.message.includes('Daily upload limit')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to update file', details: err.message });
  }
});

// Delete unit with file cleanup
router.delete('/:unitId', async (req, res) => {
  try {
    const { unitId } = req.params;
    console.log('Deleting unit:', unitId);
    
    const unit = await Unit.findById(unitId).populate('files');

    if (!unit) {
      return res.status(404).json({ error: 'Unit not found' });
    }

    const bucket = getStorage().bucket();

    for (const file of unit.files) {
      if (file.isUploadedFile && file.url) {
        try {
          const fileName = file.url.split('/').pop().split('?')[0];
          const fileRef = bucket.file(`units/${unitId}/files/${decodeURIComponent(fileName)}`);
          await fileRef.delete();
          console.log('Deleted file from Firebase:', fileName);
        } catch (err) {
          console.warn('Could not delete file from Firebase:', err.message);
        }
      }
      await File.findByIdAndDelete(file._id);
      console.log('Deleted file from database:', file._id);
    }

    await Unit.findByIdAndDelete(unitId);
    console.log('Unit deleted successfully');
    res.json({ message: 'Unit deleted successfully' });
  } catch (err) {
    console.error('Delete unit error:', err);
    res.status(500).json({ error: 'Failed to delete unit', details: err.message });
  }
});

// Delete file from unit
router.delete('/:unitId/files/:fileId', async (req, res) => {
  try {
    const { unitId, fileId } = req.params;
    console.log('Deleting file:', fileId, 'from unit:', unitId);
    
    const unit = await Unit.findById(unitId);

    if (!unit) {
      return res.status(404).json({ error: 'Unit not found' });
    }

    const file = await File.findById(fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (file.isUploadedFile && file.url) {
      const bucket = getStorage().bucket();
      try {
        const fileName = file.url.split('/').pop().split('?')[0];
        const fileRef = bucket.file(`units/${unitId}/files/${decodeURIComponent(fileName)}`);
        await fileRef.delete();
        console.log('Deleted file from Firebase:', fileName);
      } catch (err) {
        console.warn('Could not delete file from Firebase:', err.message);
      }
    }

    unit.files = unit.files.filter((f) => f.toString() !== fileId);
    await unit.save();
    await File.findByIdAndDelete(fileId);
    
    const populatedUnit = await Unit.findById(unitId).populate('files');
    res.json(populatedUnit);
  } catch (err) {
    console.error('Delete file error:', err);
    res.status(500).json({ error: 'Failed to delete file', details: err.message });
  }
});

module.exports = router;