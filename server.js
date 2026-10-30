const express = require('express');
const admin = require('firebase-admin');
const Parser = require('rss-parser');
const parser = new Parser();
const cron = require('node-cron');

const app = express();
app.use(express.json());

const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

// --- HELPER TO SEND FORMATTED MESSAGE TO TELEGRAM ---
async function sendToTelegramChannel(classData) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  const messageText = `Year: ${classData.year}
Subject: ${classData.subject}
Title: ${classData.title}
Link: ${classData.url}
Uploaded date: ${classData.date.split('T')[0]}`;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: messageText
      })
    });
    console.log("Auto-sent parsed class format to Telegram channel.");
  } catch (err) {
    console.error("Failed to send message to Telegram:", err);
  }
}

// --- GEMINI AI THUMBNAIL ANALYSIS (QUOTA SAFE) ---
async function analyzeThumbnailWithGemini(thumbnailUrl, fallbackTitle) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { title: fallbackTitle, subject: "General", year: "Sophomore" };
  }

  try {
    const imageResponse = await fetch(thumbnailUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString("base64");

    const prompt = `Analyze this video thumbnail image and fallback title ("${fallbackTitle}"). 
    Extract academic class details. Ensure title and subject are separated clearly and never repeated or mixed up. 
    Return a strictly formatted JSON object with no markdown formatting (no \`\`\`json):
    {
      "title": "Clean, distinct lecture title only",
      "subject": "Exact academic subject name like Numerical Methods, Linear Algebra, Ordinary Differential Equations, Calculus-2, Abstract Algebra, etc.",
      "year": "Academic year: must be strictly one of [Freshman, Sophomore, Junior, Senior]"
    }
    Rules: 
    1. Never duplicate the same text into both title and subject.
    2. If year is missing or ambiguous, default to Sophomore.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: "image/jpeg",
                  data: base64Image
                }
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    if (!data.candidates || !data.candidates[0].content) {
      console.warn("Gemini quota or response limit hit. Using fallback.");
      return { title: fallbackTitle, subject: "General", year: "Sophomore" };
    }

    const textResult = data.candidates[0].content.parts[0].text.trim();
    const cleanJSON = textResult.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJSON);
  } catch (err) {
    console.error("Gemini thumbnail analysis error or quota reached:", err);
    return { title: fallbackTitle, subject: "General", year: "Sophomore" };
  }
}

// --- YOUTUBE RSS AUTO-POLLING (QUOTA-PROTECTED: ONLY CHECKS LATEST VIDEO) ---
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;

async function checkNewYouTubeVideos() {
  if (!YOUTUBE_CHANNEL_ID) {
    console.log("YOUTUBE_CHANNEL_ID not set in environment variables.");
    return;
  }

  try {
    console.log("Checking YouTube RSS feed for latest video...");
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`;
    const feed = await parser.parseURL(feedUrl);
    
    if (!feed.items || feed.items.length === 0) return;

    // QUOTA SAVER: Look ONLY at the absolute newest video uploaded on the channel
    const latestItem = feed.items[0];
    const videoId = latestItem.id.replace('yt:video:', '');
    const videoLink = latestItem.link;
    const rawTitle = latestItem.title;
    const pubDate = latestItem.isoDate || new Date().toISOString();

    // Check if this specific video link already exists in Firebase
    const snapshot = await db.collection('classes').where('url', '==', videoLink).get();
    if (!snapshot.empty) {
      console.log("Latest video is already synced in Firebase. No Gemini calls needed.");
      return;
    }

    console.log(`New unsynced video found: ${rawTitle}. Calling Gemini AI to analyze thumbnail...`);
    const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    
    const parsedData = await analyzeThumbnailWithGemini(thumbnailUrl, rawTitle);

    let extractedYear = parsedData.year || "Sophomore";
    if (extractedYear.toLowerCase().includes("freshm")) extractedYear = "Freshman";

    const classData = {
      title: parsedData.title || rawTitle,
      year: extractedYear,
      subject: parsedData.subject || "General",
      url: videoLink,
      pdfUrl: null,
      views: 0,
      date: pubDate,
      videoType: 'youtube'
    };

    await db.collection('classes').add(classData);
    console.log(`[Auto-Sync Success] Saved to Firebase: ${classData.title} | Subject: ${classData.subject}`);

    await sendToTelegramChannel(classData);

  } catch (error) {
    console.error("Error in YouTube auto-polling:", error);
  }
}

// --- TELEGRAM WEBHOOK ENDPOINT ---
app.post('/webhook', async (req, res) => {
  try {
    const msg = req.body.message || req.body.channel_post;
    if (!msg) return res.sendStatus(200);

    const rawText = (msg.text || msg.caption || '').replace(/\r/g, '');

    const deleteMatch = rawText.match(/Delete:\s*(.+)/i);
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

    const blocks = rawText.split(/(?:\n\s*)*\bYear:\s*/i);
    const snapshot = await db.collection('classes').get();
    const existingClassesMap = new Map();
    
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.title && data.url) {
        const uniqueKey = `${data.title.trim().toLowerCase()}|${data.url.trim()}`;
        existingClassesMap.set(uniqueKey, doc);
      }
    });

    for (const block of blocks) {
      if (!block.trim()) continue;

      const fullBlock = "Year: " + block;

      const titleMatch = fullBlock.match(/Title:\s*([^\n]+)/i);
      const yearMatch = fullBlock.match(/Year:\s*([^\n]+)/i);
      const subjectMatch = fullBlock.match(/Subject:\s*([^\n]+)/i);
      const linkMatch = fullBlock.match(/Link:\s*(https?:\/\/[^\s\n]+)/i);
      const pdfMatch = fullBlock.match(/PDF:\s*(https?:\/\/[^\s\n]+)/i);
      const dateMatch = fullBlock.match(/Uploaded\s*date:\s*([^\n]+)/i);

      if (titleMatch && linkMatch) {
        const rawTitle = titleMatch[1].trim();
        const url = linkMatch[1].trim();
        const uniqueKey = `${rawTitle.toLowerCase()}|${url}`;
        const existingDoc = existingClassesMap.get(uniqueKey);

        let extractedYear = yearMatch ? yearMatch[1].trim() : "Sophomore";
        if (extractedYear.toLowerCase().includes("freshm")) extractedYear = "Freshman";

        let classDate = new Date().toISOString();
        if (dateMatch) {
          const parsed = Date.parse(dateMatch[1].trim());
          if (!isNaN(parsed)) {
            classDate = new Date(parsed).toISOString();
          }
        }

        if (existingDoc) {
          const updateData = {};
          if (yearMatch) updateData.year = extractedYear;
          if (subjectMatch) updateData.subject = subjectMatch[1].trim();
          if (pdfMatch) updateData.pdfUrl = pdfMatch[1].trim();
          if (dateMatch) updateData.date = classDate;

          await existingDoc.ref.update(updateData);
        } else {
          const classData = {
            title: rawTitle,
            year: extractedYear,
            subject: subjectMatch ? subjectMatch[1].trim() : "General",
            url: url,
            pdfUrl: pdfMatch ? pdfMatch[1].trim() : null,
            views: 0,
            date: classDate,
            videoType: url.includes('facebook.com') ? 
                       (url.groups ? 'facebook_private' : 'facebook_public') 
                       : 'youtube'
          };
          
          const docRef = await db.collection('classes').add(classData);
          existingClassesMap.set(uniqueKey, { ref: docRef });
        }
      }
    }
  } catch (err) {
    console.error("Webhook error:", err);
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  
  // Safe startup check after 4 seconds
  setTimeout(() => {
    checkNewYouTubeVideos();
  }, 4000); 
});

// Run every 24 hours safely
cron.schedule('0 0 * * *', () => {
  checkNewYouTubeVideos();
});
