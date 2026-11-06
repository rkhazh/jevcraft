# Tolik: native JevCraft and Luna

Standalone Tolik now opts into `native_capabilities: true`, with Hermes using
`gpt-6-luna` through the existing OpenAI subscription connection. JevCraft's
tactical model remains `typesafe/jev-1.14`. Credentials, world state and Persona
Lab memory remain in ignored `.tolik/`; the prior local configuration is backed up.

## Gameplay change

Hermes has an authenticated native request adapter into JevCraft's ordinary
request interpreter and scheduler. It supports native resource chains, crafting,
smelting, delivery, item lists, discovery, travel, construction, following,
portals, Nether/End progression, memories, dreams and controls. The existing
model-designed schematic and exact-edit interfaces are also expanded.

The standalone native mode no longer installs the persona mutation-authority or
structure packet guard. Native item/container/entity interactions can execute
through JevCraft's own mechanics. Removed wrapper limits include the item
allowlist, Overworld-only/health admission, carried-only crafting, short travel
ranges, two-minute goal leases, one-minute visits, 64-cell edit batches, smaller
construction limits, and mandatory session/call caps. Native idle preparation is
enabled. Zero duration/call budgets mean run until explicitly stopped; positive
values are optional operator caps.

Native game rules and implementation limits remain: server protections, physical
reach and resources, loaded chunks, supported block states, pathfinding and
survival decisions. JevCraft's schematic ceiling is 48×32×48, 256 regions and
12,000 blocks. The wrapper does not grant server privileges. Native slash
commands require an actual fresh, addressed player packet from a configured
operator; neither Hermes nor formatted server text can forge that authorization.

## Session-driven fixes

Cancellation no longer discards an inspection in the same plan. Native mode can
cancel, inspect, and submit replacement work in order. Routine inventory changes
no longer withhold work. Coordinates remain tied to the dimension where they
were planned. Current target states, cancellation and observed outcomes are
checked when executing exact edits.

Long native goals remain session-owned and cancellable. Ambiguous transport
submissions reconcile using the same goal ID, preventing duplicated work and a
permanent planner wait. Delayed native dream results cannot override a newer
pause or clear. Dream status and native feedback reach Hermes and persistent
memory. Shutdown flushes dream and world knowledge.

The [session analysis](tolik-session-analysis-2026-11-07.md) explains the previous
run. Its requested block removal and return to the player were verified; the
floor was not changed. Two build leases expired, an inventory change suppressed
a retry, and JevCraft repeatedly sheltered/tunnelled around observed but unseen
wardens. The native warden survival policy is unchanged by this update.

## Validation

- Full JevCraft suite: 517 passing tests, including native admission, mechanics,
  cancellation, dream races, and the existing restricted-mode regressions.
- Full standalone Python suite: 54 passing tests covering runtime, memory,
  launcher, vision and local voice transport.
- Independent review found the ambiguous-send and dream cancellation issues;
  both have regressions and fixes.
- Two real Luna calls through Hermes' `openai-codex` provider, with no fallback
  or external tools: a movement plan in 5.326 seconds (3,879 tokens), then a
  native Nether-fortress request with the updated prompt in 8.098 seconds
  (4,405 tokens). These are planning smoke tests, not in-game completion evidence.

The previous game run ended normally at its deadline. This update was verified
without starting another game session. To run with the new configuration:

```sh
.tolik/venv/bin/python -m tolik run
```

To stop it from another terminal:

```sh
.tolik/venv/bin/python -m tolik stop
```
