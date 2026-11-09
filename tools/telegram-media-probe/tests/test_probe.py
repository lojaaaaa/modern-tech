import tempfile
from pathlib import Path
import unittest

from archive import Archive
from probe import ApiError, Probe

OWNER = 100
PARTNER = 201


def message(uid, chat=PARTNER, mid=1, text='Исходное', *, kind='business_message', author=None, connection='mine', **extra):
    body = {'business_connection_id': connection, 'message_id': mid,
            'chat': {'id': chat, 'type': 'private', 'first_name': f'Собеседник {chat}'},
            'from': {'id': author or chat, 'first_name': 'Автор'}, 'date': 1700000000, 'text': text, **extra}
    if kind == 'edited_business_message':
        body['edit_date'] = 1700000010 + uid
    return {'update_id': uid, kind: body}


class FakeTelegram:
    def __init__(self):
        self.connections = {'mine': {'id': 'mine', 'user': {'id': OWNER}, 'is_enabled': True},
                            'foreign': {'id': 'foreign', 'user': {'id': 999}, 'is_enabled': True},
                            'disabled': {'id': 'disabled', 'user': {'id': OWNER}, 'is_enabled': False}}
        self.sent = []
        self.downloads = []
        self.fail_send = False
        self.fail_poll = False
        self.fail_download = False
        self.updates = []
        self.on_send = None
        self.profiles = {}
        self.fail_connection = False

    def call(self, method, **params):
        if method == 'getBusinessConnection':
            if self.fail_connection:
                raise ApiError('getBusinessConnection: network failure')
            return self.connections[params['business_connection_id']]
        if method == 'getUpdates':
            if self.fail_poll:
                raise ApiError('getUpdates: network failure')
            updates, self.updates = self.updates, []
            return updates
        if method == 'getChat':
            if params['chat_id'] in self.profiles:
                return self.profiles[params['chat_id']]
            raise ApiError('getChat: unavailable')
        if method == 'sendMessage':
            if self.fail_send:
                raise ApiError('sendMessage: network failure')
            self.sent.append(params)
            if self.on_send:
                self.on_send()
            return {'message_id': len(self.sent)}
        raise AssertionError(f'Unexpected external API method {method}')

    def download(self, file_id, destination):
        self.downloads.append(file_id)
        if self.fail_download:
            raise ApiError('download: network failure')
        destination.write_bytes(b'complete-image')

    def send_photo(self, chat_id, path, caption):
        self.sent.append({'chat_id': chat_id, 'photo': path.read_bytes(), 'caption': caption})


class ProbeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = Path(self.tmp.name)
        self.api = FakeTelegram()
        self.probe = None
        self.now = 1800000000

    def tearDown(self):
        if self.probe:
            self.probe.close()
        self.tmp.cleanup()

    def start(self, chat=None, **kwargs):
        kwargs.setdefault('clock', lambda: self.now)
        self.probe = Probe(self.api, OWNER, chat, self.directory, **kwargs)
        return self.probe

    def store(self):
        return Archive(self.directory, OWNER, clock=lambda: self.now)

    def test_all_authorized_owner_chats_are_archived_and_other_connections_are_rejected(self):
        probe = self.start()
        for uid, chat, connection in ((1, PARTNER, 'mine'), (3, 202, 'mine'), (5, 203, 'foreign'), (7, 204, 'disabled')):
            probe.ingest(message(uid, chat, connection=connection))
            probe.ingest(message(uid + 1, chat, text='Новая версия', kind='edited_business_message', connection=connection))
        store = self.store()
        try:
            self.assertEqual([202, PARTNER], [item['id'] for item in store.conversations()])
            self.assertEqual(9, probe.offset())
            self.assertTrue(all(item['chat_id'] == OWNER for item in self.api.sent))
        finally:
            store.close()

    def test_pending_photo_failure_is_visible_and_restart_retries_without_false_success(self):
        probe = self.start()
        self.api.fail_download = True
        reply = {'message_id': 7, 'chat': {'id': PARTNER}, 'photo': [{'file_id': 'photo', 'file_unique_id': 'unique'}]}
        probe.ingest(message(1, author=OWNER, reply_to_message=reply))
        missing = {'message_id': 8, 'chat': {'id': PARTNER}, 'photo': []}
        probe.ingest(message(2, mid=2, author=OWNER, reply_to_message=missing))
        store = self.store()
        try:
            entries = store.events(PARTNER)['items']
            self.assertEqual(['error', 'unavailable'], [entry['photo_status'] for entry in entries])
            self.assertIsNone(store.photo_path(entries[0]['id']))
        finally:
            store.close()
        probe.close()
        self.now += 6
        self.api.fail_download = False
        probe = self.start()
        probe.poll_once()
        store = self.store()
        try:
            self.assertEqual(['saved', 'unavailable'], [entry['photo_status'] for entry in store.events(PARTNER)['items']])
            self.assertEqual(['photo', 'photo'], self.api.downloads)
        finally:
            store.close()

    def test_owner_commands_only_work_in_owners_private_chat_and_own_edits_stay_silent(self):
        probe = self.start()
        for uid, author, chat, kind in ((1, 999, OWNER, 'private'), (2, OWNER, 555, 'group')):
            probe.ingest({'update_id': uid, 'message': {'from': {'id': author}, 'chat': {'id': chat, 'type': kind}, 'text': '/edits_off'}})
        self.assertEqual([], self.api.sent)
        probe.ingest({'update_id': 3, 'message': {'from': {'id': OWNER}, 'chat': {'id': OWNER, 'type': 'private'}, 'text': '/edits_off'}})
        self.assertEqual(1, len(self.api.sent))
        store = self.store()
        try:
            self.assertFalse(store.settings()['notify_edits'])
        finally:
            store.close()
        probe.ingest(message(4, author=OWNER))
        probe.ingest(message(5, text='Моя правка', kind='edited_business_message', author=OWNER))
        store = self.store()
        try:
            self.assertEqual(0, store.conversations()[0]['unread'])
            self.assertTrue(store.events(PARTNER)['items'][0]['own'])
            self.assertEqual(1, len(self.api.sent))
        finally:
            store.close()

    def test_only_owner_reply_downloads_photo_once_and_sends_nothing_to_partner(self):
        probe = self.start()
        incoming = message(1, text='', photo=[{'file_id': 'full-photo', 'file_unique_id': 'same-photo'}])
        probe.ingest(incoming)
        reply = incoming['business_message']
        probe.ingest(message(2, mid=2, reply_to_message=reply))
        self.assertEqual([], self.api.downloads)
        probe.ingest(message(3, mid=3, author=OWNER, reply_to_message=reply))
        probe.ingest(message(3, mid=3, author=OWNER, reply_to_message=reply))
        probe.ingest(message(4, mid=4, author=OWNER, reply_to_message=reply))
        self.assertEqual(['full-photo'], self.api.downloads)
        store = self.store()
        try:
            entries = store.events(PARTNER)['items']
            self.assertEqual(1, len(entries))
            self.assertEqual('saved', entries[0]['photo_status'])
            self.assertEqual(b'complete-image', store.photo_path(entries[0]['id']).read_bytes())
            self.assertEqual(0, store.conversations()[0]['unread'])
            self.assertEqual([], self.api.sent)
        finally:
            store.close()

    def test_receiver_status_requires_actual_poll_and_rechecks_connection_loss_and_recovery(self):
        probe = self.start()
        self.api.updates = [message(1)]
        probe.poll_once()
        store = self.store()
        try:
            self.assertEqual('active', store.settings()['receiver']['state'])
            self.assertEqual(self.now, store.settings()['receiver']['last_success_at'])
        finally:
            store.close()
        self.api.connections['mine']['is_enabled'] = False
        probe.poll_once()
        store = self.store()
        try:
            self.assertEqual('disconnected', store.settings()['receiver']['state'])
        finally:
            store.close()
        self.api.connections['mine']['is_enabled'] = True
        probe.poll_once()
        self.api.fail_poll = True
        with self.assertRaises(ApiError):
            probe.poll_once()
        store = self.store()
        try:
            self.assertEqual('disconnected', store.settings()['receiver']['state'])
        finally:
            store.close()
        self.api.fail_poll = False
        probe.poll_once()
        probe.ingest({'update_id': 2, 'business_connection': {'id': 'mine', 'user': {'id': OWNER}, 'is_enabled': False}})
        store = self.store()
        try:
            self.assertEqual('disconnected', store.settings()['receiver']['state'])
            self.assertEqual(3, probe.offset())
        finally:
            store.close()

    def test_clear_during_first_notice_delivery_cancels_remaining_notice_parts(self):
        probe = self.start()
        probe.ingest(message(1))
        def clear_after_first_send():
            store = self.store()
            try:
                store.clear()
            finally:
                store.close()
        self.api.on_send = clear_after_first_send
        probe.ingest(message(2, text='Длинная правка. ' * 700, kind='edited_business_message'))
        self.assertEqual(1, len(self.api.sent))
        store = self.store()
        try:
            self.assertEqual([], store.conversations())
            self.assertEqual([], store.notices())
        finally:
            store.close()

    def test_failed_notice_is_retried_to_owner_and_does_not_mark_event_read(self):
        probe = self.start()
        self.api.fail_send = True
        probe.ingest(message(1))
        probe.ingest(message(2, text='Сохранить всю правку', kind='edited_business_message'))
        store = self.store()
        try:
            self.assertEqual(1, store.conversations()[0]['unread'])
        finally:
            store.close()
        self.now += 6
        self.api.fail_send = False
        probe.poll_once()
        store = self.store()
        try:
            self.assertEqual(1, store.conversations()[0]['unread'])
            self.assertEqual([], store.notices())
            self.assertEqual(OWNER, self.api.sent[0]['chat_id'])
            self.assertIn('Сохранить всю правку', self.api.sent[0]['text'])
        finally:
            store.close()

    def test_owner_can_launch_https_mini_app_and_notice_opens_its_conversation(self):
        import urllib.parse
        probe = self.start(webapp_url='https://archive.example.test/app?view=archive')
        probe.ingest({'update_id': 1, 'message': {'from': {'id': OWNER}, 'chat': {'id': OWNER, 'type': 'private'}, 'text': '/start'}})
        launch = self.api.sent[0]['reply_markup']['inline_keyboard'][0][0]
        self.assertEqual('Открыть архив', launch['text'])
        self.assertEqual('https://archive.example.test/app?view=archive', launch['web_app']['url'])
        probe.ingest(message(2))
        probe.ingest(message(3, text='Новое содержимое', kind='edited_business_message'))
        notice = self.api.sent[-1]['reply_markup']['inline_keyboard'][0][0]
        self.assertEqual('Открыть диалог', notice['text'])
        self.assertEqual({'view': ['archive'], 'chat': [str(PARTNER)]}, urllib.parse.parse_qs(urllib.parse.urlsplit(notice['web_app']['url']).query))
        self.assertEqual(OWNER, self.api.sent[-1]['chat_id'])

    def test_webapp_rejects_insecure_or_credential_bearing_urls(self):
        for url in ('http://archive.example.test', 'https://user:password@archive.example.test', 'file:///tmp/archive'):
            with self.assertRaises(ValueError):
                self.start(webapp_url=url)

    def test_available_telegram_profile_and_avatar_refresh_without_changing_event_snapshot(self):
        probe = self.start()
        self.api.profiles[PARTNER] = {'id': PARTNER, 'type': 'private', 'first_name': 'Алексей', 'username': 'Alex',
                                      'photo': {'small_file_id': 'avatar1', 'small_file_unique_id': 'avatar-one'}}
        probe.ingest(message(1))
        probe.ingest(message(2, text='Правка', kind='edited_business_message'))
        store = self.store()
        try:
            initial = store.events(PARTNER)['items'][0]
        finally:
            store.close()
        self.api.profiles[PARTNER] = {'id': PARTNER, 'type': 'private', 'first_name': 'Новое имя', 'username': 'NewNick',
                                      'photo': {'small_file_id': 'avatar2', 'small_file_unique_id': 'avatar-two'}}
        self.now += 61
        probe.ingest(message(3, mid=2, text='Обычное сообщение'))
        store = self.store()
        try:
            item = store.conversations()[0]
            self.assertEqual('Новое имя', item['name'])
            self.assertEqual('NewNick', item['username'])
            self.assertIsNotNone(item['avatar'])
            self.assertEqual(b'complete-image', store.avatar_path(PARTNER).read_bytes())
            self.assertEqual(initial, store.events(PARTNER)['items'][0])
            self.assertEqual(1, len(store.events(PARTNER)['items']))
            self.assertEqual(['avatar1', 'avatar2'], self.api.downloads)
        finally:
            store.close()

    def test_photo_and_notification_commands_show_only_owners_saved_archive(self):
        probe = self.start()
        reply = {'message_id': 7, 'chat': {'id': PARTNER}, 'photo': [{'file_id': 'photo', 'file_unique_id': 'unique'}]}
        probe.ingest(message(1, author=OWNER, reply_to_message=reply))
        probe.ingest({'update_id': 2, 'message': {'from': {'id': OWNER}, 'chat': {'id': OWNER, 'type': 'private'}, 'text': '/photos'}})
        self.assertEqual(b'complete-image', self.api.sent[0]['photo'])
        self.assertEqual(OWNER, self.api.sent[0]['chat_id'])
        probe.ingest({'update_id': 3, 'message': {'from': {'id': OWNER}, 'chat': {'id': OWNER, 'type': 'private'}, 'text': '/notifications'}})
        self.assertIn('Изменения: включены', self.api.sent[-1]['text'])
        self.assertIn('Удаления: включены', self.api.sent[-1]['text'])
        store = self.store()
        try:
            store.clear()
        finally:
            store.close()
        probe.ingest({'update_id': 4, 'message': {'from': {'id': OWNER}, 'chat': {'id': OWNER, 'type': 'private'}, 'text': '/photos'}})
        self.assertEqual('Сохранённых фото пока нет.', self.api.sent[-1]['text'])

    def test_connection_verification_failure_preserves_update_for_retry_and_never_claims_active(self):
        probe = self.start()
        self.api.updates = [message(1)]
        probe.poll_once()
        self.api.fail_connection = True
        with self.assertRaises(ApiError):
            probe.ingest(message(2, text='Правка после сбоя', kind='edited_business_message'))
        self.assertEqual(2, probe.offset())
        store = self.store()
        try:
            self.assertEqual('disconnected', store.settings()['receiver']['state'])
            self.assertEqual([], store.conversations())
        finally:
            store.close()
        self.api.fail_connection = False
        probe.ingest(message(2, text='Правка после сбоя', kind='edited_business_message'))
        store = self.store()
        try:
            self.assertEqual('Правка после сбоя', store.events(PARTNER)['items'][0]['after']['text'])
        finally:
            store.close()

    def test_explicit_scope_limits_collection_and_zero_only_discovers_verified_chat_id(self):
        import contextlib
        import io
        probe = self.start(chat=PARTNER)
        probe.ingest(message(1, chat=202, kind='edited_business_message'))
        probe.ingest(message(2, kind='edited_business_message'))
        probe.close()
        probe = self.start(chat=0)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            probe.ingest(message(3, chat=203, kind='edited_business_message'))
        self.assertIn('203', output.getvalue())
        store = self.store()
        try:
            self.assertEqual([PARTNER], [item['id'] for item in store.conversations()])
            self.assertEqual(1, len(store.events(PARTNER)['items']))
            self.assertEqual([], store.events(203)['items'])
        finally:
            store.close()


class TelegramDownloadTests(unittest.TestCase):
    def test_short_body_never_becomes_a_saved_file_or_leaves_partial_content(self):
        import io
        import json
        from unittest.mock import patch
        from probe import Telegram
        metadata = io.BytesIO(json.dumps({'ok': True, 'result': {'file_path': 'photos/full.jpg', 'file_size': 100}}).encode())
        body = io.BytesIO(b'part')
        body.headers = {'Content-Length': '4'}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'saved.jpg'
            with patch('urllib.request.urlopen', side_effect=[metadata, body]):
                with self.assertRaises(ApiError):
                    Telegram('secret-do-not-log').download('file', path)
            self.assertFalse(path.exists())
            self.assertEqual([], list(Path(directory).glob('*.part')))

    def test_malformed_api_response_is_a_sanitized_retryable_error(self):
        import io
        from unittest.mock import patch
        from probe import Telegram
        for raw in (b'not-json', b'[]', b'{"ok": true}', b'{"ok":false,"error_code":"private text"}'):
            with self.subTest(raw=raw), patch('urllib.request.urlopen', return_value=io.BytesIO(raw)):
                with self.assertRaises(ApiError) as failure:
                    Telegram('secret-do-not-log').call('getUpdates')
                self.assertNotIn('secret-do-not-log', str(failure.exception))
                self.assertNotIn('private text', str(failure.exception))
