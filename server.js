/**
 * server.js — Express entrypoint replacing Vercel's serverless runtime.
 *
 * Every file under api/**\/*.js exports `module.exports = async function
 * handler(req, res) {...}` in plain Node (req, res) style — identical to
 * what Express route handlers receive. So instead of hand-wiring each
 * route, we walk the api/ directory recursively and auto-mount every
 * handler at the path matching its file location:
 *
 *   api/chat.js                     -> POST/OPTIONS /api/chat
 *   api/dashboard/sessions.js       -> /api/dashboard/sessions
 *   api/session/start.js            -> /api/session/start
 *
 * This mirrors Vercel's own file-system-based routing convention, so no
 * route list needs to be maintained by hand as new api/ files are added.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Vercel's default body size limit is fine for this app's JSON payloads;
// bump slightly since some catalog/session payloads can be sizeable.
app.use(express.json({ limit: '10mb' }));
// The widget's navigator.sendBeacon calls send text/plain (a JSON string):
// beacons carry cookies, and a beacon with Content-Type application/json
// needs a CORS preflight that our "Allow-Origin: *" can't satisfy for
// credentialed requests -- the browser silently drops it (found live, Oct
// 2026: card clicks never arrived). text/plain needs no preflight.
app.use('/api/session', express.text({ type: 'text/plain', limit: '64kb' }));

// ─── Replicate vercel.json's header rules ──────────────────────────────────
// /api/(.*) — CORS for the widget calling these endpoints cross-origin
app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// /widget/(.*) — served as JS with CORS + caching
app.use('/widget', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  if (req.path.endsWith('.js')) {
    res.setHeader('Content-Type', 'application/javascript');
  }
  next();
});

// /dashboard/manifest.json and /dashboard/sw.js — specific content types
app.use('/dashboard/manifest.json', (req, res, next) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  next();
});
app.use('/dashboard/sw.js', (req, res, next) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache');
  next();
});

// ─── Auto-mount every api/**/*.js handler ──────────────────────────────────
const API_DIR = path.join(__dirname, 'api');

function mountApiHandlers(dir, baseRoute) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Recurse into subdirectories (dashboard/, session/, _lib/, Safe/, ...)
      mountApiHandlers(fullPath, `${baseRoute}/${entry.name}`);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      // Skip files under _lib — these are shared helper modules, not
      // route handlers (e.g. api/_lib/push.js is imported BY handlers,
      // not itself a route Vercel would have exposed).
      //
      // Skip files under Safe/ — this holds an old backup copy of chat.js,
      // not a live endpoint. Mounting it would create a stale duplicate
      // route (/api/Safe/chat) serving outdated logic alongside the real
      // /api/chat, which is confusing at best and a correctness risk at
      // worst if it's ever called by mistake.
      if (baseRoute.includes('/_lib') || baseRoute.includes('/Safe')) continue;

      const routeName = entry.name.replace(/\.js$/, '');
      const routePath = `${baseRoute}/${routeName}`;

      let handler;
      try {
        handler = require(fullPath);
      } catch (err) {
        console.error(`Failed to load handler at ${fullPath}:`, err.message);
        continue;
      }

      if (typeof handler !== 'function') {
        console.warn(`Skipping ${fullPath} — does not export a function`);
        continue;
      }

      // Vercel invokes handlers for all methods (including OPTIONS/GET),
      // letting each handler check req.method itself — same as here.
      app.all(routePath, (req, res) => {
        Promise.resolve(handler(req, res)).catch((err) => {
          console.error(`Unhandled error in ${routePath}:`, err);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
          }
        });
      });

      console.log(`Mounted ${routePath}  <-  ${path.relative(__dirname, fullPath)}`);
    }
  }
}

mountApiHandlers(API_DIR, '/api');

// ─── Static assets ──────────────────────────────────────────────────────────
// /dashboard -> dashboard/index.html (vercel.json rewrite)
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard', 'index.html'));
});

app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));
app.use('/widget', express.static(path.join(__dirname, 'widget')));

// Root-level static files (logos, chat-bg.jpg, favicon-style assets, etc.)
app.use(express.static(__dirname, {
  index: false, // don't auto-serve an index.html at root unless explicitly requested
  dotfiles: 'ignore',
}));

// ─── Health check (useful for Coolify's health checks / uptime monitoring) ──
app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
