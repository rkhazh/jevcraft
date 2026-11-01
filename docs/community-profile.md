# Bounded community profile

Start only after registration has been completed manually. Required in `private.env`: `MC_LOGIN_PASSWORD`, separate `JEV_PERSONA_TOKEN` (32+ characters); optional `OPENROUTER_API_KEY` otherwise uses the already configured NetTyan key. Never commit this file.

From workspace root:

```sh
NetTyan/.venv/bin/python setup/jevcraft-community/start-bot.py
```

Fixed target: `mc.agicraft.ru:25565`, Minecraft `1.21.11`, offline `SkipperJev`. A single connection is allowed; no reconnect loop. Authentication sends `/login` once only after a system prompt from this server, requires the trusted exact `SkipperJev joined the game` system marker plus an actual Survival world spawn (including cached-login sessions), and expires after 45 seconds. Registration/CAPTCHA requires manual intervention. Gameplay is capped at 600 seconds from process startup, with a hard 60 OpenRouter HTTP attempt limit including retries and concurrent classifications. This is an attempt cap, not a fixed dollar ceiling: request sizes and provider billing vary.

Each launch creates new private `runs/<UTC timestamp>/state` and `runs/<UTC timestamp>.log`, with `http-attempts.jsonl` recording each reserved dispatch. Never reuse local experiment goals/logs. World identity is `agicraft-community-1_21_11`; buildings disabled, command-user list empty. No voice client or localhost voice service is started. The separate persona bridge binds loopback port8769 with this profile's token. The wrapper starts only the body; parent controls any persona runner, which must use community-specific SQLite memory and omit all local house objectives and voice arguments. A Python persona LLM's calls are separate from this body's tactical OpenRouter attempt cap.

Jev1.14 is explicit. Default local launchers and deadlines remain unchanged. The body's logical-call ledger does not count retry dispatches; use this profile's attempt audit for the hard limit. Requests already in flight at shutdown can finish server-side; no new dispatch can exceed the cap.

`MC_LOGIN_SUCCESS_TEXT` is optional diagnostic authentication acknowledgement; it never releases gameplay by itself. Lobby messages never satisfy readiness. Installed Mineflayer4.39.0 / minecraft-protocol1.68.0 / minecraft-data3.116.0 / prismarine-chunk1.41.0 recognize Minecraft1.21.11 protocol774; transient backend/decoder failures are not suppressed.

## HTTP usage evidence (future launches)

`http-usage.jsonl` records at most 60 actual dispatch outcomes, including retry responses, network failures and cancellation. Each allowlisted row contains attempt number, timestamp, HTTP status (null without headers), success/abort flags, latency, reported input/output tokens and cost. It excludes prompts, state, response bodies, credentials and provider error text. Existing logical-call ledger accounting remains unchanged. Usage-ledger write failure stops the community session.

`cost_usd: null` / `charge_known: false` means unknown, never free. Timeouts, disconnects, aborted calls, missing usage, or process termination can still incur provider charges. Compare attempt audit counts against outcome rows to identify unfinished requests. Sum known costs only as reported charges, not a complete billed total; reconcile unknowns with the provider dashboard. The 60-attempt ceiling is unchanged and is not a dollar cap. Persona-model calls are separate.
