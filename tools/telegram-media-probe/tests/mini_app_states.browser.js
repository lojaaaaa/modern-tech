async (page) => {
  page.setDefaultTimeout(3000);
  await page.unrouteAll({ behavior: "wait" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const base = {
    chat_id: 42,
    message_id: 70,
    own: true,
    read: true,
    at: 1794200000,
    received_at: 1794200000,
    time_source: "received",
    profile: {
      id: 42,
      name: "Алексей Очень Длинное Имя Собеседника",
      username: "VeryLongUsername",
    },
    before: null,
    after: { media: "photo", text: "" },
  };
  const entries = ["saved", "pending", "unavailable", "error"].map(
    (status, i) => ({
      ...base,
      id: i + 1,
      message_id: 70 + i,
      kind: "photo",
      photo_status: status,
    }),
  );
  entries.push({
    ...base,
    id: 5,
    message_id: 80,
    kind: "delete",
    own: false,
    before: { text: "Удалённый текст сохранён", media: null, author_id: null },
    after: null,
  });
  const conversation = {
    id: 42,
    name: base.profile.name,
    username: base.profile.username,
    avatar: null,
    last_event: entries[4],
    last_event_at: base.at,
    unread: 1,
    collecting: true,
    notifications: true,
  };
  let failList = false,
    notifyEdits = false,
    retried = false,
    apiCalls = 0;
  await page.route("https://telegram.org/js/**", (route) =>
    route.fulfill({ body: "" }),
  );
  await page.addInitScript(() => {
    window.__tgEvents = {};
    window.Telegram = {
      WebApp: {
        initData: "signed-test-data",
        colorScheme: "light",
        themeParams: {},
        isActive: true,
        ready() {},
        expand() {},
        onEvent(name, fn) {
          (window.__tgEvents[name] ||= []).push(fn);
        },
      },
    };
  });
  await page.route("**/api/**", async (route) => {
    apiCalls++;
    const url = new URL(route.request().url());
    let body,
      status = 200;
    if (route.request().headers().authorization !== "Telegram signed-test-data")
      throw new Error("Unsigned API request");
    if (url.pathname === "/api/conversations") {
      if (failList) {
        status = 503;
        body = { error: "Нет сети" };
      } else body = { items: [conversation] };
    } else if (url.pathname === "/api/settings") {
      if (route.request().method() === "PATCH")
        notifyEdits = route.request().postDataJSON().notify_edits;
      body = {
        notify_edits: notifyEdits,
        notify_deletes: true,
        retention_days: 30,
        receiver: {
          state: "stale",
          last_success_at: base.at,
          connection_enabled: true,
        },
      };
    } else if (url.pathname.endsWith("/events"))
      body = {
        items: entries,
        has_more: false,
        next_before: null,
        through_id: 5,
      };
    else if (url.pathname.endsWith("/read")) body = { unread: 0 };
    else if (url.pathname.endsWith("/history")) {
      status = 503;
      body = { error: "История временно недоступна" };
    } else if (url.pathname.endsWith("/retry")) {
      retried = true;
      entries[3].photo_status = "pending";
      body = { ok: true };
    } else {
      status = 404;
      body = { error: "Нет данных" };
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("http://127.0.0.1:8794/?chat=42");
  await page.getByText("Удалённый текст сохранён", { exact: true }).waitFor();
  await page
    .getByText("Автор исходного сообщения: Автор неизвестен", { exact: true })
    .waitFor();
  await page.getByText("Фото сохранено", { exact: true }).waitFor();
  await page.getByText("Получаем фото", { exact: true }).waitFor();
  await page.getByText("Файл недоступен", { exact: true }).waitFor();
  await page.getByText("Не удалось сохранить фото", { exact: true }).waitFor();
  await page
    .locator(".entry")
    .filter({ hasText: "Не удалось сохранить фото" })
    .getByRole("button", { name: "Повторить", exact: true })
    .click();
  if (!retried) throw new Error("Photo retry did not reach protected API");
  await page
    .getByRole("button", { name: "История сообщения", exact: true })
    .last()
    .click();
  await page.getByText(/Не удалось загрузить историю/).waitFor();
  if (
    await page
      .getByText("История сообщения отсутствует.", { exact: true })
      .count()
  )
    throw new Error("Network error shown as empty history");
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.evaluate(() => {
    window.Telegram.WebApp.colorScheme = "dark";
    window.Telegram.WebApp.themeParams = {
      bg_color: "#17212b",
      text_color: "#f5f5f5",
    };
    for (const fn of window.__tgEvents.themeChanged) fn();
  });
  if ((await page.locator("html").getAttribute("data-theme")) !== "dark")
    throw new Error("Live Telegram theme did not apply");
  for (const width of [320, 1024]) {
    await page.setViewportSize({ width, height: 720 });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      )
    )
      throw new Error("Horizontal overflow at " + width);
  }
  await page
    .getByRole("button", { name: "Назад к диалогам", exact: true })
    .click();
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  const edits = page.getByRole("switch", { name: /Изменения сообщений/ });
  await edits.check();
  if (!notifyEdits)
    throw new Error("Global edit notification setting not saved");
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  failList = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.getByText(/Не удалось загрузить диалоги/).waitFor();
  await page
    .getByRole("button", { name: /Алексей Очень Длинное Имя/ })
    .waitFor();
  if (errors.length) throw new Error(errors.join("; "));
  const callsBefore = apiCalls;
  await page.addInitScript(() => {
    window.Telegram.WebApp.initData = "";
  });
  await page.goto("http://127.0.0.1:8794/");
  await page.getByText(/Откройте архив из личного чата с ботом/).waitFor();
  if (apiCalls !== callsBefore)
    throw new Error("Anonymous browser made an archive API request");
  return {
    result:
      "photo states/retry; deleted content; unknown author; history errors; deep link; live dark theme; 320/1024 layout; settings; retained list on network failure; anonymous lock",
  };
}
