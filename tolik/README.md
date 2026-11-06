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
provider; there is no paid OpenAI API fallback. Jev still uses its separate
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
(at least 32 characters) and `OPENROUTER_API_KEY`, and an explicit valid native
mutation-authority file. For vision, set `asset_root` to a local 1.21.11 asset directory
with its manifest, or set `vision` to false. Client assets are not distributed here.
This launcher uses the existing `TolikScheben` account
on `mc.agicraft.ru`, Minecraft 1.21.11. It does not register or warp the account.

## Run, inspect, stop

```sh
.tolik/venv/bin/python -m tolik run --seconds 300 --max-calls 24 --max-jev 40
.tolik/venv/bin/python -m tolik status
.tolik/venv/bin/python -m tolik stop
```

Runs are bounded to 600 seconds and 60 Jev attempts at most. A bridge/lock check
prevents duplicate controllers. Ctrl-C stops the owned planner and game body;
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
