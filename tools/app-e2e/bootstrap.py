import argparse
import base64
import json
import os
from pathlib import Path
import secrets


parser = argparse.ArgumentParser(description='Prepare an isolated whole-app browser test environment.')
parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[2])
parser.add_argument('--state-dir', type=Path)
parser.add_argument('--app-port', type=int, default=8892)
parser.add_argument('--mail-port', type=int, default=8893)
args = parser.parse_args()
source = args.source.resolve()
state = (args.state_dir or source / '.local/app-e2e').resolve()
if not (source / 'backend/artisan').is_file() or not (source / 'frontend/package-lock.json').is_file():
    parser.error('--source must contain this application backend and frontend')
if not 1024 <= args.app_port <= 65535 or not 1024 <= args.mail_port <= 65535 or args.app_port == args.mail_port:
    parser.error('Choose two distinct unprivileged local ports')
os.umask(0o077)
state.mkdir(parents=True, exist_ok=True)
(state / 'files').mkdir(exist_ok=True)
(state / 'reports').mkdir(exist_ok=True)
settings_file = state / 'settings.json'
if settings_file.exists():
    settings = json.loads(settings_file.read_text())
else:
    settings = {
        'database_password': secrets.token_hex(24),
        'application_key': 'base64:' + base64.b64encode(secrets.token_bytes(32)).decode(),
    }
    settings_file.write_text(json.dumps(settings, indent=2))
settings_file.chmod(0o600)
application = f'http://localhost:{args.app_port}'
overrides = {
    'APP_NAME': 'Modern Tech E2E',
    'APP_ENV': 'local',
    'APP_KEY': settings['application_key'],
    'APP_DEBUG': 'false',
    'APP_URL': application,
    'LOG_LEVEL': 'warning',
    'DB_CONNECTION': 'pgsql',
    'DB_URL': '',
    'DB_HOST': 'postgres',
    'DB_PORT': '5432',
    'DB_DATABASE': 'modern_tech_e2e',
    'DB_USERNAME': 'modern_tech_e2e',
    'DB_PASSWORD': settings['database_password'],
    'SESSION_DRIVER': 'database',
    'SESSION_COOKIE': 'modern-tech-e2e-session',
    'SESSION_ENCRYPT': 'true',
    'SESSION_DOMAIN': 'null',
    'SESSION_SECURE_COOKIE': 'false',
    'SANCTUM_STATEFUL_DOMAINS': f'localhost:{args.app_port}',
    'QUEUE_CONNECTION': 'sync',
    'MAIL_MAILER': 'smtp',
    'MAIL_HOST': 'mailpit',
    'MAIL_PORT': '1025',
    'MAIL_FROM_ADDRESS': 'hello@modern-tech.test',
}
lines = (source / 'backend/.env.example').read_text().splitlines()
output = []
for line in lines:
    key = line.split('=', 1)[0]
    output.append(f'{key}={json.dumps(overrides.pop(key))}' if key in overrides else line)
output.extend(f'{key}={json.dumps(value)}' for key, value in overrides.items())
backend_env = state / 'backend.env'
backend_env.write_text('\n'.join(output) + '\n')
backend_env.chmod(0o600)
compose = {
    'E2E_SOURCE_ROOT': str(source),
    'E2E_STATE_DIR': str(state),
    'E2E_BACKEND_ENV': str(backend_env),
    'E2E_DB_PASSWORD': settings['database_password'],
    'E2E_APP_PORT': str(args.app_port),
    'E2E_MAIL_PORT': str(args.mail_port),
    'E2E_UID': str(os.getuid()),
    'E2E_GID': str(os.getgid()),
}
compose_env = state / 'compose.env'
compose_env.write_text(''.join(f'{key}={json.dumps(value)}\n' for key, value in compose.items()))
compose_env.chmod(0o600)
print(f'Isolated environment ready: {application}; Mailpit http://localhost:{args.mail_port}; state {state}')
