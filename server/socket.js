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
const { generateUserId, normalizeUserId, sanitizeText } = require("./utils");

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

function initializeSocket(io, { sessionLinkBase = "", sessionSocketUrl = "" } = {}) {
  const messageManager = new MessageManager();
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

  const hydrateSessionMessages = async (sessionId) => {
    if (messageManager.getMessages(sessionId).length > 0) {
      return;
    }

    const persistedMessages = await loadRecentMessages(sessionId, MAX_MESSAGES_PER_SESSION);

    if (persistedMessages.length > 0) {
      messageManager.setMessages(sessionId, persistedMessages);
    }
  };

  const sessionManager = new SessionManager({
    sessionSocketUrl,
    sessionLinkBase,
    onSessionExpired: ({ sessionId, reason, participants }) => {
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

      io.emit("sessions-list", sessionManager.getSessionsList());
    },
  });

  const emitParticipantsUpdated = (sessionId) => {
    const snapshot = sessionManager.getParticipantSnapshot(sessionId);

    io.to(sessionId).emit("participants-updated", {
      sessionId,
      participantCount: snapshot.participantCount,
      participants: snapshot.participants,
    });
  };

  const resolveUserId = (socket, candidate) => {
    const normalized = normalizeUserId(candidate);

    if (normalized) {
      socket.data.userId = normalized;
    }

    if (!socket.data.userId) {
      socket.data.userId = generateUserId();
    }

    return socket.data.userId;
  };

  const joinSessionInternal = async (socket, payload, requirePrivatePassword) => {
    const sessionId = normalizeSessionId(payload.sessionId || GENERAL_SESSION_ID);
    const password = sanitizeText(payload.password || "", 64);
    const userId = resolveUserId(socket, payload.userId);

    if (!sessionId) {
      socket.emit("join-session-error", {
        sessionId: "",
        code: "INVALID_SESSION",
        message: "Session ID is required.",
      });
      return;
    }

    if (requirePrivatePassword && !password) {
      socket.emit("join-session-error", {
        sessionId,
        code: "WRONG_PASSWORD",
        message: "Wrong password.",
      });
      return;
    }

    try {
      sessionManager.joinSession({
        sessionId,
        socketId: socket.id,
        userId,
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
        userId,
      });

      emitParticipantsUpdated(sessionId);
      io.emit("sessions-list", sessionManager.getSessionsList());
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
    io.emit("sessions-list", sessionManager.getSessionsList());
  };

  const rotateUserIdentityInternal = async ({ oldUserId, newUserId, socket }) => {
    if (!oldUserId || !newUserId || oldUserId === newUserId) {
      return {
        deletedMessages: 0,
        affectedSessions: [],
      };
    }

    const removedParticipants = sessionManager.removeUserFromAllSessions(oldUserId);
    const affectedSessions = new Set();

    removedParticipants.forEach(({ sessionId, socketId }) => {
      affectedSessions.add(sessionId);

      const participantSocket = io.sockets.sockets.get(socketId);

      if (participantSocket) {
        participantSocket.leave(sessionId);

        if (participantSocket.data && participantSocket.data.joinedSessions) {
          participantSocket.data.joinedSessions.delete(sessionId);
        }

        if (socket && participantSocket.id !== socket.id) {
          participantSocket.emit("identity-rotated", {
            oldUserId,
            newUserId,
          });
        }
      }

      io.to(sessionId).emit("user-left", {
        sessionId,
        userId: oldUserId,
        reason: "identity-rotated",
      });
    });

    affectedSessions.forEach((sessionId) => {
      emitParticipantsUpdated(sessionId);
    });

    const removedMessages = messageManager.removeMessagesByUser(oldUserId);

    removedMessages.forEach((message) => {
      io.to(message.sessionId).emit("message-deleted", {
        sessionId: message.sessionId,
        messageId: message.id,
        userId: message.userId,
        reason: "identity-rotated",
      });
    });

    const deletedMessages = await persistWithLog(
      () => deleteMessagesByUserInStore(oldUserId),
      `deleteMessagesByUser(${oldUserId})`
    );

    io.emit("sessions-list", sessionManager.getSessionsList());

    return {
      deletedMessages: typeof deletedMessages === "number" ? deletedMessages : removedMessages.length,
      affectedSessions: Array.from(affectedSessions),
    };
  };

  io.on("connection", (socket) => {
    socket.data.userId = resolveUserId(socket, socket.handshake.auth && socket.handshake.auth.userId);
    socket.data.joinedSessions = new Set();

    socket.emit("sessions-list", sessionManager.getSessionsList());

    socket.on("create-private-session", async (payload = {}) => {
      try {
        const userId = resolveUserId(socket, payload.userId);

        const created = sessionManager.createPrivateSession({
          durationMinutes: payload.durationMinutes,
          maxParticipants: payload.maxParticipants,
        });

        socket.emit("session-created-success", {
          session: created.session,
          link: created.link,
          password: created.password,
        });

        io.emit("session-created", {
          session: sessionManager.getSession(created.session.id),
        });

        io.emit("sessions-list", sessionManager.getSessionsList());

        await joinSessionInternal(
          socket,
          {
            sessionId: created.session.id,
            password: created.password,
            userId,
          },
          true
        );
      } catch (error) {
        socket.emit("error", toErrorPayload(error, "CREATE_SESSION_FAILED"));
      }
    });

    socket.on("join-session", async (payload = {}) => {
      await joinSessionInternal(socket, payload, false);
    });

    socket.on("join-private-session", async (payload = {}) => {
      await joinSessionInternal(socket, payload, true);
    });

    socket.on("leave-session", (payload = {}) => {
      leaveSessionInternal(socket, payload.sessionId, "left");
    });

    socket.on("get-sessions", () => {
      socket.emit("sessions-list", sessionManager.getSessionsList());
    });

    socket.on("rotate-user-identity", async (payload = {}) => {
      try {
        const oldUserId = normalizeUserId(payload.oldUserId);
        const newUserId = resolveUserId(socket, payload.newUserId || payload.userId);

        if (!oldUserId || oldUserId === newUserId) {
          socket.emit("identity-rotation-complete", {
            oldUserId,
            newUserId,
            deletedMessages: 0,
            affectedSessions: [],
          });
          return;
        }

        const cleanup = await rotateUserIdentityInternal({
          oldUserId,
          newUserId,
          socket,
        });

        socket.emit("identity-rotation-complete", {
          oldUserId,
          newUserId,
          deletedMessages: cleanup.deletedMessages,
          affectedSessions: cleanup.affectedSessions,
        });
      } catch (error) {
        socket.emit("error", toErrorPayload(error, "IDENTITY_ROTATION_FAILED"));
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

        const userId = resolveUserId(socket, payload.userId);

        const message = messageManager.addMessage({
          sessionId,
          userId,
          content: payload.content,
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
          userId: resolveUserId(socket, payload.userId),
          content: payload.content,
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
          userId: resolveUserId(socket, payload.userId),
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
      for (const sessionId of Array.from(socket.data.joinedSessions)) {
        leaveSessionInternal(socket, sessionId, "disconnect");
      }
    });
  });

  // Optional extension placeholder: E2E encryption key exchange per private session.
  // Optional extension placeholder: attach file metadata and upload flow.
  // Optional extension placeholder: bind WebRTC signaling to Socket.IO rooms.
  // Optional extension placeholder: push notifications via service workers.

  return {
    messageManager,
    sessionManager,
  };
}

module.exports = {
  initializeSocket,
};
