# Mosaic AI Recommendation Chat Agent

Custom Claude-powered chat widget and analytics dashboard for Новая Мозаика.
Replaces Voiceflow. Powered by Claude Haiku via a Vercel serverless proxy.

---

## Project structure

```
mosaic-recom/
├── api/
│   ├── dashboard/
│   │   └── sessions.js        ← Sessions data endpoint for dashboard
│   ├── session/
│   │   ├── end.js             ← Ends a user session
│   │   ├── manager.js         ← Session management logic
│   │   └── start.js           ← Starts a new user session
│   ├── chat.js                ← Vercel serverless function (Claude proxy)
│   └── image.js               ← Image handling endpoint
├── dashboard/
│   └── index.html             ← Admin analytics dashboard (ИИ Аналитика)
├── widget/
│   └── chat-widget.js         ← Chat UI loaded by your landing page
├── apple-touch-icon.png       ← PWA / bookmark icon
├── .env.local                 ← Your API key (NEVER commit)
├── .gitignore
├── vercel.json                ← Routes + CORS headers
└── README.md
```

---

## Step 1 — Create GitHub repo

1. Go to https://github.com/new
2. Repository name: `mosaic-recom`
3. Private ✅
4. Click **Create repository**
5. In VS Code terminal:
   ```bash
   cd path\to\mosaic-recom
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/mosaic-recom.git
   git push -u origin main
   ```

---

## Step 2 — Deploy to Vercel

1. Go to https://vercel.com/new
2. Click **Import Git Repository** → select `mosaic-recom`
3. Framework Preset: **Other**
4. Click **Deploy**

---

## Step 3 — Add your Anthropic API key

1. In Vercel dashboard → your project → **Settings** → **Environment Variables**
2. Add:
   - Name: `ANTHROPIC_API_KEY`
   - Value: `sk-ant-xxxxxxxxxxxxxxxx` (your key from console.anthropic.com)
   - Environment: ✅ Production ✅ Preview
3. Click **Save**
4. Go to **Deployments** → click the three dots → **Redeploy** (to apply the env var)

---

## Step 4 — Update the widget URL

After deployment, Vercel gives you a URL like:
`https://mosaic-recom.vercel.app`

1. Open `widget/chat-widget.js`
2. Find this line near the top:
   ```js
   const AGENT_URL = (window.MOSAIC_AGENT_URL || 'https://mosaic-recom.vercel.app') + '/api/chat';
   ```
3. Replace `mosaic-recom.vercel.app` with your actual Vercel URL if different
4. Commit and push — Vercel auto-redeploys

---

## Step 5 — Update your landing page (index.html)

### Remove the Voiceflow block:
```html
<!-- DELETE THIS ENTIRE BLOCK -->
<script>
  window.addEventListener('load', function() {
    setTimeout(function() {
      (function(d, t) {
        ...voiceflow code...
      })(document, 'script');
    }, 2000);
  });
</script>
```

### Add the new widget (before `</body>`):
```html
<!-- AI Chat Widget -->
<script>
  window.MOSAIC_AGENT_URL = 'https://mosaic-recom.vercel.app';
</script>
<script src="https://mosaic-recom.vercel.app/widget/chat-widget.js" defer></script>
```

### Wire up the "Начать диалог с ИИ" button:
Find:
```html
<button class="ai-start-btn" onclick="window.voiceflow && window.voiceflow.chat && window.voiceflow.chat.open()">
```
Replace with:
```html
<button class="ai-start-btn" onclick="window.MosaicChat && window.MosaicChat.open()">
```

---

## Step 6 — Access the Analytics Dashboard

The admin dashboard is available at:
```
https://mosaic-recom.vercel.app/dashboard
```

It shows:
- **Total sessions** — unique conversations
- **Call conversion** — % of sessions that requested a manager
- **Manager requests** — total call requests
- **Last activity** — most recent session timestamp
- **Sessions by day** — bar chart with date filter

---

## Step 7 — Test locally

Open `index.html` directly in Chrome (`file://`).
The widget appears bottom-right. Click it — proactive messages appear.
Type a message or click a quick button.

To test the API locally with Vercel CLI:
```bash
npm i -g vercel
vercel dev
```
Then set `window.MOSAIC_AGENT_URL = 'http://localhost:3000'` temporarily.

---

## How it works

1. User opens the chat widget on the landing page
2. Widget sends `POST /api/chat` with the conversation history
3. `api/session/start.js` creates a session and logs it via `api/session/manager.js`
4. Vercel function fetches the live catalog and injects it into Claude's system prompt
5. Claude returns a response with optional `<<<PRODUCTS>>>` and `<<<BUTTONS>>>` blocks
6. Widget parses and renders product carousels + quick-action buttons
7. When the user requests a manager, `api/session/end.js` closes the session
8. Dashboard reads session data from `api/dashboard/sessions.js` and renders analytics

---

## Updating

Any push to `main` branch triggers automatic Vercel redeployment.
No manual steps needed after initial setup.
