"""Runs inside Hermes' own environment. No private authentication implementation."""
import contextlib
import base64
import json
import os
import sys
from pathlib import Path


def main():
    request=Path(sys.argv[1]);response=Path(sys.argv[2]);model=sys.argv[3]
    data=json.loads(request.read_text())
    # Hermes owns provider resolution, OAuth and its Responses transport.
    from agent.ssl_verify import install_truststore
    install_truststore()
    from hermes_cli.runtime_provider import resolve_runtime_provider
    from run_agent import AIAgent
    runtime=resolve_runtime_provider(requested='openai-codex',target_model=model)
    if runtime.get('provider')!='openai-codex':raise RuntimeError('Subscription provider was not selected')
    agent=AIAgent(model=model,provider='openai-codex',api_key=runtime.get('api_key'),
        base_url=runtime.get('base_url'),api_mode=runtime.get('api_mode'),
        enabled_toolsets=[],max_iterations=2,quiet_mode=True,
        skip_context_files=True,skip_memory=True,skip_background_review=True,
        reasoning_config={'effort':'low'},fallback_model=None,run_budget_seconds=60)
    # No terminal, browser, file or messaging tools in the Minecraft planner.
    if agent.tools:raise RuntimeError('Hermes planner unexpectedly has tools enabled')
    prompt=(Path(__file__).with_name('prompt.txt')).read_text()
    image_path=data.pop('image_path',None)
    message=json.dumps(data,ensure_ascii=False)
    if image_path:
        image=Path(image_path).read_bytes()
        if len(image)>2097152 or not image.startswith(b'\x89PNG\r\n\x1a\n'):raise ValueError('Invalid planner image')
        message=[{'type':'text','text':message},{'type':'image_url','image_url':{'url':'data:image/png;base64,'+base64.b64encode(image).decode()}}]
    result=agent.run_conversation(message,system_message=prompt)
    if not result.get('completed') or not result.get('final_response'):
        raise RuntimeError('Hermes did not complete the planning turn')
    text=result['final_response'].strip()
    if text.startswith('```'):
        text=text.split('\n',1)[1].rsplit('```',1)[0].strip()
    plan=json.loads(text)
    usage={key:result[key] for key in ('input_tokens','output_tokens','cache_read_tokens',
        'cache_write_tokens','reasoning_tokens','prompt_tokens','completion_tokens','total_tokens') if key in result}
    response.write_text(json.dumps({'plan':plan,'api_calls':result.get('api_calls'),
        'usage':usage or None},ensure_ascii=False))


if __name__=='__main__':
    try:main()
    except Exception as error:
        # Detailed diagnostics stay in the private subprocess log.
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
