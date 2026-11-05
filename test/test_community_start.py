import contextlib
import io
import json
import os
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch

class CommunityStartTests(unittest.TestCase):
    def test_profile_is_loaded_locally_into_clean_environment_before_exec(self):
        script=Path(__file__).resolve().parents[1]/'scripts/community-start.py'
        credentials={'OPENROUTER_API_KEY':'offline-key','MC_LOGIN_PASSWORD':'offline-password','JEV_PERSONA_TOKEN':'x'*32}
        with patch('sys.argv',[str(script),'--character','TolikScheben']), patch.dict(os.environ,{'JEV_PERSONA_PROFILE':'inherited-wrong-profile','UNRELATED_SECRET':'never-forward'}), patch('dotenv.dotenv_values',return_value=credentials), patch('pathlib.Path.mkdir'), patch('os.open',return_value=123), patch('os.dup2'), patch('os.close'), patch('os.chdir'), patch('os.execvpe') as execute:
            runpy.run_path(str(script),run_name='__main__')
        environment=execute.call_args.args[2]
        profile=json.loads(environment['JEV_PERSONA_PROFILE'])
        self.assertEqual(profile['persona_id'],'TolikScheben')
        self.assertTrue(profile['identity'])
        self.assertTrue(profile['motivations'])
        self.assertNotIn('inherited-wrong-profile',environment['JEV_PERSONA_PROFILE'])
        self.assertNotIn('UNRELATED_SECRET',environment)
        self.assertLessEqual(len(environment['JEV_PERSONA_PROFILE'].encode('utf-8')),24576)

    def test_invalid_local_profile_stops_before_credentials_logs_or_connection(self):
        script=Path(__file__).resolve().parents[1]/'scripts/community-start.py'
        # The local character reader is the configuration boundary, not a model.
        src=str(script.parents[2]/'NetTyan/src')
        import sys
        if src not in sys.path:sys.path.insert(0,src)
        with patch('sys.argv',[str(script)]), patch('character.character_manager.CharacterManager.get_cached_instance',side_effect=ValueError('private-profile-secret')), patch('dotenv.dotenv_values') as credentials, patch('os.open') as opened, patch('os.execvpe') as execute:
            with self.assertRaises(SystemExit) as caught:runpy.run_path(str(script),run_name='__main__')
        self.assertNotIn('private-profile-secret',str(caught.exception))
        credentials.assert_not_called();opened.assert_not_called();execute.assert_not_called()

    def test_invalid_http_limit_rejected_before_credentials_or_exec(self):
        script=Path(__file__).resolve().parents[1]/'scripts/community-start.py'
        for value in ('0','61','-1','1.5'):
            with patch('sys.argv',[str(script),'--max-http-attempts',value]), patch('dotenv.dotenv_values') as credentials, patch('os.execve') as execute, contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as error:runpy.run_path(str(script),run_name='__main__')
                self.assertEqual(error.exception.code,2)
                credentials.assert_not_called();execute.assert_not_called()

if __name__=='__main__':unittest.main()
