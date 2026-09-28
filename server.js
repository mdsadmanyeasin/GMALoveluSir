const express = require('express');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());

// Initialize Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

app.post('/webhook', async (req, res) => {
  try {
    const message = req.body.message || req.body.channel_post;
    if (!message) return res.sendStatus(200);

    const text = message.text || message.caption || '';

    // Extract fields
    const yearMatch = text.match(/Year:\s*(.+)/i);
    const subjectMatch = text.match(/Subject:\s*(.+)/i);
    const titleMatch = text.match(/Title:\s*(.+)/i);
    const linkMatch = text.match(/Link:\s*(https?:\/\/[^\s]+)/i);
    const pdfMatch = text.match(/PDF:\s*(https?:\/\/[^\s]+)/i);

    // CASE 1: Telegram PDF Document Attachment
    if (message.document && message.document.mime_type === 'application/pdf') {
      const fileId = message.document.file_id;
      const botToken = process.env.TELEGRAM_BOT_TOKEN;

      const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
      const fileData = await fileRes.json();

      if (fileData.ok) {
        const pdfUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
        
        let targetTitle = titleMatch ? titleMatch[1].trim() : null;
        if (!targetTitle && message.reply_to_message) {
          const replyText = message.reply_to_message.text || message.reply_to_message.caption || '';
          const replyTitleMatch = replyText.match(/Title:\s*(.+)/i);
          if (replyTitleMatch) targetTitle = replyTitleMatch[1].trim();
        }

        if (targetTitle) {
          const snapshot = await db.collection('classes').where('title', '==', targetTitle).get();
          snapshot.forEach(async (doc) => {
            await doc.ref.update({ pdfUrl: pdfUrl });
          });
          console.log(`Attached PDF document to class: ${targetTitle}`);
        }
      }
    }

    // CASE 2: New Class Creation or Metadata/PDF Update via Text
    if (titleMatch) {
      const title = titleMatch[1].trim();
      const year = yearMatch ? yearMatch[1].trim() : "Sophomore";
      const subject = subjectMatch ? subjectMatch[1].trim() : "General";
      const url = linkMatch ? linkMatch[1].trim() : null;
      const pdfUrl = pdfMatch ? pdfMatch[1].trim() : null;

      const existing = await db.collection('classes').where('title', '==', title).get();

      if (!existing.empty) {
        // Update existing class with new PDF or edited subject/year
        existing.forEach(async (doc) => {
          const updateData = {};
          if (yearMatch) updateData.year = year;
          if (subjectMatch) updateData.subject = subject;
          if (url) updateData.url = url;
          if (pdfUrl) updateData.pdfUrl = pdfUrl;
          await doc.ref.update(updateData);
        });
        console.log(`Updated class record for: ${title}`);
      } else if (url) {
        // Create new class
        const classData = {
          title: title,
          year: year,
          subject: subject,
          url: url,
          pdfUrl: pdfUrl || null,
          views: 0,
          date: new Date().toISOString(),
          videoType: url.includes('facebook.com') ? 
                     (url.includes('/groups/') ? 'facebook_private' : 'facebook_public') 
                     : 'youtube'
        };
        await db.collection('classes').add(classData);
        console.log(`Saved new class: ${title}`);
      }
    }
  } catch (err) {
    console.error("Webhook processing error:", err);
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
