(() => {
  const MAX_SENDER_CHARS = 8;

  const refs = {};

  const state = {
    messageActionHandler: null,
    deleteConfirmResolver: null,
    sessionShareData: null,
  };

  function cacheRefs() {
    refs.bootOverlay = document.getElementById("bootOverlay");
    refs.bootStatus = document.getElementById("bootStatus");
    refs.bootProgress = document.getElementById("bootProgress");
    refs.bootTimer = document.getElementById("bootTimer");
    refs.userIdDisplay = document.getElementById("userIdDisplay");
    refs.sessionTitle = document.getElementById("sessionTitle");
    refs.participantsInfo = document.getElementById("participantsInfo");
    refs.sessionsList = document.getElementById("sessionsList");
    refs.messagesContainer = document.getElementById("messagesContainer");
    refs.toastContainer = document.getElementById("toastContainer");
    refs.globalLoader = document.getElementById("globalLoader");
    refs.sidebar = document.getElementById("sidebar");

    refs.createSessionModal = document.getElementById("createSessionModal");
    refs.joinSessionModal = document.getElementById("joinSessionModal");
    refs.deleteModal = document.getElementById("deleteModal");
    refs.confirmDeleteBtn = document.getElementById("confirmDeleteBtn");
    refs.cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
    refs.sessionShareModal = document.getElementById("sessionShareModal");
    refs.closeShareModalBtn = document.getElementById("closeShareModalBtn");
    refs.doneShareBtn = document.getElementById("doneShareBtn");
    refs.shareInviteBtn = document.getElementById("shareInviteBtn");
    refs.shareSessionIdInput = document.getElementById("shareSessionIdInput");
    refs.sharePasswordInput = document.getElementById("sharePasswordInput");
    refs.shareLinkInput = document.getElementById("shareLinkInput");
    refs.copySessionIdBtn = document.getElementById("copySessionIdBtn");
    refs.copyPasswordBtn = document.getElementById("copyPasswordBtn");
    refs.copyLinkBtn = document.getElementById("copyLinkBtn");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatTimestamp(timestamp) {
    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
      return "--:--";
    }

    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function truncateSender(userId) {
    if (!userId) {
      return "unknown";
    }

    return userId.length > MAX_SENDER_CHARS ? userId.slice(0, MAX_SENDER_CHARS) : userId;
  }

  function openModal(modalEl) {
    if (!modalEl) {
      return;
    }

    modalEl.classList.remove("hidden");
    modalEl.classList.add("flex");
  }

  function closeModal(modalEl) {
    if (!modalEl) {
      return;
    }

    modalEl.classList.add("hidden");
    modalEl.classList.remove("flex");
  }

  function closeAllModals() {
    [refs.createSessionModal, refs.joinSessionModal, refs.deleteModal, refs.sessionShareModal].forEach((modalEl) => {
      closeModal(modalEl);
    });
  }

  function showToast(message, type = "info", durationMs = 3200) {
    if (!refs.toastContainer) {
      return;
    }

    const toneClass = {
      info: "border-white/20 text-slate-100",
      success: "border-emerald-400/40 text-emerald-100",
      error: "border-rose-400/40 text-rose-100",
      warning: "border-amber-400/40 text-amber-100",
    }[type] || "border-white/20 text-slate-100";

    const toast = document.createElement("div");
    toast.className = `toast glass-panel rounded-xl border px-3 py-2 text-sm ${toneClass}`;
    toast.textContent = message;

    refs.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(10px)";

      setTimeout(() => {
        toast.remove();
      }, 200);
    }, durationMs);
  }

  function setLoading(visible) {
    if (!refs.globalLoader) {
      return;
    }

    if (visible) {
      refs.globalLoader.classList.remove("hidden");
      refs.globalLoader.classList.add("flex");
    } else {
      refs.globalLoader.classList.add("hidden");
      refs.globalLoader.classList.remove("flex");
    }
  }

  function setUserId(userId) {
    if (refs.userIdDisplay) {
      refs.userIdDisplay.textContent = userId;
    }
  }

  function setSessionHeader(sessionId, participantCount = 0) {
    if (refs.sessionTitle) {
      refs.sessionTitle.textContent = `#${sessionId}`;
    }

    if (refs.participantsInfo) {
      const label = participantCount === 1 ? "participant" : "participants";
      refs.participantsInfo.textContent = `${participantCount} ${label}`;
    }
  }

  function renderSessions(sessions, currentSessionId) {
    if (!refs.sessionsList) {
      return;
    }

    refs.sessionsList.innerHTML = "";

    sessions.forEach((session) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.sessionId = session.id;
      button.dataset.sessionType = session.type;
      button.className = `session-item glass-panel w-full rounded-xl border px-3 py-2 text-left text-sm ${
        session.id === currentSessionId ? "active" : ""
      }`;

      const limitLabel = session.maxParticipants ? `${session.participantCount}/${session.maxParticipants}` : `${session.participantCount}`;
      const typeLabel = session.type === "private" ? "private" : "public";

      button.innerHTML = `
        <div class="flex items-center justify-between gap-2">
          <div class="font-mono-ui text-xs text-slate-100">#${escapeHtml(session.id)}</div>
          <span class="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
            session.type === "private" ? "bg-violet-500/20 text-violet-200" : "bg-blue-500/20 text-blue-200"
          }">${typeLabel}</span>
        </div>
        <div class="mt-1 text-xs text-slate-400">${limitLabel} participants</div>
      `;

      refs.sessionsList.appendChild(button);
    });
  }

  function closeAllMessageMenus() {
    const menus = document.querySelectorAll(".menu-pop");

    menus.forEach((menu) => {
      menu.classList.add("hidden");
    });
  }

  function buildMessageElement(message, currentUserId) {
    const isSelf = message.userId === currentUserId;

    const row = document.createElement("div");
    row.className = `message-row flex ${isSelf ? "justify-end" : "justify-start"}`;
    row.dataset.messageId = message.id;

    const bubble = document.createElement("article");
    bubble.className = `message-bubble ${isSelf ? "self" : "other"}`;

    const body = document.createElement("p");
    body.className = "message-content text-sm leading-relaxed";
    body.textContent = message.content;

    const meta = document.createElement("div");
    meta.className = "message-meta mt-2 flex items-center gap-2";
    meta.innerHTML = `
      <span class="font-mono-ui">${escapeHtml(truncateSender(message.userId))}</span>
      <span>${escapeHtml(formatTimestamp(message.timestamp))}</span>
      <span>${message.edited ? "(edited)" : ""}</span>
    `;

    bubble.appendChild(body);
    bubble.appendChild(meta);

    if (isSelf) {
      const menuButton = document.createElement("button");
      menuButton.type = "button";
      menuButton.className = "absolute right-2 top-1 rounded p-1 text-slate-300 hover:bg-white/10";
      menuButton.innerHTML = '<i class="fa-solid fa-ellipsis"></i>';

      const menu = document.createElement("div");
      menu.className = "menu-pop hidden";
      menu.innerHTML = `
        <button type="button" data-action="edit">Edit</button>
        <button type="button" data-action="delete">Delete</button>
      `;

      menuButton.addEventListener("click", (event) => {
        event.stopPropagation();
        closeAllMessageMenus();
        menu.classList.toggle("hidden");
      });

      menu.querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", () => {
          menu.classList.add("hidden");

          if (state.messageActionHandler) {
            state.messageActionHandler({
              action: button.dataset.action,
              message,
            });
          }
        });
      });

      bubble.appendChild(menuButton);
      bubble.appendChild(menu);
    }

    row.appendChild(bubble);

    return row;
  }

  function renderMessages(messages, currentUserId) {
    if (!refs.messagesContainer) {
      return;
    }

    refs.messagesContainer.innerHTML = "";

    messages.forEach((message) => {
      refs.messagesContainer.appendChild(buildMessageElement(message, currentUserId));
    });

    refs.messagesContainer.scrollTop = refs.messagesContainer.scrollHeight;
  }

  function appendMessage(message, currentUserId) {
    if (!refs.messagesContainer) {
      return;
    }

    const nearBottom =
      refs.messagesContainer.scrollHeight - refs.messagesContainer.scrollTop - refs.messagesContainer.clientHeight < 80;

    refs.messagesContainer.appendChild(buildMessageElement(message, currentUserId));

    if (nearBottom) {
      refs.messagesContainer.scrollTop = refs.messagesContainer.scrollHeight;
    }
  }

  function updateMessage(message, currentUserId) {
    if (!refs.messagesContainer) {
      return;
    }

    const current = refs.messagesContainer.querySelector(`[data-message-id="${message.id}"]`);

    if (!current) {
      appendMessage(message, currentUserId);
      return;
    }

    current.replaceWith(buildMessageElement(message, currentUserId));
  }

  function removeMessage(messageId) {
    if (!refs.messagesContainer) {
      return;
    }

    const current = refs.messagesContainer.querySelector(`[data-message-id="${messageId}"]`);

    if (current) {
      current.remove();
    }
  }

  function addSystemMessage(content) {
    if (!refs.messagesContainer) {
      return;
    }

    const wrapper = document.createElement("p");
    wrapper.className = "system-message";
    wrapper.textContent = content;

    refs.messagesContainer.appendChild(wrapper);
    refs.messagesContainer.scrollTop = refs.messagesContainer.scrollHeight;
  }

  function clearMessages() {
    if (refs.messagesContainer) {
      refs.messagesContainer.innerHTML = "";
    }
  }

  function setSidebarOpen(open) {
    if (!refs.sidebar) {
      return;
    }

    if (open) {
      refs.sidebar.classList.remove("mobile-hidden");
    } else {
      refs.sidebar.classList.add("mobile-hidden");
    }
  }

  function prefillJoinSession(sessionId) {
    const input = document.getElementById("joinSessionIdInput");

    if (input) {
      input.value = sessionId || "";
    }
  }

  function openDeleteConfirm() {
    openModal(refs.deleteModal);

    return new Promise((resolve) => {
      state.deleteConfirmResolver = resolve;
    });
  }

  async function copyToClipboard(text) {
    const value = String(text || "");

    if (!value) {
      return false;
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch (_error) {
        // Ignore and fallback.
      }
    }

    const helper = document.createElement("textarea");
    helper.value = value;
    helper.setAttribute("data-allow-copy", "true");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    helper.style.left = "-9999px";
    document.body.appendChild(helper);
    helper.select();

    let copied = false;

    try {
      copied = document.execCommand("copy");
    } catch (_error) {
      copied = false;
    }

    helper.remove();
    return copied;
  }

  function setupDeleteModalBindings() {
    if (refs.confirmDeleteBtn) {
      refs.confirmDeleteBtn.addEventListener("click", () => {
        closeModal(refs.deleteModal);

        if (state.deleteConfirmResolver) {
          state.deleteConfirmResolver(true);
          state.deleteConfirmResolver = null;
        }
      });
    }

    if (refs.cancelDeleteBtn) {
      refs.cancelDeleteBtn.addEventListener("click", () => {
        closeModal(refs.deleteModal);

        if (state.deleteConfirmResolver) {
          state.deleteConfirmResolver(false);
          state.deleteConfirmResolver = null;
        }
      });
    }
  }

  function setupShareModalBindings() {
    const closeShare = () => {
      closeModal(refs.sessionShareModal);
    };

    if (refs.closeShareModalBtn) {
      refs.closeShareModalBtn.addEventListener("click", closeShare);
    }

    if (refs.doneShareBtn) {
      refs.doneShareBtn.addEventListener("click", closeShare);
    }

    if (refs.copySessionIdBtn) {
      refs.copySessionIdBtn.addEventListener("click", async () => {
        const copied = await copyToClipboard(refs.shareSessionIdInput && refs.shareSessionIdInput.value);
        showToast(copied ? "Session ID copied." : "Unable to copy Session ID.", copied ? "success" : "error");
      });
    }

    if (refs.copyPasswordBtn) {
      refs.copyPasswordBtn.addEventListener("click", async () => {
        const copied = await copyToClipboard(refs.sharePasswordInput && refs.sharePasswordInput.value);
        showToast(copied ? "Password copied." : "Unable to copy password.", copied ? "success" : "error");
      });
    }

    if (refs.copyLinkBtn) {
      refs.copyLinkBtn.addEventListener("click", async () => {
        const copied = await copyToClipboard(refs.shareLinkInput && refs.shareLinkInput.value);
        showToast(copied ? "Invite link copied." : "Unable to copy invite link.", copied ? "success" : "error");
      });
    }

    if (refs.shareInviteBtn) {
      refs.shareInviteBtn.addEventListener("click", async () => {
        const payload = state.sessionShareData;

        if (!payload) {
          showToast("No session data to share.", "error");
          return;
        }

        const shareText = `SecureChat private session\nID: ${payload.sessionId}\nPassword: ${payload.password}\nLink: ${payload.link}`;

        if (navigator.share) {
          try {
            await navigator.share({
              title: "SecureChat Invite",
              text: shareText,
              url: payload.link,
            });
            showToast("Invite shared.", "success");
            return;
          } catch (_error) {
            // Fallback to clipboard.
          }
        }

        const copied = await copyToClipboard(shareText);
        showToast(copied ? "Invite details copied." : "Unable to share invite.", copied ? "success" : "error");
      });
    }
  }

  function setupModalDismissBindings() {
    const modals = [refs.createSessionModal, refs.joinSessionModal, refs.deleteModal, refs.sessionShareModal].filter(Boolean);

    modals.forEach((modalEl) => {
      modalEl.addEventListener("click", (event) => {
        if (event.target !== modalEl) {
          return;
        }

        closeModal(modalEl);

        if (modalEl === refs.deleteModal && state.deleteConfirmResolver) {
          state.deleteConfirmResolver(false);
          state.deleteConfirmResolver = null;
        }
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") {
        return;
      }

      if (refs.deleteModal && !refs.deleteModal.classList.contains("hidden")) {
        closeModal(refs.deleteModal);

        if (state.deleteConfirmResolver) {
          state.deleteConfirmResolver(false);
          state.deleteConfirmResolver = null;
        }

        return;
      }

      if (refs.sessionShareModal && !refs.sessionShareModal.classList.contains("hidden")) {
        closeModal(refs.sessionShareModal);
        return;
      }

      if (refs.joinSessionModal && !refs.joinSessionModal.classList.contains("hidden")) {
        closeModal(refs.joinSessionModal);
        return;
      }

      if (refs.createSessionModal && !refs.createSessionModal.classList.contains("hidden")) {
        closeModal(refs.createSessionModal);
      }
    });
  }

  function showSessionShare(data = {}) {
    const shareData = {
      sessionId: data.sessionId || "",
      password: data.password || "",
      link: data.link || "",
    };

    state.sessionShareData = shareData;

    if (refs.shareSessionIdInput) {
      refs.shareSessionIdInput.value = shareData.sessionId;
    }

    if (refs.sharePasswordInput) {
      refs.sharePasswordInput.value = shareData.password;
    }

    if (refs.shareLinkInput) {
      refs.shareLinkInput.value = shareData.link;
    }

    openModal(refs.sessionShareModal);
  }

  function updateBoot(statusText, percentage) {
    if (refs.bootStatus) {
      refs.bootStatus.textContent = statusText;
    }

    if (refs.bootProgress) {
      refs.bootProgress.style.width = `${percentage}%`;
    }

    if (refs.bootTimer) {
      refs.bootTimer.textContent = `${percentage}%`;
    }
  }

  function hideBoot() {
    if (!refs.bootOverlay) {
      return;
    }

    refs.bootOverlay.classList.add("hidden");
  }

  function init() {
    cacheRefs();
    setupDeleteModalBindings();
    setupShareModalBindings();
    setupModalDismissBindings();

    document.addEventListener("click", () => {
      closeAllMessageMenus();
    });
  }

  window.SecureChatUI = {
    addSystemMessage,
    appendMessage,
    clearMessages,
    closeModal,
    closeAllModals,
    hideBoot,
    init,
    openDeleteConfirm,
    openModal,
    prefillJoinSession,
    removeMessage,
    renderMessages,
    renderSessions,
    setLoading,
    setMessageActionHandler: (handler) => {
      state.messageActionHandler = handler;
    },
    setSessionHeader,
    setSidebarOpen,
    setUserId,
    showSessionShare,
    showToast,
    updateBoot,
    updateMessage,
  };
})();
