"""Authenticated loopback JevCraft bridge; adapted from Persona Lab's client."""
import json
from urllib.parse import urlsplit
from urllib.request import Request,build_opener,ProxyHandler,HTTPRedirectHandler
from urllib.error import HTTPError


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None


class Body:
    def __init__(self,url,token):
        parts=urlsplit(url)
        if parts.scheme!='http' or parts.hostname not in {'127.0.0.1','localhost','::1'} or parts.username or parts.query or parts.fragment:
            raise ValueError('Body URL must be loopback HTTP')
        if not isinstance(token,str) or len(token)<32:raise ValueError('Missing bridge credential')
        self.url=url.rstrip('/');self.token=token
        self.opener=build_opener(ProxyHandler({}),NoRedirect())

    def request(self,path,payload=None,session_id=None,limit=2097152):
        headers={'Authorization':'Bearer '+self.token,'Content-Type':'application/json'}
        if session_id:headers['X-Persona-Session']=session_id
        raw=None if payload is None else json.dumps(payload,ensure_ascii=False,allow_nan=False).encode()
        if raw and len(raw)>32768:raise ValueError('Body request exceeds 32 KiB')
        try:
            with self.opener.open(Request(self.url+path,data=raw,headers=headers),timeout=10) as response:
                data=response.read(limit+1)
        except HTTPError as error:
            # Do not include request details, headers or server echo in exceptions.
            if error.code in (400,403,409,422,429):
                return {'status':'rejected','reason':'http_'+str(error.code)}
            raise RuntimeError('Body HTTP '+str(error.code)) from None
        if len(data)>limit:raise ValueError('Body response exceeds bound')
        value=json.loads(data)
        if not isinstance(value,dict):raise ValueError('Expected body object')
        return value

    def snapshot(self):return self.request('/snapshot')
    def events(self,after=0):return self.request('/events?after='+str(int(after)))
    def submit(self,proposal):return self.request('/goal',proposal,proposal['session_id'])
    def cancel(self,goal_id):return self.request('/cancel',{'goal_id':goal_id})
    def chat(self,text,session_id=None):return self.request('/chat',{'text':text},session_id)
    def inspect(self,query,session_id):return self.request('/persona-inspect',query,session_id)
    def vision(self,session_id):return self.request('/vision',session_id=session_id,limit=3*1024*1024)
