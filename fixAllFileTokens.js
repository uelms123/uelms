/**
 * ============================================================
 *  ONE-TIME MIGRATION SCRIPT — Run once to fix ALL old files
 *  
 *  What it does:
 *  - Finds every file in MongoDB with a broken signed URL
 *  - Sets a fresh download token on the Firebase Storage file
 *  - Updates the URL in MongoDB to the permanent token URL
 * 
 *  How to run:
 *    node fixAllFileTokens.js
 * 
 *  Run from your backend project root folder.
 * ============================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const admin = require('firebase-admin');
const crypto = require('crypto');

// ── Firebase init ────────────────────────────────────────────
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined,
  }),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
});

const bucket = admin.storage().bucket();
const BUCKET = process.env.FIREBASE_STORAGE_BUCKET;

// ── MongoDB File model (inline so script is self-contained) ──
const fileSchema = new mongoose.Schema({}, { strict: false });
const File = mongoose.model('File', fileSchema, 'files');

// ── Helpers ──────────────────────────────────────────────────

const isExpiredSignedUrl = (url) => {
  if (!url) return false;
  return (
    url.includes('GoogleAccessId') ||
    url.includes('Signature=') ||
    url.includes('Expires=') ||
    url.includes('X-Goog-Signature') ||
    url.includes('x-goog-signature') ||
    (url.startsWith('https://storage.googleapis.com/') &&
      !url.includes('firebasestorage.googleapis.com'))
  );
};

const needsTokenUrl = (url) => {
  if (!url) return false;
  // Also fix firebasestorage URLs that are missing a token
  return (
    isExpiredSignedUrl(url) ||
    (url.includes('firebasestorage.googleapis.com') && !url.includes('token='))
  );
};

const extractPathFromSignedUrl = (url) => {
  try {
    const withoutScheme = url.replace('https://storage.googleapis.com/', '');
    if (withoutScheme.startsWith(BUCKET + '/')) {
      return withoutScheme.slice(BUCKET.length + 1).split('?')[0];
    }
  } catch (e) {}
  return null;
};

const buildTokenUrl = (filePath, token) => {
  return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
};

// ── Main migration ────────────────────────────────────────────

async function migrate() {
  console.log('\n🚀 Starting file token migration...\n');

  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅ MongoDB connected\n');

  // Find all uploaded files (not notes, not links)
  const files = await File.find({ isUploadedFile: true });
  console.log(`📁 Total uploaded files found: ${files.length}\n`);

  let fixed = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const url = file.url;

    if (!needsTokenUrl(url) && file.filePath) {
      skipped++;
      continue;
    }

    // Resolve the Firebase storage path
    const filePath = file.filePath || extractPathFromSignedUrl(url);

    if (!filePath) {
      console.log(`  ⚠️  SKIP (no path resolvable): ${file.name || file._id}`);
      failed++;
      continue;
    }

    try {
      const fileRef = bucket.file(filePath);

      // Check file actually exists in Firebase
      const [exists] = await fileRef.exists();
      if (!exists) {
        console.log(`  ❌ NOT IN FIREBASE: ${filePath}`);
        failed++;
        continue;
      }

      // Set a fresh download token on the Firebase Storage file
      const downloadToken = crypto.randomBytes(16).toString('hex');
      await fileRef.setMetadata({
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
        },
      });

      // Build permanent URL with the new token
      const newUrl = buildTokenUrl(filePath, downloadToken);

      // Update MongoDB
      await File.findByIdAndUpdate(file._id, {
        url: newUrl,
        filePath: filePath,
      });

      console.log(`  ✅ FIXED: ${file.name || filePath}`);
      fixed++;
    } catch (err) {
      console.log(`  ❌ ERROR: ${file.name || filePath} — ${err.message}`);
      failed++;
    }
  }

  console.log('\n══════════════════════════════════════');
  console.log(`  ✅ Fixed   : ${fixed}`);
  console.log(`  ⏭️  Skipped : ${skipped} (already OK)`);
  console.log(`  ❌ Failed  : ${failed}`);
  console.log('══════════════════════════════════════');
  console.log('\n🎉 Migration complete! All old files now have permanent URLs.\n');

  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch((err) => {
  console.error('💥 Migration failed:', err);
  process.exit(1);
});