# Standalone Tolik with Hermes and JevCraft

7 November 2026. User requested a standalone rebuild in their JevCraft fork,
retaining Tolik and AI Persona Lab features and using the OpenAI subscription.

## Outcome

One launch command starts Tolik's existing Minecraft account and a Hermes
planner. Hermes understands chat, chooses goals, designs builds and produces
Russian dialogue in Tolik's established voice. JevCraft keeps its native Jev
tactical decisions, Mineflayer execution, survival, admission and verified
results. Planning happens on new messages, completed/blocked work, useful
observations and a bounded idle interval. No prescribed gameplay sequence.

## Sources

- Fork: https://github.com/rkhazh/jevcraft from mrubens/jevcraft.
- Reference: teknium1/hermes-and-jev-play-minecraft, commit
  440bec09ee76523a706510601efcbda57df030ad. Its controller invokes Hermes at
  milestones and Jev selects valid actions. Its 1.16.5 demo is not copied as
  Tolik's server and its benchmark is not our performance claim.
- Hermes Agent: NousResearch/hermes-agent, inspected commit
  6b21d0564de0492e2ebd0d8f63fca86c03b5c892. Use the real agent, isolated from
  NetTyan's incompatible Python 3.10 environment.
- Local Persona Lab: NetTyan 23e4d13. Carry Tolik's configured identity,
  motivations, dated conversational memory and verified episodes; retain
  optional voice and vision boundaries. Keep provenance and upstream licenses.
- Existing JevCraft checkout 4767502 supplies tested community authentication,
  scoped edits, craft/build, navigation, bot-eye rendering and survival.

## Ownership

Hermes is the sole high-level planner. It receives compact current state,
recent messages, actual execution results and relevant dated memories. The
old continuing Jev/Terra consultation scheduler is not the new planner.
Hermes returns bounded plans and optional speech, or invokes a small explicit
Minecraft tool interface. The implementation may choose CLI or Python API
according to the pinned Hermes version's supported interface.

JevCraft remains the execution authority. A plan never grants ownership or
changes the server permissions. Every goal binds to a fresh body observation,
session, expiry and idempotency ID; known active work is not blindly replaced.
Completion means a verified native receipt, not accepted submission or LLM
text. Chat and inspection are independent of physical planning failures.

The planner runs while the body continues acting. One planner owns a session;
new messages remain queued during inference. Outdated replies/actions must not
execute after disconnect or against a newer incompatible request. No duplicate
effect after an uncertain transport result. Timeouts and shutdown stop owned
children and leave unrelated applications running.

## Subscription

Use Hermes' supported OpenAI Codex subscription integration. Prefer its native
provider if existing login can be used through Hermes' supported login path;
otherwise use its documented Codex runtime. Do not implement credential
extraction, send credentials to another provider, or silently switch to paid
OpenAI API access. Jev's separate existing OpenRouter credential remains for
tactical inference. Provider failures and usage accounting are explicit.

## Persona Lab features

- Carry the exact Tolik personality, aliases and long-term village motivation.
- Preserve the existing SQLite memory through a consistent local backup/import;
  mark historical facts as historical and never auto-resume old instructions.
- Persist actual new conversations and native receipts across launches.
- Include optional native bot-eye images and bounded world/cell inspection.
- Retain configurable ASR/TTS and Simple Voice Chat transport. Local transport
  tests and community voice availability are reported separately; community
  voice was previously unresolved and is not presumed fixed by this rebuild.
- Preserve existing community account, world state and mutation authority.
  Local credentials, transcripts and world state stay outside tracked source.

## Packaging and verification

The fork is runnable without NetTyan installed. Small reusable adapters and
their applicable tests may be carried with attribution rather than rewritten.
Dependencies and source revisions are pinned. Provide example config, setup,
launch, stop, status and logs. Existing code remains available for regression
comparison; no destructive reset of either original checkout.

Run the existing JevCraft and Persona Lab tests as the baseline, then tests for
the new orchestration, stale results, memory continuity, goal admission, output
validation and shutdown. Qualify real Hermes with subscription access before
starting Minecraft. Launch a bounded live Tolik demonstration using the current
account and permissions; capture actual actions, dialogue, images and usage.
Do not claim chat delivery, physical changes or voice based only on unit tests.

Implementation choices left to the builder: adapter module layout, exact
compact context representation, supported Hermes transport, installation
method and practical bounded demonstration duration. They must retain the
ownership and subscription constraints above.
