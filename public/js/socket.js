(() => {
  let socket = null;
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

    socket = io({
      auth: {
        userId,
      },
      transports: ["websocket", "polling"],
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

  window.SecureChatSocket = {
    connect,
    disconnect,
    emit,
    getSocket: () => socket,
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
  };
})();
