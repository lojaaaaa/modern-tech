"""The owner's normalized Telegram archive. No raw updates are retained."""

from pathlib import Path
from difflib import SequenceMatcher
from datetime import datetime, timezone
import json
import sqlite3
import time


RETENTION = 30 * 24 * 60 * 60
MEDIA = ('photo', 'video', 'video_note', 'voice', 'audio', 'document', 'animation', 'sticker',
         'contact', 'location', 'venue', 'poll', 'dice', 'story', 'paid_media')


def name(person):
    return (' '.join(filter(None, (person.get('first_name'), person.get('last_name'))))
            or person.get('title') or str(person.get('id', 'Неизвестно')))


def normalized(message):
    if message is None:
        return None
    media = next((kind for kind in MEDIA if kind in message), None)
    value = message.get(media) if media else None
    if isinstance(value, list):
        value = value[-1] if value else {}
    identity = (value.get('file_unique_id') or value.get('file_id')) if isinstance(value, dict) else None
    return {'text': message.get('text') or message.get('caption') or '', 'media': media,
            'author_id': message.get('from', {}).get('id'), 'date': message.get('date'),
            'edited_at': message.get('edit_date'),
            'entities': message.get('entities') or message.get('caption_entities') or [],
            'media_identity': identity, 'spoiler': bool(message.get('has_media_spoiler'))}


def visible(content):
    return {key: content.get(key) for key in ('text', 'media', 'entities', 'media_identity', 'spoiler')}


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


class Archive:
    def __init__(self, directory, owner_id, clock=time.time):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.directory.chmod(0o700)
        self.owner_id, self.clock = owner_id, clock
        self.db = sqlite3.connect(self.directory / 'archive.sqlite3', timeout=10)
        (self.directory / 'archive.sqlite3').chmod(0o600)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            PRAGMA journal_mode=WAL;
            PRAGMA busy_timeout=10000;
            PRAGMA foreign_keys=ON;
            PRAGMA secure_delete=ON;
            CREATE TABLE IF NOT EXISTS archive_meta (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS processed_updates (update_id INTEGER PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL, username TEXT,
                notifications INTEGER NOT NULL DEFAULT 1, collecting INTEGER NOT NULL DEFAULT 1, avatar_path TEXT);
            CREATE TABLE IF NOT EXISTS background (
                chat_id INTEGER NOT NULL, message_id INTEGER NOT NULL, content TEXT NOT NULL,
                received_at REAL NOT NULL, PRIMARY KEY(chat_id,message_id));
            CREATE TABLE IF NOT EXISTS message_sides (
                chat_id INTEGER NOT NULL, message_id INTEGER NOT NULL,
                own INTEGER NOT NULL, PRIMARY KEY(chat_id,message_id));
            CREATE TABLE IF NOT EXISTS entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT, update_id INTEGER NOT NULL,
                chat_id INTEGER NOT NULL, message_id INTEGER NOT NULL, kind TEXT NOT NULL,
                own INTEGER NOT NULL, at REAL NOT NULL, received_at REAL NOT NULL,
                time_source TEXT NOT NULL, profile TEXT NOT NULL,
                before_content TEXT, after_content TEXT, read INTEGER NOT NULL,
                UNIQUE(update_id,chat_id,message_id,kind));
            CREATE TABLE IF NOT EXISTS message_heads (
                chat_id INTEGER NOT NULL, message_id INTEGER NOT NULL,
                entry_id INTEGER REFERENCES entries(id) ON DELETE SET NULL,
                deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(chat_id,message_id));
            CREATE TABLE IF NOT EXISTS photo_assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT, identity TEXT NOT NULL UNIQUE, file_id TEXT,
                status TEXT NOT NULL, path TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
                retry_at REAL NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS entry_photos (
                entry_id INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
                asset_id INTEGER NOT NULL REFERENCES photo_assets(id));
            CREATE TABLE IF NOT EXISTS notices (
                id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
                text TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
                retry_at REAL NOT NULL DEFAULT 0, error TEXT);
            CREATE INDEX IF NOT EXISTS entries_by_chat ON entries(chat_id,id);
            CREATE INDEX IF NOT EXISTS entries_by_message ON entries(chat_id,message_id,id);
        ''')
        row = self.db.execute("SELECT value FROM archive_meta WHERE key='owner_id'").fetchone()
        if row and int(row[0]) != owner_id:
            self.db.close()
            raise ValueError('Archive belongs to another owner')
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO archive_meta VALUES('owner_id',?)", (str(owner_id),))
            for key in ('notify_edits', 'notify_deletes'):
                self.db.execute('INSERT OR IGNORE INTO archive_meta VALUES(?,?)', (key, '1'))
            if not self.db.execute("SELECT 1 FROM archive_meta WHERE key='message_sides_initialized'").fetchone():
                for row in self.db.execute('SELECT chat_id,message_id,content FROM background').fetchall():
                    self._remember_side(row['chat_id'], row['message_id'], json.loads(row['content']))
                self.db.execute("INSERT INTO archive_meta VALUES('message_sides_initialized','1')")
        self._migrate_legacy()
        self.expire()

    def close(self):
        self.db.close()

    def expire(self):
        with self.db:
            removed = self.db.execute('DELETE FROM background WHERE received_at<=?', (self.clock() - RETENTION,)).rowcount
        for path in self.directory.glob('*.part'):
            if not path.is_symlink() and path.is_file() and path.stat().st_mtime <= self.clock() - 300:
                path.unlink(missing_ok=True)
        if removed:
            self.db.execute('PRAGMA wal_checkpoint(TRUNCATE)')

    def _migrate_legacy(self):
        tables = {row[0] for row in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'events' not in tables:
            return
        obsolete_paths = []
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            # A second process may have completed the import while this one waited.
            if not self.db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='events'").fetchone():
                return
            for row in self.db.execute('SELECT * FROM events ORDER BY update_id').fetchall():
                try:
                    source = datetime.fromisoformat(row['received_at'].replace('Z', '+00:00'))
                    received = source.replace(tzinfo=timezone.utc).timestamp() if source.tzinfo is None else source.timestamp()
                except (TypeError, ValueError, AttributeError):
                    received = 0
                self.db.execute('DELETE FROM background WHERE received_at<=?', (received - RETENTION,))
                self._project(json.loads(row['payload']), False, received)
            if 'cursor' in tables:
                row = self.db.execute('SELECT MAX(offset) FROM cursor').fetchone()
                if row and row[0]:
                    self._advance_cursor(int(row[0]) - 1)
            if 'preferences' in tables:
                for key, value in self.db.execute('SELECT name,value FROM preferences').fetchall():
                    if key in ('notify_edits', 'notify_deletes'):
                        self.db.execute('UPDATE archive_meta SET value=? WHERE key=?', (str(int(bool(value))), key))
            if 'files' in tables:
                for row in self.db.execute('SELECT file_id,path,attempts FROM files WHERE path IS NOT NULL').fetchall():
                    try:
                        path = self._local_path(row['path'])
                    except ValueError:
                        continue
                    retained = False
                    if path and path.is_file() and path.stat().st_size:
                        retained = bool(self.db.execute('''UPDATE photo_assets SET status='saved',path=?,attempts=?
                            WHERE file_id=? AND id IN (SELECT asset_id FROM entry_photos)''',
                            (row['path'], row['attempts'], row['file_id'])).rowcount)
                    if path and not retained:
                        obsolete_paths.append(path)
            for table in ('events', 'files', 'cursor', 'archive_messages', 'message_versions',
                          'notification_outbox', 'preferences', 'archive_migrations'):
                if table in tables:
                    self.db.execute(f'DROP TABLE {table}')
            self.db.execute("INSERT OR REPLACE INTO archive_meta VALUES('legacy_imported','1')")
        for path in obsolete_paths:
            if not self.db.execute('SELECT 1 FROM photo_assets WHERE path=?', (path.name,)).fetchone():
                path.unlink(missing_ok=True)
        # Remove old raw payload pages from the database and its WAL after projection.
        self.db.execute('PRAGMA wal_checkpoint(TRUNCATE)')

    def offset(self):
        row = self.db.execute("SELECT value FROM archive_meta WHERE key='offset'").fetchone()
        return int(row[0]) if row else 0

    def _advance_cursor(self, update_id):
        self.db.execute("INSERT INTO archive_meta(key,value) VALUES('offset',?) ON CONFLICT(key) DO UPDATE SET value=MAX(CAST(archive_meta.value AS INTEGER),CAST(excluded.value AS INTEGER))",
                        (str(update_id + 1),))

    def advance_cursor(self, update_id):
        with self.db:
            self._advance_cursor(update_id)

    def _profile(self, person):
        return {'id': person.get('id'), 'name': name(person), 'username': person.get('username')}

    def update_profile(self, chat_id, profile):
        with self.db:
            self._conversation(dict(profile, id=chat_id))

    def avatar_result(self, chat_id, path=None):
        local = self._local_path(path)
        if local and (not local.is_file() or local.stat().st_size == 0):
            raise ValueError('An available avatar file is required')
        if local:
            local.chmod(0o600)
        with self.db:
            row = self.db.execute('SELECT avatar_path FROM conversations WHERE id=?', (chat_id,)).fetchone()
            if not row:
                raise KeyError(chat_id)
            self.db.execute('UPDATE conversations SET avatar_path=? WHERE id=?', (path, chat_id))
            previous = self._local_path(row['avatar_path'])
            if previous and previous != local and not self.db.execute('SELECT 1 FROM conversations WHERE avatar_path=?', (row['avatar_path'],)).fetchone():
                previous.unlink(missing_ok=True)

    def avatar_path(self, chat_id):
        row = self.db.execute('SELECT avatar_path FROM conversations WHERE id=?', (chat_id,)).fetchone()
        path = self._local_path(row['avatar_path']) if row else None
        return path if path and path.is_file() else None

    def _conversation(self, person):
        self.db.execute('''INSERT INTO conversations(id,name,username) VALUES(?,?,?)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name,username=excluded.username''',
                        (person['id'], person.get('name') or name(person), person.get('username')))

    def _background(self, chat_id, mid):
        row = self.db.execute('SELECT content FROM background WHERE chat_id=? AND message_id=?',
                              (chat_id, mid)).fetchone()
        if row:
            return json.loads(row['content'])
        head = self.db.execute('''SELECT e.kind,e.after_content,e.before_content FROM message_heads h
            JOIN entries e ON e.id=h.entry_id WHERE h.chat_id=? AND h.message_id=?''', (chat_id, mid)).fetchone()
        if head:
            payload = head['before_content'] if head['kind'] == 'delete' else head['after_content']
            return json.loads(payload) if payload else None
        return None

    def _snapshot(self, chat_id, mid, content, received_at):
        self._remember_side(chat_id, mid, content)
        self.db.execute('''INSERT INTO background VALUES(?,?,?,?)
            ON CONFLICT(chat_id,message_id) DO UPDATE SET content=excluded.content,received_at=excluded.received_at''',
                        (chat_id, mid, dumps(content), received_at))

    def _remember_side(self, chat_id, mid, content):
        # Only the side bit survives background expiry, never message content.
        if content.get('author_id') is not None:
            self.db.execute('''INSERT INTO message_sides VALUES(?,?,?)
                ON CONFLICT(chat_id,message_id) DO UPDATE SET own=excluded.own''',
                            (chat_id, mid, int(content['author_id'] == self.owner_id)))

    def process(self, update, notify=True):
        self.expire()
        with self.db:
            self._project(update, notify, self.clock())

    def _project(self, update, notify, received):
        uid = update['update_id']
        kind = next((kind for kind in ('business_message', 'edited_business_message',
                                      'deleted_business_messages') if kind in update), None)
        if kind is None:
            return
        event = update[kind]
        chat_id = event['chat']['id']
        if not self.db.execute('INSERT OR IGNORE INTO processed_updates VALUES(?)', (uid,)).rowcount:
            return
        self._advance_cursor(uid)
        self._conversation(event['chat'])
        if not self.conversation_settings(chat_id)['collecting']:
            return
        if kind == 'deleted_business_messages':
            for mid in event['message_ids']:
                old = self._background(chat_id, mid)
                self._append(uid, chat_id, mid, 'delete', old, None, event['chat'], received, received, notify)
                self.db.execute('DELETE FROM background WHERE chat_id=? AND message_id=?', (chat_id, mid))
        else:
            mid, current = event['message_id'], normalized(event)
            old = self._background(chat_id, mid)
            if kind == 'edited_business_message' and (old is None or visible(old) != visible(current)):
                self._append(uid, chat_id, mid, 'edit', old, current, event['chat'],
                             event.get('edit_date', received), received, notify, 'telegram' if event.get('edit_date') else 'received')
            self._snapshot(chat_id, mid, current, received)
            if event.get('from', {}).get('id') == self.owner_id:
                self._save_reply(uid, event, received)


    def _append(self, uid, chat_id, mid, kind, before, after, profile, at, received, notify=True, time_source=None):
        content = after or before or {}
        known_side = self.db.execute('SELECT own FROM message_sides WHERE chat_id=? AND message_id=?',
                                     (chat_id, mid)).fetchone()
        own = kind == 'photo' or (content['author_id'] == self.owner_id
                                  if content.get('author_id') is not None
                                  else bool(known_side and known_side['own']))
        eid = self.db.execute('''INSERT INTO entries(update_id,chat_id,message_id,kind,own,at,received_at,
            time_source,profile,before_content,after_content,read) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)''',
            (uid, chat_id, mid, kind, int(own), at, received,
             time_source or ('telegram' if kind == 'edit' else 'received'), dumps(self._profile(profile)),
             dumps(before) if before is not None else None, dumps(after) if after is not None else None,
             int(own))).lastrowid
        if kind in ('edit', 'delete'):
            self.db.execute('''INSERT INTO message_heads VALUES(?,?,?,?)
                ON CONFLICT(chat_id,message_id) DO UPDATE SET entry_id=excluded.entry_id,deleted=excluded.deleted''',
                            (chat_id, mid, eid, int(kind == 'delete')))
        prefs = self.settings()
        dialog = self.conversation_settings(chat_id)
        enabled = prefs['notify_edits' if kind == 'edit' else 'notify_deletes']
        if kind != 'photo' and notify and not own and enabled and dialog['notifications']:

            body = ('Сообщение изменено\n' + name(profile) + '\n\nБыло:\n' + self._text(before)
                    + '\n\nСтало:\n' + self._text(after)) if kind == 'edit' else (
                        'Сообщение удалено\n' + name(profile) + '\n\n' + self._text(before))
            for start in range(0, len(body), 1800):
                self.db.execute('INSERT INTO notices(entry_id,text) VALUES(?,?)', (eid, body[start:start + 1800]))
        return eid

    def _text(self, content):
        if content is None:
            return 'Предыдущая версия не получена'
        labels = {'photo': 'Фото', 'video': 'Видео', 'document': 'Файл', 'voice': 'Голосовое сообщение',
                  'audio': 'Аудио', 'animation': 'Анимация', 'video_note': 'Видеосообщение', 'sticker': 'Стикер'}
        media = labels.get(content.get('media'), content.get('media'))
        return '\n'.join(filter(None, (f'[{media}]' if media else '', content['text']))) or 'Содержимое не сохранилось'

    def _save_reply(self, uid, event, received):
        reply = event.get('reply_to_message')
        chat_id = event['chat']['id']
        if not reply or 'photo' not in reply or reply.get('chat', {}).get('id', chat_id) != chat_id:
            return
        mid = reply.get('message_id')
        if mid is None:
            return
        existing = self.db.execute("SELECT id FROM entries WHERE chat_id=? AND message_id=? AND kind='photo'", (chat_id, mid)).fetchone()
        photo = reply['photo'][-1] if reply.get('photo') else {}
        file_id = photo.get('file_id')
        identity = photo.get('file_unique_id') or file_id or f'unavailable:{chat_id}:{mid}'
        status = 'pending' if file_id else 'unavailable'
        self.db.execute('INSERT OR IGNORE INTO photo_assets(identity,file_id,status) VALUES(?,?,?)', (identity, file_id, status))
        asset_id = self.db.execute('SELECT id FROM photo_assets WHERE identity=?', (identity,)).fetchone()[0]
        if existing:
            old = self.db.execute('SELECT a.status FROM photo_assets a JOIN entry_photos p ON p.asset_id=a.id WHERE p.entry_id=?', (existing['id'],)).fetchone()
            if old['status'] == 'unavailable' and file_id:
                self.db.execute('UPDATE entry_photos SET asset_id=? WHERE entry_id=?', (asset_id, existing['id']))
                self.db.execute('UPDATE entries SET after_content=? WHERE id=?', (dumps(normalized(reply)), existing['id']))
                self.db.execute('DELETE FROM photo_assets WHERE id NOT IN (SELECT asset_id FROM entry_photos)')
            return
        eid = self._append(uid, chat_id, mid, 'photo', None, normalized(reply), event['chat'], received, received, False)
        self.db.execute('INSERT INTO entry_photos VALUES(?,?)', (eid, asset_id))
        # A reply may be our first copy of this message. Keep that received
        # state available for a later deletion without replacing newer edits.
        self.db.execute('INSERT OR IGNORE INTO message_heads VALUES(?,?,?,0)', (chat_id, mid, eid))

    def photo_jobs(self):
        return [dict(row) for row in self.db.execute('''SELECT MIN(p.entry_id) AS id,a.file_id,a.attempts
            FROM photo_assets a JOIN entry_photos p ON p.asset_id=a.id
            WHERE a.status IN ('pending','error') AND a.attempts<3 AND a.retry_at<=?
            GROUP BY a.id ORDER BY id''', (self.clock(),))]

    def _local_path(self, relative):
        if not relative:
            return None
        path = self.directory / relative
        if path.resolve().parent != self.directory.resolve() or path.is_symlink():
            raise ValueError('Invalid archive file path')
        return path

    def photo_result(self, id, path=None, error=None):
        local = self._local_path(path) if path is not None else None
        if error is None and (local is None or not local.is_file() or local.stat().st_size == 0):
            raise ValueError('A complete downloaded file is required')
        if local:
            local.chmod(0o600)
        with self.db:
            row = self.db.execute('''SELECT a.* FROM photo_assets a JOIN entry_photos p ON p.asset_id=a.id
                WHERE p.entry_id=?''', (id,)).fetchone()
            if not row:
                if local and not self.db.execute('SELECT 1 FROM photo_assets WHERE path=?', (path,)).fetchone():
                    local.unlink(missing_ok=True)
                return
            retry = self.clock() + min(300, 5 * 2 ** min(row['attempts'], 6)) if error else 0
            self.db.execute('UPDATE photo_assets SET status=?,path=?,error=?,attempts=attempts+1,retry_at=? WHERE id=?',
                            ('error' if error else 'saved', path, str(error) if error else None, retry, row['id']))

    def photo_path(self, id):
        row = self.db.execute('''SELECT a.path,a.status FROM photo_assets a JOIN entry_photos p ON p.asset_id=a.id
            WHERE p.entry_id=?''', (id,)).fetchone()
        if not row or row['status'] != 'saved':
            return None
        path = self._local_path(row['path'])
        return path if path and path.is_file() else None

    def retry_photo(self, id):
        with self.db:
            row = self.db.execute('''SELECT a.id,a.file_id,a.status FROM photo_assets a JOIN entry_photos p ON p.asset_id=a.id
                WHERE p.entry_id=?''', (id,)).fetchone()
            if not row:
                raise KeyError(id)
            if row['file_id'] and row['status'] == 'error':
                self.db.execute("UPDATE photo_assets SET status='pending',attempts=0,retry_at=0,error=NULL WHERE id=?", (row['id'],))


    def notices(self):
        pending = self.db.execute('''SELECT n.id,n.text,n.attempts,n.retry_at,e.chat_id
            FROM notices n JOIN entries e ON e.id=n.entry_id
            WHERE n.sent=0 ORDER BY n.id LIMIT 20''').fetchall()
        result = []
        for row in pending:
            if row['retry_at'] > self.clock():
                break
            result.append({'id': row['id'], 'text': row['text'], 'attempts': row['attempts'], 'chat_id': row['chat_id']})
        return result

    def notice_result(self, id, error=None):
        with self.db:
            if error is None:
                self.db.execute('UPDATE notices SET sent=1,error=NULL WHERE id=?', (id,))
            else:
                row = self.db.execute('SELECT attempts FROM notices WHERE id=?', (id,)).fetchone()
                if row:
                    retry = self.clock() + min(300, 5 * 2 ** min(row['attempts'], 6))
                    self.db.execute('UPDATE notices SET attempts=attempts+1,retry_at=?,error=? WHERE id=?',
                                    (retry, str(error), id))

    def _entry(self, row):
        photo = self.db.execute('''SELECT a.status,a.path FROM photo_assets a JOIN entry_photos p ON p.asset_id=a.id
            WHERE p.entry_id=?''', (row['id'],)).fetchone() if row['kind'] == 'photo' else None
        status = photo['status'] if photo else None
        if status == 'saved' and self.photo_path(row['id']) is None:
            status = 'unavailable'
        return {'id': row['id'], 'chat_id': row['chat_id'], 'message_id': row['message_id'],
                'kind': row['kind'], 'own': bool(row['own']), 'at': row['at'],
                'received_at': row['received_at'], 'time_source': row['time_source'],
                'profile': json.loads(row['profile']), 'before': json.loads(row['before_content'])
                if row['before_content'] is not None else None,
                'after': json.loads(row['after_content']) if row['after_content'] is not None else None,
                'read': bool(row['read']), 'photo_status': status}

    def conversations(self, query=''):
        result = []
        for row in self.db.execute('''SELECT c.* FROM conversations c WHERE EXISTS
                (SELECT 1 FROM entries e WHERE e.chat_id=c.id)'''):
            last = self.db.execute('SELECT * FROM entries WHERE chat_id=? ORDER BY at DESC,id DESC LIMIT 1',
                                   (row['id'],)).fetchone()
            unread = self.db.execute('SELECT COUNT(*) FROM entries WHERE chat_id=? AND read=0',
                                     (row['id'],)).fetchone()[0]
            result.append({'id': row['id'], 'name': row['name'], 'username': row['username'],
                           'avatar': f'/api/conversations/{row["id"]}/avatar' if self.avatar_path(row['id']) else None, 'unread': unread, 'last_event': self._entry(last),
                           'last_event_at': last['at'], 'notifications': bool(row['notifications']),
                           'collecting': bool(row['collecting'])})
        result.sort(key=lambda item: (item['last_event_at'], item['last_event']['id']), reverse=True)
        term = query.strip().lstrip('@').casefold()
        if not term:
            return result
        ranked = []
        for item in result:
            values = [item['name'].casefold(), (item['username'] or '').casefold()]
            if term in values:
                score = 3
            elif any(term in value for value in values):
                score = 2
            else:
                candidates = values + item['name'].casefold().split()
                score = max((SequenceMatcher(None, term, value).ratio() for value in candidates), default=0)
                if len(term) < 4 or score < 0.7:
                    continue
            ranked.append((score, item))
        ranked.sort(key=lambda pair: pair[0], reverse=True)
        return [item for score, item in ranked]

    def events(self, chat_id, before=None, limit=50):
        if not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ValueError('Page limit must be between 1 and 100')
        maximum = self.db.execute('SELECT MAX(id) FROM entries WHERE chat_id=?', (chat_id,)).fetchone()[0] or 0
        params = [chat_id, maximum]
        where = 'chat_id=? AND id<=?'
        if before is not None:
            cursor = self.db.execute('SELECT at FROM entries WHERE chat_id=? AND id=?', (chat_id, before)).fetchone()
            if cursor is None:
                raise KeyError(before)
            where += ' AND (at<? OR (at=? AND id<?))'
            params.extend((cursor['at'], cursor['at'], before))
        rows = self.db.execute(f'SELECT * FROM entries WHERE {where} ORDER BY at DESC,id DESC LIMIT ?',
                               (*params, limit + 1)).fetchall()
        has_more = len(rows) > limit
        rows = list(reversed(rows[:limit]))
        return {'items': [self._entry(row) for row in rows], 'has_more': has_more,
                'next_before': rows[0]['id'] if rows and has_more else None,
                'through_id': maximum}

    def settings(self):
        values = {row['key']: row['value'] for row in self.db.execute('SELECT * FROM archive_meta')}
        enabled = None if 'connection_enabled' not in values else values['connection_enabled'] == '1'
        last = float(values['last_success_at']) if 'last_success_at' in values else None
        state = ('disconnected' if enabled is False else 'unknown' if enabled is None or last is None
                 else 'active' if self.clock() - last <= 90 else 'stale')
        return {'notify_edits': values.get('notify_edits') == '1',
                'notify_deletes': values.get('notify_deletes') == '1', 'retention_days': 30,
                'receiver': {'state': state, 'last_success_at': last, 'connection_enabled': enabled}}

    def receiver_status(self, connected=None, success=False):
        with self.db:
            if connected is not None:
                self.db.execute("INSERT OR REPLACE INTO archive_meta VALUES('connection_enabled',?)", (str(int(connected)),))
            if success:
                self.db.execute("INSERT OR REPLACE INTO archive_meta VALUES('last_success_at',?)", (str(self.clock()),))

    def update_settings(self, changes):
        if any(key not in ('notify_edits', 'notify_deletes') or not isinstance(value, bool)
               for key, value in changes.items()):
            raise ValueError('Invalid notification settings')
        with self.db:
            for key, value in changes.items():
                self.db.execute('UPDATE archive_meta SET value=? WHERE key=?', (str(int(value)), key))
                if not value:
                    kind = 'edit' if key == 'notify_edits' else 'delete'
                    self.db.execute('DELETE FROM notices WHERE sent=0 AND entry_id IN (SELECT id FROM entries WHERE kind=?)', (kind,))
        return self.settings()

    def conversation_settings(self, chat_id):
        row = self.db.execute('SELECT notifications,collecting FROM conversations WHERE id=?', (chat_id,)).fetchone()
        if not row:
            raise KeyError(chat_id)
        return {'notifications': bool(row['notifications']), 'collecting': bool(row['collecting'])}

    def update_conversation_settings(self, chat_id, changes):
        if any(key not in ('notifications', 'collecting') or not isinstance(value, bool)
               for key, value in changes.items()):
            raise ValueError('Invalid conversation settings')
        self.conversation_settings(chat_id)
        with self.db:
            for key, value in changes.items():
                self.db.execute(f'UPDATE conversations SET {key}=? WHERE id=?', (int(value), chat_id))
            if changes.get('notifications') is False:
                self.db.execute('DELETE FROM notices WHERE sent=0 AND entry_id IN (SELECT id FROM entries WHERE chat_id=?)', (chat_id,))
        return self.conversation_settings(chat_id)

    def _remove_orphan_photos(self):
        rows = self.db.execute('SELECT id,path FROM photo_assets WHERE id NOT IN (SELECT asset_id FROM entry_photos)').fetchall()
        for row in rows:
            path = self._local_path(row['path'])
            if path:
                path.unlink(missing_ok=True)
            self.db.execute('DELETE FROM photo_assets WHERE id=?', (row['id'],))

    def _scrub_deleted_content(self):
        # secure_delete clears database pages, while TRUNCATE removes older WAL
        # frames. Never report completed deletion if an active reader blocks it.
        busy, _, _ = self.db.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()
        if busy:
            raise sqlite3.OperationalError('Archive cleanup is busy; retry the deletion')

    def delete_entry(self, id):
        with self.db:
            row = self.db.execute('SELECT chat_id,message_id FROM entries WHERE id=?', (id,)).fetchone()
            if not row:
                raise KeyError(id)
            self.db.execute('DELETE FROM background WHERE chat_id=? AND message_id=?', (row['chat_id'], row['message_id']))
            self.db.execute('DELETE FROM message_sides WHERE chat_id=? AND message_id=?', (row['chat_id'], row['message_id']))
            self.db.execute('DELETE FROM entries WHERE id=?', (id,))
            self._remove_orphan_photos()
        self._scrub_deleted_content()

    def clear_conversation(self, chat_id):
        self.conversation_settings(chat_id)
        with self.db:
            self.db.execute('DELETE FROM background WHERE chat_id=?', (chat_id,))
            self.db.execute('DELETE FROM message_sides WHERE chat_id=?', (chat_id,))
            self.db.execute('DELETE FROM entries WHERE chat_id=?', (chat_id,))
            self.db.execute('DELETE FROM message_heads WHERE chat_id=?', (chat_id,))
            self._remove_orphan_photos()
        self._scrub_deleted_content()

    def clear(self):
        with self.db:
            self.db.execute('DELETE FROM background')
            self.db.execute('DELETE FROM message_sides')
            self.db.execute('DELETE FROM entries')
            self.db.execute('DELETE FROM message_heads')
            self._remove_orphan_photos()
        self._scrub_deleted_content()

    def mark_read(self, chat_id, ids=None, through_id=None):
        if (ids is None) == (through_id is None):
            raise ValueError('Specify event ids or through_id')
        with self.db:
            if ids is not None:
                if ids:
                    placeholders = ','.join('?' for _ in ids)
                    self.db.execute(f'UPDATE entries SET read=1 WHERE chat_id=? AND id IN ({placeholders})',
                                    (chat_id, *ids))
            else:
                self.db.execute('UPDATE entries SET read=1 WHERE chat_id=? AND id<=?', (chat_id, through_id))
        count = self.db.execute('SELECT COUNT(*) FROM entries WHERE chat_id=? AND read=0', (chat_id,)).fetchone()[0]
        return {'unread': count}

    def history(self, chat_id, message_id):
        rows = self.db.execute('SELECT * FROM entries WHERE chat_id=? AND message_id=? ORDER BY id',
                               (chat_id, message_id)).fetchall()
        if not rows:
            return {'items': [], 'original_missing': True}
        first = self._entry(rows[0])
        initial = first['after'] if first['kind'] == 'photo' else first['before']
        items = []
        if initial is not None:
            items.append({'kind': 'edit' if initial.get('edited_at') else 'original',
                          'at': initial.get('edited_at') or initial.get('date'), 'content': initial,
                          'time_source': 'telegram'})
        for row in rows:
            entry = self._entry(row)
            if entry['kind'] == 'photo':
                continue
            items.append({'kind': entry['kind'], 'at': entry['at'],
                          'content': entry['after'] if entry['kind'] in ('edit', 'photo') else entry['before'],
                          'time_source': entry['time_source']})
        return {'items': items, 'original_missing': initial is None or bool(initial.get('edited_at'))}
