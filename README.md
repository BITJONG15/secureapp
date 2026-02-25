# SecureChat

Real-time secure chat web app with public and private sessions.

## Run Local

```bash
npm install
npm run dev
```

## Render-Only Deployment (Frontend + Backend)

This project is configured to run as a single Render Web Service:
- Express serves `public/`
- Socket.IO runs on the same origin

### Deploy Steps

1. Push repository to GitHub.
2. In Render: `New +` -> `Web Service` -> connect this repo.
3. Use:
- `Build Command`: `npm ci`
- `Start Command`: `npm start`
- `Plan`: `Free`
4. Set environment variables:
- `NODE_ENV=production`
- `CORS_ORIGINS=*`
- `SESSION_LINK_BASE_URL=https://your-service-name.onrender.com`
5. Deploy and verify health endpoint:
- `https://your-service-name.onrender.com/health`

You can also deploy from `render.yaml`.

## Environment

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

## Firebase Setup (Optional)

1. Create a Firebase project and enable Firestore.
2. Create a service account key (`Project Settings > Service accounts`).
3. Set in `.env`:
- `FIREBASE_ENABLED=true`
- one credential option:
- `FIREBASE_SERVICE_ACCOUNT_JSON` (full JSON string), or
- `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` (keep `\\n` escapes), or
- `GOOGLE_APPLICATION_CREDENTIALS` (path to service account JSON file)

## Features

- General persistent public session (`general`)
- Private sessions with duration and participant limits
- Real-time messaging with edit window (10 minutes)
- Message deletion and capped message history (100/session)
- Frontend security controls and responsive UI
