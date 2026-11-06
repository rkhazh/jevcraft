# Sources

The Minecraft body is Matt Rubens' MIT-licensed JevCraft, with the local Persona
Lab integration preserved. See the repository LICENSE.

`voice.py`, `svc_client.py` and `vision.py` are adapted from the local NetTyan
Persona Lab revision 23e4d13. `body.py` adapts its authenticated HTTP boundary.
The original MIT notice is in `NETTYAN-LICENSE`. No third-party voice samples
are included. `profile.json` carries the user's existing Tolik character.

The architecture follows teknium1/hermes-and-jev-play-minecraft at
440bec09ee76523a706510601efcbda57df030ad: Hermes plans at milestones, Jev makes
native tactical decisions, and Mineflayer executes. We do not copy its demo
world, objectives or performance claims.

Hermes is installed separately at pinned revision
6b21d0564de0492e2ebd0d8f63fca86c03b5c892 under its own MIT license.
