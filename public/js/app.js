(() => {
  const USER_STORAGE_KEY = "securechat_last_user_id";
  const REQUEST_TIMEOUT_MS = 12000;

  const state = {
    currentSessionId: "general",
    isConnected: false,
    hasRequestedSocketUrl: false,
    previousUserId: "",
    privateSessionPasswords: new Map(),
    requestTimeoutId: null,
    userId: "",
  };

  function randomAlphanumeric(length) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let output = "";

    for (let i = 0; i < length; i += 1) {
      output += chars[Math.floor(Math.random() * chars.length)];
    }

    return output;
  }

  function generateUserId() {
    return `user_${randomAlphanumeric(5)}`;
  }

  function wait(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  async function animateProgress(from, to, durationMs, steps, label) {
    const stepCount = Math.max(1, steps);
    const stepDelay = durationMs / stepCount;

    for (let step = 1; step <= stepCount; step += 1) {
      await wait(stepDelay);
      const value = Math.round(from + ((to - from) * step) / stepCount);
      window.SecureChatUI.updateBoot(label, value);
    }
  }

  async function runBootSequence() {
    window.SecureChatUI.updateBoot("Running simulated reCAPTCHA verification...", 0);
    await animateProgress(0, 45, 3000, 12, "Running simulated reCAPTCHA verification...");
    await animateProgress(45, 100, 4000, 16, "Running simulated facial recognition...");
    window.SecureChatUI.hideBoot();
  }

  function closeModalById(id) {
    const modal = document.getElementById(id);

    if (modal) {
      window.SecureChatUI.closeModal(modal);
    }
  }

  function clearRequestTimeout() {
    if (state.requestTimeoutId) {
      clearTimeout(state.requestTimeoutId);
      state.requestTimeoutId = null;
    }
  }

  function startRequestTimeout(actionLabel = "Request") {
    clearRequestTimeout();

    state.requestTimeoutId = setTimeout(() => {
      window.SecureChatUI.setLoading(false);
      window.SecureChatUI.showToast(`${actionLabel} timed out. Try again.`, "error");
      state.requestTimeoutId = null;
    }, REQUEST_TIMEOUT_MS);
  }

  function finishRequest() {
    clearRequestTimeout();
    window.SecureChatUI.setLoading(false);
  }

  function requestSessions() {
    window.SecureChatSocket.emit("get-sessions");
  }

  function isSocketConnected() {
    const socket = window.SecureChatSocket.getSocket();
    return Boolean(socket && socket.connected);
  }

  function ensureSocketConnected(actionLabel) {
    if (isSocketConnected()) {
      return true;
    }

    finishRequest();
    window.SecureChatUI.showToast(
      `${actionLabel} impossible: backend Socket indisponible (${window.SecureChatSocket.getSocketUrl()}).`,
      "error",
      5000
    );
    return false;
  }

  function joinPublicSession(sessionId) {
    if (!ensureSocketConnected("Join session")) {
      return;
    }

    window.SecureChatUI.setLoading(true);
    startRequestTimeout("Join session");

    window.SecureChatSocket.emit("join-session", {
      sessionId,
      userId: state.userId,
    });
  }

  function joinPrivateSession(sessionId, password) {
    if (!ensureSocketConnected("Join private session")) {
      return;
    }

    window.SecureChatUI.setLoading(true);
    startRequestTimeout("Join private session");
    state.privateSessionPasswords.set(sessionId, password);

    window.SecureChatSocket.emit("join-private-session", {
      sessionId,
      password,
      userId: state.userId,
    });
  }

  function rejoinCurrentSession() {
    const sessionId = state.currentSessionId || "general";

    if (sessionId === "general") {
      joinPublicSession("general");
      return;
    }

    const privatePassword = state.privateSessionPasswords.get(sessionId);

    if (privatePassword) {
      joinPrivateSession(sessionId, privatePassword);
      return;
    }

    joinPublicSession(sessionId);
  }

  function sendCurrentMessage() {
    const input = document.getElementById("messageInput");

    if (!input) {
      return;
    }

    const content = input.value.trim();

    if (!content) {
      return;
    }

    if (!ensureSocketConnected("Envoi message")) {
      return;
    }

    window.SecureChatSocket.emit("send-message", {
      sessionId: state.currentSessionId,
      content,
      userId: state.userId,
    });

    input.value = "";
    input.focus();
  }

  function bindMessageForm() {
    const form = document.getElementById("messageForm");

    if (!form) {
      return;
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      sendCurrentMessage();
    });
  }

  function bindMessageActions() {
    window.SecureChatUI.setMessageActionHandler(async ({ action, message }) => {
      if (action === "edit") {
        const content = window.prompt("Edit message", message.content);

        if (!content || !content.trim()) {
          return;
        }

        window.SecureChatSocket.emit("edit-message", {
          sessionId: state.currentSessionId,
          messageId: message.id,
          content: content.trim(),
          userId: state.userId,
        });
        return;
      }

      if (action === "delete") {
        const confirmed = await window.SecureChatUI.openDeleteConfirm();

        if (!confirmed) {
          return;
        }

        window.SecureChatSocket.emit("delete-message", {
          sessionId: state.currentSessionId,
          messageId: message.id,
          userId: state.userId,
        });
      }
    });
  }

  function bindSocketEvents() {
    window.SecureChatSocket.on("connect", () => {
      state.isConnected = true;
      window.SecureChatUI.showToast("Connected.", "success");

      if (state.previousUserId) {
        window.SecureChatSocket.emit("rotate-user-identity", {
          oldUserId: state.previousUserId,
          newUserId: state.userId,
        });
        state.previousUserId = "";
      }

      requestSessions();
      rejoinCurrentSession();
    });

    window.SecureChatSocket.on("disconnect", () => {
      state.isConnected = false;
      finishRequest();
      window.SecureChatUI.showToast("Disconnected. Reconnecting...", "warning");
    });

    window.SecureChatSocket.on("connect_error", (error) => {
      state.isConnected = false;
      finishRequest();
      const message = error && error.message ? String(error.message) : "";
      const detail = message ? ` (${message})` : "";
      window.SecureChatUI.showToast(
        `Connexion Socket impossible vers ${window.SecureChatSocket.getSocketUrl()}${detail}`,
        "error",
        7000
      );

      if (message.includes("SOCKET_URL_REQUIRED") && !state.hasRequestedSocketUrl) {
        state.hasRequestedSocketUrl = true;

        const providedUrl = window.prompt(
          "URL du backend Socket.IO requise (ex: https://ton-backend.example.com)",
          ""
        );

        if (providedUrl && providedUrl.trim()) {
          window.SecureChatSocket.setSocketUrl(providedUrl.trim(), true);
          window.SecureChatSocket.connect(state.userId);
          return;
        }

        window.SecureChatUI.showToast(
          "Ajoute ?socketUrl=https://ton-backend.example.com dans l'URL de ton site Netlify.",
          "warning",
          9000
        );
      }
    });

    window.SecureChatSocket.onManager("reconnect", () => {
      window.SecureChatUI.showToast("Socket reconnected.", "success");
    });

    window.SecureChatSocket.on("session-created", () => {
      requestSessions();
    });

    window.SecureChatSocket.on("session-created-success", (payload = {}) => {
      if (payload.session && payload.password) {
        state.privateSessionPasswords.set(payload.session.id, payload.password);
      }

      closeModalById("createSessionModal");

      window.SecureChatUI.showSessionShare({
        sessionId: payload.session && payload.session.id ? payload.session.id : "",
        password: payload.password || "",
        link: payload.link || "",
      });

      window.SecureChatUI.showToast(
        `Private session created: ${payload.session && payload.session.id ? payload.session.id : "unknown"} | password: ${
          payload.password || "unknown"
        }`,
        "success",
        6000
      );

      window.SecureChatUI.addSystemMessage(`Private session link: ${payload.link}`);
      window.SecureChatUI.addSystemMessage(`Private session password: ${payload.password}`);
    });

    window.SecureChatSocket.on("join-session-success", (payload = {}) => {
      const session = payload.session;

      if (!session || !session.id) {
        finishRequest();
        return;
      }

      state.currentSessionId = session.id;
      window.SecureChatSessions.setCurrentSession(session.id);

      if (Array.isArray(payload.messages)) {
        window.SecureChatUI.renderMessages(payload.messages, state.userId);
      } else {
        window.SecureChatUI.clearMessages();
      }

      finishRequest();
      closeModalById("joinSessionModal");
      closeModalById("createSessionModal");
      window.SecureChatUI.showToast(`Joined #${session.id}`, "success");
    });

    window.SecureChatSocket.on("session-full", (payload = {}) => {
      finishRequest();
      window.SecureChatUI.showToast(payload.message || "Session is full.", "error");
    });

    window.SecureChatSocket.on("session-expired", (payload = {}) => {
      const sessionId = payload.sessionId;

      if (!sessionId) {
        return;
      }

      state.privateSessionPasswords.delete(sessionId);
      window.SecureChatUI.showToast(`Session expired: ${sessionId}`, "warning");

      if (state.currentSessionId === sessionId) {
        state.currentSessionId = "general";
        joinPublicSession("general");
      }

      requestSessions();
    });

    window.SecureChatSocket.on("sessions-list", (sessions = []) => {
      const list = Array.isArray(sessions) ? sessions : [];
      window.SecureChatSessions.setSessions(list);
    });

    window.SecureChatSocket.on("participants-updated", (payload = {}) => {
      if (!payload.sessionId) {
        return;
      }

      window.SecureChatSessions.updateParticipantCount(payload.sessionId, payload.participantCount || 0);
    });

    window.SecureChatSocket.on("load-messages", (payload = {}) => {
      if (payload.sessionId !== state.currentSessionId) {
        return;
      }

      window.SecureChatUI.renderMessages(Array.isArray(payload.messages) ? payload.messages : [], state.userId);
      finishRequest();
    });

    window.SecureChatSocket.on("message-received", (message = {}) => {
      if (message.sessionId !== state.currentSessionId) {
        return;
      }

      window.SecureChatUI.appendMessage(message, state.userId);
    });

    window.SecureChatSocket.on("message-edited", (message = {}) => {
      if (message.sessionId !== state.currentSessionId) {
        return;
      }

      window.SecureChatUI.updateMessage(message, state.userId);
    });

    window.SecureChatSocket.on("message-deleted", (payload = {}) => {
      if (payload.sessionId !== state.currentSessionId) {
        return;
      }

      window.SecureChatUI.removeMessage(payload.messageId);
    });

    window.SecureChatSocket.on("user-joined", (payload = {}) => {
      if (payload.sessionId !== state.currentSessionId) {
        return;
      }

      window.SecureChatUI.addSystemMessage(`${payload.userId} joined.`);
    });

    window.SecureChatSocket.on("user-left", (payload = {}) => {
      if (payload.sessionId !== state.currentSessionId) {
        return;
      }

      window.SecureChatUI.addSystemMessage(`${payload.userId} left.`);
    });

    window.SecureChatSocket.on("join-session-error", (payload = {}) => {
      finishRequest();
      window.SecureChatUI.showToast(payload.message || "Join failed.", "error");
    });

    window.SecureChatSocket.on("error", (payload = {}) => {
      finishRequest();
      window.SecureChatUI.showToast(payload.message || "Unexpected error.", "error");
    });

    window.SecureChatSocket.on("identity-rotation-complete", (payload = {}) => {
      if (!payload || !payload.oldUserId) {
        return;
      }

      const deletedCount = Number.parseInt(payload.deletedMessages || 0, 10);
      const totalDeleted = Number.isFinite(deletedCount) ? deletedCount : 0;

      window.SecureChatUI.showToast(
        `New identity active. Previous ID cleaned (${totalDeleted} messages removed).`,
        "info",
        5000
      );

      requestSessions();
    });

    window.SecureChatSocket.on("identity-rotated", () => {
      state.currentSessionId = "general";
      window.SecureChatSessions.setCurrentSession("general");
      window.SecureChatUI.clearMessages();
      window.SecureChatUI.showToast("Your previous identity was rotated and removed.", "warning", 4500);
    });
  }

  async function init() {
    window.SecureChatUI.init();

    const lastKnownUserId = window.localStorage.getItem(USER_STORAGE_KEY) || "";
    state.userId = generateUserId();
    state.previousUserId = lastKnownUserId && lastKnownUserId !== state.userId ? lastKnownUserId : "";
    window.localStorage.setItem(USER_STORAGE_KEY, state.userId);
    window.SecureChatUI.setUserId(state.userId);

    window.SecureChatSecurity.init({
      notify: (message) => window.SecureChatUI.showToast(message, "warning", 1800),
    });

    bindMessageForm();
    bindMessageActions();

    window.SecureChatSessions.init({
      notify: (message, type) => window.SecureChatUI.showToast(message, type || "info"),
      onCreatePrivateSession: ({ durationMinutes, maxParticipants }) => {
        if (!ensureSocketConnected("Création session privée")) {
          return;
        }

        window.SecureChatUI.setLoading(true);
        startRequestTimeout("Create private session");

        window.SecureChatSocket.emit("create-private-session", {
          durationMinutes,
          maxParticipants,
          userId: state.userId,
        });
      },
      onJoinPrivateSession: ({ sessionId, password }) => {
        joinPrivateSession(sessionId, password);
      },
      onJoinSession: ({ sessionId }) => {
        joinPublicSession(sessionId);
      },
      onLeaveSession: ({ sessionId }) => {
        if (!ensureSocketConnected("Leave session")) {
          return;
        }

        window.SecureChatSocket.emit("leave-session", {
          sessionId,
          userId: state.userId,
        });
        state.currentSessionId = "general";
        joinPublicSession("general");
      },
      onRequestSessions: () => {
        requestSessions();
      },
    });

    await runBootSequence();

    bindSocketEvents();
    window.SecureChatSocket.connect(state.userId);
  }

  document.addEventListener("DOMContentLoaded", () => {
    init();
  });
})();
