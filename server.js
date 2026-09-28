const express = require('express');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());

// Connect to Firebase securely using environment variables
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Listen for new updates from Telegram
app.post('/webhook', async (req, res) => {
  // Support both Channel Posts and Group Messages
  const message = req.body.message || req.body.channel_post;
  
  if (message && message.text) {
    const text = message.text;
    const subgroup = message.chat.title || "General"; 

    // Extract details typed by Lovelu Sir
    const titleMatch = text.match(/Title:\s*(.+)/i);
    const linkMatch = text.match(/Link:\s*(https?:\/\/[^\s]+)/i);
    
    if (titleMatch && linkMatch) {
      const classData = {
        title: titleMatch[1].trim(),
        url: linkMatch[1].trim(),
        subgroup: subgroup,
        date: new Date().toISOString(),
        videoType: linkMatch[1].includes('facebook.com') ? 
                   (linkMatch[1].includes('/groups/') ? 'facebook_private' : 'facebook_public') 
                   : 'youtube'
      };

      // Save instantly to Firestore
      await db.collection('classes').add(classData);
      console.log("Class saved to database!");
    }
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
