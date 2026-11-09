"""Explicit environment loading shared by the two local CLI processes."""

import os
from pathlib import Path


ENV_KEYS = frozenset({
    'TELEGRAM_BOT_TOKEN', 'TELEGRAM_OWNER_ID', 'TELEGRAM_CHAT_ID',
    'TELEGRAM_DATA_DIR', 'TELEGRAM_WEBAPP_URL', 'TELEGRAM_HOST', 'TELEGRAM_PORT',
})


def load_env(path=None, environ=None):
    """Read known KEY=value settings while preserving existing environment values."""
    target = os.environ if environ is None else environ
    source = Path(path) if path is not None else Path(__file__).parent / '.env'
    if source.is_file():
        for line in source.read_text(encoding='utf-8').splitlines():
            key, separator, value = line.partition('=')
            key, value = key.strip(), value.strip()
            if separator and key in ENV_KEYS and value:
                target.setdefault(key, value)
    return target
