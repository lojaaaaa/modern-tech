"""Owner-only HTTP API for the local Telegram archive. Python 3.10+."""

import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
from pathlib import Path
import time
from urllib.parse import parse_qsl, urlsplit

from archive import Archive


WEB = Path(__file__).parent / 'web'
STATIC = {'/': ('index.html', 'text/html; charset=utf-8'),
          '/index.html': ('index.html', 'text/html; charset=utf-8'),
          '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
          '/style.css': ('style.css', 'text/css; charset=utf-8')}


class RequestError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message


def verify_launch_data(header, token, owner_id, now):
    invalid = RequestError(401, 'Откройте архив заново из Telegram.')
    if not header or not header.startswith('Telegram ') or len(header) > 16384:
        raise invalid
    try:
        pairs = parse_qsl(header[9:], keep_blank_values=True, strict_parsing=True,
                          encoding='utf-8', errors='strict', max_num_fields=64)
        fields = dict(pairs)
        if len(fields) != len(pairs):
            raise invalid
        digest = fields.pop('hash')
        if len(digest) != 64:
            raise invalid
        secret = hmac.digest(b'WebAppData', token.encode(), 'sha256')
        check = '\n'.join(f'{key}={fields[key]}' for key in sorted(fields))
        expected = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, digest):
            raise invalid
        timestamp = int(fields['auth_date'])
        if now - timestamp > 3600 or timestamp > now + 30:
            raise invalid
        user = json.loads(fields['user'])
        if not isinstance(user, dict) or type(user.get('id')) is not int:
            raise invalid
    except (KeyError, ValueError, TypeError, UnicodeError):
        raise invalid from None
    if user['id'] != owner_id:
        raise RequestError(403, 'Архив доступен только владельцу.')


def unique_fields(pairs):
    result = dict(pairs)
    if len(result) != len(pairs):
        raise ValueError('Duplicate JSON keys')
    return result


def number(value, signed=False):
    if not re.fullmatch(r'-?[0-9]+' if signed else r'[0-9]+', value):
        raise RequestError(400, 'Некорректный идентификатор.')
    result = int(value)
    if result == 0 or not -(2**63)+1 <= result <= 2**63-1:
        raise RequestError(400, 'Некорректный идентификатор.')
    return result


def make_server(directory, owner_id, token, host='127.0.0.1', port=0, clock=time.time):
    if not token or type(owner_id) is not int or owner_id <= 0:
        raise ValueError('A bot token and numeric owner ID are required')

    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def log_message(self, format, *args):
            # URLs, headers and payloads can contain correspondence or credentials.
            pass

        def respond(self, status, payload, content_type='application/json; charset=utf-8'):
            data = payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'none'")
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Connection', 'close')
            self.end_headers()
            self.close_connection = True
            self.wfile.write(data)

        def body(self):
            if self.headers.get('Transfer-Encoding') is not None:
                raise RequestError(400, 'Некорректное тело запроса.')
            values = self.headers.get_all('Content-Length', [])
            if len(values) != 1 or not re.fullmatch(r'[0-9]+', values[0]):
                raise RequestError(400, 'Требуется JSON запроса.')
            length = int(values[0])
            if length == 0:
                raise RequestError(400, 'Требуется JSON запроса.')
            if length > 65536:
                raise RequestError(413, 'Запрос слишком большой.')
            if self.headers.get_content_type() != 'application/json':
                raise RequestError(415, 'Требуется JSON запроса.')
            try:
                data = json.loads(self.rfile.read(length), object_pairs_hook=unique_fields)
            except (ValueError, UnicodeError):
                raise RequestError(400, 'Некорректный JSON запроса.') from None
            if not isinstance(data, dict):
                raise RequestError(400, 'Требуется объект JSON.')
            return data

        def route(self, store, path, query):
            method = self.command
            if path == '/api/conversations':
                if method != 'GET':
                    raise RequestError(405, 'Действие не поддерживается.')
                if set(query) - {'q'} or len(query.get('q', '')) > 256:
                    raise RequestError(400, 'Некорректный поиск.')
                return {'items': store.conversations(query.get('q', ''))}
            match = re.fullmatch(r'/api/conversations/(-?[0-9]+)/settings', path)
            if path == '/api/settings' or match:
                if method not in ('GET', 'PATCH'):
                    raise RequestError(405, 'Действие не поддерживается.')
                if query:
                    raise RequestError(400, 'Некорректный запрос настроек.')
                if path == '/api/settings':
                    return store.settings() if method == 'GET' else store.update_settings(self.body())
                chat = number(match[1], signed=True)
                return store.conversation_settings(chat) if method == 'GET' else store.update_conversation_settings(chat, self.body())
            match = re.fullmatch(r'/api/conversations/(-?[0-9]+)/events', path)
            if match:
                if method != 'GET':
                    raise RequestError(405, 'Действие не поддерживается.')
                if set(query) - {'before', 'limit'}:
                    raise RequestError(400, 'Некорректная страница событий.')
                chat = number(match[1], signed=True)
                store.conversation_settings(chat)
                before = number(query['before']) if 'before' in query else None
                limit = number(query.get('limit', '50'))
                if limit > 100:
                    raise RequestError(400, 'Некорректный размер страницы.')
                return store.events(chat, before=before, limit=limit)
            match = re.fullmatch(r'/api/conversations/(-?[0-9]+)/messages/([0-9]+)/history', path)
            if match:
                if method != 'GET':
                    raise RequestError(405, 'Действие не поддерживается.')
                if query:
                    raise RequestError(400, 'Некорректный запрос истории.')
                chat = number(match[1], signed=True)
                store.conversation_settings(chat)
                return store.history(chat, number(match[2]))
            match = re.fullmatch(r'/api/conversations/(-?[0-9]+)/read', path)
            if match:
                if method != 'POST':
                    raise RequestError(405, 'Действие не поддерживается.')
                if query:
                    raise RequestError(400, 'Некорректный запрос прочтения.')
                chat = number(match[1], signed=True)
                store.conversation_settings(chat)
                data = self.body()
                if set(data) == {'ids'}:
                    ids = data['ids']
                    if not isinstance(ids, list) or len(ids) > 100 or any(type(id) is not int or not 1 <= id <= 2**63-1 for id in ids):
                        raise RequestError(400, 'Некорректные записи для прочтения.')
                    return store.mark_read(chat, ids=ids)
                if set(data) == {'through_id'} and type(data['through_id']) is int and 0 <= data['through_id'] <= 2**63-1:
                    return store.mark_read(chat, through_id=data['through_id'])
                raise RequestError(400, 'Укажите записи или границу прочтения.')
            entry = re.fullmatch(r'/api/entries/([0-9]+)', path)
            conversation = re.fullmatch(r'/api/conversations/(-?[0-9]+)', path)
            if entry or conversation or path == '/api/archive':
                if method != 'DELETE':
                    raise RequestError(405, 'Действие не поддерживается.')
                data = self.body()
                if query or set(data) != {'confirm'} or data['confirm'] is not True:
                    raise RequestError(400, 'Подтвердите удаление выбранных данных.')
                if entry:
                    store.delete_entry(number(entry[1]))
                elif conversation:
                    store.clear_conversation(number(conversation[1], signed=True))
                else:
                    store.clear()
                return {'ok': True}
            match = re.fullmatch(r'/api/entries/([0-9]+)/retry', path)
            if match:
                if method != 'POST':
                    raise RequestError(405, 'Действие не поддерживается.')
                if query or self.body():
                    raise RequestError(400, 'Некорректный запрос повтора.')
                store.retry_photo(number(match[1]))
                return {'ok': True}
            photo = re.fullmatch(r'/api/entries/([0-9]+)/photo', path)
            avatar = re.fullmatch(r'/api/conversations/(-?[0-9]+)/avatar', path)
            if photo or avatar:
                if method != 'GET':
                    raise RequestError(405, 'Действие не поддерживается.')
                if query:
                    raise RequestError(400, 'Некорректный запрос изображения.')
                location = store.photo_path(number(photo[1])) if photo else store.avatar_path(number(avatar[1], signed=True))
                if location is None:
                    raise RequestError(404, 'Файл недоступен.')
                try:
                    return location.read_bytes(), 'image/jpeg'
                except FileNotFoundError:
                    raise RequestError(404, 'Файл недоступен.') from None
            raise RequestError(404, 'Запись не найдена.')

        def do_request(self):
            store = None
            try:
                parsed = urlsplit(self.path)
                if parsed.scheme or parsed.netloc or parsed.fragment:
                    raise RequestError(400, 'Некорректный адрес запроса.')
                if parsed.path.startswith('/api/'):
                    if len(self.headers.get_all('Authorization', [])) != 1:
                        raise RequestError(401, 'Откройте архив заново из Telegram.')
                    verify_launch_data(self.headers.get('Authorization'), token, owner_id, clock())
                    if self.command == 'GET' and (self.headers.get('Transfer-Encoding') is not None or self.headers.get('Content-Length') not in (None, '0')):
                        raise RequestError(400, 'GET-запрос не принимает тело.')
                    store = Archive(directory, owner_id, clock)
                    pairs = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True,
                                      errors='strict', max_num_fields=8)
                    query = dict(pairs)
                    if len(query) != len(pairs):
                        raise RequestError(400, 'Повторяющиеся параметры запроса.')
                    result = self.route(store, parsed.path, query)
                    if isinstance(result, tuple):
                        self.respond(200, result[0], result[1])
                    else:
                        self.respond(200, result)
                elif parsed.path in STATIC:
                    if self.command != 'GET':
                        raise RequestError(405, 'Действие не поддерживается.')
                    filename, content_type = STATIC[parsed.path]
                    asset = WEB / filename
                    if asset.is_symlink() or not asset.is_file():
                        raise RequestError(404, 'Страница не найдена.')
                    self.respond(200, asset.read_bytes(), content_type)
                else:
                    raise RequestError(404, 'Страница не найдена.')
            except RequestError as error:
                self.respond(error.status, {'error': error.message})
            except KeyError:
                self.respond(404, {'error': 'Запись не найдена.'})
            except (ValueError, TypeError, UnicodeError):
                self.respond(400, {'error': 'Некорректный запрос.'})
            except Exception:
                self.respond(500, {'error': 'Не удалось выполнить запрос. Повторите попытку.'})
            finally:
                if store is not None:
                    store.close()

        do_GET = do_POST = do_PATCH = do_DELETE = do_PUT = do_OPTIONS = do_request

    return ThreadingHTTPServer((host, port), Handler)


def main():
    from config import load_env

    settings = load_env()
    token = settings.get('TELEGRAM_BOT_TOKEN', '').strip()
    try:
        owner_id = int(settings.get('TELEGRAM_OWNER_ID', ''))
        port = int(settings.get('TELEGRAM_PORT') or '8787')
        if not token or owner_id <= 0 or not 1 <= port <= 65535:
            raise ValueError
    except ValueError:
        raise SystemExit('Укажите TELEGRAM_BOT_TOKEN, числовой TELEGRAM_OWNER_ID и порт 1–65535.') from None
    host = settings.get('TELEGRAM_HOST') or '127.0.0.1'
    directory = Path(settings.get('TELEGRAM_DATA_DIR') or Path(__file__).parent / 'data').expanduser()
    try:
        app = make_server(directory, owner_id, token, host=host, port=port)
    except OSError:
        raise SystemExit('Не удалось запустить HTTP-сервер. Проверьте адрес и порт.') from None
    print(f'Архив доступен локально: http://{host}:{port}. Ctrl+C для остановки.', flush=True)
    try:
        app.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        app.server_close()


if __name__ == '__main__':
    main()
