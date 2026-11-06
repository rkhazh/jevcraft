# Tolik: broader editing scope and operator instructions

The user explicitly requested removal of the house-only limit, digging and
building wherever the Minecraft server permits, priority for their in-game
instructions, and a new interactive launch.

The local policy now contains dig/place grants spanning all supported world
coordinates in all three dimensions. Existing project utility grants remain.
The previous policy was backed up locally. The public opt-in example is
[authority.server-permissions.json](../tolik/authority.server-permissions.json).
These are local permissions; server protection and actual block updates still
determine success. Container contents and entity effects are separate operations.

SkipperBot is configured as the gameplay operator using the name and known
server UUID. Incoming matching chat or voice events are labelled for Hermes;
the prompt prioritizes current operator requests and corrections over autonomous
plans. Server-formatted community chat still relies on the server's formatting
and current roster, rather than independent signed sender authentication.
No chat message can rewrite host permissions or access credentials/files.

Inspection also found that the exact-edit tool rejected grass's ordinary
`snowy` property. Grass, podzol and mycelium now support exact edits with that
observed boolean property; target-state and neighbour checks remain. Other
complex block effects retain their existing limitations.

Verification: 497 JevCraft tests and 46 standalone tests passed. The soil cases
exercise real native mutation guards and observed completion. Operator tests
cover matching/mismatched UUIDs and the voice event's distinct UUID field. Each
new behavior failed before its fix. Native policy checks confirmed the earlier
requested grass cell, distant cells and new build sites are locally permitted.
Independent review found the voice UUID mismatch; it was corrected and retested.

[Remaining limits](../tolik/README.md#editing-scope-and-human-instructions) include
Overworld-only persona actions, batch/range/design limits, Survival materials,
unsupported complex interactions, native threat preemption, bounded runtime and
unverified community voice. This change does not promise perfect interpretation
of every instruction or establish a completed live dig/build result.
