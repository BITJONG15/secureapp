const { v4: uuidv4 } = require("uuid");
const { isWithinEditWindow, sanitizeText } = require("./utils");

const MAX_MESSAGES_PER_SESSION = 100;
const EDIT_WINDOW_MINUTES = 10;
const MAX_ENCRYPTED_MESSAGE_LENGTH = 12000;
const MAX_IV_LENGTH = 256;

function createError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizePlainContent(content) {
  const cleanContent = sanitizeText(content, 2000);

  if (!cleanContent) {
    throw createError("Message content cannot be empty.", "EMPTY_MESSAGE");
  }

  return cleanContent;
}

function normalizeEncryptedContent(content) {
  if (typeof content !== "string") {
    throw createError("Invalid encrypted payload.", "INVALID_ENCRYPTED_PAYLOAD");
  }

  const compact = content.trim();

  if (!compact || compact.length > MAX_ENCRYPTED_MESSAGE_LENGTH) {
    throw createError("Invalid encrypted payload.", "INVALID_ENCRYPTED_PAYLOAD");
  }

  return compact;
}

function normalizeIv(iv) {
  const compact = String(iv || "").trim();

  if (!compact || compact.length > MAX_IV_LENGTH) {
    throw createError("Invalid IV for encrypted message.", "INVALID_ENCRYPTED_PAYLOAD");
  }

  return compact;
}

class MessageManager {
  constructor(maxMessages = MAX_MESSAGES_PER_SESSION) {
    this.maxMessages = maxMessages;
    this.messagesBySession = new Map();
  }

  _ensureSessionBucket(sessionId) {
    if (!this.messagesBySession.has(sessionId)) {
      this.messagesBySession.set(sessionId, []);
    }

    return this.messagesBySession.get(sessionId);
  }

  getMessages(sessionId) {
    const bucket = this.messagesBySession.get(sessionId) || [];
    return bucket.map((message) => ({ ...message }));
  }

  setMessages(sessionId, messages) {
    if (!sessionId) {
      throw createError("Invalid session ID.", "INVALID_SESSION_ID");
    }

    const nextBucket = Array.isArray(messages)
      ? messages
          .filter((message) => message && message.id && message.userId && message.sessionId === sessionId)
          .slice(-this.maxMessages)
          .map((message) => {
            const encrypted = Boolean(message.encrypted);

            return {
              id: message.id,
              userId: message.userId,
              sessionId: message.sessionId,
              content: encrypted ? normalizeEncryptedContent(message.content) : sanitizeText(message.content, 2000),
              timestamp: message.timestamp,
              edited: Boolean(message.edited),
              encrypted,
              iv: encrypted ? normalizeIv(message.iv) : "",
            };
          })
      : [];

    this.messagesBySession.set(sessionId, nextBucket);
  }

  addMessage({ sessionId, userId, content, encrypted = false, iv = "" }) {
    if (!sessionId || !userId) {
      throw createError("Invalid message payload.", "INVALID_MESSAGE_PAYLOAD");
    }

    const encryptedMessage = Boolean(encrypted);
    const message = {
      id: uuidv4(),
      userId,
      sessionId,
      content: encryptedMessage ? normalizeEncryptedContent(content) : normalizePlainContent(content),
      timestamp: new Date().toISOString(),
      edited: false,
      encrypted: encryptedMessage,
      iv: encryptedMessage ? normalizeIv(iv) : "",
    };

    const bucket = this._ensureSessionBucket(sessionId);
    bucket.push(message);

    if (bucket.length > this.maxMessages) {
      bucket.splice(0, bucket.length - this.maxMessages);
    }

    return { ...message };
  }

  editMessage({ sessionId, messageId, userId, content, encrypted = false, iv = "" }) {
    const bucket = this._ensureSessionBucket(sessionId);
    const messageIndex = bucket.findIndex((message) => message.id === messageId);

    if (messageIndex === -1) {
      throw createError("Message not found.", "MESSAGE_NOT_FOUND");
    }

    const target = bucket[messageIndex];

    if (target.userId !== userId) {
      throw createError("Cannot edit another user's message.", "FORBIDDEN");
    }

    if (!isWithinEditWindow(target.timestamp, EDIT_WINDOW_MINUTES)) {
      throw createError("Edit window expired (10 minutes).", "EDIT_WINDOW_EXPIRED");
    }

    const encryptedMessage = Boolean(encrypted);

    target.content = encryptedMessage ? normalizeEncryptedContent(content) : normalizePlainContent(content);
    target.edited = true;
    target.encrypted = encryptedMessage;
    target.iv = encryptedMessage ? normalizeIv(iv) : "";

    return { ...target };
  }

  deleteMessage({ sessionId, messageId, userId }) {
    const bucket = this._ensureSessionBucket(sessionId);
    const messageIndex = bucket.findIndex((message) => message.id === messageId);

    if (messageIndex === -1) {
      throw createError("Message not found.", "MESSAGE_NOT_FOUND");
    }

    const target = bucket[messageIndex];

    if (target.userId !== userId) {
      throw createError("Cannot delete another user's message.", "FORBIDDEN");
    }

    bucket.splice(messageIndex, 1);

    return { ...target };
  }

  removeMessagesByUser(userId) {
    if (!userId) {
      return [];
    }

    const removedMessages = [];

    for (const [sessionId, bucket] of this.messagesBySession.entries()) {
      const nextBucket = [];

      bucket.forEach((message) => {
        if (message.userId === userId) {
          removedMessages.push({ ...message });
          return;
        }

        nextBucket.push(message);
      });

      this.messagesBySession.set(sessionId, nextBucket);
    }

    return removedMessages;
  }

  clearSession(sessionId) {
    this.messagesBySession.delete(sessionId);
  }
}

module.exports = {
  EDIT_WINDOW_MINUTES,
  MAX_MESSAGES_PER_SESSION,
  MessageManager,
};
