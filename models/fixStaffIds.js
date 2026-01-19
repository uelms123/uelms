// fixStaffIds.js
const mongoose = require('mongoose');
const Staff = require('./models/Staff');

async function fixStaffIds() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/uelms', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('Connected to MongoDB...');
    
    // Find all staff without staffId
    const staffWithoutId = await Staff.find({ staffId: { $exists: false } });
    console.log(`Found ${staffWithoutId.length} staff without staffId`);
    
    for (const staff of staffWithoutId) {
      // Generate staffId from email
      const emailPrefix = staff.email.split('@')[0];
      staff.staffId = `staff_${emailPrefix}_${Date.now().toString().slice(-6)}`;
      await staff.save();
      console.log(`Updated ${staff.email} with staffId: ${staff.staffId}`);
    }
    
    console.log('Migration completed!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixStaffIds();