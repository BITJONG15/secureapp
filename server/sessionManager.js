const {
  buildSessionLink,
  generatePassword,
  generatePrivateSessionId,
  validateDurationMinutes,
  validateMaxParticipants,
} = require("./utils");

const GENERAL_SESSION_ID = "general";
const EMPTY_GRACE_MS = 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const DIRECT_PRIVATE_DURATION_MINUTES = 60;
const DIRECT_PRIVATE_PARTICIPANT_LIMIT = 2;

function createError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function uniqueUserList(participantsMap) {
  return Array.from(new Set(participantsMap.values()));
}

class SessionManager {
  constructor({ onSessionExpired, sessionLinkBase } = {}) {
    this.sessions = new Map();
    this.expiryTimers = new Map();
    this.emptyTimers = new Map();
    this.onSessionExpired = typeof onSessionExpired === "function" ? onSessionExpired : () => {};
    this.sessionLinkBase = sessionLinkBase || "";

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
      mode: "general",
      joinMode: "open",
      persistent: true,
      maxParticipants: null,
      durationMinutes: null,
      password: null,
      creatorUserId: null,
      createdAt: nowIso,
      expiresAt: null,
      link: buildSessionLink(GENERAL_SESSION_ID, this.sessionLinkBase),
      participants: new Map(),
    });
  }

  _generateUniquePrivateSessionId() {
    let sessionId = generatePrivateSessionId();

    while (this.sessions.has(sessionId)) {
      sessionId = generatePrivateSessionId();
    }

    return sessionId;
  }

  _buildPrivateSession({
    creatorUserId,
    durationMinutes,
    maxParticipants,
    mode,
    joinMode,
    password,
  }) {
    const sessionId = this._generateUniquePrivateSessionId();
    const now = Date.now();

    const session = {
      id: sessionId,
      type: "private",
      mode,
      joinMode,
      persistent: false,
      maxParticipants,
      durationMinutes,
      password: joinMode === "password" ? password : null,
      creatorUserId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + durationMinutes * 60 * 1000).toISOString(),
      link: buildSessionLink(sessionId, this.sessionLinkBase),
      participants: new Map(),
    };

    this.sessions.set(sessionId, session);
    this._scheduleDurationExpiry(sessionId, durationMinutes * 60 * 1000);

    return session;
  }

  _scheduleDurationExpiry(sessionId, delayMs) {
    this._clearExpiryTimer(sessionId);

    const timeout = setTimeout(() => {
      this.expireSession(sessionId, "duration-reached");
    }, Math.max(500, delayMs));

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
    const users = uniqueUserList(session.participants);

    const response = {
      id: session.id,
      type: session.type,
      mode: session.mode,
      joinMode: session.joinMode,
      persistent: session.persistent,
      maxParticipants: session.maxParticipants,
      durationMinutes: session.durationMinutes,
      creatorUserId: session.creatorUserId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      link: session.link,
      participantCount: users.length,
      participants: users,
      encrypted: session.type === "private",
    };

    if (includeSensitive && session.password) {
      response.password = session.password;
    }

    return response;
  }

  createCustomPrivateSession({ durationMinutes, maxParticipants, creatorUserId }) {
    if (!creatorUserId) {
      throw createError("Creator is required.", "CREATOR_REQUIRED");
    }

    const duration = validateDurationMinutes(durationMinutes);
    const participantLimit = validateMaxParticipants(maxParticipants);
    const password = generatePassword();

    const session = this._buildPrivateSession({
      creatorUserId,
      durationMinutes: duration,
      maxParticipants: participantLimit,
      mode: "custom",
      joinMode: "password",
      password,
    });

    return {
      session: this._toClientSession(session, true),
      password,
      link: session.link,
    };
  }

  createDirectPrivateSession({ requesterUserId, targetUserId }) {
    if (!requesterUserId || !targetUserId) {
      throw createError("Invalid private request payload.", "INVALID_PRIVATE_REQUEST");
    }

    const session = this._buildPrivateSession({
      creatorUserId: requesterUserId,
      durationMinutes: DIRECT_PRIVATE_DURATION_MINUTES,
      maxParticipants: DIRECT_PRIVATE_PARTICIPANT_LIMIT,
      mode: "direct",
      joinMode: "consent",
      password: null,
    });

    session.allowedUsers = new Set([requesterUserId, targetUserId]);

    return {
      session: this._toClientSession(session, false),
      link: session.link,
      password: null,
    };
  }

  updateSessionDuration({ sessionId, actorUserId, durationMinutes }) {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw createError("Session not found.", "SESSION_NOT_FOUND");
    }

    if (session.persistent) {
      throw createError("General session cannot be updated.", "FORBIDDEN");
    }

    if (session.creatorUserId !== actorUserId) {
      throw createError("Only the session creator can update duration.", "FORBIDDEN");
    }

    const duration = validateDurationMinutes(durationMinutes);
    const nextExpiresAt = new Date(Date.now() + duration * 60 * 1000).toISOString();

    session.durationMinutes = duration;
    session.expiresAt = nextExpiresAt;

    this._scheduleDurationExpiry(sessionId, duration * 60 * 1000);

    return this._toClientSession(session, false);
  }

  joinSession({ sessionId, socketId, userId, password }) {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw createError("Session not found.", "SESSION_NOT_FOUND");
    }

    if (!socketId || !userId) {
      throw createError("Invalid join payload.", "INVALID_JOIN_PAYLOAD");
    }

    if (!session.persistent && session.allowedUsers && !session.allowedUsers.has(userId)) {
      throw createError("This direct private session is restricted.", "FORBIDDEN");
    }

    if (session.joinMode === "password") {
      if (!password || session.password !== password) {
        throw createError("Wrong password.", "WRONG_PASSWORD");
      }
    }

    const currentParticipants = uniqueUserList(session.participants);

    if (!session.participants.has(socketId) && session.maxParticipants && currentParticipants.length >= session.maxParticipants) {
      throw createError("Session is full.", "SESSION_FULL");
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

    if (session.type === "private" && uniqueUserList(session.participants).length === 0) {
      this._scheduleEmptyExpiry(sessionId);
    }

    return {
      userId: existingUser,
      session: this._toClientSession(session, false),
    };
  }

  removeUserFromSession(sessionId, targetUserId) {
    const session = this.sessions.get(sessionId);

    if (!session || !targetUserId) {
      return [];
    }

    const removed = [];

    for (const [socketId, participantUserId] of Array.from(session.participants.entries())) {
      if (participantUserId !== targetUserId) {
        continue;
      }

      session.participants.delete(socketId);
      removed.push({
        sessionId,
        socketId,
        userId: targetUserId,
      });
    }

    if (session.type === "private" && uniqueUserList(session.participants).length === 0) {
      this._scheduleEmptyExpiry(sessionId);
    }

    return removed;
  }

  kickParticipant({ sessionId, actorUserId, targetUserId }) {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw createError("Session not found.", "SESSION_NOT_FOUND");
    }

    if (session.persistent) {
      throw createError("Cannot kick users from general session.", "FORBIDDEN");
    }

    if (session.creatorUserId !== actorUserId) {
      throw createError("Only the creator can kick participants.", "FORBIDDEN");
    }

    if (actorUserId === targetUserId) {
      throw createError("Creator cannot kick self.", "FORBIDDEN");
    }

    const removedParticipants = this.removeUserFromSession(sessionId, targetUserId);

    if (removedParticipants.length === 0) {
      throw createError("Participant not found in this session.", "PARTICIPANT_NOT_FOUND");
    }

    return removedParticipants;
  }

  getParticipantSnapshot(sessionId) {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return {
        participantCount: 0,
        participants: [],
      };
    }

    const participants = uniqueUserList(session.participants);

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

  isCreator(sessionId, userId) {
    const session = this.sessions.get(sessionId);
    return Boolean(session && !session.persistent && session.creatorUserId === userId);
  }

  removeUserParticipations(userId, { skipCreatorOwnedSessions = false } = {}) {
    if (!userId) {
      return [];
    }

    const removedParticipants = [];

    for (const session of this.sessions.values()) {
      if (skipCreatorOwnedSessions && session.creatorUserId === userId) {
        continue;
      }

      const removedFromSession = this.removeUserFromSession(session.id, userId);

      if (removedFromSession.length > 0) {
        removedParticipants.push(...removedFromSession);
      }
    }

    return removedParticipants;
  }

  expireSessionsByCreator(creatorUserId, reason = "creator-reset") {
    const expiredPayloads = [];

    for (const session of Array.from(this.sessions.values())) {
      if (session.persistent) {
        continue;
      }

      if (session.creatorUserId !== creatorUserId) {
        continue;
      }

      const payload = this.expireSession(session.id, reason);

      if (payload) {
        expiredPayloads.push(payload);
      }
    }

    return expiredPayloads;
  }

  getSessionsList({ userId } = {}) {
    const sessions = Array.from(this.sessions.values())
      .filter((session) => {
        if (session.persistent) {
          return true;
        }

        if (!userId) {
          return false;
        }

        if (session.creatorUserId === userId) {
          return true;
        }

        return uniqueUserList(session.participants).includes(userId);
      })
      .map((session) => this._toClientSession(session, false));

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
      creatorUserId: session.creatorUserId,
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
  DIRECT_PRIVATE_DURATION_MINUTES,
  GENERAL_SESSION_ID,
  SessionManager,
  createSessionError: createError,
};
