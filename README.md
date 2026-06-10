# Car Parts AI Recommendation Chat Agent

Custom Claude-powered chat widget and analytics dashboard for car parts e-commerce.
Powered by Claude Haiku via a Vercel serverless proxy.

---

## Project structure

```
Car-Parts-Ai-Recommendation/
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
│   └── index.html             ← Admin analytics dashboard
├── widget/
│   └── chat-widget.js         ← Chat UI loaded by your landing page
├── apple-touch-icon.png       ← PWA / bookmark icon
├── .env.local                 ← Your API key (NEVER commit)
├── .gitignore
├── vercel.json                ← Routes + CORS headers
└── README.md
```

---

## Step 1 — GitHub repo

Repository is already created at:
```
https://github.com/Aris1672/Car-Parts-Ai-Recommendation.git
```

To push changes from VS Code terminal:
```bash
git add .
git commit -m "describe what you changed"
git push
```

---

## Step 2 — Deploy to Vercel

1. Go to https://vercel.com/new
2. Click **Import Git Repository** → select `Car-Parts-Ai-Recommendation`
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

## Step 4 — Fill in the TODO placeholders

Before deploying, open `api/chat.js` and `widget/chat-widget.js` and replace every `TODO` with real values:

| Placeholder | What to put |
|---|---|
| `TODO_COMPANY_NAME` | Your client's company name |
| `TODO_SITE.ru` | Their website domain |
| `TODO_PHONE` | Contact phone (display format) |
| `TODO_PHONE_DIGITS_ONLY` | Same phone, digits only e.g. `+79991234567` |
| `TODO_EMAIL` | Contact email |
| `TODO_ADDRESS` | Company address |
| `TODO_HOURS` | Working hours e.g. `Пн-Пт 09:00–18:00` |
| `TODO-YOUR-CATALOG-PROXY.vercel.app` | Catalog API endpoint URL |
| `TODO-YOUR-PROJECT.vercel.app` | This project's Vercel URL (set after deploy) |

---

## Step 5 — Update the widget URL

After deployment, Vercel gives you a URL like:
`https://car-parts-ai-recommendation.vercel.app`

1. Open `widget/chat-widget.js`
2. Find this line near the top:
   ```js
   const BASE_URL = window.AGENT_URL || 'https://TODO-YOUR-PROJECT.vercel.app';
   ```
3. Replace the TODO with your actual Vercel URL
4. Commit and push — Vercel auto-redeploys

---

## Step 6 — Add the widget to the client's landing page

Add before `</body>`:
```html
<!-- AI Chat Widget -->
<script>
  window.AGENT_URL = 'https://car-parts-ai-recommendation.vercel.app';
</script>
<script src="https://car-parts-ai-recommendation.vercel.app/widget/chat-widget.js" defer></script>
```

Wire up any existing chat button:
```html
<button onclick="window.AutoChat && window.AutoChat.open()">
  Подобрать запчасть
</button>
```

---

## Step 7 — Access the Analytics Dashboard

The admin dashboard is available at:
```
https://car-parts-ai-recommendation.vercel.app/dashboard
```

It shows:
- **Total sessions** — unique conversations
- **Call conversion** — % of sessions that requested a manager
- **Manager requests** — total call requests
- **Last activity** — most recent session timestamp
- **Sessions by day** — bar chart with date filter

---

## Step 8 — Test locally

To test the API locally with Vercel CLI:
```bash
npm i -g vercel
vercel dev
```
Then set `window.AGENT_URL = 'http://localhost:3000'` temporarily in the widget.

---

## How it works

1. User opens the chat widget on the landing page
2. Widget sends `POST /api/chat` with the conversation history
3. `api/session/start.js` creates a session and logs it via `api/session/manager.js`
4. Vercel function fetches the live parts catalog and injects it into Claude's system prompt
5. Claude returns a response with optional `<<<PRODUCTS>>>` and `<<<BUTTONS>>>` blocks
6. Widget parses and renders product carousels + quick-action buttons
7. When the user requests a manager, `api/session/end.js` closes the session
8. Dashboard reads session data from `api/dashboard/sessions.js` and renders analytics

---

## Catalog API field mapping

The catalog endpoint must return a `products` array. Each product should have:

| Field | Description |
|---|---|
| `article` | Part number / SKU |
| `name` | Part name |
| `brand` | Manufacturer brand |
| `category` | Part category (e.g. тормоза, подвеска) |
| `compatibility` | Compatible car makes/models |
| `price` | Price in RUB |
| `stock` | Units in stock |
| `url` | Product page URL |
| `picture` | Product image URL |

If your catalog uses different field names, update the mapping in `api/chat.js` inside `fetchCatalog()`.

---

## Updating

Any push to `main` branch triggers automatic Vercel redeployment.
No manual steps needed after initial setup.
