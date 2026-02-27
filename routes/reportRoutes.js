const express = require('express');
const router = express.Router();
const Report = require('../models/Report');
const { generatePDFReport } = require('../utils/pdfReportGenerator');

/**
 * GET /api/reports/download/:id
 * Download report as PDF
 */
router.get('/download/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.query.userId;
    const userEmail = req.headers['x-user-email'] || req.query.userEmail;

    let query = { _id: req.params.id };
    
    // If user info provided, ensure they own the report
    if (userId || userEmail) {
      query.$or = [];
      if (userId) query.$or.push({ userId: userId });
      if (userEmail) query.$or.push({ userEmail: userEmail.toLowerCase() });
    }

    const report = await Report.findOne(query);

    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    const pdfBuffer = await generatePDFReport({
      fileName: report.fileName,
      totalWords: report.totalWords,
      totalSentences: report.totalSentences,
      plagiarizedSentences: report.plagiarizedSentences,
      originalSentences: report.originalSentences,
      plagiarismPercentage: report.plagiarismPercentage,
      matches: report.matches,
      createdAt: report.createdAt
    });

    const safeName = report.fileName.replace(/[^a-zA-Z0-9]/g, '_');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="plagiarism_report_${safeName}.pdf"`,
      'Content-Length': pdfBuffer.length
    });

    res.send(pdfBuffer);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /api/reports/:id
 * Delete a report
 */
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.query.userId;
    const userEmail = req.headers['x-user-email'] || req.query.userEmail;

    let query = { _id: req.params.id };
    
    // If user info provided, ensure they own the report
    if (userId || userEmail) {
      query.$or = [];
      if (userId) query.$or.push({ userId: userId });
      if (userEmail) query.$or.push({ userEmail: userEmail.toLowerCase() });
    }

    const result = await Report.findOneAndDelete(query);

    if (!result) {
      return res.status(404).json({ 
        success: false, 
        message: 'Report not found or you do not have permission to delete it.' 
      });
    }

    res.json({ success: true, message: 'Report deleted' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;