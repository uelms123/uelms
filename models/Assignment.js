const mongoose = require('mongoose');

const optionSchema = new mongoose.Schema({
  text: { type: String, required: true },
  isCorrect: { type: Boolean, default: false }
});

const mcqQuestionSchema = new mongoose.Schema({
  question: { type: String, required: true },
  options: [optionSchema]
});

const fileSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, required: true },
  size: { type: Number, required: true },
  url: { type: String, required: true }
}, { timestamps: false });

const assignmentSchema = new mongoose.Schema({
  classId: {
    type: String,
    required: true
  },
  staffId: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['assignment', 'meet-google', 'meet-zoom', 'meet-teams'],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  assignmentType: {
    type: String,
    enum: ['question', 'mcq', 'file-upload', null],
    default: null
  },
  question: {
    type: String,
    default: null
  },
  mcqQuestions: [mcqQuestionSchema],
  meetTime: {
    type: String,
    default: null
  },
  meetLink: {
    type: String,
    default: null
  },
  attachments: [fileSchema],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: null
  }
});

module.exports = mongoose.model('Assignment', assignmentSchema);