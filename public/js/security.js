(() => {
  function normalizeKey(event) {
    return String(event.key || "").toUpperCase();
  }

  function isMac() {
    return navigator.platform.toUpperCase().includes("MAC");
  }

  function isAllowedCopyTarget(target) {
    if (!target || typeof target.closest !== "function") {
      return false;
    }

    return Boolean(target.closest("[data-allow-copy='true']"));
  }

  function shouldBlockShortcut(event) {
    const key = normalizeKey(event);
    const ctrlOrMeta = isMac() ? event.metaKey : event.ctrlKey;

    if (key === "F12") {
      return true;
    }

    if (key === "PRINTSCREEN") {
      return true;
    }

    if (ctrlOrMeta && key === "C") {
      if (isAllowedCopyTarget(event.target)) {
        return false;
      }

      return true;
    }

    if (ctrlOrMeta && key === "P") {
      return true;
    }

    if (ctrlOrMeta && key === "U") {
      return true;
    }

    if ((event.ctrlKey || event.metaKey) && event.shiftKey && ["I", "J", "C"].includes(key)) {
      return true;
    }

    return false;
  }

  function init(options = {}) {
    const notify = typeof options.notify === "function" ? options.notify : () => {};

    document.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      notify("Right click is disabled.");
    });

    document.addEventListener("copy", (event) => {
      if (isAllowedCopyTarget(event.target)) {
        return;
      }

      event.preventDefault();
      notify("Copy is disabled.");
    });

    document.addEventListener("keydown", (event) => {
      if (!shouldBlockShortcut(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (normalizeKey(event) === "PRINTSCREEN") {
        document.body.classList.add("privacy-shield");
        setTimeout(() => {
          document.body.classList.remove("privacy-shield");
        }, 300);

        notify("PrintScreen detected and blocked.");
        return;
      }

      if ((isMac() ? event.metaKey : event.ctrlKey) && normalizeKey(event) === "P") {
        notify("Printing is disabled.");
        return;
      }

      notify("Restricted shortcut blocked.");
    });

    window.addEventListener("beforeprint", (event) => {
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }

      notify("Printing is disabled.");
    });
  }

  window.SecureChatSecurity = {
    init,
  };
})();
