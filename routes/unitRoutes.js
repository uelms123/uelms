const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const admin = require('firebase-admin');
const { getStorage } = require('firebase-admin/storage');
const fs = require('fs');
const crypto = require('crypto');

const Unit = require('../models/unit');
const File = require('../models/files');
const StaffActivity = require('../models/StaffActivity');
const Class = require('../models/Class');
const Staff = require('../models/Staff');
const DailyUpload = require('../models/DailyUpload');

/* =====================================================
   CONFIG
===================================================== */

// 🔴 DAILY UPLOAD LIMIT (CHANGE HERE)
const DAILY_UPLOAD_LIMIT = 10 * 1024 * 1024 * 1024; // 10 GB/day

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
};

// ✅ PERMANENT URL GENERATOR — uses Firebase download token (never expires)
const generatePermanentUrl = (fileName) => {
  return `https://firebasestorage.googleapis.com/v0/b/${process.env.FIREBASE_STORAGE_BUCKET}/o/${encodeURIComponent(fileName)}?alt=media`;
};

/* =====================================================
   MULTER CONFIG - DISK STORAGE FOR LARGE FILES
===================================================== */

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, '../temp_uploads');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, tempDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, uniqueSuffix + '-' + safeName);
  }
});

const upload = multer({
  storage: storage,
  limits: { 
    fileSize: 10 * 1024 * 1024 * 1024   // 10 GB in bytes
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
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Supported types: ${allowedTypes.join(', ')}`));
    }
  },
});

const uploadMiddleware = (req, res, next) => {
  upload.single('fileUpload')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: 'File too large. Maximum allowed size is 10 GB'
        });
      }
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
};

/* =====================================================
   FIREBASE UPLOAD HELPER FUNCTION
   ✅ FIXED: Uses permanent download token URLs instead of expiring signed URLs
===================================================== */

const uploadToFirebase = async (localFilePath, destinationPath, contentType) => {
  const bucket = getStorage().bucket();
  
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(localFilePath)) {
      return reject(new Error('Local file not found'));
    }

    const firebaseFile = bucket.file(destinationPath);

    // ✅ Generate a permanent download token
    const downloadToken = crypto.randomBytes(16).toString('hex');

    const writeStream = firebaseFile.createWriteStream({
      metadata: {
        contentType: contentType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          uploadedAt: new Date().toISOString()
        }
      },
      resumable: false
    });

    const readStream = fs.createReadStream(localFilePath);

    readStream.pipe(writeStream)
      .on('error', (error) => {
        reject(error);
      })
      .on('finish', () => {
        try {
          // ✅ Clean up temp file
          if (fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
          }

          // ✅ Build permanent URL with the download token (works immediately, never expires)
          const permanentUrl = `https://firebasestorage.googleapis.com/v0/b/${process.env.FIREBASE_STORAGE_BUCKET}/o/${encodeURIComponent(destinationPath)}?alt=media&token=${downloadToken}`;

          resolve({
            url: permanentUrl,
            filePath: destinationPath,
            downloadToken: downloadToken,
            fileName: path.basename(destinationPath)
          });
        } catch (err) {
          // Clean up temp file even on error
          if (fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
          }
          reject(err);
        }
      });
  });
};

/* =====================================================
   ROUTES
===================================================== */

// ✅ Helper: extract storage filePath from a signed URL when filePath field is empty
const extractFilePathFromSignedUrl = (url) => {
  try {
    // Format: https://storage.googleapis.com/BUCKET/PATH?GoogleAccessId=...
    // Remove the bucket prefix to get just the file path
    const withoutScheme = url.replace('https://storage.googleapis.com/', '');
    const bucket = process.env.FIREBASE_STORAGE_BUCKET;
    if (withoutScheme.startsWith(bucket + '/')) {
      const pathWithQuery = withoutScheme.slice(bucket.length + 1);
      return pathWithQuery.split('?')[0]; // strip query params
    }
  } catch (e) {
    // ignore
  }
  return null;
};

// ✅ Helper: detect ANY signed/expiring URL that needs replacing
const isExpiredSignedUrl = (url) => {
  if (!url) return false;
  return (
    url.includes('X-Goog-Signature') ||
    url.includes('x-goog-signature') ||
    url.includes('GoogleAccessId') ||
    url.includes('Signature=') ||
    url.includes('Expires=') ||
    // storage.googleapis.com (not firebasestorage.googleapis.com) is always a signed URL
    (url.startsWith('https://storage.googleapis.com/') && !url.includes('firebasestorage.googleapis.com'))
  );
};

// ✅ Helper: heal all uploaded files — set download token on Firebase + rebuild permanent URL
const healFileUrls = async (files) => {
  const healPromises = files.map(async (file) => {
    const f = file.toObject ? file.toObject() : { ...file };
    if (!f.isUploadedFile) return f;

    const needsHeal = isExpiredSignedUrl(f.url) ||
      // Also heal firebasestorage URLs that may lack a download token
      (f.url && f.url.includes('firebasestorage.googleapis.com') && !f.url.includes('token='));

    if (!needsHeal) return f;

    const resolvedPath = f.filePath || extractFilePathFromSignedUrl(f.url);
    if (!resolvedPath) return f;

    try {
      const bucket = getStorage().bucket();
      const fileRef = bucket.file(resolvedPath);

      // ✅ Set a fresh download token on the actual Firebase Storage file
      const downloadToken = crypto.randomBytes(16).toString('hex');
      await fileRef.setMetadata({
        metadata: {
          firebaseStorageDownloadTokens: downloadToken
        }
      });

      // ✅ Build permanent URL with the new token
      const newUrl = `https://firebasestorage.googleapis.com/v0/b/${process.env.FIREBASE_STORAGE_BUCKET}/o/${encodeURIComponent(resolvedPath)}?alt=media&token=${downloadToken}`;
      f.url = newUrl;

      // Save corrected URL + filePath back to MongoDB asynchronously
      File.findByIdAndUpdate(f._id, { url: newUrl, filePath: resolvedPath })
        .catch((e) => console.error('URL heal DB save error:', e.message));

    } catch (e) {
      // If Firebase file doesn't exist or any error, fall back to tokenless URL
      console.error(`URL heal error for ${resolvedPath}:`, e.message);
      f.url = generatePermanentUrl(resolvedPath);
    }

    return f;
  });

  return Promise.all(healPromises);
};

// Get all units for a class
router.get('/:classId', async (req, res) => {
  try {
    const units = await Unit.find({ classId: req.params.classId }).populate('files');

    // ✅ Heal any expired signed URLs before sending to frontend
    const healedUnits = await Promise.all(
      units.map(async (unit) => {
        const u = unit.toObject();
        u.files = await healFileUrls(unit.files);
        return u;
      })
    );

    res.json(healedUnits);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch units', details: err.message });
  }
});

// Create new unit with StaffActivity tracking
router.post('/', async (req, res) => {
  try {
    const { unitTitle, unitDescription, classId, staffId, staffEmail, staffName } = req.body;

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

    // StaffActivity tracking
    if (staffId && classId) {
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
        activity.activities.assessments = activity.activities.assessments || { count: 0, lastUpdated: new Date(), items: [] };
        activity.activities.assessments.count += 1;
        activity.activities.assessments.lastUpdated = new Date();
        activity.activities.assessments.items.push({
          title: unitTitle,
          createdAt: new Date(),
          type: 'unit',
          description: unitDescription || ''
        });

        await activity.save();
      }
    }

    res.status(201).json(savedUnit);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create unit', details: error.message });
  }
});

// 🔥 ADD FILE TO UNIT (WITH DAILY LIMIT & improved error handling)
router.post('/:unitId/files', uploadMiddleware, async (req, res) => {
  try {
    const { unitId } = req.params;
    const { fileName, notesContent, fileType, linkUrl, uploadedBy, uploadedByEmail } = req.body;

    if (!fileName) {
      return res.status(400).json({ error: 'File name is required' });
    }

    const unit = await Unit.findById(unitId);
    if (!unit) {
      return res.status(404).json({ error: 'Unit not found' });
    }

    let fileData;

    /* ========== FILE UPLOAD ========== */
    if (fileType === 'upload' && req.file) {
      // 🔐 DAILY LIMIT ENFORCEMENT
      await checkDailyLimit(req.file.size);

      const originalName = req.file.originalname;
      const ext = path.extname(originalName);
      const firebasePath = `units/${unitId}/files/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      
      // ✅ Upload to Firebase using streaming — returns permanent URL
      const uploadResult = await uploadToFirebase(
        req.file.path, 
        firebasePath, 
        req.file.mimetype
      );

      const isText =
        req.file.mimetype.startsWith('text/') ||
        req.file.mimetype === 'application/json' ||
        originalName.match(/\.(txt|js|html|css|md)$/i);

      // For text files, read content
      let fileContent = null;
      if (isText && fs.existsSync(req.file.path)) {
        fileContent = fs.readFileSync(req.file.path, 'utf8');
      }

      fileData = new File({
        title: fileName,
        name: originalName,
        type: req.file.mimetype,
        size: formatFileSize(req.file.size),
        content: fileContent,
        lastModified: new Date().toLocaleDateString(),
        isUploadedFile: true,
        isNotes: false,
        isLink: false,
        filePath: uploadResult.filePath,   // ✅ store path for future URL regeneration
        url: uploadResult.url,             // ✅ permanent URL
        uploadedBy: uploadedBy || unit.createdBy,
        uploadedByEmail: uploadedByEmail || unit.createdByEmail,
        unitId,
      });
    }

    /* ========== NOTES ========== */
    else if (fileType === 'notes' && notesContent) {
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
        unitId,
      });
    }

    /* ========== LINK ========== */
    else if (fileType === 'link' && linkUrl) {
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
        unitId,
      });
    } else {
      return res.status(400).json({ error: 'Invalid file data' });
    }

    const savedFile = await fileData.save();
    unit.files.push(savedFile._id);
    await unit.save();

    const populatedUnit = await Unit.findById(unitId).populate('files');
    const u = populatedUnit.toObject();
    u.files = await healFileUrls(populatedUnit.files);
    res.status(201).json(u);
  } catch (err) {
    // Clean up temp file if it exists
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    if (err.message.includes('Daily upload limit')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to add file', details: err.message });
  }
});

// ✅ Serve file info / URL — regenerates permanent URL from stored filePath if needed
router.get('/files/:fileId', async (req, res) => {
  try {
    const file = await File.findById(req.params.fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (file.isUploadedFile) {
      let fileUrl = file.url;

      // ✅ If stored URL is expired/broken, set a fresh download token on Firebase and regenerate URL
      const needsHeal = isExpiredSignedUrl(fileUrl) ||
        (fileUrl && fileUrl.includes('firebasestorage.googleapis.com') && !fileUrl.includes('token='));

      if (needsHeal) {
        const resolvedPath = file.filePath || extractFilePathFromSignedUrl(fileUrl);
        if (resolvedPath) {
          try {
            const bucket = getStorage().bucket();
            const fileRef = bucket.file(resolvedPath);
            const downloadToken = crypto.randomBytes(16).toString('hex');
            await fileRef.setMetadata({
              metadata: { firebaseStorageDownloadTokens: downloadToken }
            });
            fileUrl = `https://firebasestorage.googleapis.com/v0/b/${process.env.FIREBASE_STORAGE_BUCKET}/o/${encodeURIComponent(resolvedPath)}?alt=media&token=${downloadToken}`;
          } catch (e) {
            fileUrl = generatePermanentUrl(resolvedPath);
          }
          file.url = fileUrl;
          file.filePath = resolvedPath;
          await file.save();
        }
      }

      return res.json({ url: fileUrl, name: file.name, type: file.type });
    }

    if (file.isNotes || file.isLink) {
      return res.json({
        content: file.content,
        name: file.name,
        type: file.type,
      });
    }

    res.status(404).json({ error: 'File not accessible' });
  } catch (err) {
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
    const u = populatedUnit.toObject();
    u.files = await healFileUrls(populatedUnit.files);
    res.json(u);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update unit', details: err.message });
  }
});

// Update file in unit
router.put('/:unitId/files/:fileId', upload.single('fileUpload'), async (req, res) => {
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
      // 🔐 DAILY LIMIT ENFORCEMENT
      await checkDailyLimit(req.file.size);

      // Delete old file from Firebase if it exists
      if (file.filePath) {
        try {
          const oldFileRef = bucket.file(file.filePath);
          await oldFileRef.delete();
        } catch (deleteErr) {
          // Try URL-based delete as fallback for old records
          if (file.url) {
            try {
              const urlObj = new URL(file.url);
              const filePath = decodeURIComponent(urlObj.pathname.split('/o/')[1].split('?')[0]);
              await bucket.file(filePath).delete();
            } catch (e) {
              console.log('Could not delete old file:', e.message);
            }
          }
        }
      }

      const originalName = req.file.originalname;
      const fileExtension = path.extname(originalName);
      const firebaseFileName = `units/${unitId}/files/${Date.now()}-${Math.random().toString(36).slice(2)}${fileExtension}`;
      
      // ✅ Upload to Firebase — returns permanent URL
      const uploadResult = await uploadToFirebase(
        req.file.path, 
        firebaseFileName, 
        req.file.mimetype
      );

      const isTextFile =
        req.file.mimetype.startsWith('text/') ||
        req.file.mimetype === 'application/json' ||
        originalName.match(/\.(txt|js|html|css|md)$/i);

      let fileContent = null;
      if (isTextFile && fs.existsSync(req.file.path)) {
        fileContent = fs.readFileSync(req.file.path, 'utf8');
      }

      file.name = originalName;
      file.type = req.file.mimetype;
      file.size = formatFileSize(req.file.size);
      file.content = fileContent;
      file.isUploadedFile = true;
      file.isNotes = false;
      file.isLink = false;
      file.filePath = uploadResult.filePath;   // ✅ save path
      file.url = uploadResult.url;             // ✅ permanent URL
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
    const u = populatedUnit.toObject();
    u.files = await healFileUrls(populatedUnit.files);
    res.json(u);
  } catch (err) {
    // Clean up temp file if it exists
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
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
    const unit = await Unit.findById(unitId).populate('files');

    if (!unit) {
      return res.status(404).json({ error: 'Unit not found' });
    }

    const bucket = getStorage().bucket();

    for (const file of unit.files) {
      if (file.isUploadedFile) {
        try {
          // ✅ Use stored filePath first, fallback to parsing URL
          const filePath = file.filePath || (() => {
            const urlObj = new URL(file.url);
            return decodeURIComponent(urlObj.pathname.split('/o/')[1].split('?')[0]);
          })();
          await bucket.file(filePath).delete();
        } catch (err) {
          // Ignore delete errors
        }
      }
      await File.findByIdAndDelete(file._id);
    }

    await Unit.findByIdAndDelete(unitId);
    res.json({ message: 'Unit deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete unit', details: err.message });
  }
});

// Delete file from unit
router.delete('/:unitId/files/:fileId', async (req, res) => {
  try {
    const { unitId, fileId } = req.params;
    const unit = await Unit.findById(unitId);

    if (!unit) {
      return res.status(404).json({ error: 'Unit not found' });
    }

    const file = await File.findById(fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (file.isUploadedFile) {
      const bucket = getStorage().bucket();
      try {
        // ✅ Use stored filePath first, fallback to parsing URL
        const filePath = file.filePath || (() => {
          const urlObj = new URL(file.url);
          return decodeURIComponent(urlObj.pathname.split('/o/')[1].split('?')[0]);
        })();
        await bucket.file(filePath).delete();
      } catch (err) {
        // Ignore delete errors
      }
    }

    unit.files = unit.files.filter((f) => f.toString() !== fileId);
    await unit.save();
    await File.findByIdAndDelete(fileId);
    const populatedUnit = await Unit.findById(unitId).populate('files');
    const u = populatedUnit.toObject();
    u.files = await healFileUrls(populatedUnit.files);
    res.json(u);
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete file', details: err.message });
  }
});

module.exports = router;