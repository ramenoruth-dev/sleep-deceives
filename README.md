# SLEEP DECEIVES

First-person psychological survival horror (three.js + Web Audio + Node/WebSocket). Solo and 1-4 player co-op.

## Run
```
npm install
npm start            # http://localhost:8080  (this computer only)
npm run lan          # same, but friends on your network can join (http://<your-LAN-IP>:8080)
```
Open the page in Chrome/Edge. Solo Mode needs nothing else. **Play With Friends -> Create Lobby** gives a 4-letter
code and an invite link (`/?join=CODE`); friends open the link or type the code under Join Lobby.

Playing over the internet: run `node server.js --lan` on a machine your friends can reach (cloud VM, or port-forward /
tunnel the port). The client uses `ws://` or `wss://` automatically; put it behind HTTPS (e.g. a reverse proxy) for `wss`.

Controls: WASD move, Shift sprint, Ctrl/C crouch, F flashlight, E interact/hide, Q throw stone (distraction), 1-4 quick
chat (co-op), P pause (solo freezes the game; online it does NOT), Tab spectate next teammate. Chair: SPACE / click / pad A.

## Architecture (authoritative)
`src/shared/*` is plain JS used by BOTH the Node server and the browser:
- `grid.js` collision / line of sight / BFS   - `brain.js` the Crimson Mother AI (multi-target)
- `match.js` the match rules: lives, captures, chair arbitration, fuses, gate, hiding, rescue, end of match
Online, `server.js` runs a `Match` per lobby at 20 Hz and broadcasts snapshots; clients render and send inputs.
Solo runs the very same `Match` in-process (`LocalNet` in `src/net.js`), so both modes obey the same rules.

Server-side validation: movement speed + wall checks (teleport/speed hacks are snapped back), distance checks for
fuses/gate/lockers, exclusive lockers, per-player chat rate limit, message size/rate limits, same-origin WebSocket check,
chair results must be plausible (min time, mistake allowance) or count as a failure, chairs time out after 100 s,
third capture is always fatal (no unlimited lives).
Honest limit: the chair timing mini-game itself runs on the client; the server checks plausibility, not every keypress.

Other files: `src/main.js` game orchestration/HUD/cinematic, `src/lobbyui.js` lobby screens, `src/remote.js` teammate
avatars, `src/demon.js` model + render of server state, `src/world.js`, `src/player.js`, `src/audio.js` (procedural),
`src/sets.js`, `src/portal.js`, `src/skillcheck.js`, `src/settings.js` (localStorage saves).

## Co-op rules
- Lobby: create/join by code, ready-up, host picks difficulty and starts when everyone is ready; connection indicator;
  lobby-phase auto-reconnect (60 s) via token.
- The intro cinematic plays for everyone if any player has not seen it; only players who have seen it may skip.
- The demon wakes when every client has finished the intro. She hunts the nearest/loudest/visible player, freezes if ANY
  player looks at her, and hears every teammate's noise.
- Capture: Red Rift for everyone nearby (sound, light failure, distortion). 1st capture -> chair; fail -> marked + final
  chair; fail again or any later capture -> spectator.
- Rescue: while a teammate is in a chair, hold E in the ritual room (the demon's den) for 4 s to break the ward: +1
  mistake allowed for them. Choose between helping and finishing objectives.
- Fuses/gate are shared team progress. Win if anyone escapes; the match ends when nobody is active or captured.

## Tests
```
npm run test:match                       # rules of the authoritative match (no network)
node server.js 8090 & npm run test:net   # real WebSocket lobby + validation tests
```
`RB_DEBUG=1 node server.js` enables `debug_capture` / `debug_tp` test hooks (never enable in production).

## Status
Done and tested: everything above incl. a browser run hosting a lobby with a bot teammate: start, capture over WS, chair,
respawn, teammate-capture rift/HUD, ward rescue, server shutdown -> "Connection lost" screen.
Not built: voice chat (use quick-chat), public matchmaking, mid-match reconnect (a dropped player is removed from that
match), friend invites through a platform SDK (link/code only), cosmetics unlocks, secret endings, more levels,
real art/audio assets. Not verified by ear/eye: audio mix, cinematic timing, performance on real GPUs, >2 real humans.

## Vercel (solo only)
`vercel-site/` is a ready static build (`game.js` is `src/main.js` bundled+minified with esbuild, three.js from jsDelivr).
Deploy: `cd vercel-site && npx vercel --prod`. Vercel cannot run the WebSocket lobby server, so online co-op is disabled
there (the lobby buttons explain why). Host `server.js` on a VM/container platform (Fly.io, Railway, a VPS) for co-op.
Rebuild after code changes: `npx esbuild src/main.js --bundle --minify --format=esm --external:three --outfile=vercel-site/game.js`
(then copy `index.html`/`style.css` and keep the CDN importmap + `window.RB_STATIC=1`).

## Visuals
The Crimson Mother follows the reference sketch: tall gaunt skull, elongated lower face with a vertical needle-toothed maw
and long tongue, black glinting eyes, thick writhing hair tendrils, hollow "eyes" in a bare chest, red blood-soaked skin and a
blood pentagram on her forehead (`src/demon.js`, `src/gore.js`). In the opening she stands over the fallen player holding a
severed head by the hair, its spine swinging, blood dripping (`playCinematic` scene 5).
Realism pass: HDR bloom, film grain, chromatic aberration and ACES tone mapping (`src/post.js`, off on "Low" quality),
bump-mapped wet stone, blood decals, a volumetric flashlight beam, PBR skin with clearcoat. This is procedural WebGL art, not
photoscanned assets, so it is atmospheric rather than photorealistic; true photorealism needs authored models/textures.
