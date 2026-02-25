const {
  buildSessionLink,
  generatePassword,
  generatePrivateSessionId,
  validateDurationMinutes,
  validateMaxParticipants,
} = require("./utils");

const GENERAL_SESSION_ID = "general";
const EMPTY_GRACE_MS = 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 1000;

function createError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

class SessionManager {
  constructor({ onSessionExpired, sessionLinkBase, sessionSocketUrl } = {}) {
    this.sessions = new Map();
    this.expiryTimers = new Map();
    this.emptyTimers = new Map();
    this.onSessionExpired = typeof onSessionExpired === "function" ? onSessionExpired : () => {};
    this.sessionLinkBase = sessionLinkBase || "";
    this.sessionSocketUrl = sessionSocketUrl || "";

    this._initGeneralSession();

    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, CLEANUP_INTERVAL_MS);

    if (typeof this.cleanupInterval.unref === "function") {
      this.cleanupInterval.unref();
    }
  }

  _initGeneralSession() {
    const nowIso = new Date().toISOString();

    this.sessions.set(GENERAL_SESSION_ID, {
      id: GENERAL_SESSION_ID,
      type: "public",
      persistent: true,
      maxParticipants: null,
      durationMinutes: null,
      password: null,
      createdAt: nowIso,
      expiresAt: null,
      link: buildSessionLink(GENERAL_SESSION_ID, this.sessionLinkBase, this.sessionSocketUrl),
      participants: new Map(),
    });
  }

  _scheduleDurationExpiry(sessionId, delayMs) {
    this._clearExpiryTimer(sessionId);

    const timeout = setTimeout(() => {
      this.expireSession(sessionId, "duration-reached");
    }, delayMs);

    if (typeof timeout.unref === "function") {
      timeout.unref();
    }

    this.expiryTimers.set(sessionId, timeout);
  }

  _scheduleEmptyExpiry(sessionId) {
    this._clearEmptyTimer(sessionId);

    const timeout = setTimeout(() => {
      this.expireSession(sessionId, "empty-session");
    }, EMPTY_GRACE_MS);

    if (typeof timeout.unref === "function") {
      timeout.unref();
    }

    this.emptyTimers.set(sessionId, timeout);
  }

  _clearExpiryTimer(sessionId) {
    const timeout = this.expiryTimers.get(sessionId);

    if (timeout) {
      clearTimeout(timeout);
      this.expiryTimers.delete(sessionId);
    }
  }

  _clearEmptyTimer(sessionId) {
    const timeout = this.emptyTimers.get(sessionId);

    if (timeout) {
      clearTimeout(timeout);
      this.emptyTimers.delete(sessionId);
    }
  }

  _toClientSession(session, includeSensitive = false) {
    const users = Array.from(new Set(session.participants.values()));

    const response = {
      id: session.id,
      type: session.type,
      persistent: session.persistent,
      maxParticipants: session.maxParticipants,
      durationMinutes: session.durationMinutes,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      link: session.link,
      participantCount: users.length,
      participants: users,
    };

    if (includeSensitive && session.password) {
      response.password = session.password;
    }

    return response;
  }

  createPrivateSession({ durationMinutes, maxParticipants }) {
    const duration = validateDurationMinutes(durationMinutes);
    const participantLimit = validateMaxParticipants(maxParticipants);

    let sessionId = generatePrivateSessionId();

    while (this.sessions.has(sessionId)) {
      sessionId = generatePrivateSessionId();
    }

    const password = generatePassword();
    const now = Date.now();

    const session = {
      id: sessionId,
      type: "private",
      persistent: false,
      maxParticipants: participantLimit,
      durationMinutes: duration,
      password,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + duration * 60 * 1000).toISOString(),
      link: buildSessionLink(sessionId, this.sessionLinkBase, this.sessionSocketUrl),
      participants: new Map(),
    };

    this.sessions.set(sessionId, session);
    this._scheduleDurationExpiry(sessionId, duration * 60 * 1000);

    return {
      session: this._toClientSession(session, true),
      password,
      link: session.link,
    };
  }

  joinSession({ sessionId, socketId, userId, password }) {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw createError("Session not found.", "SESSION_NOT_FOUND");
    }

    if (!socketId || !userId) {
      throw createError("Invalid join payload.", "INVALID_JOIN_PAYLOAD");
    }

    if (session.type === "private") {
      if (session.password !== password) {
        throw createError("Wrong password.", "WRONG_PASSWORD");
      }

      if (!session.participants.has(socketId) && session.participants.size >= session.maxParticipants) {
        throw createError("Session is full.", "SESSION_FULL");
      }
    }

    session.participants.set(socketId, userId);
    this._clearEmptyTimer(sessionId);

    return this._toClientSession(session, false);
  }

  leaveSession({ sessionId, socketId }) {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    const existingUser = session.participants.get(socketId) || null;
    const deleted = session.participants.delete(socketId);

    if (!deleted) {
      return null;
    }

    if (session.type === "private" && session.participants.size === 0) {
      this._scheduleEmptyExpiry(sessionId);
    }

    return {
      userId: existingUser,
      session: this._toClientSession(session, false),
    };
  }

  getParticipantSnapshot(sessionId) {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return {
        participantCount: 0,
        participants: [],
      };
    }

    const participants = Array.from(new Set(session.participants.values()));

    return {
      participantCount: participants.length,
      participants,
    };
  }

  getParticipantUserId(sessionId, socketId) {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    return session.participants.get(socketId) || null;
  }

  removeUserFromAllSessions(userId) {
    if (!userId) {
      return [];
    }

    const removedParticipants = [];

    for (const session of this.sessions.values()) {
      for (const [socketId, participantUserId] of Array.from(session.participants.entries())) {
        if (participantUserId !== userId) {
          continue;
        }

        session.participants.delete(socketId);
        removedParticipants.push({
          sessionId: session.id,
          socketId,
          userId,
        });
      }

      if (session.type === "private" && session.participants.size === 0) {
        this._scheduleEmptyExpiry(session.id);
      }
    }

    return removedParticipants;
  }

  getSessionsList() {
    const sessions = Array.from(this.sessions.values()).map((session) => this._toClientSession(session, false));

    sessions.sort((a, b) => {
      if (a.id === GENERAL_SESSION_ID) {
        return -1;
      }

      if (b.id === GENERAL_SESSION_ID) {
        return 1;
      }

      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return sessions;
  }

  getSession(sessionId, includeSensitive = false) {
    const session = this.sessions.get(sessionId);
    return session ? this._toClientSession(session, includeSensitive) : null;
  }

  expireSession(sessionId, reason = "expired") {
    const session = this.sessions.get(sessionId);

    if (!session || session.persistent) {
      return null;
    }

    const participants = Array.from(session.participants.entries()).map(([socketId, userId]) => ({
      socketId,
      userId,
    }));

    this._clearExpiryTimer(sessionId);
    this._clearEmptyTimer(sessionId);
    this.sessions.delete(sessionId);

    const payload = {
      reason,
      sessionId,
      participants,
      session: this._toClientSession(session, false),
    };

    this.onSessionExpired(payload);

    return payload;
  }

  cleanupExpiredSessions() {
    const now = Date.now();

    for (const session of this.sessions.values()) {
      if (session.persistent || !session.expiresAt) {
        continue;
      }

      const expiresAtMs = new Date(session.expiresAt).getTime();

      if (expiresAtMs <= now) {
        this.expireSession(session.id, "duration-reached");
      }
    }
  }
}

module.exports = {
  GENERAL_SESSION_ID,
  SessionManager,
  createSessionError: createError,
};
