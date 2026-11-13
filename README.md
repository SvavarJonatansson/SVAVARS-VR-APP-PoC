# SVAVARS VR APP PoC

Proof of concept: a WebXR 360° player on Meta Quest 3, controlled from a phone through Supabase Realtime.

- `index.html` + `player.js`: the headset page. Sign in once with the headset's own login, the carer taps **Start**, everything else is remote.
- `control.html` + `control.js`: the carer's phone page. Play, Pause, Resume, Stop, Recenter; shows online status (presence) and the headset-confirmed status of each command.
- `config.js`: Supabase project + the test video address (R2).

Command protocol: the phone inserts a `headset_commands` row with status `requested`; only the headset moves it to `received`, then `done` or `failed`. Commands older than 30 s are marked `failed: stale`.

Hosting: any static HTTPS host (e.g. GitHub Pages or Cloudflare Pages). WebXR needs HTTPS.

Plan and success criteria: see the "SVAVARS VR APP: Quest proof of concept plan" doc.
