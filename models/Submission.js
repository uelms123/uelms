const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
  name: String,
  path: String,
  type: String,
  size: Number,
  url: String
});

const gradingSchema = new mongoose.Schema({
  marks: {
    type: Number,
    min: 0,
    max: 100,
    default: null
  },
  comments: {
    type: String,
    default: ''
  },
  gradedBy: {
    type: String, // Staff ID or name
    default: ''
  },
  gradedAt: {
    type: Date,
    default: null
  },
  maxMarks: {
    type: Number,
    default: 100
  }
});

const submissionSchema = new mongoose.Schema({
  assignmentId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Assignment'
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Class'
  },
  studentId: {
    type: String,
    required: true
  },
  files: [fileSchema],
  answer: String,
  submitted: {
    type: Boolean,
    default: true
  },
  submissionDate: {
    type: Date,
    default: Date.now
  },
  studentName: String,
  grading: {
    type: gradingSchema,
    default: () => ({})
  }
});

module.exports = mongoose.model('Submission', submissionSchema);