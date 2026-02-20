const express = require('express');
const router = express.Router();
const Ebook = require('../models/Ebook');

// Get all ebooks
router.get('/api/ebooks', async (req, res) => {
  try {
    const ebooks = await Ebook.find().sort({ uploadedAt: -1 });
    res.json({ success: true, ebooks });
  } catch (error) {
    console.error('Error fetching ebooks:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch ebooks' });
  }
});

// Add new ebook (Admin only - you can add authentication middleware later)
router.post('/api/ebooks', async (req, res) => {
  try {
    const { fileName, fileLink } = req.body;
    
    if (!fileName || !fileLink) {
      return res.status(400).json({ 
        success: false, 
        error: 'File name and file link are required' 
      });
    }

    const newEbook = new Ebook({
      fileName,
      fileLink
    });

    await newEbook.save();
    res.status(201).json({ success: true, ebook: newEbook });
  } catch (error) {
    console.error('Error adding ebook:', error);
    res.status(500).json({ success: false, error: 'Failed to add ebook' });
  }
});
// Update ebook (Admin only)
router.put('/api/ebooks/:id', async (req, res) => {
  try {
    const { fileName, fileLink } = req.body;
    
    if (!fileName || !fileLink) {
      return res.status(400).json({ 
        success: false, 
        error: 'File name and file link are required' 
      });
    }

    const updatedEbook = await Ebook.findByIdAndUpdate(
      req.params.id,
      { fileName, fileLink },
      { new: true, runValidators: true }
    );

    if (!updatedEbook) {
      return res.status(404).json({ success: false, error: 'Ebook not found' });
    }

    res.json({ success: true, ebook: updatedEbook });
  } catch (error) {
    console.error('Error updating ebook:', error);
    res.status(500).json({ success: false, error: 'Failed to update ebook' });
  }
});

// Delete ebook (Admin only)
router.delete('/api/ebooks/:id', async (req, res) => {
  try {
    const ebook = await Ebook.findByIdAndDelete(req.params.id);
    if (!ebook) {
      return res.status(404).json({ success: false, error: 'Ebook not found' });
    }
    res.json({ success: true, message: 'Ebook deleted successfully' });
  } catch (error) {
    console.error('Error deleting ebook:', error);
    res.status(500).json({ success: false, error: 'Failed to delete ebook' });
  }
});

module.exports = router;