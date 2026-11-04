import contextlib
import io
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch

class CommunityStartTests(unittest.TestCase):
    def test_invalid_http_limit_rejected_before_credentials_or_exec(self):
        script=Path(__file__).resolve().parents[1]/'scripts/community-start.py'
        for value in ('0','61','-1','1.5'):
            with patch('sys.argv',[str(script),'--max-http-attempts',value]), patch('dotenv.dotenv_values') as credentials, patch('os.execve') as execute, contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as error:runpy.run_path(str(script),run_name='__main__')
                self.assertEqual(error.exception.code,2)
                credentials.assert_not_called();execute.assert_not_called()

if __name__=='__main__':unittest.main()
