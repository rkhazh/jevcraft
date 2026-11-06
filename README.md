# jevcraft

## Standalone Tolik fork

This branch adds [Tolik: Hermes + JevCraft](tolik/README.md), using the OpenAI
subscription provider and the existing Persona Lab character, dated memory,
chat, bot-eye vision and optional voice transport. Start with the
[installation and launch instructions](tolik/README.md).
The original JevCraft project description follows below.

**A Minecraft bot that beat the game with a model that never writes a word.**

On 2026-10-24, from a fresh Survival world on Normal difficulty (no cheats, no commands, no staged items) and an empty inventory, jevcraft killed the Ender Dragon after about 107 hours of play; a second fresh run did it on 2026-10-26 ([the wins](#the-wins)). Every judgement along the way, about 25,700 of them, was made by [Jev](https://typesafe.ai/), a small [System One](https://docs.typesafe.ai/concepts/system-one) model from TypeSafe: a classifier that is given a list of options and returns a probability for each, in about 0.2 seconds. Jev's part of the whole run cost about $4.30.

Jev never generates text, plans or code. **Code lists what the bot can really do right now, with what each option costs and gains. Jev picks one.** The bot is built on [mineflayer](https://github.com/PrismarineJS/mineflayer). When Jev chose badly, the cause was almost always a wrong price or a missing option on the menu, not bad judgement, and most of what this README teaches follows from that.

The next goal is time. A good human speedrun takes about eleven minutes.

[The loop](#the-loop) · [One decision](#one-decision) · [The wins](#the-wins) · [What we learned](#what-we-learned) · [How we improve it](#how-we-improve-it) · [Run it yourself](#running-it)

## The loop

```
 game state ──► code: what can the bot really do here?     (mineflayer, src/*.js)
                  │  up to fifteen options, each priced:
                  │  cost (health, seconds), gain (toward the goal),
                  │  and what was already tried from here (the ledger)
                  ▼
              Jev: one HTTPS call, about 0.2 s              (src/typesafe.js)
                  │  a probability for every option; never free text
                  ▼
              code checks the pick was offered and carries it out,
              holds the answer until a fact it rested on changes,
              records what came of it ──► the next question
```

## One decision

A blaze is 8 blocks away in a Nether fortress. The bot is on fire at 17.5 of 20 health, in iron armor with a sword and shield, and needs seven more blaze rods. Code builds fifteen options from the game state and prices each one. Three of them, and the probability Jev gave each:

| Option | What its description says, in short | Jev |
| --- | --- | --- |
| `charge_nearest` | Walk in on the nearest blaze behind the shield while its volleys rest, strike it until it dies, take its rod if it drops one. Toward the rods: one blaze. | **0.26** |
| `leave_and_heal` | Walk 9 blocks (about 2.8 seconds in their fire, about 2.9 damage) to a spot none of the four blazes can see, heal, then be asked again. Toward the rods: none yet. | 0.20 |
| `keep_working` | Carry on for fifteen seconds. The blaze keeps shooting: about 19 damage from 18 health, more than the bot has. | 0.00 |

Jev picked `charge_nearest`, code checked the pick was one it had offered, and the bot walked in. The answer is held until a fact it rested on changes (the blaze dies, health drops, another mob arrives); then the question is asked again with the new facts. The last part of each option, what it gains toward the goal, was added after note 614: without it, hiding looked cheap and the bot hid.

## The wins

Every fresh-world run that has killed the dragon (Survival mode, Normal difficulty, a fresh seed and an empty inventory each time), by its own clock (`gameProgress.milestones`); each has a write-up under [docs/wins/](docs/wins/).

| Run | Started | Killed the dragon | Hours played | Nether | Eyes | Stronghold | End entered | Deaths | Write-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full-2 | 2026-10-19 | 2026-10-24 06:53Z | 107.2 | 0.8 h | 26.2 h | 27.0 h | 76.1 h | 81 | [full-2.md](docs/wins/full-2.md) |
| full-3 | 2026-10-19 | 2026-10-26 09:01Z | 150.1 | 7.8 h | 34.0 h | 43.5 h | 54.6 h | 95 | [full-3.md](docs/wins/full-3.md) |

Staged trials (a run restarted from a saved stage, so that one phase is tried many times an hour; `scripts/trials/stage-loop.sh`): the first End-stage kill came on 2026-10-26 at 15:31Z, trial 323 on port 25589, from the End's entry platform to [Free the End] in 31 minutes, 187 dragon health taken in 7.8 minutes after the last crystal by the sword at the perched head from the ground (strike_head picked 1470 times). The 25 End trials before it that day all died within 35 minutes. Record: `artifacts/wins/stage-dragon-323-2026-10-26/`. The second came an hour later at 16:26Z, trial 333 on port 25592, from the island at the pillars in 27 minutes, 189 health in 5.4 minutes after the last crystal, the same way (55 sword blows at the perched head from the ground; `artifacts/wins/stage-dragon-333-2026-10-26/`). The third at 17:26Z, trial 336 on port 25589, from the entry platform in 21 minutes, 178 health in 7.9 minutes, 36 blows, the dragon holding all 20 of its landings for the bot standing in its sight (`artifacts/wins/stage-dragon-336-2026-10-26/`). Three kills in two hours; each was the sword at the perched head from open ground.

Both runs spent most of their time after entering the End: full-2 49 hours from the End kit to the kill, full-3 103 hours and 50 deaths. The fight itself takes minutes once the bot arrives kitted; the hours go on dying at night while kitting up again, nights waited out with no bed carried, and corpse runs. That is the work now: the time, not the kill.

Jev's cost for full-2 was about 25,700 decisions and 102 million input tokens, about $4.30 at its list price of $0.042 per million input tokens (output is free). The dragon had first been killed five days before full-2 from a staged world (a saved world from a late stage, so hard parts get many attempts an hour), in one 30-minute life. A human speedrun gets its pearls by bartering with piglins and blows the dragon up with beds; both are on Jev's menu now with the game's own numbers, and full-3 did set off a bed under the perch. Four more fresh runs are under way measuring the time to the dragon.

## What we learned

Code decides what is possible, Jev decides what to do, and how good the decisions are depends on how honest and complete the menu is. In order of how much they mattered:

1. **The options are Jev's whole world.** It cannot invent an option and it does not check our arithmetic. Nearly every bad choice we traced was a wrong price, a missing option or a stale fact. A barter was said to cost nine gold ingots a pearl, from one lucky sample; the game's own table says 15.6 (note 2106). Fixing the menu has worked far better than adding rules on top of it.
2. **A route that is not offered never happens.** Bartering was offered only once gold and a piglin were already in reach, so in 21 hours no fresh run bartered (note 2107). Beds against the dragon were offered with no damage figure, and Jev gave them 0.07 (note 2108). Speedrunners use both. Offering every real route matters more than tuning any one fight.
3. **Every option needs a price, in units that compare.** Options with no price were chosen over priced ones (`keep_working`, 39 times, note 2097). Health and seconds help; minutes toward the goal are what let unlike options be weighed, such as cooking food against eating it raw (note 2101), or carrying a rod to safety against hunting on (note 2105).
4. **Code that quietly decides is the biggest blind spot.** The routine meal ate whatever the code ranked first, about 298 of 303 meals, and Jev never knew there was a choice (note 2103). Asking "how often is Jev actually asked?" found it. Every hidden threshold is a decision Jev cannot improve.
5. **Take facts from the game's code and from this run, not from old trials.** Telling Jev that 70 of 80 lives carrying blaze rods died with them, a figure from September trials that died ten times as often, led to a 45-minute trip to protect one rod (note 2105). The server's own files have the real barter odds and what a bed does to the dragon (46 to 60 damage, note 2108).
6. **Measure what you are optimizing, and check the measure.** Chasing deaths hid the time lost to walks, waits and stalls; a death only costs the time it takes to get the kit back. Even our time-lost tool first counted chosen mining as "stuck", overstating it three to four times (note 2104).

Two more that do not fit the list. Loops are as dangerous as deaths: one question was once answered the same way 4,423 times, until every feature's private list of failures was replaced by one shared record of what has been tried and what came of it, the *ledger* (note 571). And a large LLM is not a better judge here: one reviewing the same decisions agreed with Jev, took 14 seconds a decision and cost about a hundred times more, so we removed it.

The episodes behind these, including reflexes, confidence gates and blaze tactics, are in [docs/lessons.md](docs/lessons.md). "Note N" is a trial note: [docs/notes-index.md](docs/notes-index.md) lists all 2,039 with their commits.

## Two clips

Both are from 2026-09-28, at the fortress stage, a month before the win.

![Jev kills a blaze on a fortress bridge](docs/media/blaze-kill.gif)

Code offered five things to do about the blazes and Jev picked `close_in` (0.42, in 0.15 seconds) over `dig_in_and_fight` (0.21) and leaving (0.14). It walked in, killed a blaze and picked up its rod.

![A ghast's fireball knocks Jev into lava](docs/media/ghast-death.gif)

Jev chose to `fight` (0.22) a ghast, and a fireball knocked it into lava. Nothing in the options priced a push over the edge; note 612 added a way to step back from it. Most improvements start this way: a death or a stall shows a missing option or a wrong price, and the fix goes into the menu.

## How we improve it

The bot is improved by changing its code, prices and options; Jev itself is never retrained. The loop that produced notes 500 to 2108, as run in October 2026:

1. Seven to twenty trials play in parallel, one Minecraft server each, some from fresh worlds and some from saved stages.
2. A watcher reports each death, stall or loop; a progress audit and trail maps catch runs that are busy without getting anywhere.
3. A coding agent (Claude) traces the failure from the flight record, one frame a second plus one per decision, and fixes the cause in general, with tests that fail without the fix.
4. Fixes merge after the test suite and go live by a quiet restart: each bot quits once nothing is near it, and its supervisor relaunches it on the new code.
5. Every three hours a second model, Fable, reads the notes and logs and gives design advice without changing code; two of its reviews changed the design (notes 571 and 599).

### The arena

[scripts/arena.js](scripts/arena.js) stages fights on a separate server (a blaze spawner, wither skeletons, hoglins) and runs the real survival code against them. The results are quoted to Jev in the option descriptions. Four blazes at a live spawner, with iron armor, a sword and a shield (note 606):

| Tactic | Runs | Kills | Rods | Median damage per run (20 = full health) | Deaths |
| --- | --- | --- | --- | --- | --- |
| Walk in and fight (`close_in`) | 10 | 17 | 7 | 32.2 | 3 |
| Walk in, leave to heal when hurt (`leave_and_heal`) | 5 | 4 | 3 | 23.6 | 1 |
| Wall in where it stands, one window (`box_here`) | 5 | 0 | 0 | 31.5 | 1 |
| Walk to the spawner and wall in there (`box_at_spawner`) | 5 | 0 | 0 | 33.8 | 3 |
| Light up the spawner (`light_spawner`) | 5 | 0 | 0 | 32.8 | 4 |
| Wait round a corner (`corner_ambush`) | 5 | 1 | 0 | 32.2 | 3 |

Damage above 20 means the bot healed during the run. A blaze drops a rod about half the time. Walking in was the only tactic that got rods; the box was safe once built, but blazes don't come to a window.

Operational notes, trail maps and the limits of one machine are in [scripts/README.md](scripts/README.md).

## How decisions work in code

- Code builds the options from the game state. Jev never names a coordinate, item or command, and its pick is checked against what was offered.
- Each option's description says what it does, what it costs (damage and seconds, against the bot's actual health) and what it gains toward the goal. Mob behaviour and numbers such as fireball knockback are taken from the game's own code and checked on a test server.
- Every play question also offers `none_good`: "the move a player would make is not listed". If Jev picks it, code logs a missing option and takes the most likely listed one. Those logs became a worklist for new options.
- If only one option is possible, Jev is not asked.
- No question has a code fallback. If the service is down, the bot holds, says it is waiting for Jev, and asks again with a backoff ([src/jev-down.js](src/jev-down.js), note 707). The tests answer with a declared stand-in ([test/support/jev-stand-in.js](test/support/jev-stand-in.js)).

### What Jev is sent

The `state` holds only what a player would weigh for this decision, worked out by code: health, armor and weapon, the threats with their distance and whether they can be reached, and a fight estimate. A few context fields appear on every play question:

- `riskNow`: how bad things are right now (hostiles in range, shots incoming, what fighting all of them would cost).
- `healing`: whether health comes back here, what food is carried, where the nearest food is.
- `deathWouldCost`: what would drop, the walk back from respawn, and the real minutes to make it all again.
- `runClock`: minutes played, what the bot is working on, and where the time has gone, so Jev can see it has spent too long on something.
- `recentPositions`: where the bot has been, every 15 seconds, so it can see it is going in circles.
- `previousStance`: the last answer to this question, how long ago, and why it is being asked again.

Some fields are sentences rather than numbers. Code never reads them; they are there for Jev, and the instructions that explain each field are only sent when the field is present. Field names keep the codebase's British spelling (`armour`).

<details>
<summary>A real question: the state Jev was sent</summary>

Here is the state behind [One decision](#one-decision), a real `encounter_stance` question from a trial at a fortress, shortened. The bot is at a fortress, burning, with one blaze in sight 8 blocks off and more nearby. `estimate.fightHere` is the price of fighting everything in reach where it stands; each option prices its own plan.

```json
{
  "health": 17.5, "food": 20, "dimension": "the_nether",
  "armour": ["iron_helmet", "iron_chestplate", "iron_leggings", "iron_boots"],
  "weapon": "iron_sword", "shield": true, "buildingBlocks": 464,
  "threats": [{ "name": "blaze", "distance": 8.3, "shoots": true, "visible": true }],
  "estimate": { "fightHere": { "seconds": 6.3, "damageTaken": 3.2, "healthAfter": 14.3 } },
  "alight": "The bot is alight at 17.5 health: about 4.7 seconds of fire left, a health a second that armour does not stop. Water puts it out at once; the Nether has none.",
  "riskNow": { "level": "high: the mobs about could kill the bot if they all came",
               "hostilesWithin": { "blocks": 24, "count": 6, "inSight": 1, "shooters": 6 },
               "shotsComingAtTheBot": 2 },
  "healing": { "healthComesBack": "yes: at full hunger ...", "foodCarried": "nothing to eat",
               "nearestFood": ["1 hoglin seen just now, 35 blocks north-west"] },
  "deathWouldCost": { "dropsWorn": ["iron helmet", "iron chestplate", "iron leggings", "iron boots", "shield"],
                      "levelsLost": 7, "realMinutesToMakeAgain": { "iron pickaxe": 5, "iron armour": 9 } },
  "runClock": { "minutesPlayed": 163, "nowOn": "obtain blaze rods" }
}
```

</details>

The options Jev was given for that state are the ones in [One decision](#one-decision).

A smaller example from the replay suite (`poisoned-by-witch-apple-offered`): the bot is at 1 health, poisoned, in full iron, with a witch 19 blocks off.

> `fight`: ... about 10.2 seconds and 14.4 damage to kill them all, from 1 health (more than the bot has) ...
>
> `eat_golden_apple`: Eat the golden apple now (2 carried): about 1.6 seconds eating while the mobs hit, then four extra health as absorption and regeneration of about eight health over five seconds.
>
> `retreat`: ... A witch walks after a player it has seen and throws within about ten blocks; a run that stays in its sight stays in its reach.

In the replay suite Jev picks the apple or the retreat; either is accepted, since neither is clearly right at 1 health.

<details>
<summary>How a question is defined in code</summary>

Questions are declared in [src/decisions/](src/decisions/index.js). This is the question about a shooter's warning, in outline:

```js
define({
  id: 'shot_answer', area: 'combat', parent: null, kind: 'combat', primitive: 'choice', stakes: 'medium', tree: true,
  question: 'A shooter is about to shoot at the bot: raise the shield toward it, step out of its line, strike it first, or keep on?',
  trigger: 'As a shooter in sight begins its warning (a blaze glows, a ghast opens its mouth, a skeleton draws), a shield carried, whatever the bot is doing ...',
  source: 'src/shot-reflex.js (shotOptions, ask, tick)',
  options: [
    { key: 'shield_up', label: 'face the shooters and hold the shield up while the shots come', when: 'a shield carried; said with how long the step stops ...', level: 'root' },
    { key: 'behind_cover', label: 'step out of the shooters\' line behind a block and stay there while the shots come', when: 'a cell one or two steps off ...', level: 'root' },
    { key: 'strike_first', label: 'strike the shooter at arm\'s length before it shoots', when: 'a warned shooter the sword reaches now ...', level: 'root' },
    { key: 'keep_on', label: 'leave the shield down and keep on with what the bot is doing', when: 'always; said with what each shot that lands costs ...', level: 'root' },
  ],
  instructions: { task: 'A shooter in sight is about to shoot at the bot. Choose what the bot does about these shots.', guidance: 'The shield blocks what comes from the half the bot faces, a quarter second after it rises ...' },
  // The body's physics only: answered by this when Jev cannot be reached.
  safetyRule: children => children.shield_up ? 'shield_up' : ...,
});
```

`parent` is the question asked instead when every option here has come to nothing. `when` documents when each option is offered and what its description must say; the code that builds the description lives in the file named in `source`. [docs/decisions.md](docs/decisions.md) is generated from these definitions (`node scripts/decisions-doc.js`). There are 118 questions: 68 decision trees, most of them in play, and 50 smaller questions sent together to read chat requests.

</details>

### What code still decides

Jev only chooses among options, so some things are not questions:

- Physical safety. The pathfinder refuses moves onto gravel over lava, and a guard on every dig refuses one that would let lava in or drop the bot into it.
- Anything faster than an answer. A shooter's warning (a blaze's three-second glow, a skeleton's draw) is asked about as it begins (`shot_answer`), but a shot already in the air with no answer about it lands before a question could come back, so code raises the shield toward it, whatever step is running.
- Checking the answer. A pick that was not offered is rejected.
- Nothing else when the service is down: the bot holds and waits for Jev. Only the body's physics has a safety rule (`body_way`, `shot_answer`).

[docs/rule-audit.md](docs/rule-audit.md) lists what code still decides and why.

Jev is only as good as the options and prices it is given. It cannot invent an option, and it does not redo arithmetic that the description got wrong.

## Running it

You need Node.js 22 or newer, a [TypeSafe](https://typesafe.ai/) API key, and macOS or Linux. The trial scripts download Java and the Minecraft server for you.

```sh
git clone https://github.com/mrubens/jevcraft.git
cd jevcraft
npm ci
cp .env.example .env    # then set TYPESAFE_API_KEY in .env
```

### Playing with Jev

Point the bot at a Minecraft Java 26.1 server you run. In `.env`, set `MC_HOST` and `MC_PORT` (defaults: localhost, 25565). Leave `MC_AUTH=offline` for an offline-mode server, or use `MC_AUTH=microsoft` with a separate account for the bot. Then:

```sh
npm start
```

Join the same server and talk to it in chat, for example `Jev come here` or `Jev your dream is to beat the game`. See [the chat companion](docs/companion.md).

### Running a trial

A trial gives Jev a fresh world on its own server and judges the result, the way we test it.

```sh
sh scripts/trials/setup.sh 1                          # Java 25, the 26.1.2 server, Fabric and ServerReplay; one server folder on port 25581
node scripts/first-days.js start first-days-1         # a fresh Normal world and a fresh bot
node scripts/first-days.js verdict                    # how it is going, or how it ended
node scripts/trials/trail-map.js 25581 --minutes 15   # a map of where it has been, in artifacts/trails/
```

The first-days trial lasts an hour of real time, three in-game days. To watch, run `sh scripts/trials/spectate.sh <your Minecraft name> &` and join `localhost:25581`; it puts you in Spectator mode on Jev. To run several at once, pass a larger number to `setup.sh` and choose a server with `FIRST_DAYS_PORT=25582`. Later stages (the Nether, fortresses) start from a world a first-days trial finished: see `scripts/midgame.js` and [scripts/README.md](scripts/README.md). Each trial server uses up to 2 GB of memory and about one CPU core.

## Code map

| Area | Where |
| --- | --- |
| Questions, `none_good`, escalation | [src/decisions/](src/decisions/index.js) |
| TypeSafe client | [src/typesafe.js](src/typesafe.js) |
| Turn arbiter | [src/arbiter.js](src/arbiter.js) |
| Ledger and holds | [src/tried.js](src/tried.js), [src/holds.js](src/holds.js) |
| Survival and body dangers | [src/survival.js](src/survival.js), [src/body.js](src/body.js) |
| Fight prices | [src/combat-estimate.js](src/combat-estimate.js), [src/blaze-stand.js](src/blaze-stand.js) |
| Game ladder | [src/game-progress.js](src/game-progress.js), [src/work.js](src/work.js) |
| Dreams | [src/dream.js](src/dream.js) |
| Nether travel | [src/nether-travel.js](src/nether-travel.js), [src/fortress-map.js](src/fortress-map.js) |
| Movement | [src/movement.js](src/movement.js), [src/motion.js](src/motion.js) |
| Trials | [scripts/trials/](scripts/trials/), [scripts/midgame.js](scripts/midgame.js) |
| Rendered replays | [scripts/trials/highlights.js](scripts/trials/highlights.js), [death-camera.js](scripts/trials/death-camera.js) |

More in [docs/](docs/README.md). [How Jev thinks](docs/how-jev-thinks.md) walks through a chat request end to end, and [docs/decisions.md](docs/decisions.md) lists every question Jev is asked.

## Also a chat companion

The same bot takes requests in game chat, starting with "Jev": `Jev follow me`, `Jev get me a pumpkin`, `Jev give me full diamond armor and a bed`, `Jev build a small cherry mansion`, `Jev remember this as home`. It can hold a standing *dream*, worked on whenever nobody has asked for anything; `Jev your dream is to beat the game` is the one every full run starts with. Requests, dreams and building are in [docs/companion.md](docs/companion.md).

## Development

```sh
npm test                        # about 4,300 tests, no server or key
node scripts/replay-suite.js    # recorded decisions, asked live
```

Gameplay tests, trials and the arena need a separate, disposable server. See [CONTRIBUTING.md](CONTRIBUTING.md). Flight records and logs can contain chat, player names and coordinates, so review them before sharing. The [roadmap](ROADMAP.md) has what's next. MIT License ([LICENSE](LICENSE)).

