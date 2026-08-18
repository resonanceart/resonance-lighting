# Mirror code-update protocol · v1

Three agents commit to this app simultaneously (Elliot, 2026-08-18: "make sure
we have a protocol for updating the app code" · "a seamless multi agent app
build with lighting comms, digital environment and Git and code management
from network tester"). Roles: **lighting-architect** = lighting comms ·
**blender-architect** = digital environment · **network-tester (MIRROR)** =
the app + Git and code management (branch hygiene, gates, integration,
landing). This page codifies the pattern that carried launch night — every
rule below earned its place by a real incident or a real save. Keep it one
page; simplicity is an acceptance criterion.

## 1 · One branch, one truth
`qa/mirror-ui-lib` on `gh-fork` (github.com/resonanceart/resonance-lighting).
Never main. Never force-push. Pulls are `--ff-only` — a failed ff means talk,
not merge. The UpdateChip in the app header is the running-vs-latest truth:
green ✓ = current, amber = someone pulls or pings.

## 2 · Lane ownership (who edits what)
| Lane | Files |
|---|---|
| **blender-architect** (3-D world) | `src/components/Scene3D.tsx` · `src/lib/locate.ts` · `public/*.glb` · `public/tree_footprint.json` · scene/geometry assets |
| **network-tester / MIRROR** (app) | app shell (`App.tsx`, `main.tsx`, css) · `src/lib/` store/adapter/types/registry · `src/widgets/` · `src/components/` (except Scene3D) · `vite.config.ts` · `dev/` |
| **lighting-architect** (comms) | contracts + checker (authored in elliots-controller `docs/research/` + `tools/`; the copies vendored here are READ-ONLY — re-vendor, never hand-edit) · bench/station daemons |

Cross-lane edit = ask in the hot thread first, or take a **freeze window**:
post [LANE-COORD] naming the files, others hold off, post [DONE] to release
(the 38b42a90 pattern — it worked). Never stage, stash, or revert another
lane's files. Boundary changes (e.g. a store `send` touch) are legal but get
flagged for the owner's review in the same breath as the commit.

## 3 · The land sequence (every commit, no exceptions)
1. `git pull --ff-only gh-fork qa/mirror-ui-lib`
2. `npm run build` — green
3. `python3 dev/mirror-contract-check.py` — green (MANDATORY for any
   store/type/adapter change; cheap enough to run always)
4. Stage regression (`dev/stage_test.playwright.js`) — green if the change
   touches scene, store, send, or seat flow. Behavior changes re-cut the
   test in the SAME commit (the Blink→Tag pattern).
5. Stage **explicit paths only** — never `git add -A` / `-u`.
6. Commit with your lane's attribution, push, **post the SHA in the hot
   thread** (`mirror-launch-night-triangle` or its successor).

## 4 · WIP hygiene in the shared clone
Long-lived uncommitted WIP breaks everyone else's gates (the DebugSceneHandle
tsc break). Commit small (≤15 min cadence), or announce a WIP window in the
thread so others know the tree is transiently red. `dist/` stays untracked.
Captures (`dev/state-capture-*.json`) stay untracked. Secrets never exist here.

## 5 · Gates that never move
- No mock/demo data, ever — live feed or explicit STALE (and real data must
  READ real: the class-column incident).
- Stubs bind :8766 only and replay captured state — never invent peers.
- Widgets ship `LIVE · unconfirmed` until Elliot's in-app ✔ (§0.3).
- The send fence: allowlist verbs only; bare `'S'` is refused at the store
  layer; dangerous verbs get confirm dialogs; dark-lease UI version-gated.
- The dashboard daemon is the ONLY serial writer; the Mirror only speaks
  through its proxied HTTP surface.

## 6 · Conflicts + disputes
Merge conflicts: never resolve someone else's side silently — surface in the
thread. Contract/fence disagreements: engineering review in-lane, activation
ruling to Elliot (the §0.5 pattern). When sources disagree: live git/feed
state > thread decisions > this doc > memory.

---
v1 · 2026-08-18 · drafted by MIRROR (network-tester), consent BLD + LX in
`mirror-launch-night-triangle`. Amend by PR-style: propose in-thread, land the
edit with the consenting turn linked in the commit message.
