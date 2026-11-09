"""Single-account Telegram Business media experiment. Python 3.10+, stdlib only."""

import getpass
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time
import secrets
import urllib.error
import urllib.parse
import urllib.request

import archive


class ApiError(Exception):
    pass


class Telegram:
    def __init__(self, token):
        self.token = token

    def call(self, method, **params):
        request = urllib.request.Request(
            f"https://api.telegram.org/bot{self.token}/{method}",
            data=json.dumps(params).encode(),
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                result = json.load(response)
        except urllib.error.HTTPError as error:
            # URLs contain credentials: never print urllib exceptions.
            raise ApiError(f"{method}: HTTP {error.code}") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise ApiError(f"{method}: network failure") from None
        if not result.get("ok"):
            raise ApiError(f"{method}: API error {result.get('error_code')}")
        return result["result"]

    def download(self, file_id, destination):
        file = self.call("getFile", file_id=file_id)
        remote_path = file.get("file_path")
        if not remote_path:
            raise ApiError("getFile: no downloadable path")
        url = f"https://api.telegram.org/file/bot{self.token}/" + urllib.parse.quote(remote_path, safe="/")
        temporary = destination.with_suffix(".part")
        try:
            total = 0
            with urllib.request.urlopen(url, timeout=40) as response, temporary.open("wb") as output:
                while chunk := response.read(65536):
                    total += len(chunk)
                    if total > 20 * 1024 * 1024:
                        raise ApiError("download: prototype 20 MiB limit")
                    output.write(chunk)
            if total == 0:
                raise ApiError("download: empty file")
            temporary.replace(destination)
        except (urllib.error.URLError, TimeoutError, OSError):
            raise ApiError("download: network or disk failure") from None
        finally:
            temporary.unlink(missing_ok=True)

    def send_photo(self, chat_id, path, caption):
        boundary = secrets.token_hex(16)
        body = bytearray()
        for key, value in (("chat_id", str(chat_id)), ("caption", caption)):
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n".encode())
        body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"saved.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n".encode())
        body.extend(path.read_bytes())
        body.extend(f"\r\n--{boundary}--\r\n".encode())
        request = urllib.request.Request(
            f"https://api.telegram.org/bot{self.token}/sendPhoto", data=bytes(body),
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                if not json.load(response).get("ok"):
                    raise ApiError("sendPhoto: API failure")
        except (urllib.error.URLError, TimeoutError, OSError):
            raise ApiError("sendPhoto: upload failure") from None


def media_files(message):
    if message.get("photo"):
        yield message["photo"][-1]["file_id"], "photo"
    for kind in ("video", "video_note", "voice", "audio", "document", "animation"):
        if message.get(kind, {}).get("file_id"):
            yield message[kind]["file_id"], kind
    # Telegram may attach the replied-to message even when no original update
    # was delivered. Its presence does not guarantee downloadable media.
    reply = message.get("reply_to_message")
    if reply:
        yield from media_files({key: value for key, value in reply.items() if key != "reply_to_message"})


class Probe:
    def __init__(self, api, owner, chat, directory):
        self.api, self.owner, self.chat = api, owner, chat
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(self.directory / "archive.sqlite3")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS events (
                update_id INTEGER PRIMARY KEY, kind TEXT NOT NULL,
                payload TEXT NOT NULL, received_at TEXT DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS files (
                update_id INTEGER NOT NULL, file_id TEXT NOT NULL, kind TEXT NOT NULL,
                path TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(update_id, file_id));
            CREATE TABLE IF NOT EXISTS cursor (id INTEGER PRIMARY KEY CHECK(id=1), offset INTEGER);
        """)
        archive.initialize(self.db)

    def offset(self):
        row = self.db.execute("SELECT offset FROM cursor WHERE id=1").fetchone()
        return row[0] if row else 0

    def ingest(self, update):
        if "message" in update:
            self.handle_command(update["message"])
        kind = next((key for key in (
            "business_message", "edited_business_message", "deleted_business_messages"
        ) if key in update), None)
        accepted = False
        if kind:
            message = update[kind]
            if self.chat == 0 or message.get("chat", {}).get("id") == self.chat:
                connection = self.api.call("getBusinessConnection", business_connection_id=message["business_connection_id"])
                accepted = connection["user"]["id"] == self.owner and connection["is_enabled"]
                if accepted and self.chat == 0:
                    print(f"Discovered business chat ID: {message['chat']['id']} (not archived)", flush=True)
                    accepted = False
        with self.db:
            if accepted:
                inserted = self.db.execute("INSERT OR IGNORE INTO events(update_id,kind,payload) VALUES(?,?,?)",
                                           (update["update_id"], kind, json.dumps(update, ensure_ascii=False))).rowcount
                if inserted:
                    archive.project(self.db, update["update_id"], kind, update[kind])
                for file_id, media_kind in media_files(update[kind]):
                    self.db.execute("INSERT OR IGNORE INTO files(update_id,file_id,kind) VALUES(?,?,?)",
                                    (update["update_id"], file_id, media_kind))
            self.db.execute("INSERT OR REPLACE INTO cursor VALUES(1,?)", (update["update_id"] + 1,))
        if accepted:
            self.download_pending(update["update_id"])
            self.deliver_notifications()

    def deliver_notifications(self):
        archive.deliver(self.db, self.api, self.owner, ApiError)

    def handle_command(self, message):
        if message.get("from", {}).get("id") != self.owner or message.get("chat", {}).get("id") != self.owner:
            return
        text = message.get("text", "")
        command = text.split()[0].split("@")[0] if text else ""
        if command == "/photos" or text == "Сохранённые фото":
            rows = self.db.execute(
                "SELECT update_id,path FROM files WHERE kind='photo' AND path IS NOT NULL ORDER BY update_id DESC LIMIT 5"
            ).fetchall()
            if not rows:
                self.api.call("sendMessage", chat_id=self.owner, text="Сохранённых фото пока нет.")
            for uid, relative in rows:
                path = self.directory / relative
                if path.is_file():
                    self.api.send_photo(self.owner, path, f"Сохранённое фото · событие {uid}")
                else:
                    self.api.call("sendMessage", chat_id=self.owner, text=f"Файл события {uid} отсутствует в архиве.")
        elif command == "/notifications" or text == "Уведомления":
            prefs = archive.settings(self.db)
            self.api.call("sendMessage", chat_id=self.owner,
                          text="Уведомления в этот чат:\nИзменения: " + ("включены" if prefs["notify_edits"] else "выключены") +
                          "\nУдаления: " + ("включены" if prefs["notify_deletes"] else "выключены") +
                          "\n\n/edits_on · /edits_off\n/deletes_on · /deletes_off")
        elif command in {"/edits_on", "/edits_off", "/deletes_on", "/deletes_off"}:
            key = "notify_edits" if command.startswith("/edits") else "notify_deletes"
            enabled = command.endswith("_on")
            with self.db:
                self.db.execute("UPDATE preferences SET value=? WHERE name=?", (int(enabled), key))
                if not enabled:
                    # Already queued unsent notices also respect the new setting.
                    prefix = "Сообщение изменено%" if key == "notify_edits" else "Сообщение удалено%"
                    self.db.execute("UPDATE notification_outbox SET sent=1 WHERE sent=0 AND text LIKE ?", (prefix,))
            self.api.call("sendMessage", chat_id=self.owner, text="Настройка уведомлений сохранена.")
        else:
            self.api.call("sendMessage", chat_id=self.owner,
                          text="Личный архив. /photos — последние 5 сохранённых фото. Одноразовые фото пока сохраняются только если Telegram передал файл, в том числе в ответе на сообщение.",
                          reply_markup={"keyboard": [[{"text": "Сохранённые фото"}, {"text": "Уведомления"}]], "resize_keyboard": True})

    def download_pending(self, update_id=None):
        query = "SELECT update_id,file_id,kind FROM files WHERE path IS NULL AND attempts<3"
        params = ()
        if update_id is not None:
            query += " AND update_id=?"
            params = (update_id,)
        for uid, fid, kind in self.db.execute(query, params).fetchall():
            name = f"{uid}-{hashlib.sha256(fid.encode()).hexdigest()[:24]}-{kind}.bin"
            try:
                self.api.download(fid, self.directory / name)
                path, error = name, None
            except ApiError as failure:
                path, error = None, str(failure)
            with self.db:
                self.db.execute("UPDATE files SET path=?,error=?,attempts=attempts+1 WHERE update_id=? AND file_id=?",
                                (path, error, uid, fid))
            print(f"update={uid} media={kind} result={'saved' if path else error}", flush=True)


def main():
    os.umask(0o077)
    config = Path(__file__).parent / ".env"
    if config.exists():
        for line in config.read_text().splitlines():
            key, separator, value = line.partition("=")
            if separator and key.strip() in {
                "TELEGRAM_BOT_TOKEN", "TELEGRAM_OWNER_ID", "TELEGRAM_CHAT_ID"
            } and value.strip():
                os.environ.setdefault(key.strip(), value.strip())
    token = os.environ.get("TELEGRAM_BOT_TOKEN") or getpass.getpass("Bot token (hidden): ")
    owner = int(os.environ.get("TELEGRAM_OWNER_ID") or input("Your numeric Telegram user ID: "))
    chat = int(os.environ.get("TELEGRAM_CHAT_ID") or input("Test partner numeric user ID: "))
    api = Telegram(token)
    if api.call("getWebhookInfo").get("url"):
        raise SystemExit("Webhook is configured. Use a separate test bot; no settings were changed.")
    me = api.call("getMe")
    if not me.get("can_connect_to_business"):
        raise SystemExit("Enable Secretary Mode in @BotFather first.")
    probe = Probe(api, owner, chat, Path(__file__).parent / "data")
    print(f"Listening as @{me['username']}. Ctrl+C to stop.", flush=True)
    if chat == 0:
        print("Discovery only: no messages or media are archived. Send a test message in a connected chat.", flush=True)
    while True:
        try:
            probe.download_pending()
            probe.deliver_notifications()
            updates = api.call("getUpdates", offset=probe.offset(), timeout=20,
                               allowed_updates=["message", "business_message", "edited_business_message", "deleted_business_messages"])
            for update in updates:
                probe.ingest(update)
        except ApiError as error:
            print(str(error), flush=True)
            time.sleep(5)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Stopped.")
