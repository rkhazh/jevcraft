# Bounded community profile

Start only after registration has been completed manually and the trusted server's exact successful login message has been recorded in `private.env` as `MC_LOGIN_SUCCESS_TEXT`. Also required: `MC_LOGIN_PASSWORD`, separate `JEV_PERSONA_TOKEN` (32+ characters); optional `OPENROUTER_API_KEY` otherwise uses the already configured NetTyan key. Never commit this file.

From workspace root:

```sh
NetTyan/.venv/bin/python setup/jevcraft-community/start-bot.py
```

Fixed target: `mc.agicraft.ru:25565`, Minecraft `1.21.11`, offline `SkipperJev`. A single connection is allowed; no reconnect loop. Authentication sends `/login` once only after a system prompt from this server, requires exact success and world spawn, and expires after 45 seconds. Registration/CAPTCHA requires manual intervention. Gameplay is capped at 600 seconds from process startup, with a hard 60 OpenRouter HTTP attempt limit including retries and concurrent classifications. This is an attempt cap, not a fixed dollar ceiling: request sizes and provider billing vary.

Each launch creates new private `runs/<UTC timestamp>/state` and `runs/<UTC timestamp>.log`, with `http-attempts.jsonl` recording each reserved dispatch. Never reuse local experiment goals/logs. World identity is `agicraft-community-1_21_11`; buildings disabled, command-user list empty. No voice client or localhost voice service is started. The separate persona bridge binds loopback port8769 with this profile's token. The wrapper starts only the body; parent controls any persona runner, which must use community-specific SQLite memory and omit all local house objectives and voice arguments. A Python persona LLM's calls are separate from this body's tactical OpenRouter attempt cap.

Jev1.14 is explicit. Default local launchers and deadlines remain unchanged. The body's logical-call ledger does not count retry dispatches; use this profile's attempt audit for the hard limit. Requests already in flight at shutdown can finish server-side; no new dispatch can exceed the cap.
