"""Configuration is read only by an explicit CLI call, never during import."""
from pathlib import Path
import tempfile
import unittest

import config


class ConfigurationTests(unittest.TestCase):
    def test_explicit_env_loading_preserves_environment_priority_and_accepts_only_known_keys(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)/'.env'
            path.write_text('TELEGRAM_BOT_TOKEN=file-token\nTELEGRAM_OWNER_ID=900001\n'
                            'TELEGRAM_WEBAPP_URL=https://archive.example.test\n'
                            'TELEGRAM_PORT=8788\nTELEGRAM_DATA_DIR=/tmp/isolated-test-data\n'
                            'UNKNOWN_SECRET=ignored\n# comment\n')
            environ = {'TELEGRAM_BOT_TOKEN':'environment-token'}
            loaded = config.load_env(path, environ)
            self.assertIs(loaded, environ)
            self.assertEqual('environment-token', environ['TELEGRAM_BOT_TOKEN'])
            self.assertEqual('900001', environ['TELEGRAM_OWNER_ID'])
            self.assertEqual('8788', environ['TELEGRAM_PORT'])
            self.assertEqual('/tmp/isolated-test-data', environ['TELEGRAM_DATA_DIR'])
            self.assertNotIn('UNKNOWN_SECRET', environ)
            self.assertEqual({}, config.load_env(Path(temporary)/'absent', {}))


if __name__ == '__main__':
    unittest.main()
