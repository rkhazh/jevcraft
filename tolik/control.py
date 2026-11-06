"""Current-session operator provenance and short, deterministic game controls."""
import re
import unicodedata


def quick_command(text,user):
    if not isinstance(text,str):return None
    text=unicodedata.normalize('NFKC',text).casefold().strip(' \t.,!?:;')
    text=re.sub(r'^(?:толик|tolik(?:scheben)?)[\s,:]+','',text)
    text=re.sub(r'^(?:пожалуйста|please)[\s,]+|[\s,]+(?:пожалуйста|please)$','',text)
    text=' '.join(text.split())
    if text in {'stop','cancel','stay here','стоп','стой','стой тут','стой на месте','остановись','хватит','не двигайся'}:
        return {'kind':'native','request':'stop','requester':user}
    if text in {'follow me','иди за мной','следуй за мной','за мной','ща мной'}:
        return {'kind':'follow','target':user}
    if text in {'come here','come to me','подойди ко мне','ко мне','иди ко мне','иди сюда','подойди ко мне и посмотри отсюда'}:
        return {'kind':'come','target':user}
    return None


class DirectedControl:
    def __init__(self):
        self.current=None;self.failures=0;self.goals={}

    def observe(self,event):
        if not event.get('operator_instruction') or not event.get('event_id'):return None
        stamp=event.get('observed_at');previous=(self.current or {}).get('observed_at')
        if isinstance(stamp,(int,float)) and isinstance(previous,(int,float)) and stamp<previous:return None
        self.current={k:event.get(k) for k in ('event_id','user','msg','observed_at')}
        self.failures=0
        return quick_command(event.get('msg'),event.get('user'))

    @property
    def paused(self):return self.failures>=2

    @property
    def waiting(self):return not self.current or self.paused or self.current.get('completed',False)

    def check(self,plan):
        spec=plan.get('goal')
        if spec is None and plan.get('cancel') is not True:return None
        if not self.current or plan.get('instruction_id')!=self.current['event_id']:
            return 'current_operator_instruction_required'
        text=str(spec.get('request','')).strip().lower() if isinstance(spec,dict) else ''
        control=isinstance(spec,dict) and spec.get('kind')=='native' and text in {'stop','status','resume'}
        safe_control=control and text in {'stop','status'}
        if isinstance(spec,dict) and spec.get('kind')=='native' and not control:
            return 'use_structured_goal'
        if self.paused and not safe_control and not (plan.get('cancel') is True and spec is None):
            return 'request_paused_after_failures'
        if self.current.get('completed') and not safe_control and spec is not None:return 'instruction_completed'
        quick=quick_command(self.current.get('msg'),self.current.get('user'))
        if quick:
            matching=spec==quick
            # A completed/ongoing short command cannot authorize unrelated work.
            if not matching and not safe_control and not (quick.get('request')=='stop' and spec is None):
                return 'operator_control_only'
        return None

    def submitted(self,identifier,spec=None,instruction_id=None):
        if self.current:self.goals[identifier]={'request_id':instruction_id or self.current['event_id'],'spec':spec}

    def result(self,event):
        identifier=event.get('goal_id');attempt=self.goals.pop(identifier,None)
        if not attempt or not self.current or attempt['request_id']!=self.current['event_id']:return
        if event.get('status') in {'blocked','failed','expired','rejected'}:self.failures+=1
        elif event.get('status') in {'complete','completed','complete_unverified'}:
            quick=quick_command(self.current.get('msg'),self.current.get('user'))
            if quick and attempt.get('spec')==quick:self.current['completed']=True

    def context(self):
        return {'mode':'directed','current_instruction':self.current,'failed_attempts':self.failures,
                'paused_until_new_operator_message':self.paused,'autonomous_goals':False,
                'native_text_controls':['stop','status','resume']}
