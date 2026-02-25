# SecureChat

Real-time secure chat web app with public and private sessions.

## Run Local

```bash
npm install
npm run dev
```

## Deploy Backend on Render (Free)

1. Push this repository to GitHub.
2. In Render: `New +` -> `Web Service` -> select repo.
3. Use:
- `Build Command`: `npm ci`
- `Start Command`: `npm start`
4. Set environment variables:
- `NODE_ENV=production`
- `CORS_ORIGINS=https://your-site.netlify.app`
- `SESSION_LINK_BASE_URL=https://your-site.netlify.app`
- `SOCKET_PUBLIC_URL=https://your-render-service.onrender.com`
5. Deploy and copy your Render URL.

You can also use `render.yaml` included in this repo.

## Deploy Frontend on Netlify

1. In Netlify: `Add new site` -> import this repo.
2. Set:
- `Base directory`: repository root
- `Build command`: (empty)
- `Publish directory`: `public`
3. Before deploy, set backend URL in `public/js/config.js`:

```js
window.SECURECHAT_CONFIG.SOCKET_URL = "https://your-render-service.onrender.com";
```

4. Deploy.

`netlify.toml` is already configured for SPA routing and no-cache on `index.html` + `js/config.js`.

## Quick Runtime Override

If needed, override backend URL without code change:

`https://your-site.netlify.app/?socketUrl=https://your-render-service.onrender.com`

This URL is saved in local storage for next visits.

## Environment

```env
PORT=3000
NODE_ENV=development
SESSION_SECRET=secure_random_string
CORS_ORIGINS=*
SESSION_LINK_BASE_URL=http://localhost:3000
SOCKET_PUBLIC_URL=http://localhost:3000
FIREBASE_ENABLED=false
FIREBASE_PROJECT_ID=chat-915ef
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
FIREBASE_SERVICE_ACCOUNT_JSON=
FIREBASE_WEB_API_KEY=
FIREBASE_WEB_AUTH_DOMAIN=
FIREBASE_WEB_PROJECT_ID=
FIREBASE_WEB_STORAGE_BUCKET=
FIREBASE_WEB_MESSAGING_SENDER_ID=
FIREBASE_WEB_APP_ID=
```

## Firebase Setup (Firestore)

1. Create a Firebase project and enable Firestore.
2. Create a service account key (`Project Settings > Service accounts`).
3. Set these values in `.env`:
- `FIREBASE_ENABLED=true`
- one credential option:
- `FIREBASE_SERVICE_ACCOUNT_JSON` (full JSON string), or
- `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` (keep `\\n` escapes), or
- `GOOGLE_APPLICATION_CREDENTIALS` (path to service account JSON file)

When enabled, SecureChat persists messages in Firestore and reloads recent history on join.

## Features

- General persistent public session (`general`)
- Private sessions with duration and participant limits
- Real-time messaging with edit window (10 minutes)
- Message deletion and capped message history (100/session)
- Frontend security controls and responsive UI
