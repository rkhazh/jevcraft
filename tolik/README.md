# Tolik

Hermes plans and talks. JevCraft plays Minecraft. Tolik remains Tolik.

This is a standalone runtime in the JevCraft fork. It uses the actual Hermes
agent with OpenAI's Codex subscription provider, an explicit JSON plan, and
JevCraft's existing Mineflayer body. The old NetTyan/Terra consultation scheduler
is not used. NetTyan is not required after migration.

New chat, native work results and bounded idle reconsideration trigger a
Hermes turn. One plan runs in the background while Jev keeps handling the body.
New input invalidates an outdated proposal. Body admission checks actual world
state and permissions, and native verified results are recorded separately from
plan proposals and acknowledgements.

## Install

Requires Node 22+, git, and uv. Run from the repository root:

```sh
sh tolik/install.sh
HERMES_HOME="$PWD/.tolik/hermes" .tolik/hermes-source/.venv/bin/hermes auth add openai-codex --type oauth --label Tolik
```

Complete the official ChatGPT sign-in shown by Hermes. This uses the subscription
provider with `gpt-6-luna`; there is no paid OpenAI API fallback. Jev still uses its separate
OpenRouter key. Hermes is pinned to revision
`6b21d0564de0492e2ebd0d8f63fca86c03b5c892`.

## Migrate the current Tolik once

```sh
.tolik/venv/bin/python -m tolik migrate \
  --community /absolute/path/setup/jevcraft-community \
  --key-env /absolute/path/NetTyan/.env \
  --hermes-python "$PWD/.tolik/hermes-source/.venv/bin/python"
```

This copies only required credentials, the standing mutation authority, native
body state, local vision assets and dated memory into ignored `.tolik/`. The source is not modified.
It refuses to overwrite an already configured runtime. Imported old requests
are historical records, never new instructions. The character is the existing
`profile.json`, including Tolik's village motivation and conversational style.

For a fresh installation, use `config.example.json` as `.tolik/config.json`,
provide `.tolik/credentials.json` with `MC_LOGIN_PASSWORD`, `JEV_PERSONA_TOKEN`
(at least 32 characters) and `OPENROUTER_API_KEY`. A mutation-authority file is
required only for the optional restricted persona mode. For vision, set `asset_root` to a local 1.21.11 asset directory
with its manifest, or set `vision` to false. Client assets are not distributed here.
This launcher uses the existing `TolikScheben` account
on `mc.agicraft.ru`, Minecraft 1.21.11. It does not register or warp the account.

## Native capabilities and human instructions

The standalone configuration enables `native_capabilities: true` and defaults
to `autonomous: false`. Hermes sends structured obtain, craft, move, visit,
come, follow, build and exact-edit goals to JevCraft. Native mechanics can gather
the resources required for an assigned task. Digging and building remain available
where the server allows them; there is no house-only boundary.

Directed mode waits between requests. It disables optional stockpiling,
exploration, village visits and dream execution, including during another task.
Immediate survival reactions remain enabled. Old memory does not authorize a
new task after reconnect. Every model action must reference the latest verified
operator message in the current session. Simple Russian/English stop, follow
and come commands dispatch directly without waiting for Hermes inference.

Free-text native requests are limited to exact `stop`, `status` and `resume`
controls. This avoids interpreting a compound stop/build request as just stop.
Two failed or blocked attempts pause the current request until a new operator
message. Action-associated speech is sent only after the body accepts the action;
acceptance still does not prove completion.

Setting `autonomous: true` explicitly restores native idle preparation, dreams
and the free-text interpreter. That path includes item lists, delivery, discovery,
portals and Nether/End progression in addition to structured gameplay. The direct
operator controls and failure pause above are specific to directed mode.

Removed in this mode: local land grants and packet mutation guards, the item
allowlist, Overworld-only and low-health admission, carried-inventory-only
crafting, 16/96-block travel limits, 64-cell edit limits, two-minute goal leases,
one-minute visits, smaller persona construction caps and mandatory ten-minute /
60-call run caps. Cancellation followed by
inspection or replacement work executes in order; ordinary inventory changes
no longer discard a new plan. New messages still supersede stale inference.

Set `operators` in local config to a player-name → server-UUID mapping. Matching
in-game requests supply the current task. Native server commands
require a fresh addressed literal command from a configured operator's actual
player-chat packet, and retain JevCraft's one-shot command authorization. The
model cannot fabricate that packet; formatted server messages cannot authorize it.

What still applies:

- Minecraft/server permissions, loaded chunks, available resources, recipes,
  reach, physics, and JevCraft's native pathfinding and survival decisions.
- JevCraft's own schematic ceiling: 48×32×48, 256 regions, 12,000 blocks and its
  supported material palette. Exact edits require observed current states and
  cannot force unsupported states. Native travel to a remembered place requires
  entering its dimension first.
- One owner of body controls, session/cancellation checks, server-observed block
  changes and truthful completion reporting. Generic native engine completion is
  `complete_unverified` until independently observed; exact edit/build/arrival
  verification remains available.
- A 60-second timeout for an individual Hermes inference, bounded transport
  payloads, short chat messages and serialized vision capture. These do not
  terminate a running gameplay goal. Voice remains optional and unverified on
  the community server.

`native_capabilities: false` retains the previous restricted persona integration
for callers that need it. `authority.server-permissions.json` belongs to that
mode; native Tolik does not use its local grants. The prior local configuration
and authority files are backed up under ignored `.tolik/backups/`.

## Run, inspect, stop

```sh
.tolik/venv/bin/python -m tolik run --seconds 300 --max-calls 24 --max-jev 40
.tolik/venv/bin/python -m tolik status
.tolik/venv/bin/python -m tolik stop
```

Without flags, `run` continues until stopped: `--seconds 0`, `--max-calls 0`
and `--max-jev 0` mean no operator cap. Positive values set optional caps; the
example above is a bounded interactive test. A bridge/lock check prevents duplicate controllers. Ctrl-C stops the owned planner and game body;
it leaves the human Minecraft client running. The CLI prints the private run
directory containing observations, exact planner inputs/results, body logs and
summary. Memory persists across sessions. Incomplete or rejected work is never
reported as a verified physical success.

## Persona Lab features

- Existing Tolik identity, motivations, remembered conversations and verified
  episodes. Memory is dated and kept separately from current observations.
- Actual game chat plus model-chosen movement, crafting, construction and exact
  edits under native permissions. Inspection can resolve nearby cells first.
- Bot-eye images through Persona Lab's validated simplified renderer; available
  frames go directly to Hermes as image inputs and are archived locally.
- Optional Simple Voice Chat protocol 20/21, local Parakeet ASR and Piper TTS.
  Set `voice`, `voice_send` and `voice_players` in the local config. Reception
  requires named players mapped to fresh server UUIDs. Defaults are off.
  Piper's existing Gradio endpoint is `127.0.0.1:22231`; Parakeet's transcription
  endpoint is `127.0.0.1:22233/v1/audio/transcriptions`. `TOLIK_TTS_URL` and
  `TOLIK_STT_URL` can override them. Install system libopus for voice.

Community voice authentication was unresolved before this rebuild. Local UDP
tests establish transport behavior, not that people on AgiCraft can hear Tolik.
Streaming-platform collectors and Live2D remain separate Persona Lab services;
this runtime is the standalone Minecraft character.

## Tests

```sh
npm test
.tolik/venv/bin/python -m unittest discover -s tolik -t . -v
```

Tests exercise native gameplay boundaries, the new scheduler, memory import,
voice transport and vision validation without model or public server calls.
See `NOTICE.md` for source attribution and `../docs/tolik-hermes-design.md` for
the architecture. [Live observations and limits](../docs/tolik-hermes-result-2026-11-07.md)
are documented separately from test claims.

The [recorded session analysis](../docs/tolik-session-analysis-2026-11-07.md)
separates verified actions, wrapper failures and native survival behavior.
The [native-mode update](../docs/tolik-native-capabilities-2026-11-07.md) records
validation and the Luna switch. The later
[directed-control update](../docs/tolik-directed-control-2026-11-07.md) documents
the restored restrictions. Detailed session analysis remains local in ignored
`.tolik/reports/tolik-luna-session-analysis-2026-11-07.md`.
