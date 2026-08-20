# Worksite wake-alignment — execution record 2026-08-19

Executor: lighting-architect (Elliot's bridge session, Mac + CoreS3 bridge E39A34).
Runbook: `docs/howto/WORKSITE_WAKE_ALIGNMENT_2026-08-19.md` (Ben, upstream 6c046c4).

## Result in one line

`Q47` broadcast at **23:43:06 PDT Wed 2026-08-19** → all 6 cohort fixtures
confirmed transport-slept by telemetry-vanish → wake **~22:43 PDT Fri 2026-08-21**
(28 min ahead of the fleet's ~23:11 target). 7 old-firmware fixtures left awake
(unflashable this session — details below).

## Bridge / preconditions

- Bridge E39A34 on `cores3-bridge-2026-08-17.2` (Q-capable; reflashed earlier
  tonight, first live T round-trip verified — see 507c3ac).
- Dashboard `net_bench_dashboard.py` on :8765, serial connected, warm ~1.5 h.
- Mac clock verified PDT before compute; hour count computed at send time
  (remaining 47.46 h → floor 47). Elliot typed explicit "yes" after seeing the
  exact command, wake time, delta, and expected-silent list (runbook hard gate).

## Step 1 inventory (13 awake, fresh <5 min at 23:37 PDT)

| Bucket | IDs | Disposition |
|---|---|---|
| A cohort (exact image, lit) | 9E5954 9F0E30 9F0E5C 9F26E4 F40174 9F2720 | re-slept |
| B / C (exact image, non-cohort) | — none | — |
| D old-fw, lit | 9E5AD4 (ec7f28d) 9E5AE0 (9ef4324) 9F0E54 F40424 F4042C (ec7f28d) | flash candidate — NOT flashed |
| E old-fw, dark | 9E5A84 (otafix1, 3.18 V) 9F26D8 (otafix1, 3.29 V) | NOT flashed |

## Step 2/3 — flash skipped, why

1. **No sanctioned binary on this Mac**: `fx-260818-f80f315-b` absent from all
   worktrees, ~/Downloads, home (searched). Runbook forbids rebuilding
   (one fw_rev ↔ one SHA-256); binary must come from Ben.
2. **Wrong subnet**: Mac on 192.168.1.0/24; Beryl AP 192.168.8.1 unreachable —
   OTA maintenance path dead regardless.
3. Note for Ben: 9F26D8 is the known WiFi-join-fails-at-position straggler
   (3× START_FAILED history) — likely to fail OTA hail even with binary + AP.

Per runbook: old-fw units cannot be slept (`Q` silently ignored; legacy `S`
maxes ~18.2 h — not used), so all 7 left awake on solar. Recorded for Ben.

## Step 4 — the send + verification

- `POST /api/cmd {"cmd":"Q47"}` → `{"ok":true,"cmd":"Q47"}` at 23:43:06 PDT.
- Telemetry watch (15 s polls): all 6 cohort ages climbed in lockstep from the
  send (last heartbeats within ~17 s of it) and never reset; at t+120 s all 6
  exceeded the 120 s silence threshold. All 7 old-fw units heartbeated at
  0–3 s ages throughout — clean control group.
- Cohort wakes **dark** (latch set) with the fleet; nothing light-pushing sent
  after the sleep (no `b`, no tags, no `L` survey).

## Report for Ben

> Wake alignment done 8/19. Q47 sent 23:43:06 PDT, all six cohort units
> (9E5954 9F0E30 9F0E5C 9F26E4 F40174 9F2720) confirmed silent by telemetry —
> they wake ~22:43 PDT Friday, ~28 min ahead of the fleet. Nothing flashed:
> the Mac has no copy of the fx-260818-f80f315-b artifact and it wasn't on the
> Beryl subnet, so per your runbook the 7 old-firmware units stayed awake on
> solar: lit — 9E5AD4 9E5AE0 9F0E54 F40424 F4042C; dark — 9E5A84 (3.18 V),
> 9F26D8 (3.29 V, the known WiFi-join straggler). Bridge E39A34 is on
> 2026-08-17.2. Friday-night `b` release is untouched — your call.
