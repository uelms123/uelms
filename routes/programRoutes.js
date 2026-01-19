// routes/programRoutes.js
const express = require('express');
const router = express.Router();
const Program = require('../models/Program');

// Get all programs
router.get('/', async (req, res) => {
  try {
    const programs = await Program.find().sort({ name: 1 });
    res.status(200).json({ success: true, programs });
  } catch (err) {
    console.error('Error fetching programs:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add new program
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Program name is required' });
    }

    const newProgram = new Program({
      name: name.trim()
    });

    await newProgram.save();
    res.status(201).json({ success: true, program: newProgram });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, error: 'Program name already exists' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update program
router.put('/:id', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Program name is required' });
    }

    const program = await Program.findByIdAndUpdate(
      req.params.id,
      { name: name.trim() },
      { new: true, runValidators: true }
    );

    if (!program) {
      return res.status(404).json({ success: false, error: 'Program not found' });
    }

    res.status(200).json({ success: true, program });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, error: 'Program name already exists' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete program
router.delete('/:id', async (req, res) => {
  try {
    const program = await Program.findByIdAndDelete(req.params.id);
    if (!program) {
      return res.status(404).json({ success: false, error: 'Program not found' });
    }
    res.status(200).json({ success: true, message: 'Program deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;