
const express = require('express');
const router = express.Router();
const Announcement = require('../models/Announcement');
const Class = require('../models/Class');
const multer = require('multer');

// Configure multer for memory storage (for file validation only)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOCX, XLSX, PNG, JPG, PPTX are allowed.'));
    }
  }
});

// Create a new announcement (without file upload - file will be handled by frontend)
router.post('/', upload.single('file'), async (req, res) => {
    try {
        const { title, text, link, postedBy, classId, avatar, avatarBg, fileData } = req.body;
        const uploadedFile = req.file;

        if (!title || !text || !classId) {
            return res.status(400).json({ 
                success: false,
                error: 'Title, content, and class selection are required' 
            });
        }

        let fileInfo = null;
        
        // Parse fileData if provided (from frontend)
        if (fileData) {
            try {
                fileInfo = JSON.parse(fileData);
            } catch (e) {
                console.error('Error parsing file data:', e);
            }
        }

        const newAnnouncement = new Announcement({
            title,
            text,
            link: link || '',
            postedBy: postedBy || 'Admin',
            classId,
            avatar: avatar || 'Y',
            avatarBg: avatarBg || '#1a73e8',
            file: fileInfo
        });

        await newAnnouncement.save();
        res.status(201).json({
            success: true,
            announcement: newAnnouncement
        });
    } catch (error) {
        console.error('Error creating announcement:', error);
        res.status(500).json({ 
            success: false,
            error: 'Error creating announcement',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Get all announcements with class name
router.get('/', async (req, res) => {
    try {
        const { role, postedBy, classIds } = req.query;

        let query = {};

        if (role === 'staff' && postedBy) {
            // For staff, fetch only announcements they posted
            query.postedBy = postedBy;
            // If classIds are provided, filter by classIds
            if (classIds) {
                const classIdArray = classIds.split(',').map(id => id.trim());
                query.classId = { $in: classIdArray };
            }
        } else if (role === 'student') {
            // For students, fetch announcements for specific classes if classIds provided
            if (classIds) {
                const classIdArray = classIds.split(',').map(id => id.trim());
                query.classId = { $in: classIdArray };
            }
        } else if (role) {
            // Invalid role
            return res.status(400).json({
                success: false,
                error: 'Invalid role specified'
            });
        }

        // Fetch announcements based on query
        const announcements = await Announcement.find(query)
            .populate({
                path: 'classId',
                select: 'name',
                model: Class
            })
            .sort({ createdAt: -1 });

        // Map announcements to include class name
        const formattedAnnouncements = announcements.map(a => ({
            _id: a._id,
            title: a.title,
            text: a.text,
            link: a.link,
            postedBy: a.postedBy || 'Unknown',
            className: a.classId ? a.classId.name : 'No Class',
            avatar: a.avatar,
            avatarBg: a.avatarBg,
            file: a.file,
            createdAt: a.createdAt
        }));

        res.json({
            success: true,
            announcements: formattedAnnouncements
        });
    } catch (error) {
        console.error('Error fetching announcements:', error);
        res.status(500).json({ 
            success: false,
            error: 'Error fetching announcements',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Get all announcements for a specific class
router.get('/class/:classId', async (req, res) => {
    try {
        const { classId } = req.params;
        const announcements = await Announcement.find({ classId })
            .populate({
                path: 'classId',
                select: 'name',
                model: Class
            })
            .sort({ createdAt: -1 });

        const formattedAnnouncements = announcements.map(a => ({
            _id: a._id,
            title: a.title,
            text: a.text,
            link: a.link,
            postedBy: a.postedBy || 'Unknown',
            className: a.classId ? a.classId.name : 'No Class',
            avatar: a.avatar,
            avatarBg: a.avatarBg,
            file: a.file,
            createdAt: a.createdAt
        }));

        res.json({
            success: true,
            announcements: formattedAnnouncements
        });
    } catch (error) {
        console.error('Error fetching announcements:', error);
        res.status(500).json({ 
            success: false,
            error: 'Error fetching announcements',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Delete an announcement
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                error: 'Announcement ID is required'
            });
        }

        const deletedAnnouncement = await Announcement.findByIdAndDelete(id);

        if (!deletedAnnouncement) {
            return res.status(404).json({
                success: false,
                error: 'Announcement not found'
            });
        }

        res.json({
            success: true,
            message: 'Announcement deleted successfully',
            deletedAnnouncementId: id
        });
    } catch (error) {
        console.error('Error deleting announcement:', error);
        res.status(500).json({
            success: false,
            error: 'Error deleting announcement',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

module.exports = router;