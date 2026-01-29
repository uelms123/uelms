const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fsPromises = require('fs').promises;
const admin = require('firebase-admin');
const { getStorage } = require('firebase-admin/storage');
const Unit = require('../models/unit');
const File = require('../models/files');
const StaffActivity = require('../models/StaffActivity');
const Class = require('../models/Class');
const Staff = require('../models/Staff');

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: { 
    fileSize: 500 * 1024 * 1024,
    fieldSize: 500 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg','image/png','image/gif','image/webp',
      'video/mp4','video/mpeg','video/webm','video/ogg','video/quicktime','video/x-msvideo',
      'audio/mpeg','audio/wav','audio/ogg',
      'application/pdf',
      'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain','application/json','text/html','text/css','application/javascript','text/markdown',
      'application/zip',
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Supported types: ${allowedTypes.join(', ')}`));
    }
  },
});

router.get('/:classId', async (req, res) => {
  try {
    const units = await Unit.find({ classId: req.params.classId }).populate('files');
    res.json(units);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch units', details: err.message });
  }
});

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

router.post('/generate-signed-upload-url', async (req, res) => {
  try {
    const { unitId, fileName, fileType, fileSize } = req.body;

    if (!unitId || !fileName || !fileType) {
      return res.status(400).json({ error: 'unitId, fileName, and fileType are required' });
    }

    const bucket = getStorage().bucket();
    
    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const extension = path.extname(safeFileName) || '.bin';
    const firebasePath = `units/${unitId}/files/${Date.now()}-${Math.random().toString(36).slice(2, 10)}${extension}`;

    const fileRef = bucket.file(firebasePath);

    const [signedUrl] = await fileRef.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 60 * 60 * 1000,
      contentType: fileType,
    });

    res.json({
      success: true,
      signedUrl,
      firebasePath,
      fileName: safeFileName,
      contentType: fileType
    });
  } catch (err) {
    res.status(500).json({ 
      error: 'Failed to generate upload URL', 
      details: err.message 
    });
  }
});

router.post('/:unitId/files/metadata', async (req, res) => {
  try {
    const { unitId } = req.params;
    const { 
      title, 
      originalName, 
      contentType, 
      size, 
      firebasePath, 
      downloadUrl, 
      uploadedBy, 
      uploadedByEmail 
    } = req.body;

    if (!title || !firebasePath || !downloadUrl) {
      return res.status(400).json({ error: 'Required fields missing' });
    }

    const unit = await Unit.findById(unitId);
    if (!unit) return res.status(404).json({ error: 'Unit not found' });

    const fileDoc = new File({
      title,
      name: originalName || title,
      type: contentType,
      size: formatFileSize(size),
      lastModified: new Date().toLocaleDateString(),
      isUploadedFile: true,
      isNotes: false,
      isLink: false,
      filePath: firebasePath,
      url: downloadUrl,
      uploadedBy: uploadedBy || unit.createdBy,
      uploadedByEmail: uploadedByEmail || unit.createdByEmail,
      unitId
    });

    const savedFile = await fileDoc.save();
    unit.files.push(savedFile._id);
    await unit.save();

    const populated = await Unit.findById(unitId).populate('files');
    res.json(populated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save file metadata', details: err.message });
  }
});

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

    if (fileType === 'upload' && req.file) {
      const originalName = req.file.originalname;
      const fileExtension = path.extname(originalName);
      const firebaseFileName = `units/${unitId}/files/${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExtension}`;
      const fileRef = bucket.file(firebaseFileName);

      if (req.file.size > 50 * 1024 * 1024) {
        await fileRef.save(req.file.buffer, {
          metadata: { contentType: req.file.mimetype },
          resumable: true,
          timeout: 600000,
        });
      } else {
        await fileRef.save(req.file.buffer, {
          metadata: { contentType: req.file.mimetype },
          timeout: 300000,
        });
      }

      await fileRef.makePublic();
      
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${firebaseFileName}`;

      const [downloadURL] = await fileRef.getSignedUrl({
        action: 'read',
        expires: '03-01-2500',
      });

      const isTextFile =
        req.file.mimetype.startsWith('text/') ||
        req.file.mimetype === 'application/json' ||
        originalName.match(/\.(txt|js|html|css|md)$/i);

      const fileContent = isTextFile ? req.file.buffer.toString('utf8') : null;

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
        filePath: firebaseFileName,
        url: downloadURL,
        uploadedBy: uploadedBy || unit.createdBy,
        uploadedByEmail: uploadedByEmail || unit.createdByEmail,
        unitId: unitId
      });
    } else if (fileType === 'notes' && notesContent) {
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
    } else if (fileType === 'link' && linkUrl) {
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
      return res.status(400).json({ error: 'Invalid file, notes content, or link URL' });
    }

    const savedFile = await fileData.save();
    unit.files.push(savedFile._id);
    await unit.save();
    const populatedUnit = await Unit.findById(unitId).populate('files');
    res.json(populatedUnit);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add file', details: err.message });
  }
});

router.get('/:unitId/files/:fileId', async (req, res) => {
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
      if (file.filePath) {
        const oldFileRef = bucket.file(file.filePath);
        try {
          await oldFileRef.delete();
        } catch (err) {}
      }

      const originalName = req.file.originalname;
      const fileExtension = path.extname(originalName);
      const firebaseFileName = `units/${unitId}/files/${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExtension}`;
      const fileRef = bucket.file(firebaseFileName);

      if (req.file.size > 50 * 1024 * 1024) {
        await fileRef.save(req.file.buffer, {
          metadata: { contentType: req.file.mimetype },
          resumable: true,
          timeout: 600000,
        });
      } else {
        await fileRef.save(req.file.buffer, {
          metadata: { contentType: req.file.mimetype },
          timeout: 300000,
        });
      }

      const [downloadURL] = await fileRef.getSignedUrl({
        action: 'read',
        expires: '03-01-2500',
      });

      const isTextFile =
        req.file.mimetype.startsWith('text/') ||
        req.file.mimetype === 'application/json' ||
        originalName.match(/\.(txt|js|html|css|md)$/i);

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
    res.status(500).json({ error: 'Failed to update file', details: err.message });
  }
});

router.delete('/:unitId', async (req, res) => {
  try {
    const { unitId } = req.params;
    const unit = await Unit.findById(unitId).populate('files');

    if (!unit) {
      return res.status(404).json({ error: 'Unit not found' });
    }

    const bucket = getStorage().bucket();

    for (const file of unit.files) {
      if (file.isUploadedFile && file.filePath) {
        const fileRef = bucket.file(file.filePath);
        try {
          await fileRef.delete();
        } catch (err) {}
      }
      await File.findByIdAndDelete(file._id);
    }

    await Unit.findByIdAndDelete(unitId);
    res.json({ message: 'Unit deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete unit', details: err.message });
  }
});

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

    if (file.isUploadedFile && file.filePath) {
      const bucket = getStorage().bucket();
      const fileRef = bucket.file(file.filePath);
      try {
        await fileRef.delete();
      } catch (err) {}
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