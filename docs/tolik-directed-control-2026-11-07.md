# Tolik directed control

The operator stopped the Luna trial because Tolik left the requested work and
explored. He remains stopped. The model is still `gpt-6-luna` through the existing
Hermes OpenAI subscription connection.

## What the session established

The run lasted 7 minutes 38 seconds before the operator stopped it. All eight
operator messages reached the planner with the correct identity. The floor did
not change. The bot reached the player, then native idle behavior gathered wood,
explored and visited a village, taking it about 112 blocks from the house.

Two control layers caused the failure. Hermes sent compound natural-language
requests into another interpreter: one stop-and-replace request became only
stop, while eleven floor requests returned clarification. The wrapper recorded
those clarifications as unverified completions. Meanwhile, when an active goal
ended, native idle preparation immediately started its own work. Historical
memory also caused an unsolicited floor-task restart at session startup.

The run had 36 completed Luna calls and 46 native-body HTTP attempts. The detailed
local report distinguishes accepted requests, physical evidence, unverified
results and token accounting. It is stored with ignored private artifacts at
`.tolik/reports/tolik-luna-session-analysis-2026-11-07.md`.

## Restored restrictions

- Standalone `autonomous: false` is the default. The body holds between tasks;
  it does not explore, visit villages, gather optional reserves or execute dreams.
- Work must reference an actual current-session operator message. Reconnection
  does not turn remembered work into a new instruction. Player name and server
  UUID establish the operator's dialogue identity.
- Simple stop/follow/come commands use direct dispatch, interrupting pending
  inference. Newer voice/chat timestamps win; a later question cannot erase a
  queued stop. A newer correction supersedes a queued movement command.
- Hermes uses structured gameplay goals. Free-text native requests are restricted
  to exact stop/status/resume controls, eliminating compound reinterpretation.
- Two failed or blocked attempts pause that request until a new operator message.
  Clarification/refusal is blocked, not completion. Failed resumptions count too.
- Speech accompanying an action waits for acceptance. Rejected or withheld work
  does not produce a promise that it has started. Acceptance remains distinct
  from verified physical completion.

Requested digging, construction and resource acquisition remain enabled anywhere
the server permits. The house-only boundary, short travel limits and two-minute
native goal leases remain removed. Server protections, observed block states,
supported construction mechanics and immediate survival reactions still apply.
The latter can temporarily interrupt a task to deal with danger.

Directed mode intentionally exposes fewer request types than free-text native
mode: obtain, craft, move, visit, come, follow, build and edit, plus controls.
Free-text discovery, bundles/delivery and portal/End progression are not directly
exposed in this mode. Explicit `autonomous: true` restores the earlier behavior.

## Validation

Local regressions cover real body active-goal transitions, ambiguous accepted
requests, current instruction IDs, stop races, cross-channel ordering, rejected
action speech, failure pauses, body hold behavior, disabled dreams and direct
typed goals. The full JevCraft suite passes 519 tests; the full standalone Python
suite passes 70 tests. `git diff --check` also passes.

Two synthetic-only real Luna checks passed with the updated prompt: a fresh
session ignored a fictional historical request; an explicitly inspected fictional
floor produced an exact structured edit for all three cells. They used the
existing subscription, with no game calls. These establish planning behavior,
not live mining or building success. Detailed recorded session data stayed local.

No game run was started after the stop request. A later live trial is still needed
to verify end-to-end behavior on the server.
