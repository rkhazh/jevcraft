"""Bounded asynchronous real-Hermes process; credentials stay in Hermes."""
import json
import os
import signal
import subprocess
import time
from pathlib import Path


class Planner:
    def __init__(self,python,home,runs,model='gpt-6.1-terra',timeout=60):
        # Resolving a venv interpreter symlink bypasses its pyvenv.cfg/packages.
        self.python=os.path.abspath(os.path.expanduser(str(python)));self.home=str(Path(home).resolve())
        self.runs=Path(runs);self.runs.mkdir(parents=True,exist_ok=True)
        self.model,self.timeout=model,timeout
        self.process=None;self.number=0;self.pending=False;self.log=None

    def start(self,context):
        if self.pending:raise RuntimeError('Hermes already planning')
        self.number+=1;self.directory=self.runs/str(self.number);self.directory.mkdir(mode=0o700)
        request=self.directory/'input.json';self.response=self.directory/'output.json'
        raw=json.dumps(context,ensure_ascii=False,allow_nan=False)
        if len(raw.encode())>262144:raise ValueError('Planning input exceeds bound')
        request.write_text(raw);os.chmod(request,0o600)
        env={k:v for k,v in os.environ.items() if k in {'HOME','PATH','TMPDIR','LANG','LC_ALL','SSL_CERT_FILE'}}
        env['HERMES_HOME']=self.home
        self.log=open(self.directory/'hermes.log','w')
        self.process=subprocess.Popen([self.python,str(Path(__file__).with_name('hermes_worker.py')),
            str(request.resolve()),str(self.response.resolve()),self.model],
            env=env,cwd=self.home,stdin=subprocess.DEVNULL,stdout=self.log,stderr=self.log,start_new_session=True)
        self.started=time.monotonic();self.pending=True

    def poll(self):
        if not self.pending:return None
        if time.monotonic()-self.started>self.timeout:
            self.close();raise TimeoutError('Hermes plan timeout')
        if self.process.poll() is None:return None
        code=self.process.returncode;self.pending=False
        self.log.close();self.log=None
        if code!=0 or not self.response.is_file():raise RuntimeError('Hermes planning failed; inspect private log')
        if self.response.stat().st_size>65536:raise ValueError('Hermes output exceeds bound')
        result=json.loads(self.response.read_text())
        return result['plan']

    def close(self):
        if self.process:
            try:os.killpg(self.process.pid,signal.SIGTERM)
            except ProcessLookupError:pass
            try:self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                try:os.killpg(self.process.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                self.process.wait(timeout=2)
        if self.log:self.log.close();self.log=None
        self.pending=False;self.process=None
