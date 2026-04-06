# Biblion

A dark academia reading companion — bite-sized book insights & vocabulary learning, powered by DeepSeek AI.

## Setup

### 1. Get a DeepSeek API Key
- Go to [platform.deepseek.com](https://platform.deepseek.com)
- Create an API key
- You'll enter this in the app's Settings tab

### 2. Deploy to Vercel (free)

1. Push this folder to a new GitHub repository
2. Go to [vercel.com](https://vercel.com) and sign in with GitHub
3. Click "Add New Project" → Import your repo
4. Vercel auto-detects Vite — just click **Deploy**
5. Your app will be live at `your-project.vercel.app`

### 3. Install on Android

1. Open your Vercel URL in Chrome
2. Tap the three-dot menu (⋮)
3. Tap "Add to Home screen"
4. Biblion appears as a standalone app

## Local Development

```bash
npm install
npm run dev
```

## Features

- **The Stacks** — Upload EPUB/PDF books, generate curated insights (key ideas, passages, practical takeaways, surprises, connections)
- **Word Alcove** — Upload a dictionary file, learn a new word every 3 hours with etymology, examples, and mnemonics
- **Offline-capable** — PWA with service worker for offline access
- **Private** — API key stored only on your device, no backend server
