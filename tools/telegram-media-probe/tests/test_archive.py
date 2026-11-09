import json
import os
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
import tempfile
import unittest

import archive


OWNER = 100
PARTNER = 200


def message(uid, text='Привет', *, mid=1, author=PARTNER, chat=PARTNER, kind='business_message', **extra):
    body = {'message_id': mid, 'business_connection_id': 'business-1',
            'chat': {'id': chat, 'first_name': 'Алексей', 'username': 'Alexey'},
            'from': {'id': author, 'first_name': 'Вы' if author == OWNER else 'Алексей'},
            'date': 1700000000, 'text': text}
    if kind == 'edited_business_message':
        body['edit_date'] = 1700000000 + uid
    body.update(extra)
    return {'update_id': uid, kind: body}


def deletion(uid, mids=(1,), chat=PARTNER):
    return {'update_id': uid, 'deleted_business_messages': {
        'business_connection_id': 'business-1',
        'chat': {'id': chat, 'first_name': 'Алексей'}, 'message_ids': list(mids)}}


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.now = 1700000100.0
        self.store = archive.Archive(self.directory, OWNER, clock=lambda: self.now)

    def tearDown(self):
        self.store.close()
        self.temporary.cleanup()

    def test_plain_message_stays_background_until_two_received_edits_form_history(self):
        self.store.process(message(1, 'В 18:00'))
        self.assertEqual([], self.store.conversations())
        self.store.process(message(2, 'В 19:00', kind='edited_business_message'))
        self.store.process(message(3, 'В 20:00', kind='edited_business_message'))
        events = self.store.events(PARTNER)['items']
        self.assertEqual(['edit', 'edit'], [event['kind'] for event in events])
        self.assertEqual('В 18:00', events[0]['before']['text'])
        self.assertEqual('В 19:00', events[0]['after']['text'])
        history = self.store.history(PARTNER, 1)
        self.assertFalse(history['original_missing'])
        self.assertEqual(['В 18:00', 'В 19:00', 'В 20:00'],
                         [item['content']['text'] for item in history['items']])

    def test_own_edits_and_metadata_updates_do_not_notify_or_count_unread(self):
        self.store.process(message(1, 'Свой текст', author=OWNER))
        self.store.process(message(2, 'Свой новый текст', author=OWNER, kind='edited_business_message'))
        self.store.process(message(3, 'Свой новый текст', author=OWNER,
                                   kind='edited_business_message', edit_date=1800000000))
        events = self.store.events(PARTNER)['items']
        self.assertEqual(1, len(events))
        self.assertTrue(events[0]['own'])
        self.assertEqual(0, self.store.conversations()[0]['unread'])
        self.assertEqual([], self.store.notices())

    def test_first_received_edit_explicitly_has_missing_original_and_durable_notice(self):
        update = message(1, 'Новая версия', kind='edited_business_message')
        self.store.process(update)
        self.store.process(update)
        self.assertIsNone(self.store.events(PARTNER)['items'][0]['before'])
        self.assertTrue(self.store.history(PARTNER, 1)['original_missing'])
        self.assertEqual(1, self.store.conversations()[0]['unread'])
        self.assertEqual(1, len(self.store.notices()))
        notice = self.store.notices()[0]
        self.store.notice_result(notice['id'], error='offline')
        self.assertEqual([], self.store.notices())
        self.now += 6
        self.store.close()
        self.store = archive.Archive(self.directory, OWNER, clock=lambda: self.now)
        self.assertEqual(1, self.store.notices()[0]['attempts'])
        self.assertIn('Новая версия', self.store.notices()[0]['text'])
        self.store.notice_result(notice['id'])
        self.assertEqual([], self.store.notices())

    def test_cursor_is_monotonic_and_redelivered_update_is_not_another_event(self):
        self.store.process(message(10, 'Правка', kind='edited_business_message'))
        self.store.process(message(10, 'Правка', kind='edited_business_message'))
        self.store.advance_cursor(8)
        self.assertEqual(11, self.store.offset())
        self.store.advance_cursor(20)
        self.assertEqual(21, self.store.offset())
        self.assertEqual(1, len(self.store.events(PARTNER)['items']))

    def test_only_shown_events_are_read_and_read_all_does_not_consume_later_arrival(self):
        for uid in range(1, 21):
            self.store.process(message(uid, f'Версия {uid}', kind='edited_business_message'))
        page = self.store.events(PARTNER, limit=5)
        ids = [entry['id'] for entry in page['items']]
        self.assertEqual({'unread': 15}, self.store.mark_read(PARTNER, ids=ids))
        self.store.process(message(21, 'Новое', kind='edited_business_message'))
        self.assertEqual({'unread': 1}, self.store.mark_read(PARTNER, through_id=page['through_id']))
        self.store.close()
        self.store = archive.Archive(self.directory, OWNER, clock=lambda: self.now)
        self.assertEqual(1, self.store.conversations()[0]['unread'])
        self.assertTrue(self.store.events(PARTNER, limit=5)['items'][-2]['read'])

    def test_global_and_dialog_notification_switches_leave_archive_and_unread_intact(self):
        self.store.process(message(1, 'Первый', kind='edited_business_message'))
        self.store.update_settings({'notify_edits': False})
        self.assertEqual([], self.store.notices())
        self.store.process(message(2, 'Второй', kind='edited_business_message'))
        self.store.process(deletion(3))
        self.assertEqual(1, len(self.store.notices()))
        self.assertIn('Сообщение удалено', self.store.notices()[0]['text'])
        self.store.update_conversation_settings(PARTNER, {'notifications': False})
        self.assertEqual([], self.store.notices())
        self.store.process(message(4, 'Третий', kind='edited_business_message'))
        self.assertEqual(4, self.store.conversations()[0]['unread'])
        self.assertFalse(self.store.settings()['notify_edits'])
        self.assertTrue(self.store.settings()['notify_deletes'])
        self.assertTrue(self.store.conversation_settings(PARTNER)['collecting'])

    def test_excluding_dialog_stops_new_background_and_events_without_erasing_old_archive(self):
        self.store.process(message(1, 'Старое', kind='edited_business_message'))
        self.store.update_conversation_settings(PARTNER, {'collecting': False})
        self.store.process(message(2, 'Не сохранять'))
        self.store.process(message(3, 'Не сохранять правку', kind='edited_business_message'))
        self.store.update_conversation_settings(PARTNER, {'collecting': True})
        self.store.process(deletion(4, mids=(9,)))
        self.assertEqual(2, len(self.store.events(PARTNER)['items']))
        self.assertIsNone(self.store.events(PARTNER)['items'][-1]['before'])
        self.assertEqual('Старое', self.store.events(PARTNER)['items'][0]['after']['text'])

    def test_search_uses_latest_profile_and_typo_matching_without_reordering_or_rewriting_snapshot(self):
        self.store.process(message(1, 'Правка', kind='edited_business_message'))
        other = message(2, 'Иной', chat=300, kind='edited_business_message')
        other['edited_business_message']['chat'] = {'id': 300, 'first_name': 'Алекесй', 'username': 'Other'}
        self.store.process(other)
        self.assertEqual([300, PARTNER], [c['id'] for c in self.store.conversations('Алекесй')])
        self.assertEqual([PARTNER], [c['id'] for c in self.store.conversations('@aLeXeY')])
        self.store.update_profile(PARTNER, {'id': PARTNER, 'first_name': 'Новое имя', 'username': 'NewName'})
        self.assertEqual([300, PARTNER], [c['id'] for c in self.store.conversations()])
        self.assertEqual('Новое имя', self.store.conversations('newname')[0]['name'])
        self.assertEqual('Алексей', self.store.events(PARTNER)['items'][0]['profile']['name'])
        self.store.process(message(3, 'Ещё', kind='edited_business_message', business_connection_id='business-2'))
        self.assertEqual(2, len(self.store.conversations()))

    def test_deleted_media_keeps_type_caption_and_own_side_without_inventing_actor(self):
        self.store.process(message(1, '', author=OWNER, photo=[{'file_id': 'not-saved', 'file_unique_id': 'u'}], caption='Подпись'))
        self.store.process(deletion(2))
        event = self.store.events(PARTNER)['items'][0]
        self.assertTrue(event['own'])
        self.assertEqual('photo', event['before']['media'])
        self.assertEqual('Подпись', event['before']['text'])
        self.assertEqual('received', event['time_source'])
        self.assertNotIn('actor', event)
        self.assertEqual([], self.store.notices())
        self.assertEqual([], self.store.photo_jobs())

    def test_only_owner_reply_saves_photo_and_repeated_reply_does_not_duplicate(self):
        incoming = message(1, '', photo=[{'file_id': 'photo-file', 'file_unique_id': 'unique-photo'}])
        self.store.process(incoming)
        reply = incoming['business_message']
        self.store.process(message(2, 'Ответ собеседника', mid=2, reply_to_message=reply))
        self.assertEqual([], self.store.conversations())
        self.store.process(message(3, 'Мой ответ', mid=3, author=OWNER, reply_to_message=reply))
        self.store.process(message(4, 'Ещё ответ', mid=4, author=OWNER, reply_to_message=reply))
        events = self.store.events(PARTNER)['items']
        self.assertEqual(1, len(events))
        self.assertEqual('photo', events[0]['kind'])
        self.assertEqual('pending', events[0]['photo_status'])
        self.assertEqual(0, self.store.conversations()[0]['unread'])
        self.assertEqual([], self.store.notices())
        self.assertEqual('photo-file', self.store.photo_jobs()[0]['file_id'])
        path = self.directory / 'complete.jpg'
        path.write_bytes(b'full-image-fixture')
        self.store.photo_result(events[0]['id'], path='complete.jpg')
        self.assertEqual('saved', self.store.events(PARTNER)['items'][0]['photo_status'])
        self.assertEqual(path, self.store.photo_path(events[0]['id']))
        self.assertEqual([], self.store.photo_jobs())

    def test_unavailable_photo_can_be_received_by_a_later_owner_reply_without_false_success(self):
        reply = {'message_id': 9, 'chat': {'id': PARTNER}, 'date': 1700000000, 'photo': []}
        self.store.process(message(1, 'Ответ', author=OWNER, reply_to_message=reply))
        entry = self.store.events(PARTNER)['items'][0]
        self.assertEqual('unavailable', entry['photo_status'])
        self.assertIsNone(self.store.photo_path(entry['id']))
        reply['photo'] = [{'file_id': 'later-file', 'file_unique_id': 'later-unique'}]
        self.store.process(message(2, 'Ответ ещё раз', mid=2, author=OWNER, reply_to_message=reply))
        self.assertEqual(1, len(self.store.events(PARTNER)['items']))
        self.assertEqual('pending', self.store.events(PARTNER)['items'][0]['photo_status'])
        self.store.photo_result(entry['id'], error='download unavailable')
        self.assertEqual('error', self.store.events(PARTNER)['items'][0]['photo_status'])
        self.store.retry_photo(entry['id'])
        self.assertEqual('later-file', self.store.photo_jobs()[0]['file_id'])
        with self.assertRaises(ValueError):
            self.store.photo_result(entry['id'], path='missing.jpg')

    def test_retention_expires_background_but_preserves_archived_event_states(self):
        self.store.process(message(1, 'Фон без события', mid=1))
        self.store.process(message(2, 'Исходное', mid=2))
        self.store.process(message(3, 'Правка навсегда', mid=2, kind='edited_business_message'))
        self.now += 30 * 86400 + 1
        self.store.expire()
        self.store.close()
        self.store = archive.Archive(self.directory, OWNER, clock=lambda: self.now)
        self.store.process(deletion(4, mids=(1, 2)))
        events = self.store.events(PARTNER)['items']
        self.assertIsNone(events[1]['before'])
        self.assertEqual('Правка навсегда', events[2]['before']['text'])
        self.assertEqual('Исходное', self.store.history(PARTNER, 2)['items'][0]['content']['text'])

    def test_clear_cancels_notices_removes_history_and_background_and_does_not_replay_old_update(self):
        self.store.process(message(1, 'Исходное'))
        edit = message(2, 'Изменено', kind='edited_business_message')
        self.store.process(edit)
        self.store.update_conversation_settings(PARTNER, {'notifications': False})
        self.store.clear_conversation(PARTNER)
        self.assertEqual([], self.store.conversations())
        self.assertEqual([], self.store.history(PARTNER, 1)['items'])
        self.assertEqual([], self.store.notices())
        self.assertFalse(self.store.conversation_settings(PARTNER)['notifications'])
        self.store.process(edit)
        self.assertEqual([], self.store.conversations())
        self.store.process(deletion(3))
        self.assertIsNone(self.store.events(PARTNER)['items'][0]['before'])
        self.store.clear()
        self.assertEqual([], self.store.events(PARTNER)['items'])
        self.assertFalse(self.store.conversation_settings(PARTNER)['notifications'])

    def test_deleting_entry_does_not_expose_its_orphan_history_or_claim_intermediate_state_is_original(self):
        self.store.process(message(1, 'Исходное'))
        self.store.process(message(2, 'Промежуточное', kind='edited_business_message'))
        self.store.process(message(3, 'Последнее', kind='edited_business_message'))
        first, second = self.store.events(PARTNER)['items']
        self.store.delete_entry(first['id'])
        history = self.store.history(PARTNER, 1)
        self.assertTrue(history['original_missing'])
        self.assertEqual(['Промежуточное', 'Последнее'], [item['content']['text'] for item in history['items']])
        self.store.delete_entry(second['id'])
        self.assertEqual([], self.store.history(PARTNER, 1)['items'])
        self.assertEqual([], self.store.notices())

    def test_legacy_import_keeps_event_history_without_reaging_background_or_importing_unselected_files(self):
        legacy = self.directory / 'legacy'
        legacy.mkdir()
        db = sqlite3.connect(legacy / 'archive.sqlite3')
        db.executescript('CREATE TABLE events(update_id INTEGER PRIMARY KEY,kind TEXT,payload TEXT,received_at TEXT);'
                         'CREATE TABLE files(update_id INTEGER,file_id TEXT,kind TEXT,path TEXT,error TEXT,attempts INTEGER);'
                         'CREATE TABLE cursor(id INTEGER,offset INTEGER);'
                         'CREATE TABLE preferences(name TEXT,value INTEGER);')
        updates = [message(1, 'Истекший фон'), message(2, 'До', mid=2),
                   message(3, 'После', mid=2, kind='edited_business_message')]
        photo = message(9, '', mid=9, photo=[{'file_id': 'saved-fid', 'file_unique_id': 'saved-unique'}])['business_message']
        updates.append(message(4, 'Мой ответ', mid=4, author=OWNER, reply_to_message=photo))
        for update in updates:
            kind = next(key for key in update if key != 'update_id')
            when = datetime.fromtimestamp(self.now - 40 * 86400 + update['update_id'], timezone.utc).isoformat()
            db.execute('INSERT INTO events VALUES(?,?,?,?)', (update['update_id'], kind, json.dumps(update), when))
        (legacy / 'ordinary.bin').write_bytes(b'ordinary-media')
        (legacy / 'saved.bin').write_bytes(b'full-saved-media')
        db.execute('INSERT INTO files VALUES(1,?,?,?,?,?)', ('ordinary-fid', 'photo', 'ordinary.bin', None, 1))
        db.execute('INSERT INTO files VALUES(4,?,?,?,?,?)', ('saved-fid', 'photo', 'saved.bin', None, 1))
        db.execute('INSERT INTO cursor VALUES(1,20)')
        db.execute("INSERT INTO preferences VALUES('notify_edits',0)")
        db.commit()
        db.close()
        imported = archive.Archive(legacy, OWNER, clock=lambda: self.now)
        try:
            self.assertEqual(20, imported.offset())
            self.assertFalse(imported.settings()['notify_edits'])
            self.assertEqual([], imported.notices())
            self.assertEqual(['До', 'После'], [i['content']['text'] for i in imported.history(PARTNER, 2)['items']])
            photo_entry = next(e for e in imported.events(PARTNER)['items'] if e['kind'] == 'photo')
            self.assertEqual('saved', photo_entry['photo_status'])
            self.assertEqual(legacy / 'saved.bin', imported.photo_path(photo_entry['id']))
            self.assertFalse((legacy / 'ordinary.bin').exists())
            imported.process(deletion(21))
            self.assertIsNone(imported.events(PARTNER)['items'][-1]['before'])
        finally:
            imported.close()
        self.assertNotIn('Истекший фон'.encode(), (legacy / 'archive.sqlite3').read_bytes())

    def test_expiration_scrubs_background_from_active_sqlite_and_stale_partial_files(self):
        marker = 'unique-expired-background-3c70'
        self.store.process(message(1, marker))
        partial = self.directory / 'download.part'
        partial.write_bytes(b'partial-data')
        os.utime(partial, (self.now, self.now))
        self.now += 31 * 86400
        self.store.expire()
        for path in self.directory.glob('archive.sqlite3*'):
            self.assertFalse(marker.encode() in path.read_bytes(), path.name)
        self.assertFalse(partial.exists())

    def test_shared_photo_survives_entry_deletion_and_late_download_completion(self):
        for uid, mid in ((1, 7), (2, 8)):
            photo = {'message_id': mid, 'chat': {'id': PARTNER}, 'date': 1700000000,
                     'photo': [{'file_id': 'shared-file', 'file_unique_id': 'shared-unique'}]}
            self.store.process(message(uid, 'Мой ответ', mid=uid, author=OWNER, reply_to_message=photo))
        first, second = self.store.events(PARTNER)['items']
        shared = self.directory / 'shared.jpg'
        shared.write_bytes(b'full-image')
        self.store.photo_result(first['id'], path='shared.jpg')
        self.store.delete_entry(first['id'])
        self.store.photo_result(first['id'], path='shared.jpg')
        self.assertEqual(shared, self.store.photo_path(second['id']))
        self.store.clear_conversation(PARTNER)
        self.assertFalse(shared.exists())
        late = self.directory / 'late.jpg'
        late.write_bytes(b'late-image')
        self.store.photo_result(second['id'], path='late.jpg')
        self.assertFalse(late.exists())
        self.assertEqual([], self.store.conversations())

    def test_manual_deletions_scrub_deleted_content_from_active_database_and_wal(self):
        for operation in ('delete_entry', 'clear_conversation', 'clear'):
            with self.subTest(operation=operation):
                marker = 'deleted-personal-content-' + operation
                self.store.process(message(100 + len(marker), marker, mid=40,
                                           kind='edited_business_message'))
                entry = next(entry for entry in self.store.events(PARTNER)['items']
                             if entry['message_id'] == 40)
                if operation == 'delete_entry':
                    self.store.delete_entry(entry['id'])
                elif operation == 'clear_conversation':
                    self.store.clear_conversation(PARTNER)
                else:
                    self.store.clear()
                self.assertEqual([], self.store.history(PARTNER, 40)['items'])
                for path in self.directory.glob('archive.sqlite3*'):
                    self.assertFalse(marker.encode() in path.read_bytes(), path.name)

    def test_expired_own_message_keeps_its_side_without_retaining_content(self):
        marker = 'expired-own-message-secret-4a61'
        self.store.process(message(1, marker, author=OWNER))
        self.now += 31 * 86400
        self.store.expire()
        for path in self.directory.glob('archive.sqlite3*'):
            self.assertFalse(marker.encode() in path.read_bytes(), path.name)
        self.store.close()
        self.store = archive.Archive(self.directory, OWNER, clock=lambda: self.now)
        self.store.process(deletion(2))
        event = self.store.events(PARTNER)['items'][0]
        self.assertTrue(event['own'])
        self.assertIsNone(event['before'])
        self.assertEqual(0, self.store.conversations()[0]['unread'])
        self.assertEqual([], self.store.notices())
        self.store.clear_conversation(PARTNER)
        self.store.process(deletion(3))
        self.assertFalse(self.store.events(PARTNER)['items'][0]['own'])

    def test_receiver_status_only_claims_active_after_connection_and_recent_success(self):
        self.assertEqual('unknown', self.store.settings()['receiver']['state'])
        self.store.receiver_status(connected=True, success=True)
        self.assertEqual('active', self.store.settings()['receiver']['state'])
        self.now += 91
        self.assertEqual('stale', self.store.settings()['receiver']['state'])
        self.store.receiver_status(connected=False, success=True)
        self.assertEqual('disconnected', self.store.settings()['receiver']['state'])
        self.assertFalse(self.store.settings()['receiver']['connection_enabled'])

    def test_available_avatar_is_local_and_profile_refresh_does_not_create_archive_entry(self):
        self.store.update_profile(PARTNER, {'first_name': 'Алексей'})
        avatar = self.directory / 'avatar-200.jpg'
        avatar.write_bytes(b'avatar-fixture')
        self.store.avatar_result(PARTNER, 'avatar-200.jpg')
        self.assertEqual([], self.store.conversations())
        self.assertEqual(avatar, self.store.avatar_path(PARTNER))
        self.store.process(message(1, 'Правка', kind='edited_business_message'))
        self.assertEqual('/api/conversations/200/avatar', self.store.conversations()[0]['avatar'])
        self.store.avatar_result(PARTNER, None)
        self.assertIsNone(self.store.conversations()[0]['avatar'])
        self.assertFalse(avatar.exists())

    def test_archive_cannot_be_reopened_as_another_owner_and_database_is_private(self):
        self.store.process(message(1, 'Личное', kind='edited_business_message'))
        with self.assertRaises(ValueError):
            archive.Archive(self.directory, 999, clock=lambda: self.now)
        self.assertEqual(0, (self.directory / 'archive.sqlite3').stat().st_mode & 0o077)

    def test_events_and_pagination_follow_action_time_with_stable_equal_time_order(self):
        self.store.process(message(1, 'Вчера', mid=1, kind='edited_business_message', edit_date=1700000001))
        self.store.process(deletion(2, mids=(99,)))
        self.store.process(message(3, 'Позже полученная старая правка', mid=2,
                                   kind='edited_business_message', edit_date=1700000002))
        page = self.store.events(PARTNER, limit=2)
        self.assertEqual(['Позже полученная старая правка', None],
                         [e['after']['text'] if e['after'] else None for e in page['items']])
        earlier = self.store.events(PARTNER, before=page['next_before'], limit=2)
        self.assertEqual(['Вчера'], [e['after']['text'] for e in earlier['items']])
        self.assertEqual('delete', self.store.conversations()[0]['last_event']['kind'])
        no_date = message(4, 'Нет времени', mid=3, kind='edited_business_message')
        del no_date['edited_business_message']['edit_date']
        self.store.process(no_date)
        self.assertEqual('received', self.store.events(PARTNER)['items'][-1]['time_source'])

    def test_photo_reply_supplies_known_original_for_history_and_later_deletion(self):
        photo = {'message_id': 7, 'chat': {'id': PARTNER}, 'from': {'id': PARTNER},
                 'date': 1700000000, 'caption': 'Память',
                 'photo': [{'file_id': 'original-file', 'file_unique_id': 'original-unique'}]}
        self.store.process(message(1, 'Мой ответ', author=OWNER, reply_to_message=photo))
        history = self.store.history(PARTNER, 7)
        self.assertFalse(history['original_missing'])
        self.assertEqual('original', history['items'][0]['kind'])
        self.store.process(deletion(2, mids=(7,)))
        self.assertEqual('Память', self.store.events(PARTNER)['items'][-1]['before']['text'])


if __name__ == '__main__':
    unittest.main()
