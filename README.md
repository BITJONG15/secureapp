# SecureChat

Real-time secure chat web app with public and private sessions.

## Run

```bash
npm install
npm run dev
```

## Environment

```env
PORT=3000
NODE_ENV=development
SESSION_SECRET=secure_random_string
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
3. Set these values in [.env](E:/app-chat/securechat/.env):
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

## Optional Extension Hooks

Codebase includes commented hooks for:
- Firebase persistence
- End-to-end encryption
- File sharing
- WebRTC video
- Push notifications
