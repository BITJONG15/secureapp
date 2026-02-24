(() => {
  const state = {
    sessions: [],
    currentSessionId: "general",
  };

  const callbacks = {
    createPrivateSession: null,
    joinPrivateSession: null,
    joinSession: null,
    leaveSession: null,
    requestSessions: null,
    notify: null,
  };

  function normalizeSessionId(value) {
    if (!value) {
      return "";
    }

    const trimmed = String(value).trim();
    const queryString = trimmed.includes("?") ? trimmed.split("?")[1] : trimmed;
    const fromQuery = trimmed.includes("session=") ? new URLSearchParams(queryString).get("session") : trimmed;
    return String(fromQuery || "").replace(/[^a-zA-Z0-9_-]/g, "");
  }

  function getSessionById(sessionId) {
    return state.sessions.find((session) => session.id === sessionId) || null;
  }

  function renderSessions() {
    window.SecureChatUI.renderSessions(state.sessions, state.currentSessionId);
  }

  function setCurrentSession(sessionId) {
    state.currentSessionId = sessionId || "general";

    const target = getSessionById(state.currentSessionId);
    const count = target ? target.participantCount : 0;

    window.SecureChatUI.setSessionHeader(state.currentSessionId, count);
    renderSessions();
    window.SecureChatUI.setSidebarOpen(false);
  }

  function setSessions(sessions) {
    state.sessions = Array.isArray(sessions) ? sessions : [];

    if (!getSessionById(state.currentSessionId)) {
      state.currentSessionId = "general";
    }

    const target = getSessionById(state.currentSessionId);
    const count = target ? target.participantCount : 0;

    window.SecureChatUI.setSessionHeader(state.currentSessionId, count);
    renderSessions();
  }

  function updateParticipantCount(sessionId, participantCount) {
    const target = getSessionById(sessionId);

    if (target) {
      target.participantCount = participantCount;
    }

    if (sessionId === state.currentSessionId) {
      window.SecureChatUI.setSessionHeader(sessionId, participantCount);
    }

    renderSessions();
  }

  function bindSessionListClicks() {
    const list = document.getElementById("sessionsList");

    if (!list) {
      return;
    }

    list.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-session-id]");

      if (!target) {
        return;
      }

      const sessionId = normalizeSessionId(target.dataset.sessionId);
      const sessionType = target.dataset.sessionType;

      if (!sessionId) {
        return;
      }

      if (sessionType === "private") {
        window.SecureChatUI.prefillJoinSession(sessionId);
        window.SecureChatUI.openModal(document.getElementById("joinSessionModal"));
        return;
      }

      if (typeof callbacks.joinSession === "function") {
        callbacks.joinSession({ sessionId });
      }
    });
  }

  function bindCreateSessionForm() {
    const form = document.getElementById("createSessionForm");
    const openButton = document.getElementById("openCreateModalBtn");
    const closeButton = document.getElementById("closeCreateModalBtn");
    const modal = document.getElementById("createSessionModal");

    if (openButton) {
      openButton.addEventListener("click", () => {
        window.SecureChatUI.openModal(modal);
      });
    }

    if (closeButton) {
      closeButton.addEventListener("click", () => {
        window.SecureChatUI.closeModal(modal);
      });
    }

    if (!form) {
      return;
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();

      const durationInput = document.getElementById("sessionDurationInput");
      const participantsInput = document.getElementById("sessionParticipantsInput");

      const durationMinutes = Number.parseInt(durationInput.value, 10);
      const maxParticipants = Number.parseInt(participantsInput.value, 10);

      if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 1440) {
        callbacks.notify("Duration must be between 5 and 1440 minutes.", "error");
        return;
      }

      if (!Number.isInteger(maxParticipants) || maxParticipants < 2 || maxParticipants > 50) {
        callbacks.notify("Participants must be between 2 and 50.", "error");
        return;
      }

      if (typeof callbacks.createPrivateSession === "function") {
        callbacks.createPrivateSession({
          durationMinutes,
          maxParticipants,
        });
      }
    });
  }

  function bindJoinSessionForm() {
    const form = document.getElementById("joinSessionForm");
    const openButton = document.getElementById("openJoinModalBtn");
    const closeButton = document.getElementById("closeJoinModalBtn");
    const modal = document.getElementById("joinSessionModal");

    if (openButton) {
      openButton.addEventListener("click", () => {
        window.SecureChatUI.openModal(modal);
      });
    }

    if (closeButton) {
      closeButton.addEventListener("click", () => {
        window.SecureChatUI.closeModal(modal);
      });
    }

    if (!form) {
      return;
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();

      const sessionIdInput = document.getElementById("joinSessionIdInput");
      const passwordInput = document.getElementById("joinPasswordInput");

      const sessionId = normalizeSessionId(sessionIdInput.value);
      const password = String(passwordInput.value || "").trim();

      if (!sessionId) {
        callbacks.notify("Session ID is required.", "error");
        return;
      }

      if (!password || password.length !== 8) {
        callbacks.notify("Password must be exactly 8 characters.", "error");
        return;
      }

      if (typeof callbacks.joinPrivateSession === "function") {
        callbacks.joinPrivateSession({ sessionId, password });
      }
    });
  }

  function bindSidebarControls() {
    const openButton = document.getElementById("menuToggleBtn");
    const closeButton = document.getElementById("closeSidebarBtn");
    const sidebar = document.getElementById("sidebar");

    if (openButton) {
      openButton.addEventListener("click", () => {
        window.SecureChatUI.setSidebarOpen(true);
      });
    }

    if (closeButton) {
      closeButton.addEventListener("click", () => {
        window.SecureChatUI.setSidebarOpen(false);
      });
    }

    document.addEventListener("click", (event) => {
      if (window.innerWidth >= 1024) {
        return;
      }

      if (!sidebar || sidebar.classList.contains("mobile-hidden")) {
        return;
      }

      const clickedInsideSidebar = sidebar.contains(event.target);
      const clickedOpenButton = openButton ? openButton.contains(event.target) : false;

      if (clickedInsideSidebar || clickedOpenButton) {
        return;
      }

      window.SecureChatUI.setSidebarOpen(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || window.innerWidth >= 1024) {
        return;
      }

      window.SecureChatUI.setSidebarOpen(false);
    });
  }

  function bindLeaveButton() {
    const leaveButton = document.getElementById("leaveSessionBtn");

    if (!leaveButton) {
      return;
    }

    leaveButton.addEventListener("click", () => {
      if (state.currentSessionId === "general") {
        callbacks.notify("General session is persistent and cannot be left.", "warning");
        return;
      }

      if (typeof callbacks.leaveSession === "function") {
        callbacks.leaveSession({ sessionId: state.currentSessionId });
      }
    });
  }

  function handleAutoJoinFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const sessionParam = normalizeSessionId(params.get("session"));

    if (!sessionParam || sessionParam === "general") {
      return;
    }

    window.SecureChatUI.prefillJoinSession(sessionParam);
    window.SecureChatUI.openModal(document.getElementById("joinSessionModal"));
  }

  function init(config = {}) {
    callbacks.createPrivateSession = config.onCreatePrivateSession;
    callbacks.joinPrivateSession = config.onJoinPrivateSession;
    callbacks.joinSession = config.onJoinSession;
    callbacks.leaveSession = config.onLeaveSession;
    callbacks.requestSessions = config.onRequestSessions;
    callbacks.notify = typeof config.notify === "function" ? config.notify : () => {};

    bindSessionListClicks();
    bindCreateSessionForm();
    bindJoinSessionForm();
    bindSidebarControls();
    bindLeaveButton();

    if (typeof callbacks.requestSessions === "function") {
      callbacks.requestSessions();
    }

    handleAutoJoinFromUrl();
  }

  window.SecureChatSessions = {
    getCurrentSessionId: () => state.currentSessionId,
    init,
    setCurrentSession,
    setSessions,
    updateParticipantCount,
  };
})();
