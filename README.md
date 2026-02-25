# SecureChat v2

Anonymous real-time chat with ephemeral private sessions, participant control, and client-side encrypted private messaging.

## Run Local

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Core Features

- Persistent anonymous identity (`user_xxxxx` + password) stored in browser.
- General room (`general`) with clickable user IDs to request direct private session.
- Two private session modes:
  - `direct`: consent-based, 2 participants, 60 minutes, no password.
  - `custom`: creator-defined duration (5-1440) + participant limit (2-50), password protected.
- Creator controls for custom sessions:
  - kick participant
  - update remaining duration
- Panic reset:
  - delete current identity data (messages + creator sessions)
  - rotate to a new identity instantly
- Anti-bruteforce behavior:
  - after repeated identity password failures, creator sessions/messages are purged.
- Private message encryption on client side (AES-GCM key per private session).

## Render Deployment (single service)

This app is configured for one Render Web Service (frontend + backend together):

1. Push repository to GitHub.
2. On Render: `New` -> `Web Service` -> connect repo.
3. Use:
- `Build Command`: `npm ci`
- `Start Command`: `npm start`
4. Environment:
- `NODE_ENV=production`
- `CORS_ORIGINS=*`
- `SESSION_LINK_BASE_URL=https://your-service-name.onrender.com`
5. Deploy and verify:
- `https://your-service-name.onrender.com/health`

`render.yaml` is included.

## Environment

Use `.env.example` as baseline.

```env
PORT=3000
NODE_ENV=development
SESSION_SECRET=secure_random_string
CORS_ORIGINS=*
SESSION_LINK_BASE_URL=http://localhost:3000
FIREBASE_ENABLED=false
FIREBASE_PROJECT_ID=
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

## Firebase (optional persistence)

Set `FIREBASE_ENABLED=true` and provide one credential mode:
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- or `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`
- or `GOOGLE_APPLICATION_CREDENTIALS`

When enabled, message storage/hydration uses Firestore.
