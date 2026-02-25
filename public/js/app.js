(() => {
  const IDENTITY_STORAGE_KEY = "securechat_identity_v2";
  const SESSION_KEYS_STORAGE_KEY = "securechat_session_keys_v2";
  const REQUEST_TIMEOUT_MS = 12000;

  const state = {
    credentials: {
      userId: "",
      password: "",
    },
    currentSessionId: "general",
    currentSession: null,
    isConnected: false,
    requestTimeoutId: null,
    sessionsById: new Map(),
    privateSessionPasswords: new Map(),
    sessionKeys: new Map(),
    pendingDirectRequestKeys: new Map(),
    pendingCreatedSessionKey: "",
    pendingJoinFromUrl: null,
  };

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
    window.SecureChatUI.updateBoot("Verification de securite...", 0);
    await animateProgress(0, 50, 2000, 10, "Simulation reCAPTCHA");
    await animateProgress(50, 100, 2000, 10, "Initialisation chiffrement");
    window.SecureChatUI.hideBoot();
  }

  function saveIdentityToStorage() {
    try {
      window.localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(state.credentials));
    } catch (_error) {
      // Ignore storage failures.
    }
  }

  function loadIdentityFromStorage() {
    try {
      const raw = window.localStorage.getItem(IDENTITY_STORAGE_KEY);

      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);

      state.credentials.userId = typeof parsed.userId === "string" ? parsed.userId : "";
      state.credentials.password = typeof parsed.password === "string" ? parsed.password : "";
    } catch (_error) {
      state.credentials.userId = "";
      state.credentials.password = "";
    }
  }

  function saveSessionKeys() {
    try {
      const serializable = Object.fromEntries(state.sessionKeys.entries());
      window.localStorage.setItem(SESSION_KEYS_STORAGE_KEY, JSON.stringify(serializable));
    } catch (_error) {
      // Ignore storage failures.
    }
  }

  function loadSessionKeys() {
    try {
      const raw = window.localStorage.getItem(SESSION_KEYS_STORAGE_KEY);

      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);

      Object.entries(parsed).forEach(([sessionId, keyMaterial]) => {
        if (!sessionId || typeof keyMaterial !== "string" || !keyMaterial.trim()) {
          return;
        }

        state.sessionKeys.set(sessionId, keyMaterial.trim());
      });
    } catch (_error) {
      // Ignore invalid storage payloads.
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

  function ensureSocketConnected(actionLabel) {
    const socket = window.SecureChatSocket.getSocket();

    if (socket && socket.connected) {
      return true;
    }

    finishRequest();
    window.SecureChatUI.showToast(
      `${actionLabel} impossible: connexion Socket indisponible (${window.SecureChatSocket.getSocketUrl()}).`,
      "error",
      5000
    );
    return false;
  }

  function parseAutoJoinFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const sessionId = String(params.get("session") || "").replace(/[^a-zA-Z0-9_-]/g, "");
    const password = String(params.get("password") || "").trim();
    const hash = window.location.hash ? window.location.hash.slice(1) : "";
    const hashParams = new URLSearchParams(hash);
    const keyFromHash = String(hashParams.get("k") || hashParams.get("key") || "").trim();

    if (!sessionId || sessionId === "general") {
      return;
    }

    state.pendingJoinFromUrl = {
      sessionId,
      password,
      keyMaterial: keyFromHash,
    };

    window.SecureChatUI.prefillJoinSession(sessionId, password, keyFromHash);
  }

  function updateEncryptionBadge() {
    const session = state.sessionsById.get(state.currentSessionId) || state.currentSession;

    if (!session || session.type !== "private") {
      window.SecureChatUI.setEncryptionStatus(false, "Session publique");
      return;
    }

    if (state.sessionKeys.has(session.id)) {
      window.SecureChatUI.setEncryptionStatus(true, "E2EE active");
      return;
    }

    window.SecureChatUI.setEncryptionStatus(false, "Cle E2EE manquante");
  }

  function updateParticipantManager(participants = []) {
    const session = state.sessionsById.get(state.currentSessionId) || state.currentSession;

    window.SecureChatUI.renderParticipantManager({
      session,
      currentUserId: state.credentials.userId,
      participants,
    });
  }

  function setSessionKey(sessionId, keyMaterial, persist = true) {
    if (!sessionId || !keyMaterial) {
      return;
    }

    state.sessionKeys.set(sessionId, keyMaterial);

    if (persist) {
      saveSessionKeys();
    }

    updateEncryptionBadge();
  }

  function removeSessionKey(sessionId) {
    if (!sessionId) {
      return;
    }

    state.sessionKeys.delete(sessionId);
    saveSessionKeys();
    updateEncryptionBadge();
  }

  function bytesToBase64(bytes) {
    let binary = "";

    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });

    return window.btoa(binary);
  }

  function base64ToBytes(base64Value) {
    const binary = window.atob(base64Value);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  }

  function generateSessionKeyMaterial() {
    const raw = new Uint8Array(32);
    window.crypto.getRandomValues(raw);
    return bytesToBase64(raw);
  }

  async function importSessionKey(keyMaterial) {
    const raw = base64ToBytes(keyMaterial);

    return window.crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }

  async function encryptForSession(plainText, keyMaterial) {
    const iv = new Uint8Array(12);
    window.crypto.getRandomValues(iv);

    const key = await importSessionKey(keyMaterial);
    const encoded = new TextEncoder().encode(plainText);
    const encryptedBuffer = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

    return {
      content: bytesToBase64(new Uint8Array(encryptedBuffer)),
      iv: bytesToBase64(iv),
    };
  }

  async function decryptForSession(cipherText, iv, keyMaterial) {
    const key = await importSessionKey(keyMaterial);
    const encryptedBytes = base64ToBytes(cipherText);
    const ivBytes = base64ToBytes(iv);

    const plainBuffer = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: ivBytes,
      },
      key,
      encryptedBytes
    );

    return new TextDecoder().decode(plainBuffer);
  }

  async function decodeMessageForRender(message) {
    if (!message || !message.encrypted) {
      return message;
    }

    const keyMaterial = state.sessionKeys.get(message.sessionId);

    if (!keyMaterial) {
      return {
        ...message,
        content: "[Message chiffre - cle requise]",
      };
    }

    try {
      const content = await decryptForSession(message.content, message.iv, keyMaterial);
      return {
        ...message,
        content,
      };
    } catch (_error) {
      return {
        ...message,
        content: "[Impossible de dechiffrer]",
      };
    }
  }

  async function joinPublicSession(sessionId) {
    if (!ensureSocketConnected("Join session")) {
      return;
    }

    window.SecureChatUI.setLoading(true);
    startRequestTimeout("Join session");

    window.SecureChatSocket.emit("join-session", {
      sessionId,
    });
  }

  async function joinPrivateSession(sessionId, password, keyMaterial = "") {
    if (!ensureSocketConnected("Join private session")) {
      return;
    }

    const normalizedKey = String(keyMaterial || "").trim();

    if (normalizedKey) {
      setSessionKey(sessionId, normalizedKey);
    }

    if (password) {
      state.privateSessionPasswords.set(sessionId, password);
    }

    window.SecureChatUI.setLoading(true);
    startRequestTimeout("Join private session");

    window.SecureChatSocket.emit("join-private-session", {
      sessionId,
      password,
    });
  }

  async function joinSessionFromState() {
    if (state.pendingJoinFromUrl) {
      const payload = state.pendingJoinFromUrl;
      state.pendingJoinFromUrl = null;

      if (payload.password) {
        await joinPrivateSession(payload.sessionId, payload.password, payload.keyMaterial);
      } else {
        await joinPublicSession(payload.sessionId);
      }
      return;
    }

    if (state.currentSessionId === "general") {
      await joinPublicSession("general");
      return;
    }

    const privatePassword = state.privateSessionPasswords.get(state.currentSessionId);

    if (privatePassword) {
      await joinPrivateSession(state.currentSessionId, privatePassword);
      return;
    }

    await joinPublicSession(state.currentSessionId);
  }

  async function sendCurrentMessage() {
    const input = document.getElementById("messageInput");

    if (!input) {
      return;
    }

    const plainContent = input.value.trim();

    if (!plainContent) {
      return;
    }

    if (!ensureSocketConnected("Envoi message")) {
      return;
    }

    const session = state.sessionsById.get(state.currentSessionId) || state.currentSession;

    if (session && session.type === "private") {
      const keyMaterial = state.sessionKeys.get(state.currentSessionId);

      if (!keyMaterial) {
        window.SecureChatUI.showToast("Cle E2EE manquante pour cette session privee.", "error");
        return;
      }

      const encrypted = await encryptForSession(plainContent, keyMaterial);

      window.SecureChatSocket.emit("send-message", {
        sessionId: state.currentSessionId,
        content: encrypted.content,
        encrypted: true,
        iv: encrypted.iv,
      });
    } else {
      window.SecureChatSocket.emit("send-message", {
        sessionId: state.currentSessionId,
        content: plainContent,
        encrypted: false,
      });
    }

    input.value = "";
    input.focus();
  }

  function bindMessageForm() {
    const form = document.getElementById("messageForm");

    if (!form) {
      return;
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await sendCurrentMessage();
    });
  }

  function bindMessageActions() {
    window.SecureChatUI.setMessageActionHandler(async ({ action, message }) => {
      if (!message) {
        return;
      }

      const session = state.sessionsById.get(state.currentSessionId) || state.currentSession;

      if (action === "edit") {
        const editedContent = window.prompt("Modifier le message", message.content);

        if (!editedContent || !editedContent.trim()) {
          return;
        }

        if (session && session.type === "private") {
          const keyMaterial = state.sessionKeys.get(state.currentSessionId);

          if (!keyMaterial) {
            window.SecureChatUI.showToast("Cle E2EE manquante pour cette session privee.", "error");
            return;
          }

          const encrypted = await encryptForSession(editedContent.trim(), keyMaterial);

          window.SecureChatSocket.emit("edit-message", {
            sessionId: state.currentSessionId,
            messageId: message.id,
            content: encrypted.content,
            encrypted: true,
            iv: encrypted.iv,
          });
          return;
        }

        window.SecureChatSocket.emit("edit-message", {
          sessionId: state.currentSessionId,
          messageId: message.id,
          content: editedContent.trim(),
          encrypted: false,
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
        });
      }
    });
  }

  function bindUserClickAction() {
    window.SecureChatUI.setUserIdClickHandler((targetUserId) => {
      if (state.currentSessionId !== "general") {
        return;
      }

      if (!targetUserId || targetUserId === state.credentials.userId) {
        return;
      }

      if (!ensureSocketConnected("Demande session privee")) {
        return;
      }

      const keyMaterial = generateSessionKeyMaterial();

      window.SecureChatSocket.emit("request-private-session", {
        targetUserId,
        keyMaterial,
      });

      state.pendingDirectRequestKeys.set(targetUserId, keyMaterial);
      window.SecureChatUI.showToast(`Demande envoyee a ${targetUserId}.`, "info");
    });
  }

  function bindParticipantKick() {
    window.SecureChatUI.setParticipantKickHandler((payload = {}) => {
      if (!payload.sessionId || !payload.targetUserId) {
        return;
      }

      window.SecureChatSocket.emit("kick-participant", {
        sessionId: payload.sessionId,
        targetUserId: payload.targetUserId,
      });
    });
  }

  function bindPanicReset() {
    window.SecureChatUI.setPanicResetHandler(() => {
      const confirmed = window.confirm(
        "Panic reset: supprimer votre identite, vos sessions creees et vos messages. Continuer ?"
      );

      if (!confirmed) {
        return;
      }

      window.SecureChatSocket.emit("panic-reset");
    });
  }

  function updateSessionCache(sessionList) {
    state.sessionsById.clear();

    sessionList.forEach((session) => {
      if (!session || !session.id) {
        return;
      }

      state.sessionsById.set(session.id, session);
    });

    state.currentSession = state.sessionsById.get(state.currentSessionId) || null;
    updateEncryptionBadge();
  }

  function clearModalById(id) {
    const modal = document.getElementById(id);

    if (modal) {
      window.SecureChatUI.closeModal(modal);
    }
  }

  function bindSocketEvents() {
    window.SecureChatSocket.on("connect", async () => {
      state.isConnected = true;
      window.SecureChatUI.showToast("Connecte.", "success");
      window.SecureChatSocket.emit("get-sessions");
      await joinSessionFromState();
    });

    window.SecureChatSocket.on("disconnect", () => {
      state.isConnected = false;
      finishRequest();
      window.SecureChatUI.showToast("Deconnecte. Reconnexion...", "warning");
    });

    window.SecureChatSocket.on("connect_error", (error) => {
      state.isConnected = false;
      finishRequest();

      const detail = error && error.message ? ` (${error.message})` : "";
      window.SecureChatUI.showToast(
        `Connexion Socket impossible vers ${window.SecureChatSocket.getSocketUrl()}${detail}`,
        "error",
        7000
      );
    });

    window.SecureChatSocket.on("identity-assigned", (payload = {}) => {
      if (!payload.userId || !payload.password) {
        return;
      }

      state.credentials.userId = payload.userId;
      state.credentials.password = payload.password;
      saveIdentityToStorage();
      window.SecureChatUI.setIdentity(state.credentials.userId, state.credentials.password);

      if (payload.reason && payload.reason !== "restored") {
        const attemptsInfo =
          typeof payload.attemptsRemaining === "number"
            ? ` Tentatives restantes: ${payload.attemptsRemaining}.`
            : "";

        window.SecureChatUI.showToast(`Nouvelle identite attribuee (${payload.reason}).${attemptsInfo}`, "warning", 5000);
      }
    });

    window.SecureChatSocket.on("sessions-list", (sessions = []) => {
      const list = Array.isArray(sessions) ? sessions : [];

      updateSessionCache(list);
      window.SecureChatSessions.setSessions(list);

      if (!state.sessionsById.has(state.currentSessionId)) {
        state.currentSessionId = "general";
        state.currentSession = state.sessionsById.get("general") || null;
      }

      updateEncryptionBadge();
    });

    window.SecureChatSocket.on("session-created-success", (payload = {}) => {
      if (!payload.session || !payload.session.id) {
        return;
      }

      const sessionId = payload.session.id;

      if (payload.password) {
        state.privateSessionPasswords.set(sessionId, payload.password);
      }

      const keyMaterial = state.pendingCreatedSessionKey || generateSessionKeyMaterial();
      state.pendingCreatedSessionKey = "";
      setSessionKey(sessionId, keyMaterial);

      const invitationLink = `${window.location.origin}/?session=${encodeURIComponent(sessionId)}&password=${encodeURIComponent(
        payload.password || ""
      )}#k=${encodeURIComponent(keyMaterial)}`;

      clearModalById("createSessionModal");

      window.SecureChatUI.showSessionShare({
        sessionId,
        password: payload.password || "",
        e2eeKey: keyMaterial,
        link: invitationLink,
      });

      window.SecureChatUI.showToast(`Session privee creee: ${sessionId}`, "success", 5000);
    });

    window.SecureChatSocket.on("join-session-success", async (payload = {}) => {
      const session = payload.session;

      if (!session || !session.id) {
        finishRequest();
        return;
      }

      state.currentSessionId = session.id;
      state.currentSession = session;

      window.SecureChatSessions.setCurrentSession(session.id);

      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const decodedMessages = await Promise.all(messages.map((message) => decodeMessageForRender(message)));

      window.SecureChatUI.renderMessages(decodedMessages, state.credentials.userId, state.currentSessionId);

      finishRequest();
      clearModalById("joinSessionModal");
      clearModalById("createSessionModal");

      updateEncryptionBadge();
      updateParticipantManager(Array.isArray(session.participants) ? session.participants : []);

      window.SecureChatUI.showToast(`Session rejointe: #${session.id}`, "success");
    });

    window.SecureChatSocket.on("load-messages", async (payload = {}) => {
      if (payload.sessionId !== state.currentSessionId) {
        return;
      }

      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const decodedMessages = await Promise.all(messages.map((message) => decodeMessageForRender(message)));

      window.SecureChatUI.renderMessages(decodedMessages, state.credentials.userId, state.currentSessionId);
      finishRequest();
    });

    window.SecureChatSocket.on("participants-updated", (payload = {}) => {
      if (!payload.sessionId) {
        return;
      }

      window.SecureChatSessions.updateParticipantCount(payload.sessionId, payload.participantCount || 0);

      if (payload.sessionId === state.currentSessionId) {
        updateParticipantManager(Array.isArray(payload.participants) ? payload.participants : []);
      }
    });

    window.SecureChatSocket.on("message-received", async (message = {}) => {
      if (message.sessionId !== state.currentSessionId) {
        return;
      }

      const decoded = await decodeMessageForRender(message);
      window.SecureChatUI.appendMessage(decoded, state.credentials.userId, state.currentSessionId);
    });

    window.SecureChatSocket.on("message-edited", async (message = {}) => {
      if (message.sessionId !== state.currentSessionId) {
        return;
      }

      const decoded = await decodeMessageForRender(message);
      window.SecureChatUI.updateMessage(decoded, state.credentials.userId, state.currentSessionId);
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

      window.SecureChatUI.addSystemMessage(`${payload.userId} a rejoint la session.`);
    });

    window.SecureChatSocket.on("user-left", (payload = {}) => {
      if (payload.sessionId !== state.currentSessionId) {
        return;
      }

      const reasonLabel = payload.reason ? ` (${payload.reason})` : "";
      window.SecureChatUI.addSystemMessage(`${payload.userId} a quitte la session${reasonLabel}.`);
    });

    window.SecureChatSocket.on("participant-kicked", (payload = {}) => {
      if (payload.sessionId !== state.currentSessionId) {
        return;
      }

      window.SecureChatUI.showToast("Vous avez ete ejecte de la session privee.", "warning");
      state.currentSessionId = "general";
      joinPublicSession("general");
    });

    window.SecureChatSocket.on("session-key-shared", (payload = {}) => {
      if (!payload.sessionId || !payload.keyMaterial) {
        return;
      }

      setSessionKey(payload.sessionId, payload.keyMaterial);
      window.SecureChatUI.showToast(`Cle E2EE recue pour ${payload.sessionId}.`, "success", 5000);
    });

    window.SecureChatSocket.on("private-session-request", (payload = {}) => {
      const requestId = payload.requestId;
      const fromUserId = payload.fromUserId;

      if (!requestId || !fromUserId) {
        return;
      }

      const accepted = window.confirm(`${fromUserId} souhaite ouvrir une session privee (1h, 2 participants). Accepter ?`);

      window.SecureChatSocket.emit("respond-private-session-request", {
        requestId,
        accepted,
      });
    });

    window.SecureChatSocket.on("private-session-request-sent", (payload = {}) => {
      if (!payload.requestId || !payload.targetUserId) {
        return;
      }

      const keyMaterial = state.pendingDirectRequestKeys.get(payload.targetUserId) || "";

      if (keyMaterial) {
        state.pendingDirectRequestKeys.delete(payload.targetUserId);
        state.pendingDirectRequestKeys.set(payload.requestId, keyMaterial);
      }
    });

    window.SecureChatSocket.on("private-session-request-response", (payload = {}) => {
      const requestId = payload.requestId;

      if (!requestId) {
        return;
      }

      if (payload.accepted && payload.sessionId) {
        const keyMaterial = state.pendingDirectRequestKeys.get(requestId);

        if (keyMaterial) {
          setSessionKey(payload.sessionId, keyMaterial);
          state.pendingDirectRequestKeys.delete(requestId);
        }

        window.SecureChatUI.showToast("Session privee directe acceptee.", "success");
        return;
      }

      state.pendingDirectRequestKeys.delete(requestId);

      if (payload.reason === "expired") {
        window.SecureChatUI.showToast("Demande privee expiree.", "warning");
        return;
      }

      if (payload.reason === "declined") {
        window.SecureChatUI.showToast("Demande privee refusee.", "warning");
        return;
      }

      if (payload.reason === "request-cancelled") {
        window.SecureChatUI.showToast("Demande privee annulee.", "warning");
      }
    });

    window.SecureChatSocket.on("private-session-request-error", (payload = {}) => {
      window.SecureChatUI.showToast(payload.message || "Demande privee impossible.", "error");
    });

    window.SecureChatSocket.on("session-updated", (payload = {}) => {
      if (!payload.session || !payload.session.id) {
        return;
      }

      state.sessionsById.set(payload.session.id, payload.session);

      if (payload.session.id === state.currentSessionId) {
        state.currentSession = payload.session;
      }

      window.SecureChatUI.showToast("Duree de session mise a jour.", "success");
    });

    window.SecureChatSocket.on("session-expired", (payload = {}) => {
      const sessionId = payload.sessionId;

      if (!sessionId) {
        return;
      }

      state.privateSessionPasswords.delete(sessionId);
      removeSessionKey(sessionId);
      window.SecureChatUI.showToast(`Session expiree: ${sessionId}`, "warning");

      if (state.currentSessionId === sessionId) {
        state.currentSessionId = "general";
        joinPublicSession("general");
      }
    });

    window.SecureChatSocket.on("session-full", (payload = {}) => {
      finishRequest();
      window.SecureChatUI.showToast(payload.message || "Session complete.", "error");
    });

    window.SecureChatSocket.on("join-session-error", (payload = {}) => {
      finishRequest();
      window.SecureChatUI.showToast(payload.message || "Impossible de rejoindre la session.", "error");
    });

    window.SecureChatSocket.on("panic-reset-complete", (payload = {}) => {
      state.privateSessionPasswords.clear();
      state.sessionKeys.clear();
      saveSessionKeys();
      state.currentSessionId = "general";
      state.currentSession = null;
      window.SecureChatUI.clearMessages();
      window.SecureChatUI.showToast(
        `Panic reset effectue. ${payload.deletedMessages || 0} messages supprimes.`,
        "success",
        6000
      );
    });

    window.SecureChatSocket.on("identity-invalidated", (payload = {}) => {
      try {
        window.localStorage.removeItem(IDENTITY_STORAGE_KEY);
        window.localStorage.removeItem(SESSION_KEYS_STORAGE_KEY);
      } catch (_error) {
        // Ignore storage failures.
      }

      const reason = payload.reason ? ` (${payload.reason})` : "";
      window.SecureChatUI.showToast(`Identite invalidee${reason}. Rechargement...`, "warning", 2500);

      setTimeout(() => {
        window.location.reload();
      }, 1200);
    });

    window.SecureChatSocket.on("error", (payload = {}) => {
      finishRequest();
      window.SecureChatUI.showToast(payload.message || "Erreur inattendue.", "error");
    });
  }

  async function init() {
    window.SecureChatUI.init();

    loadIdentityFromStorage();
    loadSessionKeys();
    parseAutoJoinFromUrl();

    window.SecureChatUI.setIdentity(state.credentials.userId || "--", state.credentials.password || "--");

    window.SecureChatSecurity.init({
      notify: (message) => window.SecureChatUI.showToast(message, "warning", 1500),
    });

    bindMessageForm();
    bindMessageActions();
    bindUserClickAction();
    bindParticipantKick();
    bindPanicReset();

    window.SecureChatSessions.init({
      notify: (message, type) => window.SecureChatUI.showToast(message, type || "info"),
      onCreatePrivateSession: ({ durationMinutes, maxParticipants }) => {
        if (!ensureSocketConnected("Creation session privee")) {
          return;
        }

        state.pendingCreatedSessionKey = generateSessionKeyMaterial();

        window.SecureChatUI.setLoading(true);
        startRequestTimeout("Create private session");

        window.SecureChatSocket.emit("create-private-session", {
          durationMinutes,
          maxParticipants,
        });
      },
      onJoinPrivateSession: ({ sessionId, password, keyMaterial }) => {
        joinPrivateSession(sessionId, password, keyMaterial || "");
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
        });

        state.currentSessionId = "general";
        joinPublicSession("general");
      },
      onRequestSessions: () => {
        window.SecureChatSocket.emit("get-sessions");
      },
      onUpdateSessionDuration: ({ sessionId, durationMinutes }) => {
        if (!ensureSocketConnected("Update session")) {
          return;
        }

        window.SecureChatSocket.emit("update-session-duration", {
          sessionId,
          durationMinutes,
        });
      },
    });

    await runBootSequence();

    bindSocketEvents();
    window.SecureChatSocket.connect({
      userId: state.credentials.userId,
      password: state.credentials.password,
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    init();
  });
})();
