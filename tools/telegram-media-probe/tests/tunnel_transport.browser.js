async (page) => {
  const test = await page.context().newPage();
  try {
    test.setDefaultTimeout(3000);
    await test.route("https://telegram.org/js/**", (route) =>
      route.fulfill({ body: "" }),
    );
    await test.addInitScript(() => {
      window.Telegram = {
        WebApp: {
          initData: "synthetic-launch-for-tunnel-test",
          themeParams: {},
          isActive: true,
          ready() {},
          expand() {},
          onEvent() {},
        },
      };
    });
    const event = {
      id: 1,
      chat_id: 42,
      message_id: 1,
      kind: "edit",
      own: false,
      at: 1794200000,
      before: { text: "До" },
      after: { text: "После" },
    };
    let unexpectedHtml = false;
    await test.route("**/api/**", async (route) => {
      if (
        unexpectedHtml ||
        !route.request().headers()["ngrok-skip-browser-warning"]
      ) {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><title>Tunnel confirmation</title>",
        });
        return;
      }
      const path = new URL(route.request().url()).pathname;
      const body =
        path === "/api/conversations"
          ? {
              items: [{
                id: 42,
                name: "Собеседник через туннель",
                username: null,
                avatar: null,
                unread: 1,
                last_event: event,
                last_event_at: event.at,
              }],
            }
          : { receiver: { state: "unknown" } };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    await test.goto("http://127.0.0.1:8794/");
    await test.getByRole("button", { name: /Собеседник через туннель/ }).waitFor();
    unexpectedHtml = true;
    await test.reload();
    await test
      .getByText(/Не удалось прочитать ответ\. Закройте архив и откройте его снова/)
      .waitFor();
    return {
      result: "API bypasses tunnel HTML; unexpected HTML produces a useful error",
    };
  } finally {
    await test.close();
  }
}
