(() => {
  let socket = null;
  let activeSocketUrl = "";

  const eventHandlers = new Map();
  const managerHandlers = new Map();

  function applyRegisteredHandlers() {
    if (!socket) {
      return;
    }

    eventHandlers.forEach((handlers, eventName) => {
      handlers.forEach((handler) => {
        socket.on(eventName, handler);
      });
    });

    managerHandlers.forEach((handlers, eventName) => {
      handlers.forEach((handler) => {
        socket.io.on(eventName, handler);
      });
    });
  }

  function normalizeSocketUrl(input) {
    const raw = String(input || "").trim();

    if (!raw) {
      return "";
    }

    return raw.replace(/\/+$/, "");
  }

  function resolveSocketUrl() {
    const fromWindowConfig =
      window.SECURECHAT_CONFIG && window.SECURECHAT_CONFIG.SOCKET_URL
        ? normalizeSocketUrl(window.SECURECHAT_CONFIG.SOCKET_URL)
        : "";

    if (fromWindowConfig) {
      return fromWindowConfig;
    }

    return normalizeSocketUrl(window.location.origin);
  }

  function addHandler(store, eventName, handler, binder) {
    if (!store.has(eventName)) {
      store.set(eventName, new Set());
    }

    const handlers = store.get(eventName);

    if (handlers.has(handler)) {
      return;
    }

    handlers.add(handler);

    if (socket) {
      binder(eventName, handler);
    }
  }

  function removeHandler(store, eventName, handler, unbinder) {
    const handlers = store.get(eventName);

    if (!handlers) {
      return;
    }

    handlers.delete(handler);

    if (handlers.size === 0) {
      store.delete(eventName);
    }

    if (socket) {
      unbinder(eventName, handler);
    }
  }

  function connect(userId) {
    if (socket) {
      return socket;
    }

    activeSocketUrl = resolveSocketUrl();

    socket = io(activeSocketUrl, {
      path: "/socket.io",
      auth: {
        userId,
      },
      transports: ["websocket", "polling"],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 600,
      reconnectionDelayMax: 5000,
      timeout: 8000,
    });

    applyRegisteredHandlers();

    return socket;
  }

  function emit(eventName, payload = {}) {
    if (!socket) {
      return;
    }

    socket.emit(eventName, payload);
  }

  function disconnect() {
    if (!socket) {
      return;
    }

    socket.disconnect();
    socket = null;
  }

  function setSocketUrl(url) {
    const normalized = normalizeSocketUrl(url);

    if (!normalized) {
      return;
    }

    activeSocketUrl = normalized;

    if (socket) {
      socket.disconnect();
      socket = null;
    }
  }

  function getSocketUrl() {
    return activeSocketUrl || resolveSocketUrl();
  }

  window.SecureChatSocket = {
    connect,
    disconnect,
    emit,
    getSocket: () => socket,
    getSocketUrl,
    off: (eventName, handler) => {
      removeHandler(eventHandlers, eventName, handler, (evt, fn) => socket.off(evt, fn));
    },
    offManager: (eventName, handler) => {
      removeHandler(managerHandlers, eventName, handler, (evt, fn) => socket.io.off(evt, fn));
    },
    on: (eventName, handler) => {
      addHandler(eventHandlers, eventName, handler, (evt, fn) => socket.on(evt, fn));
    },
    onManager: (eventName, handler) => {
      addHandler(managerHandlers, eventName, handler, (evt, fn) => socket.io.on(evt, fn));
    },
    setSocketUrl,
  };
})();
