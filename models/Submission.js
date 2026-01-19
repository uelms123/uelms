const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, required: true },
  size: { type: Number, required: true },
  url: { type: String, required: true } 
}, { timestamps: false });

const gradingSchema = new mongoose.Schema({
  marks: { type: Number, min: 0, default: null },
  comments: { type: String, default: '' },
  gradedBy: { type: String, default: '' },
  gradedAt: { type: Date, default: null },
  maxMarks: { type: Number, min: 1, default: 100 }
}, { timestamps: false });

const submissionSchema = new mongoose.Schema({
  assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', required: true },
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  studentId: { type: String, required: true },
  studentName: { type: String, default: 'Student' },
  answer: { type: String, default: '' },
  mcqAnswers: { type: [mongoose.Schema.Types.Mixed], default: [] },
  files: [fileSchema],
  submitted: { type: Boolean, default: true },
  submissionDate: { type: Date, default: Date.now },
  grading: { type: gradingSchema, default: () => ({}) }
}, { timestamps: true });

submissionSchema.index({ classId: 1, studentId: 1 });
submissionSchema.index({ assignmentId: 1, studentId: 1 });
submissionSchema.index({ studentId: 1, 'grading.marks': 1 });
submissionSchema.index({ submissionDate: -1 });
submissionSchema.index({ classId: 1, assignmentId: 1 });

module.exports = mongoose.model('Submission', submissionSchema);