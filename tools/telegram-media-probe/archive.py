"""Message history and durable owner notifications on the existing SQLite archive."""

import json
import time


SCHEMA = """
CREATE TABLE IF NOT EXISTS archive_messages (
    connection TEXT NOT NULL, chat_id INTEGER NOT NULL, message_id INTEGER NOT NULL,
    payload TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (connection, chat_id, message_id)
);
CREATE TABLE IF NOT EXISTS message_versions (
    update_id INTEGER NOT NULL, connection TEXT NOT NULL, chat_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
    previous TEXT, PRIMARY KEY (update_id, connection, chat_id, message_id)
);
CREATE TABLE IF NOT EXISTS notification_outbox (
    id INTEGER PRIMARY KEY, update_id INTEGER NOT NULL, message_id INTEGER NOT NULL,
    part INTEGER NOT NULL, text TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0, retry_at REAL NOT NULL DEFAULT 0, error TEXT,
    UNIQUE (update_id, message_id, part)
);
CREATE TABLE IF NOT EXISTS preferences (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS archive_migrations (version INTEGER PRIMARY KEY);
CREATE INDEX IF NOT EXISTS notification_pending ON notification_outbox(sent, retry_at);
CREATE INDEX IF NOT EXISTS versions_by_message ON message_versions(connection, chat_id, message_id, update_id);
"""


def initialize(db):
    db.executescript(SCHEMA)
    with db:
        for key in ("notify_edits", "notify_deletes"):
            db.execute("INSERT OR IGNORE INTO preferences VALUES (?,1)", (key,))
        if not db.execute("SELECT 1 FROM archive_migrations WHERE version=1").fetchone():
            # Index old events without sending historical notifications.
            for uid, kind, payload in db.execute("SELECT update_id,kind,payload FROM events ORDER BY update_id").fetchall():
                project(db, uid, kind, json.loads(payload)[kind], notify=False)
            db.execute("INSERT INTO archive_migrations VALUES (1)")


def settings(db):
    return {key: bool(value) for key, value in db.execute("SELECT name,value FROM preferences")}


def name(person):
    return " ".join(filter(None, (person.get("first_name"), person.get("last_name")))) or person.get("title") or str(person.get("id", "Неизвестно"))


def content(message):
    parts = []
    for kind, label in (("photo", "Фото"), ("video", "Видео"), ("video_note", "Видеосообщение"),
                        ("voice", "Голосовое сообщение"), ("audio", "Аудио"), ("document", "Файл"), ("animation", "Анимация")):
        if message.get(kind):
            parts.append(f"[{label}]")
    parts.append(message.get("text") or message.get("caption") or "")
    return "\n".join(filter(None, parts)) or "Содержимое недоступно в архиве."


def queue_notice(db, update_id, mid, text):
    # Stay below Telegram's UTF-16 limit even for emoji-heavy messages.
    for part, start in enumerate(range(0, len(text), 1800)):
        db.execute("INSERT OR IGNORE INTO notification_outbox(update_id,message_id,part,text) VALUES(?,?,?,?)",
                   (update_id, mid, part, text[start:start + 1800]))


def snapshot(db, connection, chat_id, message):
    if not message.get("message_id"):
        return
    db.execute("""INSERT INTO archive_messages(connection,chat_id,message_id,payload) VALUES(?,?,?,?)
        ON CONFLICT(connection,chat_id,message_id) DO UPDATE SET payload=excluded.payload""",
        (connection, chat_id, message["message_id"], json.dumps(message, ensure_ascii=False)))


def project(db, uid, kind, event, notify=True):
    connection, chat_id = event["business_connection_id"], event["chat"]["id"]
    if kind != "deleted_business_messages":
        reply = event.get("reply_to_message")
        if reply and reply.get("chat", {}).get("id") == chat_id:
            # An old reply must not overwrite an already indexed newer version.
            if not db.execute("SELECT 1 FROM archive_messages WHERE connection=? AND chat_id=? AND message_id=?",
                              (connection, chat_id, reply["message_id"])).fetchone():
                snapshot(db, connection, chat_id, reply)
        ids = [event["message_id"]]
    else:
        ids = event["message_ids"]
    prefs = settings(db)
    for mid in ids:
        row = db.execute("SELECT payload,deleted FROM archive_messages WHERE connection=? AND chat_id=? AND message_id=?",
                         (connection, chat_id, mid)).fetchone()
        old = json.loads(row[0]) if row else None
        deleted = kind == "deleted_business_messages"
        current = old or {"message_id": mid, "chat": event["chat"]} if deleted else event
        old_json = json.dumps(old, ensure_ascii=False) if old else None
        inserted = db.execute("INSERT OR IGNORE INTO message_versions VALUES(?,?,?,?,?,?,?)",
                              (uid, connection, chat_id, mid, kind, json.dumps(current, ensure_ascii=False), old_json)).rowcount
        if not inserted:
            continue
        snapshot(db, connection, chat_id, current)
        if deleted:
            db.execute("UPDATE archive_messages SET deleted=1 WHERE connection=? AND chat_id=? AND message_id=?",
                       (connection, chat_id, mid))
        if not notify:
            continue
        context = f"Чат: {name(event['chat'])}\nСообщение: {mid}"
        if deleted and prefs["notify_deletes"] and not (row and row[1]):
            text = f"Сообщение удалено\n{context}\n\n{content(current)}"
            if old and old.get("from"):
                text = f"Сообщение удалено\n{context}\nАвтор: {name(old['from'])}\n\n{content(current)}"
            queue_notice(db, uid, mid, text)
        elif kind == "edited_business_message" and prefs["notify_edits"]:
            # Telegram also emits edits for invisible metadata; don't spam those.
            visible = lambda m: {key: m.get(key) for key in (
                "text", "caption", "entities", "caption_entities", "photo", "video", "document", "voice", "audio", "animation", "video_note")}
            if old is None or visible(old) != visible(current):
                before = content(old) if old else "Предыдущая версия не была получена ботом."
                queue_notice(db, uid, mid, f"Сообщение изменено\n{context}\nАвтор: {name(current.get('from', {}))}\n\nБыло:\n{before}\n\nСтало:\n{content(current)}")


def deliver(db, api, owner, error_type):
    rows = db.execute("SELECT id,text,attempts FROM notification_outbox WHERE sent=0 AND retry_at<=? ORDER BY id LIMIT 20", (time.time(),)).fetchall()
    for nid, text, attempts in rows:
        try:
            api.call("sendMessage", chat_id=owner, text=text)
        except error_type as error:
            with db:
                db.execute("UPDATE notification_outbox SET attempts=attempts+1,retry_at=?,error=? WHERE id=?",
                           (time.time() + min(300, 5 * 2 ** min(attempts, 6)), str(error), nid))
            break
        with db:
            db.execute("UPDATE notification_outbox SET sent=1,error=NULL WHERE id=?", (nid,))
