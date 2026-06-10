# MindCare AI Final Project

MindCare AI is an online therapist-style mental wellness platform with:
- Login/Register
- WhatsApp-like MindCare Chat
- Hidden sentiment analysis on every message
- Mood/risk/confidence scoring
- Dashboard and mood history
- Voice analysis demo
- Image/video analysis demo
- Multimodal fusion engine
- Clear Mind / Calm Space activities
- Therapist directory
- Voice/video call demo button
- Appointment booking
- Personalised settings and consent controls
- MySQL schema

## Project Structure

```text
mindcare-final/
├── frontend/        React + Vite UI
├── backend/         Node.js + Express API
├── ai-service/      Python FastAPI spaCy text emotion service
└── database/        MySQL schema
```

## How to Run

### 1. Backend
```bash
cd backend
npm install
copy .env.example .env   # Windows
# or: cp .env.example .env
npm run dev
```
Backend runs on: `http://localhost:5000`

### 1.5. AI Service (spaCy text analysis)
Open another terminal and run:
```bash
cd ai-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m spacy download en_core_web_sm
uvicorn main:app --reload --port 8001
```
The AI service runs on: `http://localhost:8001`

### 2. Frontend
Open a second terminal:
```bash
cd frontend
npm install
npm run dev
```
Frontend runs on the Vite URL shown, usually: `http://localhost:5173`

## Test Login
Create a new account from the Register page.

## Most Important Feature
The `MindCare Chat` page works like WhatsApp:
1. User sends a normal message.
2. Backend replies naturally.
3. Sentiment analysis runs in the background.
4. Mood, sentiment, risk and confidence are saved.
5. Dashboard updates mood history.

## Important Safety Note
This is a final-year project prototype. It supports wellness and therapist connection, but it does not replace professional diagnosis or emergency medical care.

## How to Improve for Final Defense
- Replace demo sentiment with HuggingFace model.
- Replace voice demo with Librosa/MFCC classifier.
- Replace image/video demo with DeepFace or MediaPipe.
- Connect real MySQL instead of in-memory demo storage.
- Add real WebRTC signaling with Socket.io.
- Add therapist and admin role dashboards.
