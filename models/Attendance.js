const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  meetingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Meeting',
    required: true
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true
  },
  joinedAt: {
    type: Date,
    default: Date.now
  },
  leftAt: Date,
  duration: Number,
  status: {
    type: String,
    enum: ['present', 'absent', 'late'],
    default: 'absent'
  },
  recordedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
});

module.exports = mongoose.model('Attendance', attendanceSchema);