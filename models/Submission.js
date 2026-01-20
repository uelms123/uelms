const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, required: true },
  size: { type: Number, required: true },
  url: { type: String, required: true } 
}, { timestamps: false });

const mcqResultSchema = new mongoose.Schema({
  question: { type: String, required: true },
  studentAnswer: { type: Number, default: null },
  correctAnswer: { type: Number, required: true },
  isCorrect: { type: Boolean, default: false },
  options: [{
    text: { type: String, required: true },
    isCorrect: { type: Boolean, default: false },
    isSelected: { type: Boolean, default: false }
  }]
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
  mcqResults: { type: [mcqResultSchema], default: [] },
  mcqScore: { type: Number, default: 0 },
  mcqTotalQuestions: { type: Number, default: 0 },
  files: [fileSchema],
  submitted: { type: Boolean, default: true },
  submissionDate: { type: Date, default: Date.now },
  grading: { type: gradingSchema, default: () => ({}) }
}, { timestamps: true });

// Indexes
submissionSchema.index({ classId: 1, studentId: 1 });
submissionSchema.index({ assignmentId: 1, studentId: 1 });
submissionSchema.index({ studentId: 1, 'grading.marks': 1 });
submissionSchema.index({ submissionDate: -1 });
submissionSchema.index({ classId: 1, assignmentId: 1 });
submissionSchema.index({ 'mcqScore': -1 });

// Middleware to calculate MCQ results before saving
submissionSchema.pre('save', async function(next) {
  // Only calculate MCQ results if this is an MCQ submission and mcqAnswers is populated
  if (this.mcqAnswers && this.mcqAnswers.length > 0 && this.isModified('mcqAnswers')) {
    try {
      // Get the assignment to access the correct answers
      const Assignment = mongoose.model('Assignment');
      const assignment = await Assignment.findById(this.assignmentId);
      
      if (assignment && assignment.assignmentType === 'mcq' && assignment.mcqQuestions) {
        this.mcqResults = [];
        this.mcqScore = 0;
        this.mcqTotalQuestions = assignment.mcqQuestions.length;
        
        // Calculate results for each question
        assignment.mcqQuestions.forEach((question, qIndex) => {
          const studentAnswer = this.mcqAnswers[qIndex];
          const correctIndex = question.options.findIndex(opt => opt.isCorrect);
          const isCorrect = studentAnswer === correctIndex;
          
          if (isCorrect) {
            this.mcqScore++;
          }
          
          // Create result object
          const result = {
            question: question.question,
            studentAnswer: studentAnswer,
            correctAnswer: correctIndex,
            isCorrect: isCorrect,
            options: question.options.map((opt, idx) => ({
              text: opt.text,
              isCorrect: opt.isCorrect,
              isSelected: studentAnswer === idx
            }))
          };
          
          this.mcqResults.push(result);
        });
        
        // If answer field is empty, populate it with the MCQ results summary
        if (!this.answer || this.answer.trim() === '') {
          this.answer = `MCQ Submission: ${this.mcqScore}/${this.mcqTotalQuestions} correct`;
        }
      }
    } catch (error) {
      console.error('Error calculating MCQ results:', error);
      // Continue saving even if MCQ calculation fails
    }
  }
  next();
});

// Static method to calculate MCQ results
submissionSchema.statics.calculateMCQResults = async function(submissionId) {
  try {
    const submission = await this.findById(submissionId);
    if (!submission) throw new Error('Submission not found');
    
    const Assignment = mongoose.model('Assignment');
    const assignment = await Assignment.findById(submission.assignmentId);
    
    if (!assignment || assignment.assignmentType !== 'mcq' || !assignment.mcqQuestions) {
      return { score: 0, total: 0, results: [] };
    }
    
    let score = 0;
    const results = [];
    
    assignment.mcqQuestions.forEach((question, qIndex) => {
      const studentAnswer = submission.mcqAnswers[qIndex];
      const correctIndex = question.options.findIndex(opt => opt.isCorrect);
      const isCorrect = studentAnswer === correctIndex;
      
      if (isCorrect) score++;
      
      results.push({
        question: question.question,
        studentAnswer: studentAnswer,
        correctAnswer: correctIndex,
        isCorrect: isCorrect,
        options: question.options.map((opt, idx) => ({
          text: opt.text,
          isCorrect: opt.isCorrect,
          isSelected: studentAnswer === idx
        }))
      });
    });
    
    // Update submission if needed
    if (submission.mcqScore !== score || JSON.stringify(submission.mcqResults) !== JSON.stringify(results)) {
      submission.mcqScore = score;
      submission.mcqTotalQuestions = assignment.mcqQuestions.length;
      submission.mcqResults = results;
      await submission.save();
    }
    
    return {
      score: score,
      total: assignment.mcqQuestions.length,
      results: results
    };
  } catch (error) {
    console.error('Error calculating MCQ results:', error);
    throw error;
  }
};

// Instance method to get formatted MCQ results
submissionSchema.methods.getFormattedMCQResults = function() {
  if (!this.mcqResults || this.mcqResults.length === 0) {
    return null;
  }
  
  return {
    score: this.mcqScore,
    totalQuestions: this.mcqTotalQuestions,
    percentage: this.mcqTotalQuestions > 0 ? (this.mcqScore / this.mcqTotalQuestions * 100).toFixed(1) : 0,
    results: this.mcqResults.map((result, index) => ({
      questionNumber: index + 1,
      question: result.question,
      studentAnswer: result.studentAnswer !== null && result.studentAnswer !== undefined ? 
        `Option ${result.studentAnswer + 1}` : 'Not answered',
      correctAnswer: `Option ${result.correctAnswer + 1}`,
      isCorrect: result.isCorrect,
      options: result.options.map((opt, idx) => ({
        optionNumber: idx + 1,
        text: opt.text,
        isCorrect: opt.isCorrect,
        isSelected: opt.isSelected,
        status: opt.isCorrect ? 'correct' : (opt.isSelected ? 'selected-incorrect' : 'not-selected')
      }))
    }))
  };
};

// Instance method to check if submission is for MCQ
submissionSchema.methods.isMCQSubmission = function() {
  return this.mcqAnswers && this.mcqAnswers.length > 0;
};

module.exports = mongoose.model('Submission', submissionSchema);