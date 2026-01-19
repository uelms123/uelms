// migrateStaffClasses.js
const mongoose = require('mongoose');
const Staff = require('./models/Staff');
const Class = require('./models/Class');

async function migrateStaffClasses() {
  try {
    // Connect to your MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/uelms', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('Connected to MongoDB for migration...');

    // Find all staff members
    const allStaff = await Staff.find();
    console.log(`Found ${allStaff.length} staff records to process`);

    let updatedCount = 0;
    
    // Process each staff member
    for (const staff of allStaff) {
      // Find classes where this staff is the creator or staff member
      const staffClasses = await Class.find({
        $or: [
          { staffId: staff.staffId }, // Classes where staff is the creator
          { 'staff.staffId': staff.staffId } // Classes where staff is a member
        ]
      });

      if (staffClasses.length > 0) {
        // Update staff's createdClasses field
        staff.createdClasses = staffClasses.map(cls => cls._id);
        await staff.save();
        updatedCount++;
        console.log(`Updated staff ${staff.name} (${staff.email}) with ${staffClasses.length} classes`);
      }
    }

    console.log(`\nMigration completed! Updated ${updatedCount} staff records with their classes.`);
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrateStaffClasses();