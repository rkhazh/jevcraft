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

SVC handshake/export is now explicit opt-in: append `--voice` to `start-bot.py`. The default text-only launch sets `JEV_SVC_ENABLED=0`; the community supervisor forwards `--voice` only when requested. Voice sending is separately controlled by the persona runner. A stable live session can request fresh credentials through authenticated `POST /voice/session/refresh` with `X-Persona-Session`, at most once per10 seconds, without reconnecting or invoking Jev. Existing processes do not gain new endpoints until their next authorized launch.

## TolikScheben profile

Append `--character TolikScheben` to select username `TolikScheben`, bridge port8770, `setup/jevcraft-community/tolik-private.env`, and `runs/tolik/<timestamp>/state`. Its world ID is `agicraft-community-1_21_11-tolik`; no Skipper goals or state are loaded. The default `--character Skipper` retains usernameSkipperJev, port8769 and `private.env`. The supervisor maintains separate character memory. Both profiles retain600 seconds,60 actual tactical HTTP attempts, one connection and optional `--voice`.

Tolik enables the existing bounded model-authored build capability and relevant ordinary Survival materials, doors and beds. There is no village blueprint, construction sequence or forced first build. Existing terrain/ownership checks, geometry limits, lease bounds and factual world verification remain in effect. Model permission uncertainty must produce waiting or asking; advertising building capability does not establish permission to alter another player's land.

For a new account only, append `--first-register`: one trusted server `/reg` or `/register` prompt permits `/reg <stored password> <stored password>`. The default refuses registration; player chat cannot trigger it; CAPTCHA still requires manual intervention. The secret comes from that character's private file and is redacted from process output. Registration acknowledgement alone cannot start gameplay: the matching self-join marker plus actual Survival spawn is still required. Never commit either private environment file. Launching and credential generation remain separate authorized steps.

Tolik's body state persists at `setup/jevcraft-community/characters/TolikScheben/body-state`, including its world-specific structure registry and survival memory. Per-run HTTP attempt/usage evidence and process logs remain under `runs/tolik/<timestamp>`. Skipper retains its existing run-local body state. External-persona sessions do not automatically resume saved running goals: every new session still needs a fresh admitted observation and lease; recorded build ownership can support a later explicit continuation. The launcher binds its exclusive bridge port before creating the Minecraft client, so an occupied profile port stops startup before another game connection is opened.
