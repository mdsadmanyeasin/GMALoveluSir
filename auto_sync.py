import os
import time
import requests
from datetime import datetime
from PIL import Image
from io import BytesIO
import google.generativeai as genai
import yt_dlp

# ==================== CONFIGURATION ====================
API_KEY = os.environ.get("GEMINI_API_KEY")
CHANNEL_URL = "https://www.youtube.com/@IftekharAlamlovelu/videos"
START_DATE = "2026-10-20"  # Change this to your tracking start date

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID")
# =======================================================

genai.configure(api_key=API_KEY)
model = genai.GenerativeModel('gemini-1.5-flash')

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
    ydl_flat_opts = {'extract_flat': True, 'skip_download': True, 'quiet': True}

    print("Checking YouTube channel for new videos...")
    try:
        with yt_dlp.YoutubeDL(ydl_flat_opts) as ydl:
            info = ydl.extract_info(CHANNEL_URL, download=False)
            entries = info.get('entries', [])
    except Exception as e:
        print(f"Error fetching channel entries: {e}")
        return

    ydl_detail_opts = {'skip_download': True, 'quiet': True}
    
    with yt_dlp.YoutubeDL(ydl_detail_opts) as ydl_detail:
        for entry in entries[:3]:  # Check the 3 most recent videos/streams
            video_id = entry.get('id')
            if not video_id:
                continue

            video_url = f"https://www.youtube.com/watch?v={video_id}"

            try:
                video_info = ydl_detail.extract_info(video_url, download=False)
                raw_date = video_info.get('upload_date')
                if not raw_date:
                    continue

                upload_dt = datetime.strptime(raw_date, "%Y%m%d")

                if upload_dt >= start_dt:
                    title = video_info.get('title', 'Unknown Title')
                    thumbnail_url = f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"

                    # Process through Gemini Vision
                    ai_result = analyze_video_with_gemini(title, thumbnail_url)
                    
                    formatted_message = f"""{ai_result}
Link: {video_url}
Uploaded date: {upload_dt.strftime('%Y-%m-%d')}"""

                    print("\n--- Generated Class Record ---")
                    print(formatted_message)
                    print("-" * 30)

                    # Send to Telegram -> This automatically hits your Render webhook and saves to Firebase!
                    send_to_telegram(formatted_message)
                    time.sleep(2)
                else:
                    break
            except Exception as err:
                print(f"Error processing video {video_id}: {err}")
                continue

if __name__ == "__main__":
    run_automation_pipeline()
