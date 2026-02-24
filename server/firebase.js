let admin = null;
let firestore = null;
let initializationError = null;

function isEnabledByEnv() {
  return String(process.env.FIREBASE_ENABLED || "false").toLowerCase() === "true";
}

function hasSplitServiceAccountEnv() {
  return Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY);
}

function getPrivateKey() {
  return String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
}

function parseServiceAccountJson(rawValue) {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);

    if (parsed.private_key) {
      parsed.private_key = String(parsed.private_key).replace(/\\n/g, "\n");
    }

    return parsed;
  } catch (_error) {
    return null;
  }
}

function buildCredential(adminSdk) {
  const jsonCredential = parseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

  if (jsonCredential) {
    return adminSdk.credential.cert(jsonCredential);
  }

  if (hasSplitServiceAccountEnv()) {
    return adminSdk.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: getPrivateKey(),
    });
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return adminSdk.credential.applicationDefault();
  }

  return null;
}

function initialize() {
  if (!isEnabledByEnv()) {
    return;
  }

  try {
    // eslint-disable-next-line global-require
    admin = require("firebase-admin");
    const credential = buildCredential(admin);

    if (!credential) {
      initializationError = new Error(
        "Firebase enabled but no credentials found. Use FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY, or GOOGLE_APPLICATION_CREDENTIALS."
      );
      return;
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential,
      });
    }

    firestore = admin.firestore();
    initializationError = null;
  } catch (error) {
    initializationError = error;
    admin = null;
    firestore = null;
  }
}

initialize();

function isReady() {
  return Boolean(firestore) && !initializationError;
}

function getStatus() {
  if (!isEnabledByEnv()) {
    return {
      enabled: false,
      ready: false,
      error: null,
    };
  }

  return {
    enabled: true,
    ready: isReady(),
    error: initializationError,
  };
}

function messagesCollection(sessionId) {
  return firestore.collection("sessions").doc(sessionId).collection("messages");
}

async function saveMessage(message) {
  if (!isReady()) {
    return;
  }

  const createdAtMs = Date.parse(message.timestamp);

  await messagesCollection(message.sessionId)
    .doc(message.id)
    .set({
      ...message,
      createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
    });
}

async function editMessage(message) {
  if (!isReady()) {
    return;
  }

  await messagesCollection(message.sessionId).doc(message.id).update({
    content: message.content,
    edited: true,
    updatedAt: new Date().toISOString(),
  });
}

async function deleteMessage(sessionId, messageId) {
  if (!isReady()) {
    return;
  }

  await messagesCollection(sessionId).doc(messageId).delete();
}

async function deleteMessagesByUser(userId) {
  if (!isReady() || !userId) {
    return 0;
  }

  const snapshot = await firestore.collectionGroup("messages").where("userId", "==", userId).get();

  if (snapshot.empty) {
    return 0;
  }

  let deletedCount = 0;
  let currentBatch = firestore.batch();
  let operationsInBatch = 0;

  for (const doc of snapshot.docs) {
    currentBatch.delete(doc.ref);
    operationsInBatch += 1;
    deletedCount += 1;

    if (operationsInBatch >= 400) {
      await currentBatch.commit();
      currentBatch = firestore.batch();
      operationsInBatch = 0;
    }
  }

  if (operationsInBatch > 0) {
    await currentBatch.commit();
  }

  return deletedCount;
}

async function loadRecentMessages(sessionId, limit = 100) {
  if (!isReady()) {
    return [];
  }

  const querySnapshot = await messagesCollection(sessionId).orderBy("createdAtMs", "asc").limit(limit).get();

  return querySnapshot.docs.map((doc) => {
    const data = doc.data();

    return {
      id: data.id || doc.id,
      userId: data.userId || "",
      sessionId: data.sessionId || sessionId,
      content: data.content || "",
      timestamp: data.timestamp || new Date().toISOString(),
      edited: Boolean(data.edited),
    };
  });
}

async function clearSessionMessages(sessionId) {
  if (!isReady()) {
    return;
  }

  const snapshot = await messagesCollection(sessionId).get();

  if (snapshot.empty) {
    return;
  }

  const batch = firestore.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();
}

module.exports = {
  clearSessionMessages,
  deleteMessage,
  deleteMessagesByUser,
  editMessage,
  getStatus,
  loadRecentMessages,
  saveMessage,
};
