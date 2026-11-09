"use strict";
(() => {
  const tg = window.Telegram?.WebApp;
  const $ = (id) => document.getElementById(id);
  const photoDownloads = new Map();
  let settingsSnapshot = null;
  let settingsPending = null;
  function getSettings(refresh = false) {
    if (!refresh && settingsSnapshot) return Promise.resolve(settingsSnapshot);
    if (!settingsPending)
      settingsPending = request("/api/settings").finally(() => { settingsPending = null; });
    return settingsPending;
  }
  let photoBytes = 0;
  function savedPhoto(id) {
    if (photoDownloads.has(id)) return photoDownloads.get(id).promise;
    const item = { size: 0, promise: null };
    item.promise = request(`/api/entries/${id}/photo`, { blob: true })
      .then((blob) => {
        if (photoDownloads.get(id) === item) {
          item.size = blob.size;
          photoBytes += blob.size;
          for (const [key, value] of photoDownloads) {
            if (photoBytes <= 24 * 1024 * 1024 && photoDownloads.size <= 8) break;
            if (value.size) {
              photoBytes -= value.size;
              photoDownloads.delete(key);
            }
          }
        }
        return blob;
      })
      .catch((error) => {
        if (photoDownloads.get(id) === item) photoDownloads.delete(id);
        throw error;
      });
    photoDownloads.set(id, item);
    return item.promise;
  }
  const state = {
    pendingPage: null,
    conversations: [],
    selected: null,
    entries: [],
    through: 0,
    before: null,
    hasMore: false,
    query: "",
    initialChat: new URLSearchParams(location.search).get("chat"),
    layer: null,
    visible: new Set(),
    acknowledged: new Set(),
  };
  const dateTime = (value, options) =>
    value
      ? new Intl.DateTimeFormat("ru-RU", options).format(
          new Date(Number(value) * 1000),
        )
      : "";
  const time = (value) =>
    dateTime(value, { hour: "2-digit", minute: "2-digit" });
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function button(text, action, className = "text-button") {
    const el = node("button", className, text);
    el.type = "button";
    el.addEventListener("click", action);
    return el;
  }
  async function request(path, { method = "GET", body, blob = false } = {}) {
    const target = new URL(path, location.origin);
    if (
      target.origin !== location.origin ||
      !target.pathname.startsWith("/api/")
    )
      throw new Error("Недопустимый адрес запроса.");
    if (!tg?.initData)
      throw new Error("Откройте архив из личного чата с ботом в Telegram.");
    const response = await fetch(path, {
      method,
      headers: {
        Authorization: `Telegram ${tg.initData}`,
        "ngrok-skip-browser-warning": "true",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok) {
      let data;
      try {
        data = await response.json();
      } catch {}
      throw new Error(
        data?.error ||
          (response.status === 401
            ? "Сеанс истёк. Закройте архив и откройте его из Telegram."
            : "Не удалось выполнить запрос. Повторите попытку."),
      );
    }
    if (method === "DELETE") {
      photoDownloads.clear();
      photoBytes = 0;
    }
    if (blob) return response.blob();
    try {
      const data = await response.json();
      if (target.pathname === "/api/settings") settingsSnapshot = data;
      return data;
    } catch {
      throw new Error(
        "Не удалось прочитать ответ. Закройте архив и откройте его снова.",
      );
    }
  }
  function announce(text) {
    $("announcement").textContent = text;
  }
  function toast(text) {
    $("toast").textContent = text;
    $("toast").hidden = false;
    setTimeout(() => {
      $("toast").hidden = true;
    }, 3000);
  }
  function errorBox(container, message, retry) {
    container.replaceChildren(
      node("p", "", message),
      button("Повторить", retry),
    );
    container.hidden = false;
  }
  const mediaLabels = {
    photo: "Фото",
    video: "Видео",
    document: "Файл",
    voice: "Голосовое сообщение",
    audio: "Аудио",
    animation: "Анимация",
    video_note: "Видеосообщение",
    sticker: "Стикер",
  };
  const photoStatusLabels = {
    pending: "Получаем фото",
    saved: "Фото сохранено",
    unavailable: "Файл недоступен",
    error: "Не удалось сохранить фото",
  };
  function contentText(content) {
    if (!content) return "Содержимое не сохранилось";
    return (
      [content.media ? mediaLabels[content.media] || "Медиа" : null, content.text]
        .filter(Boolean)
        .join(" · ") || "Содержимое не сохранилось"
    );
  }
  function preview(entry) {
    if (!entry) return "";
    if (entry.kind === "photo")
      return photoStatusLabels[entry.photo_status] || "Фото";
    return (
      (entry.own ? "Вы · " : "") +
      (entry.kind === "edit" ? "Изменено: " : "Удалено: ") +
      contentText(entry.kind === "delete" ? entry.before : entry.after)
    );
  }
  function avatar(conversation) {
    const el = node("span", "avatar");
    el.setAttribute("aria-hidden", "true");
    el.textContent = conversation.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((x) => Array.from(x)[0])
      .join("")
      .toLocaleUpperCase("ru");
    if (conversation.avatar)
      request(conversation.avatar, { blob: true })
        .then((blob) => {
          if (!el.isConnected) return;
          const img = node("img");
          const url = URL.createObjectURL(blob);
          img.src = url;
          img.alt = "";
          img.onload = () => {
            if (el.isConnected) el.replaceChildren(img);
            URL.revokeObjectURL(url);
          };
          img.onerror = () => URL.revokeObjectURL(url);
        })
        .catch(() => {});
    return el;
  }
  function renderList() {
    const list = $("conversations");
    list.replaceChildren();
    for (const conversation of state.conversations) {
      const row = button(
        "",
        () => openConversation(conversation),
        "conversation",
      );
      row.dataset.chatId = conversation.id;
      row.setAttribute(
        "aria-current",
        String(state.selected?.id === conversation.id),
      );
      const copy = node("span", "conversation-copy");
      const top = node("span", "row");
      top.append(
        node("span", "name", conversation.name),
        node("span", "time", time(conversation.last_event_at)),
      );
      const bottom = node("span", "row");
      bottom.append(node("span", "preview", preview(conversation.last_event)));
      if (conversation.unread) {
        const count = node("span", "unread", String(conversation.unread));
        count.setAttribute(
          "aria-label",
          `Непрочитанных событий: ${conversation.unread}`,
        );
        bottom.append(count);
      }
      copy.append(top, bottom);
      row.append(avatar(conversation), copy);
      list.append(row);
    }
    if (!state.conversations.length) {
      const empty = node("div", "empty");
      empty.append(
        node(
          "strong",
          "",
          state.query ? "Ничего не найдено" : "Архив пока пуст",
        ),
        node(
          "p",
          "",
          state.query
            ? "Проверьте имя или ник."
            : "Здесь появятся изменения, удаления и сохранённые фото из подключённых диалогов.",
        ),
      );
      if (state.query)
        empty.append(
          button("Сбросить поиск", () => {
            $("search").value = "";
            state.query = "";
            loadList();
          }),
        );
      list.append(empty);
    }
  }
  let listSequence = 0;
  async function loadList() {
    const sequence = ++listSequence;
    try {
      const data = await request(
        `/api/conversations?q=${encodeURIComponent(state.query)}`,
      );
      if (sequence !== listSequence) return;
      state.conversations = data.items;
      $("list-error").hidden = true;
      renderList();
      if (state.initialChat) {
        const id = Number(state.initialChat);
        state.initialChat = null;
        const conversation = data.items.find((item) => item.id === id);
        if (conversation) openConversation(conversation);
        else toast("Диалог не найден в архиве");
      }
      if (state.query) announce(`Найдено диалогов: ${data.items.length}`);
    } catch (error) {
      if (sequence !== listSequence) return;
      errorBox(
        $("list-error"),
        "Не удалось загрузить диалоги. " + error.message,
        loadList,
      );
      if (!$("conversations").querySelector("button"))
        $("conversations").replaceChildren();
    }
  }
  function applyTheme() {
    const theme = tg?.themeParams || {};
    document.documentElement.dataset.theme =
      tg?.colorScheme ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const roles = {
      "--bg": "bg_color",
      "--secondary": "secondary_bg_color",
      "--section": "section_bg_color",
      "--text": "text_color",
      "--hint": theme.subtitle_text_color
        ? "subtitle_text_color"
        : "hint_color",
      "--action": "button_color",
      "--button-text": "button_text_color",
      "--link": "link_color",
      "--danger": "destructive_text_color",
    };
    for (const [css, key] of Object.entries(roles)) {
      if (theme[key])
        document.documentElement.style.setProperty(css, theme[key]);
      else document.documentElement.style.removeProperty(css);
    }
  }
  function applyViewport() {
    document.documentElement.style.setProperty(
      "--viewport-height",
      `${tg?.viewportHeight || window.innerHeight}px`,
    );
    for (const side of ["top", "bottom", "left", "right"])
      document.documentElement.style.setProperty(
        `--safe-${side}`,
        `${Math.max(tg?.safeAreaInset?.[side] || 0, tg?.contentSafeAreaInset?.[side] || 0)}px`,
      );
  }
  async function loadStatus() {
    try {
      const settings = await getSettings(true);
      const labels = {
        active: "Сбор работает",
        disconnected: "Нет подключения",
        stale: "Приёмник не отвечает",
        unknown: "Подключение ещё не проверено",
      };
      const receiver = settings.receiver;
      let text = labels[receiver?.state] || labels.unknown;
      if (receiver?.last_success_at && receiver.state !== "active")
        text += ` · Проверено ${dateTime(receiver.last_success_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
      $("receiver").textContent = navigator.onLine ? text : "Нет сети";
    } catch {
      $("receiver").textContent = navigator.onLine
        ? "Не удалось проверить подключение"
        : "Нет сети";
    }
  }

  let eventSequence = 0;
  function timestamp(at, source) {
    const el = node(
      "time",
      "time",
      (source === "received" ? "Получено " : "") + time(at),
    );
    if (at) el.dateTime = new Date(Number(at) * 1000).toISOString();
    el.title = dateTime(at, {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    return el;
  }
  function appendContent(
    container,
    content,
    missing = "Содержимое не сохранилось",
  ) {
    if (!content) {
      container.append(node("p", "message-text", missing));
      return;
    }
    if (content.media) {
      container.append(
        node("p", "media-type", mediaLabels[content.media] || "Медиа"),
      );
    }
    if (content.text) container.append(node("p", "message-text", content.text));
    else if (!content.media)
      container.append(node("p", "message-text", missing));
  }
  function entryElement(entry) {
    const article = node("article", `entry${entry.own ? " own" : ""}`);
    article.dataset.entryId = entry.id;
    article.append(
      node(
        "h3",
        "",
        entry.kind === "delete"
          ? "Сообщение удалено"
          : entry.kind === "photo"
            ? "Фото"
            : "Сообщение изменено",
      ),
    );
    if (entry.kind === "delete")
      article.append(
        node(
          "p",
          "author",
          `Автор исходного сообщения: ${entry.before?.author_id == null ? "Автор неизвестен" : entry.own ? "Вы" : entry.before.author_id === entry.profile?.id ? entry.profile.name : "Автор неизвестен"}`,
        ),
      );
    else if (entry.kind !== "delete")
      article.append(
        node("p", "author", entry.own ? "Вы" : entry.profile?.name || ""),
      );
    if (entry.kind === "edit") {
      const before = node("div", "message-state");
      before.append(node("span", "state-label", "Было"));
      appendContent(before, entry.before, "Предыдущая версия не получена");
      const after = node("div", "message-state after");
      after.append(node("span", "state-label", "Стало"));
      appendContent(after, entry.after);
      article.append(before, after);
    } else if (entry.kind === "photo") {
      renderPhotoCard(article, entry);
    } else
      appendContent(
        article,
        entry.kind === "delete" ? entry.before : entry.after,
      );
    const footer = node("div", "entry-footer");
    const actions = node("div", "entry-actions");
    actions.append(
      button("История сообщения", (event) =>
        openHistory(entry, event.currentTarget),
      ),
      button(
        "Удалить запись",
        (event) => confirmEntryDelete(entry, event.currentTarget),
        "text-button destructive",
      ),
    );
    actions.children[0].textContent = "История";
    actions.children[0].setAttribute("aria-label", "История сообщения");
    actions.children[1].textContent = "Удалить";
    actions.children[1].setAttribute("aria-label", "Удалить запись");
    footer.append(actions, timestamp(entry.at, entry.time_source));
    article.append(footer);
    return article;
  }
  function renderEntries() {
    const feed = $("feed");
    if (!feed) return;
    feed.replaceChildren();
    if (state.hasMore)
      feed.append(
        button("Показать предыдущие", loadEarlier, "text-button load-earlier"),
      );
    let previousDay = "";
    for (const entry of state.entries) {
      const day = dateTime(entry.at, {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      if (day !== previousDay) {
        feed.append(node("p", "date-divider", day));
        previousDay = day;
      }
      feed.append(entryElement(entry));
    }
    if (!state.entries.length) {
      const empty = node("div", "empty");
      empty.append(
        node("strong", "", "В архиве диалога пока нет событий"),
        node("p", "", "Здесь появятся изменения, удаления и сохранённые фото."),
      );
      feed.append(empty);
    }
  }
  function syncBack() {
    const visible = !!state.selected || !!state.layer;
    if (tg?.BackButton) {
      visible ? tg.BackButton.show() : tg.BackButton.hide();
    }
    const fallback = $("back");
    if (fallback) fallback.hidden = !!tg?.BackButton;
  }
  function closeConversation() {
    stopObserving();
    eventSequence++;
    state.selected = null;
    state.entries = [];
    $("app").classList.remove("has-conversation");
    $("detail").replaceChildren();
    const welcome = node("div", "welcome");
    welcome.append(
      node("p", "", "Выберите диалог"),
      node("span", "", "Изменения, удаления и сохранённые фото"),
    );
    $("detail").append(welcome);
    renderList();
    syncBack();
    const row = $("conversations").querySelector("button");
    row?.focus();
  }
  async function openConversation(conversation) {
    stopObserving();
    const sequence = ++eventSequence;
    state.selected = conversation;
    state.entries = [];
    state.pendingPage = null;
    state.through = 0;
    state.hasMore = false;
    state.before = null;
    $("app").classList.add("has-conversation");
    const detail = $("detail");
    detail.replaceChildren();
    const header = node("header", "conversation-header");
    const back = button("‹", closeConversation, "back");
    back.id = "back";
    back.setAttribute("aria-label", "Назад к диалогам");
    const heading = node("div", "conversation-heading");
    const title = node("h2", "", conversation.name);
    title.title = conversation.name;
    heading.append(title);
    if (conversation.username) {
      const username = button(
        "@" + conversation.username,
        async () => {
          try {
            await navigator.clipboard.writeText("@" + conversation.username);
            toast("Ник скопирован");
          } catch {
            toast("Не удалось скопировать ник");
          }
        },
        "username",
      );
      username.title = "Скопировать @" + conversation.username;
      heading.append(username);
    }
    const refresh = button("↻", () => refreshEvents(), "icon-button");
    refresh.setAttribute("aria-label", "Обновить события");
    const menu = button("⋯", () => openConversationSettings(), "icon-button");
    menu.setAttribute("aria-label", "Настройки диалога");
    header.append(back, avatar(conversation), heading, refresh, menu);
    const error = node("div", "inline-error");
    error.id = "event-error";
    error.hidden = true;
    const feed = node("div", "feed");
    feed.id = "feed";
    feed.tabIndex = 0;
    feed.setAttribute("aria-label", "События диалога");
    feed.append(node("p", "empty", "Загружаем события…"));
    const footer = node("div", "feed-footer");
    footer.id = "feed-footer";
    detail.append(header, error, feed, footer);
    syncBack();
    renderList();
    try {
      const data = await request(
        `/api/conversations/${conversation.id}/events`,
      );
      if (sequence !== eventSequence) return;
      state.entries = data.items;
      state.through = data.through_id;
      state.before = data.next_before;
      state.hasMore = data.has_more;
      renderEntries();
      renderReadFooter();
      requestAnimationFrame(() => {
        feed.scrollTop = feed.scrollHeight;
        observeEntries();
      });
    } catch (error) {
      if (sequence !== eventSequence) return;
      feed.replaceChildren();
      errorBox(
        $("event-error"),
        "Не удалось загрузить события. " + error.message,
        () => openConversation(conversation),
      );
    }
  }
  async function loadEarlier() {
    const chat = state.selected?.id;
    if (!chat || !state.hasMore) return;
    const feed = $("feed");
    const oldHeight = feed.scrollHeight;
    const oldTop = feed.scrollTop;
    try {
      const data = await request(
        `/api/conversations/${chat}/events?before=${state.before}`,
      );
      if (state.selected?.id !== chat) return;
      state.entries = [...data.items, ...state.entries];
      state.before = data.next_before;
      state.hasMore = data.has_more;
      renderEntries();
      feed.scrollTop = oldTop + feed.scrollHeight - oldHeight;
      observeEntries();
    } catch (error) {
      errorBox(
        $("event-error"),
        "Не удалось загрузить предыдущие события. " + error.message,
        loadEarlier,
      );
    }
  }

  let observer = null,
    readTimer = null,
    reading = false;
  function active() {
    return (
      document.visibilityState === "visible" &&
      tg?.isActive !== false &&
      !state.layer
    );
  }
  function stopObserving() {
    observer?.disconnect();
    state.visible.clear();
    clearTimeout(readTimer);
  }
  function scheduleRead() {
    clearTimeout(readTimer);
    if (active()) readTimer = setTimeout(flushRead, 120);
  }
  function observeEntries() {
    stopObserving();
    const feed = $("feed");
    if (!feed) return;
    observer = new IntersectionObserver(
      (entries) => {
        for (const observed of entries) {
          const id = Number(observed.target.dataset.entryId);
          const enough =
            observed.isIntersecting &&
            observed.intersectionRect.height >=
              Math.min(120, observed.boundingClientRect.height * 0.5);
          enough ? state.visible.add(id) : state.visible.delete(id);
        }
        scheduleRead();
      },
      { root: feed, threshold: [0, 0.01, 0.25, 0.5, 1] },
    );
    for (const entry of state.entries) {
      if (
        !entry.own &&
        entry.kind !== "photo" &&
        !entry.read &&
        !state.acknowledged.has(entry.id)
      ) {
        const el = feed.querySelector(`[data-entry-id="${entry.id}"]`);
        if (el) observer.observe(el);
      }
    }
  }
  function setUnread(chat, unread) {
    for (const conversation of state.conversations)
      if (conversation.id === chat) conversation.unread = unread;
    renderList();
  }
  async function flushRead() {
    if (reading || !active() || !state.selected) return;
    const chat = state.selected.id;
    const ids = [...state.visible].filter(
      (id) =>
        !state.acknowledged.has(id) &&
        state.entries.some(
          (entry) =>
            entry.id === id &&
            !entry.read &&
            !entry.own &&
            entry.kind !== "photo",
        ),
    );
    if (!ids.length) return;
    reading = true;
    try {
      const data = await request(`/api/conversations/${chat}/read`, {
        method: "POST",
        body: { ids },
      });
      for (const id of ids) state.acknowledged.add(id);
      if (state.selected?.id === chat) {
        for (const entry of state.entries)
          if (ids.includes(entry.id)) entry.read = true;
        setUnread(chat, data.unread);
        const error = $("read-error");
        if (error) error.hidden = true;
      }
    } catch {
      if (state.selected?.id === chat) {
        const error = $("read-error");
        if (error) {
          error.replaceChildren(
            node("span", "", "Не удалось сохранить прочтение. "),
            button("Повторить", flushRead),
          );
          error.hidden = false;
        }
      }
    } finally {
      reading = false;
    }
  }
  function renderReadFooter() {
    const footer = $("feed-footer");
    if (!footer) return;
    footer.replaceChildren();
    if (state.pendingPage)
      footer.append(
        button(
          "Новые события",
          () => openConversation(state.selected),
          "text-button new-events",
        ),
      );
    const error = node("div", "read-error");
    error.id = "read-error";
    error.hidden = true;
    footer.append(
      error,
      button("Прочитать всё", async (event) => {
        const chat = state.selected?.id,
          through = state.through;
        if (!chat || !through) return;
        const control = event.currentTarget;
        control.disabled = true;
        try {
          const data = await request(`/api/conversations/${chat}/read`, {
            method: "POST",
            body: { through_id: through },
          });
          if (state.selected?.id === chat) {
            for (const entry of state.entries)
              if (entry.id <= through) {
                entry.read = true;
                state.acknowledged.add(entry.id);
              }
            setUnread(chat, data.unread);
            error.hidden = true;
            toast("События отмечены прочитанными");
          }
        } catch (failure) {
          error.textContent = "Не удалось отметить события. " + failure.message;
          error.hidden = false;
        } finally {
          control.disabled = false;
        }
      }),
    );
  }
  document.addEventListener("visibilitychange", () => {
    if (active()) scheduleRead();
  });
  tg?.onEvent?.("activated", scheduleRead);
  tg?.onEvent?.("deactivated", () => clearTimeout(readTimer));
  let layerVersion = 0,
    photoURL = null;
  let sheetOpener = null;
  function showSheet(title, opener) {
    layerVersion++;
    if (photoURL) {
      URL.revokeObjectURL(photoURL);
      photoURL = null;
    }
    state.layer = title;
    if (!$("sheet").open) sheetOpener = opener || document.activeElement;
    $("sheet-title").textContent = title;
    $("sheet-body").replaceChildren();
    if (!$("sheet").open) $("sheet").showModal();
    $("sheet-title").tabIndex = -1;
    $("sheet-title").focus({ preventScroll: true });
    syncBack();
    return $("sheet-body");
  }
  function closeSheet() {
    layerVersion++;
    if (photoURL) {
      URL.revokeObjectURL(photoURL);
      photoURL = null;
    }
    if ($("sheet").open) $("sheet").close();
    state.layer = null;
    syncBack();
    scheduleRead();
    if (sheetOpener?.isConnected) sheetOpener.focus();
  }
  $("sheet-close").addEventListener("click", closeSheet);
  $("sheet").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeSheet();
  });
  function navigateBack() {
    if (state.layer) closeSheet();
    else if (state.selected) closeConversation();
  }
  tg?.BackButton?.onClick(navigateBack);
  async function openHistory(entry, opener) {
    const body = showSheet("История сообщения", opener),
      version = layerVersion;
    body.append(
      node("p", "history-profile", entry.profile?.name || ""),
      node("p", "empty", "Загружаем историю…"),
    );
    try {
      const data = await request(
        `/api/conversations/${entry.chat_id}/messages/${entry.message_id}/history`,
      );
      if (layerVersion !== version) return;
      body.replaceChildren(
        node(
          "p",
          "history-profile",
          [
            entry.profile?.name,
            entry.profile?.username ? "@" + entry.profile.username : null,
          ]
            .filter(Boolean)
            .join(" · "),
        ),
      );
      if (data.original_missing)
        body.append(node("p", "warning", "Исходное состояние не получено."));
      if (!data.items.length)
        body.append(node("p", "empty", "История сообщения отсутствует."));
      for (const item of data.items) {
        const block = node("section", "history-item");
        const labels = {
          original: "Исходное полученное состояние",
          business_message: "Исходное полученное состояние",
          edit: "Сообщение изменено",
          edited_business_message: "Сообщение изменено",
          delete: "Сообщение удалено",
          deleted_business_messages: "Сообщение удалено",
        };
        block.append(
          node("h3", "", labels[item.kind] || "Полученное состояние"),
        );
        appendContent(block, item.content);
        block.append(timestamp(item.at, item.time_source));
        body.append(block);
      }
    } catch (error) {
      if (layerVersion === version)
        errorBox(body, "Не удалось загрузить историю. " + error.message, () =>
          openHistory(entry, opener),
        );
    }
  }

  function renderPhotoCard(container, entry) {
    container.querySelector("h3").textContent =
      photoStatusLabels[entry.photo_status] || "Фото";
    if (entry.after?.text)
      container.append(node("p", "message-text", entry.after.text));
    if (entry.photo_status === "saved") {
      const tile = button(
        "Загружаем фото…",
        (event) => openPhoto(entry, event.currentTarget),
        "photo-tile",
      );
      tile.setAttribute("aria-label", "Открыть фото");
      container.append(tile);
      savedPhoto(entry.id)
        .then((blob) => {
          if (!tile.isConnected) return;
          const url = URL.createObjectURL(blob);
          const preview = node("img", "photo-preview");
          preview.alt = "Сохранённое фото";
          preview.onload = () => {
            URL.revokeObjectURL(url);
            tile.replaceChildren(preview);
          };
          preview.onerror = () => {
            URL.revokeObjectURL(url);
            tile.textContent = "Не удалось загрузить фото · Открыть";
          };
          preview.src = url;
        })
        .catch(() => {
          tile.textContent = "Не удалось загрузить фото · Открыть";
        });
    }
    else if (entry.photo_status === "unavailable")
      container.append(
        node("p", "photo-note", "Бот не получил файл этого фото."),
      );
    else if (entry.photo_status === "pending")
      container.append(node("p", "photo-note", "Получаем файл из Telegram."));
    else if (entry.photo_status === "error") {
      container.append(
        node("p", "photo-note", "Полный файл пока не сохранён."),
      );
      const retry = button("Повторить", async (event) => {
        const control = event.currentTarget;
        control.disabled = true;
        try {
          await request(`/api/entries/${entry.id}/retry`, { method: "POST", body: {} });
          entry.photo_status = "pending";
          const replacement = entryElement(entry);
          const previous = $("feed")?.querySelector(
            `[data-entry-id="${entry.id}"]`,
          );
          previous?.replaceWith(replacement);
          observeEntries();
          toast("Получаем фото");
        } catch (error) {
          const message = node(
            "p",
            "setting-error",
            "Не удалось повторить загрузку. " + error.message,
          );
          control.after(message);
        } finally {
          control.disabled = false;
        }
      });
      container.append(retry);
    }
  }
  async function openPhoto(entry, opener) {
    const body = showSheet("Фото", opener),
      version = layerVersion;
    body.append(node("p", "empty", "Загружаем фото…"));
    try {
      const blob = await savedPhoto(entry.id);
      if (layerVersion !== version) return;
      photoURL = URL.createObjectURL(blob);
      const image = node("img", "photo-viewer");
      image.alt = "Сохранённое фото";
      image.src = photoURL;
      image.onload = () => {
        if (layerVersion === version) body.replaceChildren(image);
      };
      image.onerror = () => {
        if (layerVersion === version)
          errorBox(body, "Не удалось открыть изображение.", () =>
            openPhoto(entry, opener),
          );
      };
    } catch (error) {
      if (layerVersion === version)
        errorBox(body, "Не удалось загрузить фото. " + error.message, () =>
          openPhoto(entry, opener),
        );
    }
  }
  let refreshingEvents = false;
  async function refreshEvents() {
    const chat = state.selected?.id;
    if (!chat || refreshingEvents) return;
    refreshingEvents = true;
    try {
      const data = await request(`/api/conversations/${chat}/events`);
      if (state.selected?.id !== chat) return;
      const existing = new Map(state.entries.map((entry) => [entry.id, entry]));
      if (data.items.some((entry) => !existing.has(entry.id))) {
        state.pendingPage = data;
        renderReadFooter();
      }
      for (const entry of data.items) {
        const old = existing.get(entry.id);
        if (!old) continue;
        if (entry.read) {
          old.read = true;
          state.acknowledged.add(entry.id);
        }
        if (entry.kind === "photo" && old.photo_status !== entry.photo_status) {
          Object.assign(old, entry);
          const element = $("feed")?.querySelector(
            `[data-entry-id="${entry.id}"]`,
          );
          element?.replaceWith(entryElement(old));
        }
      }
      state.through = data.through_id;
      $("event-error").hidden = true;
      observeEntries();
    } catch (error) {
      if (state.selected?.id === chat)
        errorBox(
          $("event-error"),
          "Не удалось обновить события. " + error.message,
          refreshEvents,
        );
    } finally {
      refreshingEvents = false;
    }
  }
  async function refresh() {
    if (document.visibilityState !== "visible" || tg?.isActive === false)
      return;
    await Promise.allSettled([
      loadList(),
      loadStatus(),
      ...(!state.layer ? [refreshEvents()] : []),
    ]);
    scheduleRead();
  }
  setInterval(refresh, 10000);
  window.addEventListener("online", refresh);
  window.addEventListener("offline", () => {
    $("receiver").textContent = "Нет сети";
  });
  document.addEventListener("visibilitychange", () => {
    if (active()) refresh();
  });
  tg?.onEvent?.("activated", refresh);
  function settingSwitch(container, label, description, value, save) {
    const row = node("label", "setting-row");
    const copy = node("span");
    copy.append(node("span", "setting-label", label));
    if (description)
      copy.append(node("span", "setting-description", description));
    const input = node("input");
    input.type = "checkbox";
    input.setAttribute("role", "switch");
    input.checked = value;
    const error = node("p", "setting-error");
    error.hidden = true;
    input.addEventListener("change", async () => {
      const next = input.checked;
      if (input.dataset.saving) {
        input.checked = input.dataset.saving === "true";
        return;
      }
      input.dataset.saving = String(next);
      input.setAttribute("aria-busy", "true");
      error.hidden = true;
      try {
        await save(next);
        toast("Настройка сохранена");
      } catch (failure) {
        input.checked = !next;
        error.textContent =
          "Не удалось сохранить настройку. " + failure.message;
        error.hidden = false;
      } finally {
        delete input.dataset.saving;
        input.removeAttribute("aria-busy");
      }
    });
    row.append(copy, input);
    container.append(row, error);
  }
  async function openSettings() {
    const body = showSheet("Настройки");
    body.append(node("p", "empty", "Загружаем настройки…"));
    try {
      const settings = await getSettings();
      if (state.layer !== "Настройки") return;
      body.replaceChildren();
      const group = node("section", "settings-group");
      group.append(node("h3", "", "Уведомления"),
        node("p", "warning", "Бот сообщает о правках и удалениях собеседника в личном чате с вами."));
      settingSwitch(
        group,
        "Изменения сообщений",
        "",
        settings.notify_edits,
        (value) =>
          request("/api/settings", {
            method: "PATCH",
            body: { notify_edits: value },
          }),
      );
      settingSwitch(
        group,
        "Удаления сообщений",
        "",
        settings.notify_deletes,
        (value) =>
          request("/api/settings", {
            method: "PATCH",
            body: { notify_deletes: value },
          }),
      );
      body.append(group);
      const storage = node("section", "settings-group");
      storage.append(
        node("h3", "", "Хранение"),
        node(
          "p",
          "warning",
          "В архиве — правки, удаления и сохранённые фото. Копии обычных сообщений храним 30 дней: если сообщение удалят позже, его текст может не сохраниться. Записи архива остаются до ручной очистки.",
        ),
      );
      storage.append(
        node("h3", "", "Фото"),
        node(
          "p",
          "warning",
          "Ответьте на фото в Telegram, чтобы сохранить его. Сохраняются только файлы, доступные боту. Временные фото доступны не всегда.",
        ),
      );
      body.append(storage);
      const connection = node("section", "settings-group");
      const connectionHeading = node("div", "connection-heading");
      const connectionStatus = node("span", "connection-status",
        settings.receiver.state === "active" ? "Сбор работает" : $("receiver").textContent);
      connectionStatus.classList.toggle("is-active", settings.receiver.state === "active");
      connectionHeading.append(node("h3", "", "Подключение"), connectionStatus);
      connection.append(
        connectionHeading,
        node(
          "p",
          "warning",
          "Бот сохраняет новые события, пока запущен и подключён к Telegram. События за время отключения могут не попасть в архив.",
        ),
      );
      body.append(connection);
      body.append(
        button(
          "Очистить архив",
          () => confirmClearAll(),
          "setting-action destructive",
        ),
      );
    } catch (error) {
      if (state.layer === "Настройки")
        errorBox(
          body,
          "Не удалось загрузить настройки. " + error.message,
          openSettings,
        );
    }
  }
  async function openConversationSettings() {
    const conversation = state.selected;
    if (!conversation) return;
    const body = showSheet("Настройки диалога");
    body.append(
      node("p", "history-profile", conversation.name),
      node("p", "empty", "Загружаем настройки…"),
    );
    try {
      const settings = await request(
        `/api/conversations/${conversation.id}/settings`,
      );
      if (
        state.layer !== "Настройки диалога" ||
        state.selected?.id !== conversation.id
      )
        return;
      Object.assign(conversation, settings);
      body.replaceChildren(node("p", "history-profile", conversation.name));
      const group = node("section", "settings-group");
      settingSwitch(
        group,
        "Уведомления",
        "Новые события продолжают сохраняться. Типы уведомлений выбираются в общих настройках.",
        settings.notifications,
        async (value) => {
          await request(`/api/conversations/${conversation.id}/settings`, {
            method: "PATCH",
            body: { notifications: value },
          });
          conversation.notifications = value;
        },
      );
      body.append(group);
      const description = node(
        "p",
        "warning",
        settings.collecting
          ? "Новые события и фото сохраняются."
          : "Новые события не добавляются. Старый архив остаётся.",
      );
      const collecting = button(
        settings.collecting
          ? "Не сохранять этот диалог"
          : "Сохранять этот диалог",
        async (event) => {
          const control = event.currentTarget;
          control.disabled = true;
          try {
            const next = await request(
              `/api/conversations/${conversation.id}/settings`,
              {
                method: "PATCH",
                body: { collecting: !conversation.collecting },
              },
            );
            Object.assign(conversation, next);
            control.textContent = next.collecting
              ? "Не сохранять этот диалог"
              : "Сохранять этот диалог";
            description.textContent = next.collecting
              ? "Новые события и фото сохраняются."
              : "Новые события не добавляются. Старый архив остаётся.";
            toast("Настройка сохранена");
          } catch (error) {
            toast("Не удалось изменить сбор. " + error.message);
          } finally {
            control.disabled = false;
          }
        },
        "setting-action",
      );
      body.append(
        collecting,
        description,
        button(
          "Очистить диалог",
          () => confirmConversationClear(conversation),
          "setting-action destructive",
        ),
      );
    } catch (error) {
      if (state.layer === "Настройки диалога")
        errorBox(
          body,
          "Не удалось загрузить настройки диалога. " + error.message,
          openConversationSettings,
        );
    }
  }
  function confirmDelete({
    title,
    description,
    label,
    path,
    collecting,
    after,
    opener,
  }) {
    const body = showSheet(title, opener);
    body.append(node("p", "clear-explanation", description));
    if (collecting)
      body.append(node("p", "warning", "Новые события продолжат сохраняться."));
    const error = node("p", "setting-error");
    error.hidden = true;
    body.append(error);
    const actions = node("div", "confirm-actions");
    const cancel = button("Отмена", closeSheet);
    const confirm = button(
      label,
      async () => {
        confirm.disabled = true;
        cancel.disabled = true;
        error.hidden = true;
        try {
          await request(path, { method: "DELETE", body: { confirm: true } });
          closeSheet();
          await after();
          toast(
            label === "Удалить запись"
              ? "Запись удалена"
              : label === "Очистить диалог"
                ? "Архив диалога очищен"
                : "Архив очищен",
          );
        } catch (failure) {
          error.textContent = "Не удалось удалить данные. " + failure.message;
          error.hidden = false;
        } finally {
          confirm.disabled = false;
          cancel.disabled = false;
        }
      },
      "confirm-delete",
    );
    actions.append(cancel, confirm);
    body.append(actions);
    cancel.focus();
  }
  function confirmEntryDelete(entry, opener) {
    confirmDelete({
      title: "Удалить запись?",
      description:
        "Запись и принадлежащие ей данные будут удалены из архива. Переписка в Telegram останется.",
      label: "Удалить запись",
      path: `/api/entries/${entry.id}`,
      collecting: state.selected?.collecting !== false,
      opener,
      after: async () => {
        if (state.selected?.id === entry.chat_id) {
          const feed = $("feed"),
            top = feed.scrollTop;
          state.entries = state.entries.filter((item) => item.id !== entry.id);
          renderEntries();
          feed.scrollTop = top;
          observeEntries();
        }
        await loadList();
      },
    });
  }
  function confirmConversationClear(conversation) {
    confirmDelete({
      title: "Очистить архив диалога?",
      description:
        "События, фото и фоновые копии этого диалога будут удалены. Переписка в Telegram останется.",
      label: "Очистить диалог",
      path: `/api/conversations/${conversation.id}`,
      collecting: conversation.collecting !== false,
      after: async () => {
        if (state.selected?.id === conversation.id) closeConversation();
        await loadList();
      },
    });
  }
  function confirmClearAll() {
    confirmDelete({
      title: "Очистить весь архив?",
      description:
        "События, фото и фоновые копии всех диалогов будут удалены. Переписка в Telegram останется.",
      label: "Очистить архив",
      path: "/api/archive",
      collecting:
        !state.conversations.length ||
        state.conversations.some((item) => item.collecting !== false),
      after: async () => {
        closeConversation();
        await loadList();
      },
    });
  }
  $("settings").addEventListener("click", openSettings);
  let searchTimer;
  $("search").addEventListener("input", () => {
    state.query = $("search").value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadList, 220);
  });
  applyTheme();
  applyViewport();
  tg?.ready?.();
  tg?.expand?.();
  tg?.onEvent?.("themeChanged", applyTheme);
  for (const event of [
    "viewportChanged",
    "safeAreaChanged",
    "contentSafeAreaChanged",
  ])
    tg?.onEvent?.(event, applyViewport);
  window.addEventListener("resize", applyViewport);
  loadList();
  loadStatus();
})();
