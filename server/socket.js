const { v4: uuidv4 } = require("uuid");

const { MAX_MESSAGES_PER_SESSION, MessageManager } = require("./messageManager");
const {
  clearSessionMessages,
  deleteMessage: deleteMessageInStore,
  deleteMessagesByUser: deleteMessagesByUserInStore,
  editMessage: editMessageInStore,
  getStatus: getFirebaseStatus,
  loadRecentMessages,
  saveMessage,
} = require("./firebase");
const { GENERAL_SESSION_ID, SessionManager } = require("./sessionManager");
const { generateIdentityPassword, generateUserId, normalizeUserId, sanitizeText } = require("./utils");

const MAX_AUTH_FAILURES = 3;
const DIRECT_REQUEST_TTL_MS = 45 * 1000;
const MAX_KEY_MATERIAL_LENGTH = 8192;

function toErrorPayload(error, fallbackCode = "UNKNOWN_ERROR") {
  return {
    code: error && error.code ? error.code : fallbackCode,
    message: error && error.message ? error.message : "Unexpected error.",
  };
}

function normalizeSessionId(value) {
  const cleaned = sanitizeText(value, 80);
  return cleaned ? cleaned.replace(/[^a-zA-Z0-9_-]/g, "") : "";
}

function normalizeMessageId(value) {
  const cleaned = sanitizeText(value, 64);
  return cleaned ? cleaned.replace(/[^a-zA-Z0-9-]/g, "") : "";
}

function normalizePassword(value) {
  return sanitizeText(value, 128);
}

function normalizeKeyMaterial(value) {
  const key = String(value || "").trim();

  if (!key) {
    return "";
  }

  return key.slice(0, MAX_KEY_MATERIAL_LENGTH);
}

function initializeSocket(io, { sessionLinkBase = "" } = {}) {
  const messageManager = new MessageManager();
  const identities = new Map();
  const userSockets = new Map();
  const pendingDirectRequests = new Map();

  const firebaseStatus = getFirebaseStatus();

  if (firebaseStatus.enabled && !firebaseStatus.ready && firebaseStatus.error) {
    // eslint-disable-next-line no-console
    console.warn(`[Firebase] Disabled due to configuration/init error: ${firebaseStatus.error.message}`);
  } else if (firebaseStatus.enabled && firebaseStatus.ready) {
    // eslint-disable-next-line no-console
    console.log("[Firebase] Firestore persistence enabled.");
  }

  const persistWithLog = async (operation, contextLabel) => {
    try {
      return await operation();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[Firebase] ${contextLabel} failed:`, error.message);
      return null;
    }
  };

  const getOnlineSocketIds = (userId) => Array.from(userSockets.get(userId) || []);

  const emitToUser = (userId, eventName, payload = {}) => {
    getOnlineSocketIds(userId).forEach((socketId) => {
      const targetSocket = io.sockets.sockets.get(socketId);

      if (targetSocket) {
        targetSocket.emit(eventName, payload);
      }
    });
  };

  const isUserOnline = (userId) => getOnlineSocketIds(userId).length > 0;

  const ensureIdentityRecord = (userId) => {
    const existing = identities.get(userId);

    if (existing) {
      return existing;
    }

    return null;
  };

  const issueIdentity = (reason = "issued") => {
    let userId = generateUserId();

    while (identities.has(userId)) {
      userId = generateUserId();
    }

    const identity = {
      userId,
      password: generateIdentityPassword(),
      failedAttempts: 0,
      createdSessionIds: new Set(),
      createdAt: new Date().toISOString(),
    };

    identities.set(userId, identity);

    return {
      identity,
      reason,
    };
  };

  const identityPayload = ({ identity, reason, attemptsRemaining = MAX_AUTH_FAILURES, previousUserId = "" }) => ({
    userId: identity.userId,
    password: identity.password,
    reason,
    attemptsRemaining,
    previousUserId,
  });

  const trackCreatedSession = (userId, sessionId) => {
    const identity = ensureIdentityRecord(userId);

    if (identity) {
      identity.createdSessionIds.add(sessionId);
    }
  };

  const untrackCreatedSession = (userId, sessionId) => {
    const identity = ensureIdentityRecord(userId);

    if (identity) {
      identity.createdSessionIds.delete(sessionId);
    }
  };

  const emitSessionsListToSocket = (socket) => {
    if (!socket || !socket.data || !socket.data.userId) {
      return;
    }

    socket.emit(
      "sessions-list",
      sessionManager.getSessionsList({
        userId: socket.data.userId,
      })
    );
  };

  const emitSessionsListToAll = () => {
    io.sockets.sockets.forEach((socket) => {
      emitSessionsListToSocket(socket);
    });
  };

  const hydrateSessionMessages = async (sessionId) => {
    if (messageManager.getMessages(sessionId).length > 0) {
      return;
    }

    const persistedMessages = await loadRecentMessages(sessionId, MAX_MESSAGES_PER_SESSION);

    if (persistedMessages.length > 0) {
      messageManager.setMessages(sessionId, persistedMessages);
    }
  };

  const emitParticipantsUpdated = (sessionId) => {
    const snapshot = sessionManager.getParticipantSnapshot(sessionId);
    const session = sessionManager.getSession(sessionId);

    io.to(sessionId).emit("participants-updated", {
      sessionId,
      participantCount: snapshot.participantCount,
      participants: snapshot.participants,
      creatorUserId: session ? session.creatorUserId : null,
    });
  };

  const sessionManager = new SessionManager({
    sessionLinkBase,
    onSessionExpired: ({ sessionId, reason, participants, creatorUserId }) => {
      io.to(sessionId).emit("session-expired", { sessionId, reason });
      io.in(sessionId).socketsLeave(sessionId);

      participants.forEach(({ socketId }) => {
        const socket = io.sockets.sockets.get(socketId);

        if (socket && socket.data && socket.data.joinedSessions) {
          socket.data.joinedSessions.delete(sessionId);
        }
      });

      messageManager.clearSession(sessionId);
      persistWithLog(() => clearSessionMessages(sessionId), `clearSessionMessages(${sessionId})`);

      if (creatorUserId) {
        untrackCreatedSession(creatorUserId, sessionId);
      }

      emitSessionsListToAll();
    },
  });

  const leaveSessionInternal = (socket, sessionId, reason = "left") => {
    const normalizedSessionId = normalizeSessionId(sessionId);

    if (!normalizedSessionId) {
      return;
    }

    const userId = sessionManager.getParticipantUserId(normalizedSessionId, socket.id);

    if (!userId) {
      return;
    }

    socket.to(normalizedSessionId).emit("user-left", {
      sessionId: normalizedSessionId,
      userId,
      reason,
    });

    sessionManager.leaveSession({
      sessionId: normalizedSessionId,
      socketId: socket.id,
    });

    socket.leave(normalizedSessionId);
    socket.data.joinedSessions.delete(normalizedSessionId);

    emitParticipantsUpdated(normalizedSessionId);
    emitSessionsListToAll();
  };

  const removeParticipantSocketsFromSession = (sessionId, removedParticipants, reason = "removed") => {
    removedParticipants.forEach(({ socketId, userId }) => {
      const targetSocket = io.sockets.sockets.get(socketId);

      if (targetSocket) {
        targetSocket.leave(sessionId);

        if (targetSocket.data && targetSocket.data.joinedSessions) {
          targetSocket.data.joinedSessions.delete(sessionId);
        }

        if (reason === "kicked") {
          targetSocket.emit("participant-kicked", {
            sessionId,
            byUserId: null,
          });
        }
      }

      io.to(sessionId).emit("user-left", {
        sessionId,
        userId,
        reason,
      });
    });

    emitParticipantsUpdated(sessionId);
  };

  const purgeUserData = async ({ userId, reason = "identity-reset", keepSocketId = "" }) => {
    const onlineSocketIds = getOnlineSocketIds(userId);

    const expiredSessions = sessionManager.expireSessionsByCreator(userId, reason);

    const removedParticipants = sessionManager.removeUserParticipations(userId, {
      skipCreatorOwnedSessions: true,
    });

    const touchedSessionIds = new Set();

    removedParticipants.forEach(({ sessionId, socketId }) => {
      touchedSessionIds.add(sessionId);
      const targetSocket = io.sockets.sockets.get(socketId);

      if (targetSocket) {
        targetSocket.leave(sessionId);

        if (targetSocket.data && targetSocket.data.joinedSessions) {
          targetSocket.data.joinedSessions.delete(sessionId);
        }
      }

      io.to(sessionId).emit("user-left", {
        sessionId,
        userId,
        reason,
      });
    });

    touchedSessionIds.forEach((sessionId) => {
      emitParticipantsUpdated(sessionId);
    });

    const removedMessages = messageManager.removeMessagesByUser(userId);

    removedMessages.forEach((message) => {
      io.to(message.sessionId).emit("message-deleted", {
        sessionId: message.sessionId,
        messageId: message.id,
        userId: message.userId,
        reason,
      });
    });

    const deletedMessages = await persistWithLog(
      () => deleteMessagesByUserInStore(userId),
      `deleteMessagesByUser(${userId})`
    );

    onlineSocketIds.forEach((socketId) => {
      if (keepSocketId && socketId === keepSocketId) {
        return;
      }

      const targetSocket = io.sockets.sockets.get(socketId);

      if (!targetSocket) {
        return;
      }

      targetSocket.emit("identity-invalidated", {
        reason,
      });
      targetSocket.disconnect(true);
    });

    identities.delete(userId);
    userSockets.delete(userId);

    emitSessionsListToAll();

    return {
      expiredSessionCount: expiredSessions.length,
      removedParticipationCount: removedParticipants.length,
      deletedMessages: typeof deletedMessages === "number" ? deletedMessages : removedMessages.length,
    };
  };

  const authenticateSocket = async (socket) => {
    const requestedUserId = normalizeUserId(socket.handshake.auth && socket.handshake.auth.userId);
    const requestedPassword = normalizePassword(socket.handshake.auth && socket.handshake.auth.password);

    if (requestedUserId) {
      const identity = ensureIdentityRecord(requestedUserId);

      if (identity) {
        if (requestedPassword && requestedPassword === identity.password) {
          identity.failedAttempts = 0;

          return {
            identity,
            reason: "restored",
            attemptsRemaining: MAX_AUTH_FAILURES,
            previousUserId: requestedUserId,
          };
        }

        identity.failedAttempts += 1;
        const attemptsRemaining = Math.max(0, MAX_AUTH_FAILURES - identity.failedAttempts);

        if (identity.failedAttempts >= MAX_AUTH_FAILURES) {
          await purgeUserData({
            userId: requestedUserId,
            reason: "auth-lockout",
          });

          const issued = issueIdentity("auth-lockout-reset");

          return {
            identity: issued.identity,
            reason: issued.reason,
            attemptsRemaining,
            previousUserId: requestedUserId,
          };
        }

        const issued = issueIdentity("wrong-password");

        return {
          identity: issued.identity,
          reason: issued.reason,
          attemptsRemaining,
          previousUserId: requestedUserId,
        };
      }

      const issued = issueIdentity("missing-identity");

      return {
        identity: issued.identity,
        reason: issued.reason,
        attemptsRemaining: MAX_AUTH_FAILURES,
        previousUserId: requestedUserId,
      };
    }

    const issued = issueIdentity("first-connection");

    return {
      identity: issued.identity,
      reason: issued.reason,
      attemptsRemaining: MAX_AUTH_FAILURES,
      previousUserId: "",
    };
  };

  const addSocketForUser = (socket, userId) => {
    socket.data.userId = userId;

    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }

    userSockets.get(userId).add(socket.id);
  };

  const removeSocketForUser = (socket) => {
    const userId = socket.data.userId;

    if (!userId || !userSockets.has(userId)) {
      return;
    }

    const set = userSockets.get(userId);
    set.delete(socket.id);

    if (set.size === 0) {
      userSockets.delete(userId);
    }
  };

  const clearDirectRequest = (requestId) => {
    const request = pendingDirectRequests.get(requestId);

    if (!request) {
      return null;
    }

    clearTimeout(request.timeoutId);
    pendingDirectRequests.delete(requestId);

    return request;
  };

  const cancelDirectRequestsBySocket = (socket) => {
    const socketUserId = socket.data.userId;

    for (const request of Array.from(pendingDirectRequests.values())) {
      if (request.fromSocketId !== socket.id && request.toUserId !== socketUserId) {
        continue;
      }

      clearDirectRequest(request.id);

      emitToUser(request.fromUserId, "private-session-request-response", {
        requestId: request.id,
        accepted: false,
        reason: "request-cancelled",
      });

      emitToUser(request.toUserId, "private-session-request-response", {
        requestId: request.id,
        accepted: false,
        reason: "request-cancelled",
      });
    }
  };

  const joinSessionInternal = async (socket, payload = {}) => {
    const sessionId = normalizeSessionId(payload.sessionId || GENERAL_SESSION_ID);
    const password = normalizePassword(payload.password || "");

    if (!sessionId) {
      socket.emit("join-session-error", {
        sessionId: "",
        code: "INVALID_SESSION",
        message: "Session ID is required.",
      });
      return;
    }

    try {
      sessionManager.joinSession({
        sessionId,
        socketId: socket.id,
        userId: socket.data.userId,
        password,
      });

      await hydrateSessionMessages(sessionId);

      socket.join(sessionId);
      socket.data.joinedSessions.add(sessionId);

      const joinedSession = sessionManager.getSession(sessionId);
      const sessionMessages = messageManager.getMessages(sessionId);

      socket.emit("join-session-success", {
        session: joinedSession,
        messages: sessionMessages,
      });

      socket.emit("load-messages", {
        sessionId,
        messages: sessionMessages,
      });

      socket.to(sessionId).emit("user-joined", {
        sessionId,
        userId: socket.data.userId,
      });

      emitParticipantsUpdated(sessionId);
      emitSessionsListToAll();
    } catch (error) {
      const payloadError = {
        sessionId,
        ...toErrorPayload(error, "JOIN_FAILED"),
      };

      if (payloadError.code === "SESSION_FULL") {
        socket.emit("session-full", payloadError);
      }

      socket.emit("join-session-error", payloadError);
    }
  };

  io.on("connection", async (socket) => {
    socket.data.joinedSessions = new Set();

    const auth = await authenticateSocket(socket);

    addSocketForUser(socket, auth.identity.userId);

    socket.emit("identity-assigned", identityPayload(auth));
    emitSessionsListToSocket(socket);

    socket.on("create-private-session", async (payload = {}) => {
      try {
        const created = sessionManager.createCustomPrivateSession({
          durationMinutes: payload.durationMinutes,
          maxParticipants: payload.maxParticipants,
          creatorUserId: socket.data.userId,
        });

        trackCreatedSession(socket.data.userId, created.session.id);

        socket.emit("session-created-success", {
          session: created.session,
          link: created.link,
          password: created.password,
        });

        await joinSessionInternal(socket, {
          sessionId: created.session.id,
          password: created.password,
        });
      } catch (error) {
        socket.emit("error", toErrorPayload(error, "CREATE_SESSION_FAILED"));
      }
    });

    socket.on("request-private-session", (payload = {}) => {
      const fromUserId = socket.data.userId;
      const targetUserId = normalizeUserId(payload.targetUserId);
      const keyMaterial = normalizeKeyMaterial(payload.keyMaterial);

      if (!targetUserId || targetUserId === fromUserId) {
        socket.emit("private-session-request-error", {
          code: "INVALID_TARGET",
          message: "Select a valid user.",
        });
        return;
      }

      if (!isUserOnline(targetUserId)) {
        socket.emit("private-session-request-error", {
          code: "TARGET_NOT_FOUND",
          message: "Cet utilisateur n'existe plus",
        });
        return;
      }

      const requestId = uuidv4();

      const timeoutId = setTimeout(() => {
        const request = clearDirectRequest(requestId);

        if (!request) {
          return;
        }

        emitToUser(request.fromUserId, "private-session-request-response", {
          requestId,
          accepted: false,
          reason: "expired",
        });

        emitToUser(request.toUserId, "private-session-request-response", {
          requestId,
          accepted: false,
          reason: "expired",
        });
      }, DIRECT_REQUEST_TTL_MS);

      if (typeof timeoutId.unref === "function") {
        timeoutId.unref();
      }

      pendingDirectRequests.set(requestId, {
        id: requestId,
        fromUserId,
        toUserId: targetUserId,
        fromSocketId: socket.id,
        keyMaterial,
        timeoutId,
      });

      emitToUser(targetUserId, "private-session-request", {
        requestId,
        fromUserId,
        ttlMs: DIRECT_REQUEST_TTL_MS,
      });

      socket.emit("private-session-request-sent", {
        requestId,
        targetUserId,
      });
    });

    socket.on("respond-private-session-request", async (payload = {}) => {
      const requestId = sanitizeText(payload.requestId || "", 128);
      const accepted = Boolean(payload.accepted);
      const responderUserId = socket.data.userId;

      const request = pendingDirectRequests.get(requestId);

      if (!request || request.toUserId !== responderUserId) {
        socket.emit("private-session-request-error", {
          code: "REQUEST_NOT_FOUND",
          message: "Private request not found or expired.",
        });
        return;
      }

      clearDirectRequest(requestId);

      if (!accepted) {
        emitToUser(request.fromUserId, "private-session-request-response", {
          requestId,
          accepted: false,
          reason: "declined",
        });

        emitToUser(request.toUserId, "private-session-request-response", {
          requestId,
          accepted: false,
          reason: "declined",
        });
        return;
      }

      try {
        const created = sessionManager.createDirectPrivateSession({
          requesterUserId: request.fromUserId,
          targetUserId: request.toUserId,
        });

        trackCreatedSession(request.fromUserId, created.session.id);

        const requesterSocket = io.sockets.sockets.get(request.fromSocketId);

        if (!requesterSocket) {
          throw Object.assign(new Error("Request initiator disconnected."), {
            code: "REQUESTER_OFFLINE",
          });
        }

        await joinSessionInternal(requesterSocket, {
          sessionId: created.session.id,
        });

        await joinSessionInternal(socket, {
          sessionId: created.session.id,
        });

        if (request.keyMaterial) {
          emitToUser(request.fromUserId, "session-key-shared", {
            sessionId: created.session.id,
            keyMaterial: request.keyMaterial,
          });

          emitToUser(request.toUserId, "session-key-shared", {
            sessionId: created.session.id,
            keyMaterial: request.keyMaterial,
          });
        }

        emitToUser(request.fromUserId, "private-session-request-response", {
          requestId,
          accepted: true,
          sessionId: created.session.id,
        });

        emitToUser(request.toUserId, "private-session-request-response", {
          requestId,
          accepted: true,
          sessionId: created.session.id,
        });
      } catch (error) {
        socket.emit("error", toErrorPayload(error, "DIRECT_SESSION_CREATE_FAILED"));
      }
    });

    socket.on("join-session", async (payload = {}) => {
      await joinSessionInternal(socket, payload);
    });

    socket.on("join-private-session", async (payload = {}) => {
      await joinSessionInternal(socket, payload);
    });

    socket.on("leave-session", (payload = {}) => {
      leaveSessionInternal(socket, payload.sessionId, "left");
    });

    socket.on("get-sessions", () => {
      emitSessionsListToSocket(socket);
    });

    socket.on("update-session-duration", (payload = {}) => {
      try {
        const sessionId = normalizeSessionId(payload.sessionId);

        if (!sessionId) {
          throw Object.assign(new Error("Session ID is required."), {
            code: "INVALID_SESSION",
          });
        }

        const updatedSession = sessionManager.updateSessionDuration({
          sessionId,
          actorUserId: socket.data.userId,
          durationMinutes: payload.durationMinutes,
        });

        io.to(sessionId).emit("session-updated", {
          session: updatedSession,
        });

        emitSessionsListToAll();
      } catch (error) {
        socket.emit("error", toErrorPayload(error, "UPDATE_SESSION_DURATION_FAILED"));
      }
    });

    socket.on("kick-participant", (payload = {}) => {
      try {
        const sessionId = normalizeSessionId(payload.sessionId);
        const targetUserId = normalizeUserId(payload.targetUserId);

        if (!sessionId || !targetUserId) {
          throw Object.assign(new Error("Session ID and target user are required."), {
            code: "INVALID_KICK_PAYLOAD",
          });
        }

        const removedParticipants = sessionManager.kickParticipant({
          sessionId,
          actorUserId: socket.data.userId,
          targetUserId,
        });

        removedParticipants.forEach(({ socketId, userId }) => {
          const participantSocket = io.sockets.sockets.get(socketId);

          if (participantSocket) {
            participantSocket.leave(sessionId);

            if (participantSocket.data && participantSocket.data.joinedSessions) {
              participantSocket.data.joinedSessions.delete(sessionId);
            }

            participantSocket.emit("participant-kicked", {
              sessionId,
              byUserId: socket.data.userId,
            });
          }

          io.to(sessionId).emit("user-left", {
            sessionId,
            userId,
            reason: "kicked",
          });
        });

        emitParticipantsUpdated(sessionId);
        emitSessionsListToAll();
      } catch (error) {
        socket.emit("error", toErrorPayload(error, "KICK_PARTICIPANT_FAILED"));
      }
    });

    socket.on("panic-reset", async () => {
      try {
        const oldUserId = socket.data.userId;

        const cleanup = await purgeUserData({
          userId: oldUserId,
          reason: "panic-reset",
          keepSocketId: socket.id,
        });

        const issued = issueIdentity("panic-reset");

        socket.data.joinedSessions.forEach((sessionId) => {
          socket.leave(sessionId);
        });

        socket.data.joinedSessions.clear();

        addSocketForUser(socket, issued.identity.userId);

        socket.emit("identity-assigned", identityPayload({
          identity: issued.identity,
          reason: issued.reason,
          previousUserId: oldUserId,
          attemptsRemaining: MAX_AUTH_FAILURES,
        }));

        socket.emit("panic-reset-complete", {
          oldUserId,
          newUserId: issued.identity.userId,
          deletedMessages: cleanup.deletedMessages,
          expiredSessionCount: cleanup.expiredSessionCount,
        });

        emitSessionsListToSocket(socket);
        await joinSessionInternal(socket, {
          sessionId: GENERAL_SESSION_ID,
        });
      } catch (error) {
        socket.emit("error", toErrorPayload(error, "PANIC_RESET_FAILED"));
      }
    });

    socket.on("send-message", async (payload = {}) => {
      try {
        const sessionId = normalizeSessionId(payload.sessionId);

        if (!sessionId || !socket.data.joinedSessions.has(sessionId)) {
          throw Object.assign(new Error("Join the session first."), {
            code: "NOT_IN_SESSION",
          });
        }

        const message = messageManager.addMessage({
          sessionId,
          userId: socket.data.userId,
          content: payload.content,
          encrypted: Boolean(payload.encrypted),
          iv: payload.iv,
        });

        io.to(sessionId).emit("message-received", message);

        await persistWithLog(() => saveMessage(message), `saveMessage(${message.id})`);
      } catch (error) {
        socket.emit("error", toErrorPayload(error, "SEND_MESSAGE_FAILED"));
      }
    });

    socket.on("edit-message", async (payload = {}) => {
      try {
        const sessionId = normalizeSessionId(payload.sessionId);
        const messageId = normalizeMessageId(payload.messageId);

        if (!sessionId || !messageId) {
          throw Object.assign(new Error("Invalid edit payload."), {
            code: "INVALID_EDIT_PAYLOAD",
          });
        }

        if (!socket.data.joinedSessions.has(sessionId)) {
          throw Object.assign(new Error("Join the session first."), {
            code: "NOT_IN_SESSION",
          });
        }

        const updatedMessage = messageManager.editMessage({
          sessionId,
          messageId,
          userId: socket.data.userId,
          content: payload.content,
          encrypted: Boolean(payload.encrypted),
          iv: payload.iv,
        });

        io.to(sessionId).emit("message-edited", updatedMessage);

        await persistWithLog(() => editMessageInStore(updatedMessage), `editMessage(${updatedMessage.id})`);
      } catch (error) {
        socket.emit("error", toErrorPayload(error, "EDIT_MESSAGE_FAILED"));
      }
    });

    socket.on("delete-message", async (payload = {}) => {
      try {
        const sessionId = normalizeSessionId(payload.sessionId);
        const messageId = normalizeMessageId(payload.messageId);

        if (!sessionId || !messageId) {
          throw Object.assign(new Error("Invalid delete payload."), {
            code: "INVALID_DELETE_PAYLOAD",
          });
        }

        if (!socket.data.joinedSessions.has(sessionId)) {
          throw Object.assign(new Error("Join the session first."), {
            code: "NOT_IN_SESSION",
          });
        }

        const deletedMessage = messageManager.deleteMessage({
          sessionId,
          messageId,
          userId: socket.data.userId,
        });

        io.to(sessionId).emit("message-deleted", {
          sessionId,
          messageId: deletedMessage.id,
          userId: deletedMessage.userId,
        });

        await persistWithLog(
          () => deleteMessageInStore(deletedMessage.sessionId, deletedMessage.id),
          `deleteMessage(${deletedMessage.id})`
        );
      } catch (error) {
        socket.emit("error", toErrorPayload(error, "DELETE_MESSAGE_FAILED"));
      }
    });

    socket.on("disconnect", () => {
      cancelDirectRequestsBySocket(socket);

      for (const sessionId of Array.from(socket.data.joinedSessions)) {
        leaveSessionInternal(socket, sessionId, "disconnect");
      }

      removeSocketForUser(socket);
    });
  });

  // Optional extension placeholder: End-to-end key ratchet with Double Ratchet.
  // Optional extension placeholder: Firebase room/session persistence layer.
  // Optional extension placeholder: WebRTC media calls over private sessions.
  // Optional extension placeholder: Push notifications with service workers.

  return {
    messageManager,
    sessionManager,
  };
}

module.exports = {
  initializeSocket,
};
