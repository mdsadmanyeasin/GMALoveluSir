import os
import time
import requests
from datetime import datetime
from PIL import Image
from io import BytesIO
import google.generativeai as genai
import xml.etree.ElementTree as ET

# ==================== CONFIGURATION ====================
API_KEY = os.environ.get("GEMINI_API_KEY")
CHANNEL_ID = "UC..." # Or we can use the RSS feed URL directly below
RSS_URL = "https://www.youtube.com/feeds/videos.xml?channel_id=YOUR_CHANNEL_ID"
# Alternatively, use your channel's uploads playlist or standard RSS. 
# Let's use the direct RSS feed parser below:
YOUTUBE_RSS = "https://www.youtube.com/feeds/videos.xml?channel_id=IftekharAlamlovelu" # We can use user handle feed format

START_DATE = "2026-10-01"  # Change this to your tracking start date

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID")
# =======================================================

genai.configure(api_key=API_KEY)
model = genai.GenerativeModel('gemini-1.5-flash')

def get_channel_rss_url():
    """Automatically finds the channel ID and RSS feed from your channel URL."""
    try:
        # Fetch channel page HTML to extract channel_id safely
        headers = {"User-Agent": "Mozilla/5.0"}
        resp = requests.get("https://www.youtube.com/@IftekharAlamlovelu/videos", headers=headers)
        import re
        match = re.search(r'"channelId":"(UC[\w-]+)"', resp.text)
        if match:
            ch_id = match.group(1)
            return f"https://www.youtube.com/feeds/videos.xml?channel_id={ch_id}"
    except Exception as e:
        print(f"Error resolving channel ID: {e}")
    return None

def analyze_video_with_gemini(title, thumbnail_url):
    """Sends both thumbnail image and title to Gemini to accurately separate Year, Subject, and Title."""
    try:
        img_response = requests.get(thumbnail_url)
        img = Image.open(BytesIO(img_response.content))

        prompt = f"""
        Analyze this YouTube video thumbnail image and the video title: "{title}".
        Your task is to extract academic class details and return them strictly in the format below.
        
        Rules:
        1. Year level must be strictly one of: Freshman, Sophomore, Junior, Senior. (Translate terms like ১ম বর্ষ->Freshman, ২য় বর্ষ->Sophomore, ৩য় বর্ষ->Junior, ৪র্থ বর্ষ->Senior).
        2. Subject must be the core academic subject name (e.g., Numerical Methods, Linear Algebra, Ordinary Differential Equations, Calculus-2, Abstract Algebra). Never leave it blank or repeat the title.
        3. Title must be the clean lecture topic name.
        
        Respond ONLY in this exact format:
        Year: [Year]
        Subject: [Subject]
        Title: [Clean Topic Title]
        """
        
        response = model.generate_content([prompt, img])
        return response.text.strip()
    except Exception as e:
        print(f"Gemini Vision Error: {e}")
        return f"Year: Sophomore\nSubject: General\nTitle: {title}"

def send_to_telegram(message_text):
    """Sends the formatted class block straight to your Telegram channel."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("Telegram credentials missing.")
        return
    
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": message_text
    }
    try:
        response = requests.post(url, json=payload)
        if response.status_code == 200:
            print("Successfully posted clean format to Telegram channel!")
        else:
            print(f"Telegram error: {response.text}")
    except Exception as e:
        print(f"Failed to send to Telegram: {e}")

def run_automation_pipeline():
    start_dt = datetime.strptime(START_DATE, "%Y-%m-%d")
    
    rss_url = get_channel_rss_url()
    if not rss_url:
        print("Could not retrieve RSS feed.")
        return

    print(f"Fetching RSS feed from: {rss_url}")
    response = requests.get(rss_url)
    if response.status_code != 200:
        print("Failed to fetch YouTube RSS feed.")
        return

    # Parse XML Feed
    root = ET.fromstring(response.content)
    ns = {
        'atom': 'http://www.w3.org/2005/Atom',
        'yt': 'http://www.youtube.com/xml/schemas/2015'
    }

    entries = root.findall('atom:entry', ns)
    print(f"Found {len(entries)} items in RSS feed.")

    for entry in entries[:5]:  # Check recent videos
        try:
            video_id = entry.find('yt:videoId', ns).text
            title = entry.find('atom:title', ns).text
            published = entry.find('atom:published', ns).text  # Format: 2026-10-06T12:00:00+00:00
            
            upload_dt = datetime.strptime(published.split('T')[0], "%Y-%m-%d")

            if upload_dt >= start_dt:
                video_url = f"https://www.youtube.com/watch?v={video_id}"
                thumbnail_url = f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"

                print(f"\nProcessing new video: {title}")
                ai_result = analyze_video_with_gemini(title, thumbnail_url)
                
                formatted_message = f"""{ai_result}
Link: {video_url}
Uploaded date: {upload_dt.strftime('%Y-%m-%d')}"""

                print("--- Generated Class Record ---")
                print(formatted_message)
                print("-" * 30)

                send_to_telegram(formatted_message)
                time.sleep(2)
        except Exception as err:
            print(f"Error processing RSS entry: {err}")
            continue

if __name__ == "__main__":
    run_automation_pipeline()
