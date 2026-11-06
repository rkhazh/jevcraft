"""Dated evidence, including read-only migration from AI Persona Lab."""
import json
import os
import sqlite3
import time
from pathlib import Path
from uuid import uuid4


class Memory:
    def __init__(self, path):
        if str(path) != ':memory:':
            path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
            fd=os.open(path,os.O_CREAT|os.O_RDWR,0o600);os.close(fd)
        self.db=sqlite3.connect(str(path))
        self.db.execute('CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY, at REAL, data TEXT)')
        self.db.commit()

    def record(self, event, key=None):
        value=dict(event)
        identifier=key or value.get('event_id') or str(uuid4())
        raw=json.dumps(value,ensure_ascii=False,allow_nan=False)
        if len(raw.encode())>262144:raise ValueError('Evidence record too large')
        with self.db:
            cursor=self.db.execute('INSERT OR IGNORE INTO evidence VALUES(?,?,?)',
                (identifier,time.time(),raw))
        return cursor.rowcount

    def recent(self, limit=24, world=None):
        rows=self.db.execute('SELECT data FROM evidence ORDER BY rowid DESC LIMIT ?', (min(500,max(1,limit*4)),)).fetchall()
        values=[json.loads(row[0]) for row in rows]
        values=[v for v in values if world is None or v.get('world_id',world)==world]
        return list(reversed(values[:limit]))

    def context(self,world,limit=24):
        # Filter before limiting: high-frequency scheduler records cannot erase memory.
        groups=(('chat','voice','speech','historical_conversation'),
                ('goal','goal_ack','goal_proposed','native_work','native_feedback','historical_episode'),('historical_work',))
        selected=[]
        for group in groups:
            placeholders=','.join('?' for _ in group)
            rows=self.db.execute("SELECT rowid,data FROM evidence WHERE json_extract(data,'$.type') IN ("+placeholders+") ORDER BY rowid DESC LIMIT 100",group).fetchall()
            values=[(index,json.loads(raw)) for index,raw in rows]
            values=[v for v in values if v[1].get('world_id',world)==world]
            selected.extend(values[:max(1,limit//3)])
        return [value for _,value in sorted(selected)]

    def import_lab(self, source, persona='TolikScheben'):
        # SQLite's online backup supplies a consistent read without copying WAL files.
        source=Path(source).resolve()
        original=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)
        snapshot=sqlite3.connect(':memory:')
        try:original.backup(snapshot)
        finally:original.close()
        count=0
        tables={r[0] for r in snapshot.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        try:
            if 'conversation_history' in tables:
                for world,identifier,raw,reply,at in snapshot.execute('SELECT world,event_id,source,reply,at FROM conversation_history WHERE persona=? ORDER BY at',(persona,)):
                    count+=self.record(dict(type='historical_conversation',historical=True,world_id=world,
                        source=json.loads(raw),reply=reply,observed_at=at),key='lab-chat:'+identifier)
            if 'episodes' in tables:
                for identifier,world,fact,raw in snapshot.execute('SELECT event,world,fact,provenance FROM episodes WHERE persona=?',(persona,)):
                    count+=self.record(dict(type='historical_episode',historical=True,world_id=world,
                        fact=json.loads(fact),provenance=json.loads(raw)),key='lab-episode:'+identifier)
            # Preserve motivation/work history as dated records, never as pending commands.
            for table in ('objectives','objective_events','persona_missions','persona_tasks',
                          'persona_continuity','persona_impressions','persona_reflections'):
                if table not in tables:continue
                columns=[r[1] for r in snapshot.execute('PRAGMA table_info('+table+')')]
                if 'persona' not in columns:continue
                for row in snapshot.execute('SELECT rowid,* FROM '+table+' WHERE persona=?',(persona,)):
                    record=dict(zip(columns,row[1:]))
                    count+=self.record(dict(type='historical_work',historical=True,table=table,
                        world_id=record.get('world'),record=record),key='lab-'+table+':'+str(row[0]))
        finally:snapshot.close()
        return count

    def close(self):self.db.close()
