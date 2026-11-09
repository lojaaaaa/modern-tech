"""HTTP acceptance through genuinely signed synthetic Telegram launch data."""
import hashlib
import hmac
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.parse import urlencode

import archive
import server


OWNER = 900001
PARTNER = 42
TOKEN = '123456:synthetic-acceptance-token'
NOW = 1794200000


def launch_data(user_id=OWNER, at=NOW, **extra):
    fields = {'auth_date': str(at), 'user': json.dumps({'id': user_id, 'first_name': 'Owner'}, separators=(',', ':')),
              'query_id': 'synthetic-launch', **extra}
    secret = hmac.digest(b'WebAppData', TOKEN.encode(), 'sha256')
    signed = '\n'.join(f'{key}={fields[key]}' for key in sorted(fields))
    fields['hash'] = hmac.new(secret, signed.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


def message(uid, text, *, mid=1, kind='business_message'):
    body = {'message_id': mid, 'business_connection_id': 'synthetic', 'chat': {'id': PARTNER, 'type': 'private', 'first_name': 'Алексей', 'username': 'Alexey'},
            'from': {'id': PARTNER}, 'date': NOW - 100, 'text': text}
    if kind == 'edited_business_message':
        body['edit_date'] = NOW - 50 + uid
    return {'update_id': uid, kind: body}


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.now = NOW
        store = archive.Archive(self.directory, OWNER, clock=lambda: self.now)
        store.process(message(1, 'До'))
        store.process(message(2, 'После', kind='edited_business_message'))
        store.close()
        self.server = server.make_server(self.directory, OWNER, TOKEN, host='127.0.0.1', port=0, clock=lambda: self.now)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': 0.01}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        self.temporary.cleanup()

    def request(self, path='/api/conversations', *, method='GET', data=None, auth=True, headers=None, raw=None):
        outgoing = dict(headers or {})
        if auth:
            outgoing['Authorization'] = 'Telegram ' + (launch_data(at=self.now) if auth is True else auth)
        body = raw
        if data is not None:
            body = json.dumps(data).encode()
            outgoing.setdefault('Content-Type', 'application/json')
        client = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        try:
            client.request(method, path, body=body, headers=outgoing)
            response = client.getresponse()
            payload = response.read()
            result = json.loads(payload) if response.headers.get_content_type() == 'application/json' else payload
            return response.status, dict(response.headers), result
        finally:
            client.close()

    def test_only_signed_owner_can_list_archive_and_responses_do_not_cache_private_data(self):
        self.assertEqual(401, self.request(auth=False)[0])
        status, headers, data = self.request()
        self.assertEqual(200, status)
        self.assertEqual('no-store', headers['Cache-Control'])
        self.assertEqual('Алексей', data['items'][0]['name'])
        self.assertEqual('После', data['items'][0]['last_event']['after']['text'])
        self.assertEqual(1, data['items'][0]['unread'])

    def test_all_private_operations_require_current_valid_signature_of_owner(self):
        paths = [('GET', '/api/conversations'), ('GET', '/api/settings'),
                 ('GET', '/api/conversations/42/events'), ('GET', '/api/conversations/42/messages/1/history'),
                 ('GET', '/api/entries/1/photo'), ('GET', '/api/conversations/42/avatar'),
                 ('POST', '/api/entries/1/retry'), ('POST', '/api/conversations/42/read'),
                 ('PATCH', '/api/settings'), ('PATCH', '/api/conversations/42/settings'),
                 ('DELETE', '/api/entries/1'), ('DELETE', '/api/conversations/42'), ('DELETE', '/api/archive')]
        for method, path in paths:
            with self.subTest(method=method, path=path):
                self.assertEqual(401, self.request(path, method=method, data={} if method != 'GET' else None, auth=False)[0])
                self.assertEqual(403, self.request(path, method=method, data={} if method != 'GET' else None,
                                                  auth=launch_data(user_id=999))[0])
        malformed = [launch_data(at=NOW-3601), launch_data(at=NOW+31),
                     launch_data().replace('synthetic-launch', 'tampered-launch'),
                     launch_data() + '&auth_date=1794200000', launch_data(user='[]'),
                     launch_data(user='{"id":true}'), launch_data(user='broken'),
                     'auth_date=1794200000&user=%7B%22id%22%3A900001%7D',
                     launch_data(auth_date='not-a-number')]
        for value in malformed:
            with self.subTest(auth=value):
                self.assertEqual(401, self.request(auth=value)[0])
        self.assertEqual(200, self.request(auth=launch_data(signature='optional-signed-telegram-value'))[0])
        self.assertEqual(401, self.request(auth=False, headers={'Authorization': 'Bearer '+launch_data()})[0])

    def test_search_history_pagination_and_explicit_read_preserve_unseen_and_later_events(self):
        store = archive.Archive(self.directory, OWNER, clock=lambda: self.now)
        for uid in range(3, 22):
            store.process(message(uid, f'Правка {uid}', mid=uid, kind='edited_business_message'))
        store.close()
        self.assertEqual('Алексей', self.request('/api/conversations?'+urlencode({'q':'Алекесй'}))[2]['items'][0]['name'])
        self.assertEqual(1, len(self.request('/api/conversations?q=%40ALEXEY')[2]['items']))
        self.assertEqual([], self.request('/api/conversations?'+urlencode({'q':'После'}))[2]['items'])
        history = self.request('/api/conversations/42/messages/1/history')[2]
        self.assertEqual(['До', 'После'], [item['content']['text'] for item in history['items']])
        page = self.request('/api/conversations/42/events?limit=5')[2]
        self.assertEqual(5, len(page['items']))
        self.assertTrue(page['has_more'])
        self.assertEqual(20, self.request()[2]['items'][0]['unread'])
        shown = [item['id'] for item in page['items']]
        self.assertEqual({'unread':15}, self.request('/api/conversations/42/read', method='POST', data={'ids':shown})[2])
        earlier = self.request('/api/conversations/42/events?limit=5&before='+str(page['next_before']))[2]
        self.assertEqual(5, len(earlier['items']))
        self.assertTrue(set(shown).isdisjoint(item['id'] for item in earlier['items']))
        store = archive.Archive(self.directory, OWNER, clock=lambda: self.now)
        store.process(message(22, 'Новое после снимка', mid=22, kind='edited_business_message'))
        store.close()
        self.assertEqual({'unread':1}, self.request('/api/conversations/42/read', method='POST', data={'through_id':page['through_id']})[2])
        self.assertEqual(1, self.request()[2]['items'][0]['unread'])

    def test_settings_preserve_notification_collection_separation_and_report_receiver_freshness(self):
        self.assertEqual('unknown', self.request('/api/settings')[2]['receiver']['state'])
        changed = self.request('/api/settings', method='PATCH', data={'notify_edits':False})
        self.assertEqual(200, changed[0])
        self.assertFalse(changed[2]['notify_edits'])
        self.assertTrue(changed[2]['notify_deletes'])
        local = self.request('/api/conversations/42/settings', method='PATCH', data={'notifications':False})[2]
        self.assertEqual({'notifications':False, 'collecting':True}, local)
        self.assertEqual(1, self.request()[2]['items'][0]['unread'])
        self.request('/api/conversations/42/settings', method='PATCH', data={'collecting':False})
        self.assertEqual({'notifications':False, 'collecting':False}, self.request('/api/conversations/42/settings')[2])
        for data in ({'notify_edits':'false'}, {'owner_id':OWNER}, {'receiver':{}}, {'notify_deletes':0}):
            self.assertEqual(400, self.request('/api/settings', method='PATCH', data=data)[0])
        self.assertEqual(400, self.request('/api/conversations/42/settings', method='PATCH', data={'collecting':1})[0])
        store = archive.Archive(self.directory, OWNER, clock=lambda: self.now)
        store.receiver_status(connected=True, success=True)
        store.close()
        self.assertEqual('active', self.request('/api/settings')[2]['receiver']['state'])
        self.now += 91
        self.assertEqual('stale', self.request('/api/settings')[2]['receiver']['state'])

    def test_saved_photo_and_avatar_are_owner_protected_and_download_failure_can_retry(self):
        store = archive.Archive(self.directory, OWNER, clock=lambda: self.now)
        reply = {'message_id':7, 'chat':{'id':PARTNER}, 'from':{'id':PARTNER}, 'date':NOW-100,
                 'photo':[{'file_id':'complete-file', 'file_unique_id':'complete-unique'}]}
        update = message(3, 'Мой ответ', mid=3)
        update['business_message']['from']['id'] = OWNER
        update['business_message']['reply_to_message'] = reply
        store.process(update)
        photo = next(item for item in store.events(PARTNER)['items'] if item['kind']=='photo')
        photo_path = '/api/entries/'+str(photo['id'])+'/photo'
        self.assertEqual(404, self.request(photo_path)[0])
        store.photo_result(photo['id'], error='Synthetic download failure')
        self.assertEqual(200, self.request('/api/entries/'+str(photo['id'])+'/retry', method='POST', data={})[0])
        self.assertEqual('pending', store.events(PARTNER)['items'][-1]['photo_status'])
        (self.directory/'saved.jpg').write_bytes(b'complete-image-fixture')
        store.photo_result(photo['id'], path='saved.jpg')
        (self.directory/'avatar.jpg').write_bytes(b'complete-avatar-fixture')
        store.avatar_result(PARTNER, 'avatar.jpg')
        store.close()
        status, headers, data = self.request(photo_path)
        self.assertEqual((200, b'complete-image-fixture'), (status, data))
        self.assertEqual('image/jpeg', headers['Content-Type'])
        self.assertEqual('no-store', headers['Cache-Control'])
        self.assertEqual('nosniff', headers['X-Content-Type-Options'])
        self.assertEqual(b'complete-avatar-fixture', self.request('/api/conversations/42/avatar')[2])
        for path in (photo_path, '/api/conversations/42/avatar'):
            self.assertEqual(401, self.request(path, auth=False)[0])
            self.assertEqual(403, self.request(path, auth=launch_data(user_id=999))[0])
        self.assertEqual(404, self.request('/api/entries/999/photo')[0])

    def test_deleting_entries_and_clearing_archive_requires_confirmation_and_cannot_resurrect_replay(self):
        entry = self.request('/api/conversations/42/events')[2]['items'][0]
        path = '/api/entries/'+str(entry['id'])
        for data in ({}, {'confirm':False}, {'confirm':'true'}, {'confirm':True,'owner_id':OWNER}):
            self.assertEqual(400, self.request(path, method='DELETE', data=data)[0])
        self.assertEqual(200, self.request(path, method='DELETE', data={'confirm':True})[0])
        self.assertEqual([], self.request('/api/conversations/42/messages/1/history')[2]['items'])
        self.assertEqual([], self.request()[2]['items'])
        store = archive.Archive(self.directory, OWNER, clock=lambda: self.now)
        store.process(message(2, 'После', kind='edited_business_message'))
        store.process(message(3, 'Новая правка', kind='edited_business_message'))
        store.close()
        self.assertEqual(1, len(self.request('/api/conversations/42/events')[2]['items']))
        self.assertIsNone(self.request('/api/conversations/42/events')[2]['items'][0]['before'])
        self.request('/api/conversations/42/settings', method='PATCH', data={'notifications':False})
        self.assertEqual(400, self.request('/api/conversations/42', method='DELETE', data={})[0])
        self.assertEqual(200, self.request('/api/conversations/42', method='DELETE', data={'confirm':True})[0])
        self.assertEqual({'notifications':False,'collecting':True}, self.request('/api/conversations/42/settings')[2])
        store = archive.Archive(self.directory, OWNER, clock=lambda: self.now)
        store.process(message(4, 'После очистки', kind='edited_business_message'))
        store.close()
        self.assertEqual(400, self.request('/api/archive', method='DELETE', data={})[0])
        self.assertEqual(200, self.request('/api/archive', method='DELETE', data={'confirm':True})[0])
        self.assertEqual([], self.request()[2]['items'])
        self.assertEqual([], self.request('/api/conversations/42/messages/1/history')[2]['items'])

    def test_static_shell_serves_real_assets_but_never_configuration_database_or_source(self):
        for path, content_type in (('/', 'text/html'), ('/index.html','text/html'),
                                   ('/app.js','text/javascript'), ('/style.css','text/css')):
            with self.subTest(path=path):
                status, headers, data = self.request(path, auth=False)
                self.assertEqual(200, status)
                self.assertTrue(headers['Content-Type'].startswith(content_type))
                self.assertNotIn(TOKEN.encode(), data)
                self.assertIn("script-src 'self' https://telegram.org", headers['Content-Security-Policy'])
        for path in ('/.env', '/archive.py', '/server.py', '/data/archive.sqlite3', '/..%2f.env',
                     '/%2e%2e/.env', '/web/../.env', '/app.js/../.env', '//example.test/app.js'):
            with self.subTest(path=path):
                self.assertIn(self.request(path, auth=False)[0], (400,404))
        self.assertEqual(405, self.request('/', method='POST', data={}, auth=False)[0])

    def test_http_parsing_rejects_ambiguous_or_unbounded_requests_without_changing_data(self):
        for path in ('/api/conversations?q=one&q=two', '/api/conversations?owner_id=900001',
                     '/api/conversations/42/events?limit=0', '/api/conversations/42/events?limit=101',
                     '/api/conversations/42/events?before=-1', '/api/conversations/42/events?limit=x'):
            self.assertEqual(400, self.request(path)[0], path)
        for data in ({}, {'ids':[True]}, {'ids':[1],'through_id':1}, {'through_id':-1},
                     {'through_id':True}, {'ids':[1]*101}, {'ids':['1']}):
            self.assertEqual(400, self.request('/api/conversations/42/read', method='POST', data=data)[0])
        self.assertEqual(400, self.request('/api/settings', method='PATCH', raw=b'[]', headers={'Content-Type':'application/json'})[0])
        self.assertEqual(400, self.request('/api/settings', method='PATCH', raw=b'{', headers={'Content-Type':'application/json'})[0])
        self.assertEqual(415, self.request('/api/settings', method='PATCH', raw=b'{}', headers={'Content-Type':'text/plain'})[0])
        self.assertEqual(413, self.request('/api/settings', method='PATCH', raw=b'x'*65537, headers={'Content-Type':'application/json'})[0])
        self.assertEqual(400, self.request('/api/settings', method='PATCH')[0])
        self.assertEqual(400, self.request('/api/settings', method='PATCH', raw=b'{}', headers={'Content-Type':'application/json','Transfer-Encoding':'chunked'})[0])
        self.assertEqual(400, self.request('/api/settings', method='GET', data={})[0])
        self.assertEqual(400, self.request('/api/settings', method='PATCH', raw=b'{"notify_edits":false,"notify_edits":true}', headers={'Content-Type':'application/json'})[0])
        self.assertEqual(405, self.request('/api/settings', method='PUT', data={})[0])
        self.assertEqual(405, self.request('/api/settings', method='OPTIONS')[0])
        self.assertTrue(self.request('/api/settings')[2]['notify_edits'])
        self.assertEqual(1, self.request()[2]['items'][0]['unread'])


if __name__ == '__main__':
    unittest.main()
