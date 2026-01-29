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

/* =====================================================
   MULTER CONFIG
===================================================== */

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB per file
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

    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Invalid file type. Supported types: ${allowedTypes.join(', ')}`));
  },
});

/* =====================================================
   ROUTES
===================================================== */

// Get all units for a class
router.get('/:classId', async (req, res) => {
  try {
    const units = await Unit.find({ classId: req.params.classId }).populate('files');
    res.json(units);
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

    // StaffActivity tracking (from old code)
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
router.post('/:unitId/files', upload.single('fileUpload'), async (req, res) => {
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
    const bucket = getStorage().bucket();

    /* ========== FILE UPLOAD ========== */
    if (fileType === 'upload' && req.file) {
      // 🔐 DAILY LIMIT ENFORCEMENT (New Feature)
      await checkDailyLimit(req.file.size);

      const originalName = req.file.originalname;
      const ext = path.extname(originalName);
      const firebasePath = `units/${unitId}/files/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      const fileRef = bucket.file(firebasePath);

      await fileRef.save(req.file.buffer, {
        metadata: { contentType: req.file.mimetype },
      });

      const [url] = await fileRef.getSignedUrl({
        action: 'read',
        expires: '03-01-2500',
      });

      const isText =
        req.file.mimetype.startsWith('text/') ||
        req.file.mimetype === 'application/json' ||
        originalName.match(/\.(txt|js|html|css|md)$/i);

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
        filePath: '',
        url,
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
    res.status(201).json(populatedUnit);
  } catch (err) {
    if (err.message.includes('Daily upload limit')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to add file', details: err.message });
  }
});

// Serve file info / URL (no streaming from server)
router.get('/files/:fileId', async (req, res) => {
  try {
    const file = await File.findById(req.params.fileId);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (file.isUploadedFile && file.url) {
      return res.json({ url: file.url, name: file.name, type: file.type });
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
    res.json(populatedUnit);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update unit', details: err.message });
  }
});

// Update file in unit (WITH DAILY LIMIT for file uploads)
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
      // 🔐 DAILY LIMIT ENFORCEMENT for updates with new files
      await checkDailyLimit(req.file.size);

      if (file.url) {
        const oldFileName = file.url.split('/').pop().split('?')[0];
        const oldFileRef = bucket.file(`units/${unitId}/files/${decodeURIComponent(oldFileName)}`);
        try {
          await oldFileRef.delete();
        } catch (err) {
          // Ignore delete errors
        }
      }

      const originalName = req.file.originalname;
      const fileExtension = path.extname(originalName);
      const firebaseFileName = `units/${unitId}/files/${Date.now()}-${Math.random().toString(36).slice(2)}${fileExtension}`;
      const fileRef = bucket.file(firebaseFileName);

      await fileRef.save(req.file.buffer, {
        metadata: { contentType: req.file.mimetype },
      });

      const [downloadURL] = await fileRef.getSignedUrl({
        action: 'read',
        expires: '03-01-2500',
      });

      const isTextFile =
        req.file.mimetype.startsWith('text/') ||
        req.file.mimetype === 'application/json' ||
        originalName.match(/\.(txt|js|html|css|md)$/i);

      const fileContent = isTextFile
        ? req.file.buffer.toString('utf8')
        : null;

      file.name = originalName;
      file.type = req.file.mimetype;
      file.size = formatFileSize(req.file.size);
      file.content = fileContent;
      file.isUploadedFile = true;
      file.isNotes = false;
      file.isLink = false;
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
      if (file.isUploadedFile && file.url) {
        const fileName = file.url.split('/').pop().split('?')[0];
        const fileRef = bucket.file(`units/${unitId}/files/${decodeURIComponent(fileName)}`);
        try {
          await fileRef.delete();
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

    if (file.isUploadedFile && file.url) {
      const bucket = getStorage().bucket();
      const fileName = file.url.split('/').pop().split('?')[0];
      const fileRef = bucket.file(`units/${unitId}/files/${decodeURIComponent(fileName)}`);
      try {
        await fileRef.delete();
      } catch (err) {
        // Ignore delete errors
      }
    }

    unit.files = unit.files.filter((f) => f.toString() !== fileId);
    await unit.save();
    await File.findByIdAndDelete(fileId);
    const populatedUnit = await Unit.findById(unitId).populate('files');
    res.json(populatedUnit);
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete file', details: err.message });
  }
});

module.exports = router;