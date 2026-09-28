const express = require('express');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

app.post('/webhook', async (req, res) => {
  try {
    const msg = req.body.message || req.body.channel_post;
    if (!msg) return res.sendStatus(200);

    const text = msg.text || msg.caption || '';

    // 1. DELETE CLASS COMMAND
    const deleteMatch = text.match(/Delete:\s*(.+)/i);
    if (deleteMatch) {
      const targetTitle = deleteMatch[1].trim().toLowerCase();
      const snapshot = await db.collection('classes').get();
      snapshot.forEach(async (doc) => {
        if (doc.data().title && doc.data().title.trim().toLowerCase() === targetTitle) {
          await doc.ref.delete();
          console.log(`Deleted class: ${doc.data().title}`);
        }
      });
      return res.sendStatus(200);
    }

    // 2. EXTRACT METADATA
    const titleMatch = text.match(/Title:\s*(.+)/i);
    const yearMatch = text.match(/Year:\s*(.+)/i);
    const subjectMatch = text.match(/Subject:\s*(.+)/i);
    const linkMatch = text.match(/Link:\s*(https?:\/\/[^\s]+)/i);
    const pdfMatch = text.match(/PDF:\s*(https?:\/\/[^\s]+)/i);

    if (titleMatch) {
      const rawTitle = titleMatch[1].trim();
      const normalizedTitle = rawTitle.toLowerCase();

      // Check if class already exists
      const snapshot = await db.collection('classes').get();
      let existingDoc = null;
      snapshot.forEach(doc => {
        if (doc.data().title && doc.data().title.trim().toLowerCase() === normalizedTitle) {
          existingDoc = doc;
        }
      });

      if (existingDoc) {
        // UPDATE EXISTING CLASS (Attach PDF or Update Metadata)
        const updateData = {};
        if (yearMatch) updateData.year = yearMatch[1].trim();
        if (subjectMatch) updateData.subject = subjectMatch[1].trim();
        if (linkMatch) updateData.url = linkMatch[1].trim();
        if (pdfMatch) updateData.pdfUrl = pdfMatch[1].trim();

        await existingDoc.ref.update(updateData);
        console.log(`Updated class record: ${rawTitle}`);
      } else if (linkMatch) {
        // CREATE NEW CLASS
        const url = linkMatch[1].trim();
        const classData = {
          title: rawTitle,
          year: yearMatch ? yearMatch[1].trim() : "Sophomore",
          subject: subjectMatch ? subjectMatch[1].trim() : "General",
          url: url,
          pdfUrl: pdfMatch ? pdfMatch[1].trim() : null,
          views: 0,
          date: new Date().toISOString(),
          videoType: url.includes('facebook.com') ? 
                     (url.includes('/groups/') ? 'facebook_private' : 'facebook_public') 
                     : 'youtube'
        };
        await db.collection('classes').add(classData);
        console.log(`Created new class: ${rawTitle}`);
      }
    }
  } catch (err) {
    console.error("Webhook error:", err);
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
