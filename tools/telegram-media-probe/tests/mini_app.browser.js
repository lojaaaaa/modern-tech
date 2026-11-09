async (page) => {
  const event = {
    id: 1,
    chat_id: 42,
    message_id: 7,
    kind: "edit",
    own: false,
    read: false,
    at: 1794200000,
    received_at: 1794200001,
    time_source: "telegram",
    profile: { id: 42, name: "Алексей", username: "Alex" },
    before: { text: "Встречаемся в 18:00", media: null },
    after: { text: "Встречаемся в 19:00", media: null },
  };
  const events = Array.from({ length: 20 }, (_, i) => ({
    ...event,
    id: i + 1,
    message_id: i + 7,
  }));
  const readIds = new Set();
  let through = null;
  let collecting = true;
  let cleared = false;
  const conversation = {
    id: 42,
    name: "Алексей",
    username: "Alex",
    avatar: null,
    unread: 20,
    last_event: events[19],
    last_event_at: 1794200000,
    notifications: true,
    collecting: true,
  };
  await page.route("https://telegram.org/js/**", (route) =>
    route.fulfill({ body: "" }),
  );
  await page.addInitScript(() => {
    window.Telegram = {
      WebApp: {
        initData: "signed-test-data",
        themeParams: {},
        colorScheme: "light",
        isActive: true,
        ready() {},
        expand() {},
        onEvent() {},
      },
    };
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().headers().authorization !== "Telegram signed-test-data")
      throw new Error("API must carry Telegram initData");
    let body;
    if (route.request().method() === "DELETE") {
      if (route.request().postDataJSON().confirm !== true)
        throw new Error("Deletion needs confirmation");
      cleared = true;
      body = { ok: true };
    } else if (url.pathname === "/api/conversations")
      body = { items: [conversation] };
    else if (url.pathname === "/api/settings")
      body = {
        notify_edits: true,
        notify_deletes: true,
        retention_days: 30,
        receiver: {
          state: "stale",
          last_success_at: 1794200000,
          connection_enabled: true,
        },
      };
    else if (url.pathname === "/api/conversations/42/settings") {
      if (route.request().method() === "PATCH") {
        const data = route.request().postDataJSON();
        if ("collecting" in data) collecting = data.collecting;
      }
      body = { notifications: true, collecting };
    } else if (url.pathname.endsWith("/events"))
      body = {
        items: events,
        has_more: false,
        next_before: null,
        through_id: 20,
      };
    else if (url.pathname.endsWith("/photo")) {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN4kAAAAASUVORK5CYII=",
          "base64",
        ),
      });
      return;
    } else if (url.pathname.endsWith("/read")) {
      const data = route.request().postDataJSON();
      if (data.ids) for (const id of data.ids) readIds.add(id);
      if (data.through_id) through = data.through_id;
      body = { unread: 20 - readIds.size };
    } else if (url.pathname.endsWith("/history"))
      body = {
        original_missing: false,
        items: [
          { kind: "original", at: 1794199000, content: event.before },
          { kind: "edit", at: event.at, content: event.after },
        ],
      };
    else body = { error: "Not found" };
    await route.fulfill({
      status: body.error ? 404 : 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto("http://127.0.0.1:8794");
  await page
    .getByRole("button", { name: /Алексей/ })
    .waitFor({ timeout: 3000 });
  if (readIds.size) throw new Error("List preview marked events read");
  await page.getByRole("button", { name: /Алексей/ }).click();
  await page
    .getByText("Встречаемся в 18:00", { exact: true })
    .last()
    .waitFor({ timeout: 3000 });
  await page.getByText("Встречаемся в 19:00", { exact: true }).last().waitFor();
  await page.waitForTimeout(350);
  if (!readIds.size || readIds.size >= 20)
    throw new Error("Only visible events should be read: " + readIds.size);
  const visibleRead = readIds.size;
  await page.evaluate(() => {
    window.Telegram.WebApp.isActive = false;
    document.getElementById("feed").scrollTop = 0;
  });
  await page.waitForTimeout(250);
  if (readIds.size !== visibleRead)
    throw new Error("Inactive Mini App marked events read");
  await page.evaluate(() => {
    window.Telegram.WebApp.isActive = true;
  });
  await page
    .getByRole("button", { name: "Прочитать всё", exact: true })
    .click();
  if (through !== 20) throw new Error("Read all must use fetched through_id");
  await page.getByRole("button", { name: "История сообщения" }).first().click();
  await page
    .getByRole("heading", { name: "История сообщения" })
    .waitFor({ timeout: 3000 });
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page
    .getByRole("button", { name: "Настройки диалога", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Не сохранять этот диалог", exact: true })
    .click();
  await page
    .getByText("Новые события не добавляются. Старый архив остаётся.", {
      exact: true,
    })
    .waitFor({ timeout: 3000 });
  if (collecting) throw new Error("Collection setting was not persisted");
  await page
    .getByRole("button", { name: "Очистить диалог", exact: true })
    .click();
  if (cleared) throw new Error("Deletion ran before confirmation");
  await page
    .getByRole("heading", { name: "Очистить архив диалога?", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  if (cleared) throw new Error("Cancel deleted data");
  events.push({
    ...event,
    id: 21,
    message_id: 31,
    kind: "photo",
    own: true,
    photo_status: "saved",
    before: null,
    after: { media: "photo", text: "Фото из ответа" },
  });
  await page
    .getByRole("button", { name: "Обновить события", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Новые события", exact: true })
    .click();
  await page.getByRole("button", { name: "Открыть фото", exact: true }).click();
  await page
    .getByRole("img", { name: "Сохранённое фото", exact: true })
    .waitFor({ timeout: 3000 });
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  return {
    result:
      "signed API; visible-only reads; inactive guard; snapshot; history; collection; clear confirmation; protected photo",
    visibleRead,
  };
}
