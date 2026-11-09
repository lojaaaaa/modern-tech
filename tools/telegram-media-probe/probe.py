"""Owner-only Telegram Business archive receiver. Python 3.10+, stdlib only."""

import getpass
import hashlib
import http.client
import json
import os
from pathlib import Path
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
        except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException, ValueError):
            raise ApiError(f"{method}: network failure") from None
        if not isinstance(result, dict) or result.get('ok') is not True or 'result' not in result:
            raise ApiError(f'{method}: API failure')
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
                temporary.chmod(0o600)
                length = response.headers.get('Content-Length')
                while chunk := response.read(65536):
                    total += len(chunk)
                    if total > 20 * 1024 * 1024:
                        raise ApiError("download: prototype 20 MiB limit")
                    output.write(chunk)
            if total == 0:
                raise ApiError("download: empty file")
            if file.get('file_size') is not None and total != file['file_size']:
                raise ApiError('download: incomplete file')
            if length is not None and total != int(length):
                raise ApiError('download: incomplete response')
            temporary.replace(destination)
        except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException, ValueError):
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


class Probe:
    """One receiver for the owner's allowed business conversations."""

    def __init__(self, api, owner, chat, directory, *, clock=time.time, webapp_url=None):
        if webapp_url:
            parsed = urllib.parse.urlsplit(webapp_url)
            if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError('Mini App needs an HTTPS URL without credentials')
        self.api, self.owner, self.chat = api, owner, chat
        self.directory = Path(directory)
        self.archive = archive.Archive(directory, owner, clock=clock)
        self.clock = clock
        self.webapp_url = webapp_url
        self.connections = {}
        self.profile_checked = {}
        self.avatar_ids = {}
        self.archive.receiver_status(connected=False)

    def close(self):
        self.archive.receiver_status(connected=False)
        self.archive.close()

    def offset(self):
        return self.archive.offset()

    def poll_once(self):
        self.archive.expire()
        self.download_pending()
        self.deliver_notifications()
        try:
            for cid in list(self.connections):
                connection = self.api.call('getBusinessConnection', business_connection_id=cid)
                self.connections[cid] = (connection.get('user', {}).get('id') == self.owner
                                         and connection.get('is_enabled') is True)
            self.archive.receiver_status(connected=any(self.connections.values()))
            updates = self.api.call('getUpdates', offset=self.offset(), timeout=20,
                                    allowed_updates=['message', 'business_connection', 'business_message',
                                                     'edited_business_message', 'deleted_business_messages'])
            for update in updates:
                self.ingest(update)
            self.archive.receiver_status(success=True)
        except ApiError:
            self.archive.receiver_status(connected=False)
            raise

    def ingest(self, update):
        uid = update['update_id']
        if uid < self.offset():
            return
        if 'business_connection' in update:
            connection = update['business_connection']
            if connection.get('user', {}).get('id') == self.owner:
                self.connections[connection['id']] = connection.get('is_enabled') is True
                self.archive.receiver_status(connected=any(self.connections.values()))
        if 'message' in update:
            self.handle_command(update['message'])
        kind = next((key for key in ('business_message', 'edited_business_message',
                                     'deleted_business_messages') if key in update), None)
        if kind:
            event = update[kind]
            chat = event.get('chat', {})
            if chat.get('type') != 'private' or (self.chat not in (None, 0) and chat.get('id') != self.chat):
                self.archive.advance_cursor(uid)
                return
            try:
                connection = self.api.call('getBusinessConnection', business_connection_id=event['business_connection_id'])
            except ApiError:
                self.archive.receiver_status(connected=False)
                raise
            if connection.get('user', {}).get('id') != self.owner:
                self.archive.advance_cursor(uid)
                return
            enabled = connection.get('is_enabled') is True
            self.connections[event['business_connection_id']] = enabled
            self.archive.receiver_status(connected=any(self.connections.values()))
            if enabled and self.chat != 0:
                self.archive.process(update)
                self.download_pending()
                self.deliver_notifications()
                self.refresh_profile(chat['id'])
            else:
                if enabled and self.chat == 0:
                    print(f"Discovered business chat ID: {chat['id']} (not archived)", flush=True)
                self.archive.advance_cursor(uid)
        else:
            self.archive.advance_cursor(uid)

    def deliver_notifications(self):
        for notice in self.archive.notices():
            # HTTP may have cleared or muted this record after the batch was read.
            if not any(current['id'] == notice['id'] for current in self.archive.notices()):
                continue
            try:
                self.api.call('sendMessage', chat_id=self.owner, text=notice['text'],
                              **self.launch_button(notice['chat_id']))
            except ApiError as error:
                self.archive.notice_result(notice['id'], error=str(error))
                break
            self.archive.notice_result(notice['id'])

    def launch_button(self, chat_id=None):
        if not self.webapp_url:
            return {}
        url = self.webapp_url
        if chat_id is not None:
            parsed = urllib.parse.urlsplit(url)
            params = [(key, value) for key, value in urllib.parse.parse_qsl(parsed.query) if key != 'chat']
            params.append(('chat', str(chat_id)))
            url = urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(params)))
        button = {'text': 'Открыть диалог' if chat_id is not None else 'Открыть архив', 'web_app': {'url': url}}
        return {'reply_markup': {'inline_keyboard': [[button]]}}

    def download_pending(self):
        for job in self.archive.photo_jobs():
            if not any(current['id'] == job['id'] for current in self.archive.photo_jobs()):
                continue
            filename = f"photo-{job['id']}-{hashlib.sha256(job['file_id'].encode()).hexdigest()[:24]}.jpg"
            try:
                self.api.download(job['file_id'], self.directory / filename)
                self.archive.photo_result(job['id'], path=filename)
            except (ApiError, OSError, ValueError):
                (self.directory / filename).unlink(missing_ok=True)
                self.archive.photo_result(job['id'], error='Не удалось скачать полный файл фото.')

    def refresh_profile(self, chat_id):
        if not self.archive.conversation_settings(chat_id)['collecting']:
            return
        if self.clock() - self.profile_checked.get(chat_id, 0) < 60:
            return
        self.profile_checked[chat_id] = self.clock()
        try:
            profile = self.api.call('getChat', chat_id=chat_id)
            if profile.get('id') != chat_id:
                return
            self.archive.update_profile(chat_id, profile)
            photo = profile.get('photo') or {}
            file_id = photo.get('small_file_id')
            if not file_id:
                self.archive.avatar_result(chat_id, None)
                self.avatar_ids.pop(chat_id, None)
                return
            identity = photo.get('small_file_unique_id') or file_id
            if self.avatar_ids.get(chat_id) == identity and self.archive.avatar_path(chat_id):
                return
            filename = f'avatar-{chat_id}-{hashlib.sha256(identity.encode()).hexdigest()[:24]}.jpg'
            self.api.download(file_id, self.directory / filename)
            self.archive.avatar_result(chat_id, filename)
            self.avatar_ids[chat_id] = identity
        except (ApiError, OSError, ValueError):
            # An unavailable profile does not make a received event disappear.
            return

    def handle_command(self, message):
        chat = message.get('chat', {})
        if message.get('from', {}).get('id') != self.owner or chat.get('id') != self.owner or chat.get('type') != 'private':
            return
        text = message.get('text', '')
        command = text.split()[0].split('@')[0] if text else ''
        if command in {'/edits_on', '/edits_off', '/deletes_on', '/deletes_off'}:
            key = 'notify_edits' if command.startswith('/edits') else 'notify_deletes'
            self.archive.update_settings({key: command.endswith('_on')})
            self.api.call('sendMessage', chat_id=self.owner, text='Настройка уведомлений сохранена.')
        elif command == '/start':
            self.api.call('sendMessage', chat_id=self.owner,
                          text='Личный архив изменений, удалений и фото, сохранённых по вашему ответу. '
                               '/photos — последние сохранённые фото. /notifications — уведомления.',
                          **self.launch_button())
        elif command == '/notifications' or text == 'Уведомления':
            settings = self.archive.settings()
            self.api.call('sendMessage', chat_id=self.owner,
                          text='Уведомления в этот чат:\nИзменения: ' + ('включены' if settings['notify_edits'] else 'выключены')
                               + '\nУдаления: ' + ('включены' if settings['notify_deletes'] else 'выключены')
                               + '\n\n/edits_on · /edits_off\n/deletes_on · /deletes_off')
        elif command == '/photos' or text == 'Сохранённые фото':
            photos = []
            for conversation in self.archive.conversations():
                before, found = None, 0
                while found < 5:
                    page = self.archive.events(conversation['id'], before=before, limit=100)
                    for entry in reversed(page['items']):
                        if entry['kind'] == 'photo' and entry['photo_status'] == 'saved':
                            photos.append(entry)
                            found += 1
                            if found == 5:
                                break
                    if not page['has_more']:
                        break
                    before = page['next_before']
            photos.sort(key=lambda entry: (entry['at'], entry['id']), reverse=True)
            if not photos:
                self.api.call('sendMessage', chat_id=self.owner, text='Сохранённых фото пока нет.')
            for entry in photos[:5]:
                path = self.archive.photo_path(entry['id'])
                if path is not None:
                    try:
                        self.api.send_photo(self.owner, path, 'Сохранённое фото')
                    except FileNotFoundError:
                        self.api.call('sendMessage', chat_id=self.owner, text='Файл фото отсутствует в архиве.')


def main():
    from config import load_env

    os.umask(0o077)
    config = load_env()
    token = config.get('TELEGRAM_BOT_TOKEN') or getpass.getpass('Bot token (hidden): ')
    try:
        owner = int(config.get('TELEGRAM_OWNER_ID') or input('Your numeric Telegram user ID: '))
        scope = config.get('TELEGRAM_CHAT_ID', '').strip()
        chat = int(scope) if scope else None
        if owner <= 0 or (chat is not None and chat < 0):
            raise ValueError
    except ValueError:
        raise SystemExit('Telegram owner/chat IDs must be numeric positive IDs; 0 enables discovery only.') from None
    api = Telegram(token)
    if api.call("getWebhookInfo").get("url"):
        raise SystemExit("Webhook is configured. Use a separate test bot; no settings were changed.")
    me = api.call("getMe")
    if not me.get("can_connect_to_business"):
        raise SystemExit("Enable Secretary Mode in @BotFather first.")
    directory = Path(config.get('TELEGRAM_DATA_DIR') or Path(__file__).parent / 'data').expanduser()
    probe = Probe(api, owner, chat, directory, webapp_url=config.get('TELEGRAM_WEBAPP_URL') or None)
    print(f"Listening as @{me['username']}. Ctrl+C to stop.", flush=True)
    if chat == 0:
        print("Discovery only: no messages or media are archived. Send a test message in a connected chat.", flush=True)
    try:
        while True:
            try:
                probe.poll_once()
            except ApiError as error:
                print(str(error), flush=True)
                time.sleep(5)
    finally:
        probe.close()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Stopped.")
    except ApiError as error:
        raise SystemExit(str(error)) from None
