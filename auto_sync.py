import os
import time
import requests
from datetime import datetime
from PIL import Image
from io import BytesIO
import google.generativeai as genai

# ==================== CONFIGURATION ====================
API_KEY = os.environ.get("GEMINI_API_KEY")
CHANNEL_ID = "UCe3zu_4btw404zGMVkZcsz" 
START_DATE = "2026-10-01"  # Tracking start date

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

    print(f"Fetching videos via official YouTube API for Channel ID: {CHANNEL_ID}")
    
    # Official YouTube Data API v3 Search endpoint
    api_url = f"https://www.googleapis.com/youtube/v3/search?key={API_KEY}&channelId={CHANNEL_ID}&part=snippet,id&order=date&maxResults=5"
    
    response = requests.get(api_url)
    if response.status_code != 200:
        print(f"API Error: {response.status_code} - {response.text}")
        return

    data = response.json()
    items = data.get("items", [])
    print(f"Found {len(items)} items from YouTube API.")

    for item in items:
        try:
            if item["id"]["kind"] != "youtube#video":
                continue

            video_id = item["id"]["videoId"]
            snippet = item["snippet"]
            title = snippet["title"]
            published_at = snippet["publishedAt"] # Format: 2026-10-06T12:00:00Z
            
            upload_dt = datetime.strptime(published_at.split('T')[0], "%Y-%m-%d")

            if upload_dt >= start_dt:
                video_url = f"https://www.youtube.com/watch?v={video_id}"
                thumbnail_url = snippet["thumbnails"].get("high", {}).get("url", f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg")

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
            print(f"Error processing video item: {err}")
            continue

if __name__ == "__main__":
    run_automation_pipeline()
