const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const Class = require('../models/Class');
const StaffActivity = require('../models/StaffActivity');
const Staff = require('../models/Staff');

const analyzeExistingContent = async () => {
  try {
    console.log('🔍 Starting analysis of existing staff content...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Get all classes
    const allClasses = await Class.find().lean();
    console.log(`📚 Found ${allClasses.length} classes`);
    
    let totalProcessed = 0;
    let totalCreated = 0;
    let totalUpdated = 0;
    
    // Process each class
    for (const classData of allClasses) {
      try {
        // Get staff for this class
        let staffMembers = classData.staff || [];
        
        // If no staff in array, check if staffId exists
        if (staffMembers.length === 0 && classData.staffId) {
          // Try to find staff by staffId or email
          const staff = await Staff.findOne({
            $or: [
              { staffId: classData.staffId },
              { email: classData.staffId }
            ]
          });
          
          if (staff) {
            staffMembers.push({
              staffId: staff.staffId,
              email: staff.email,
              name: staff.name
            });
          }
        }
        
        // Process each staff member
        for (const staff of staffMembers) {
          if (!staff.staffId) continue;
          
          // Check if activity record exists
          let activity = await StaffActivity.findOne({
            staffId: staff.staffId,
            classId: classData._id
          });
          
          const now = new Date();
          
          if (!activity) {
            // Create new activity record
            activity = new StaffActivity({
              staffId: staff.staffId,
              staffEmail: staff.email || '',
              staffName: staff.name || 'Unknown',
              classId: classData._id,
              className: classData.name,
              classSubject: classData.subject || '',
              classSection: classData.section || '',
              classCreatedDate: classData.createdAt,
              activities: {
                streams: {
                  count: 0,
                  lastUpdated: null,
                  items: []
                },
                assignments: {
                  count: 0,
                  lastUpdated: null,
                  items: []
                },
                assessments: {
                  count: 0,
                  lastUpdated: null,
                  items: []
                }
              },
              totalStreams: 0,
              totalAssignments: 0,
              totalAssessments: 0,
              visitsCount: 1,
              lastClassVisit: classData.createdAt || now,
              isHistoricalData: true,
              actualCreationDate: classData.createdAt,
              notes: 'Created during initial content analysis',
              status: 'active'
            });
            
            await activity.save();
            totalCreated++;
            console.log(`   ✅ Created activity for ${staff.name || staff.staffId} in ${classData.name}`);
          } else {
            // Update existing record
            activity.isHistoricalData = true;
            activity.notes = 'Updated during content analysis';
            await activity.save();
            totalUpdated++;
          }
        }
        
        totalProcessed++;
        
        // Progress indicator
        if (totalProcessed % 100 === 0) {
          console.log(`   📊 Processed ${totalProcessed}/${allClasses.length} classes...`);
        }
        
      } catch (error) {
        console.error(`   ❌ Error processing class ${classData._id}:`, error.message);
      }
    }
    
    console.log('\n✅ Analysis Complete!');
    console.log('📊 Summary:');
    console.log(`   Total classes processed: ${totalProcessed}`);
    console.log(`   New activity records created: ${totalCreated}`);
    console.log(`   Existing records updated: ${totalUpdated}`);
    console.log(`   Total activity records: ${totalCreated + totalUpdated}`);
    
  } catch (error) {
    console.error('❌ Analysis failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
    process.exit(0);
  }
};

// Run the analysis
if (require.main === module) {
  analyzeExistingContent();
}

module.exports = { analyzeExistingContent };