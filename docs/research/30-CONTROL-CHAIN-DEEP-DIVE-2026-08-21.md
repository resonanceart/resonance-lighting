# 30 — The Control Chain, End to End: Mirror → Dashboard → Bridge OS → Radio → Fixture

> Elliot directive 2026-08-21 (Lighting AI channel): "dive deeper into how our mirror system
> works to control the lights and how the bridge OS interacts with the lights."
> Author: lighting-architect. Sources pinned: Mirror app @ `efca6c3c`
> (~/code/resonance-lighting-qa/mirror, network-tester's lane, read-only), lighting fork @
> `23b4aaa` (this repo). Firmware sections cite the revision read in each section header.
> Companions: 26 (state contract) · 27 (field readiness) · 28 (self-location design).

## 0. The one-paragraph mental model

The Tree's lights are **autonomous**: patterns, the voltage ladder, and day/night behavior run
ON each fixture. Nothing streams pixels. "Control" means short **serial opcodes** (one letter +
args) that Ben's dashboard writes to the bridge over USB; the bridge re-emits them as **ESP-NOW
broadcasts** on channel 11; every fixture hears every command and self-selects by the targeting
field in the payload. The Mirror never touches serial: it is a **second window** onto Ben's
dashboard — it reads the dashboard's `/api/state` + `/events` feed, and sends its three fenced
verbs back through the dashboard's own `/api/cmd`, so the dashboard remains the **only serial
writer**. Everything else in the Mirror is rendering discipline: report only what the fleet
actually said, label everything else honestly stale.

## 1. Mirror side (app @ `efca6c3c`) — verified by direct read

### 1.1 Data in — the listening path
- `src/lib/adapter.ts:159-187` `connectDashboard()`: one `GET /api/state` snapshot, then an
  `EventSource` on `GET /events` — the dashboard re-pushes the ENTIRE state every 1.0 s (not
  deltas). One bad frame never kills the feed; native SSE reconnect.
- `adapter.ts:35-70 mapPeer()`: defensive mapping, absence → honest unknowns (soc 255 = "n/a",
  never fabricated). Carries BOTH ages: `age_ms` (fixture-reported downlink age) and `rowAgeMs`
  (now − row.ts_utc, bridge-side row freshness) — contract 26 §2.
- **Freshness triple-rule** `adapter.ts:100-113`: `live` only when serial is connected AND
  fixture heard <5 s AND row fresh <3 s; `ghost` past 6 min; else `last-seen`. `isHeard()`
  checks BOTH axes so a frozen `age_ms` (ear down, HTTP still serving — memo 27's top field
  risk) can never keep a fixture "heard" forever.
- Peer tiles are **ever-seen**: a sleeping fixture's tile stays, showing last reported state
  with the age climbing. The tile is memory, not presence (this is why "lights still showing on
  the bridge" after transport sleep is expected).

### 1.2 Commands out — THE FENCE (`src/lib/store.ts:341-386`)
- Allowlist is hard-coded and throws on anything else: **NB_IDENTIFY** (`i<MAC6>` / `I` — pixel-
  invisible on today's fleet, kept for wire tests), **TAG** (`T<id>:1|0` — the visible green
  instrument, 255 s RAM-only lease), **LOCATE** (`i<id>:<1-255s>` — blink window, design 28 M3).
- **Capability gates fail closed** (`store.ts:353-367`, `adapter.ts:126-150`): a verb is only
  emitted if the bridge's own firmware banner proves it forwards that opcode (T/i/B ≥
  `2026-08-17.1`; L/Q ≥ `.2`). Null/unparseable fw = incapable. Refusals are audited to the
  in-app `commandLog` and NOTHING is sent — this exists because an 08-15.1 bridge swallowed `T`
  char-by-char while the dashboard printed "Sent" (the C0 incident).
- Sends are `POST /api/cmd` to the dashboard with `{cmd, label}` — **re-validated server-side**;
  fire-and-forget (UI never blocks on radio); dashboard ack logged to console.
- **Tag renewal** `store.ts:401-418`: fixture tag lease is 255 s RAM-only; the Mirror re-sends
  every 110 s while a tag is held (dashboard renews its own at 120 s). A dead tab self-heals —
  the lease just expires. Same self-reverting philosophy as the dark lease.

### 1.3 The control surfaces
- `Scene3D.tsx`: tap a light → per-fixture panel → **Tag toggle** (`:486,514,556`) and
  **Locate·β** with a per-click arm step (first tap arms, then 5 s/15 s/60 s buttons —
  `:163-191`) — no accidental radio from a stray tap.
- `widgets/BridgeOs.tsx`: the bridge's own fw identity + a chip row deriving every verb's
  capability from telemetry alone — a bridge reflash flips chips capable with zero code changes;
  incapable chips carry the reason (`✕ needs ≥ 2026-08-17.1`).
- `widgets/BenDashboard.tsx:28`: Ben's whole dashboard embedded as an iframe
  (`http://<hostname>:8765/`) — a *window*, not a rebuild; his page's commands are LIVE and
  labeled as such; feed-down renders an honest full-tab message, never a dead grey iframe.

### 1.4 What the Mirror can and cannot do today
CAN: see every ever-heard fixture with honest freshness; tag any fixture steady-green (and
auto-renew); blink a fixture for 5/15/60 s to find it; show which verbs the current bridge
forwards; embed Ben's full bench UI. CANNOT: set colors/brightness/patterns (no color grammar
exists bridge-side — the C1 ask to Ben), issue dark leases or sleep from its own UI (B/Q are
dashboard/CLI territory by design), or command anything when the bridge is unplugged — every
button falls to disabled/STALE, by construction.

## 2. Bridge OS (cores3_bridge) — serial in, radio out

_Agent deep-read @ `23b4aaa` (this branch); upstream/main cited where marked. All file:line
references are to `firmware/cores3_bridge/cores3_bridge.ino` and `ops/bench/net_bench_dashboard.py`._

### 2.0 Headline: our checkout is NOT the flashed bridge
This branch's bridge source is `cores3-bridge-2026-08-15.1` (`.ino:48`) — **it has no `T`, `B`,
`b`, `Q`, or `L` opcode** (full switch `.ino:1153-1390`). Those handlers exist only on
**upstream/main** (`cores3-bridge-2026-08-17.2`, upstream lines 1468-1551), which is what's
flashed on bench bridge E39A34 (commit `507c3ac`). The Mirror's capability gates (§1.2) encode
exactly this split. Anyone reading control behavior must read **upstream**, not our branch tip.

### 2.1 The command path, HTTP → radio
- `POST /api/cmd` (`py:1375-1390`): JSON `{cmd,label}` → `valid_command()` regex allowlist
  (`py:1277-1326`) → `worker.send_command` → raw `handle.write(cmd.encode("ascii"))` —
  **no newline, no framing, no lock** (`py:452-459`). Server binds `127.0.0.1:8765` by default.
- Bridge `handleSerial()` reads **one char per loop()** and switches on it (`.ino:1147-1391`);
  arguments are scavenged from the still-arriving byte stream inside 40-120 ms timed windows
  (`readSerialUint/HexId/Arg`, `.ino:998-1049`). A slow or split USB write can truncate an
  argument into its default.
- ESP-NOW TX: every frame goes to broadcast `FF:FF:FF:FF:FF:FF` (`.ino:81`); targeting is the
  `target_id[3]` payload field, `00:00:00` = all (`packet.h:197-270`, matcher `:331-334`).
  Broadcast commands repeat **4× @ 5 ms**; targeted ones **6× @ 8 ms** (`.ino:415-461`).
- **Nothing comes back.** No ack packet type exists (`packet.h:31-58`); the bridge ingests only
  `NB_HEARTBEAT` and `NB_SCANAP`. `sendok=` is a TX-queue counter, not delivery.

### 2.2 The return path (telemetry)
Heartbeats upsert a **fixed 192-slot peer table with no eviction** (`.ino:57,368,664-678`) —
"peers" = ever-seen; slot 193+ is silently dropped. `fwRev` and `has*` flags are **sticky** from
the last full heartbeat; supply fields re-zero when absent (`.ino:715-824`). Serial emits 1 Hz:
one `nb-master` + one `nb-peer` line per slot (`.ino:875-988`). The dashboard regex-parses these
into `state.peers` and serves `/api/state` + a 1 Hz full-snapshot SSE on `/events`
(`py:120-130,1359-1372`) — which is exactly what the Mirror consumes (§1.1).

### 2.3 Opcode map (HEAD = 08-15.1 source)
Bridge accepts: `S[s]` sleep (default 21600 s!), `i[id][:s]`/`I` identify (invisible — color 0),
`U[id]` 35 s maint burst, `c/+/-/R<hz>` rate, `m<v10>` maintain-voltage, `C` capacity, `G`
charge-mA (NOT a color verb), `K<id>:<s>` solenoid, `P<id>[:s]` targeted sleep, `D` drawdown,
`F` profile flip (persisted), `t/r/h/?` status. Dashboard's allowlist is a strict subset —
it additionally REFUSES `F/t/h/?/A`. **[upstream 08-17.2 adds]** `Q<hours>` transport sleep,
`L[seconds]` RSSI survey (default 120), `T<id>:0|1` green tag (identify color=2, bright=128 /
off), `B[s]` fleet dark lease (`NB_PROGRAM_COMMISSION_DARK`), `b` release; packet types
`NB_TRANSPORT_SLEEP=27`/`NB_LOCATE_CONTROL=28` exist only in upstream `packet.h:62-63`.

### 2.4 Safety semantics — measured, not assumed
- Unknown opcode = `default: break` **silent swallow** (`.ino:1388-1389`) — no error, no echo.
- Serial opened **without `exclusive=True`** (`py:166`) and `send_command` takes no lock while
  HTTP serves concurrently — two writers CAN interleave bytes inside the bridge's argument
  windows (the known two-dashboards hazard, now traced to source).
- Serial drop: rows keep serving with **frozen `age_ms` forever** (`py:185-187,336`) — a
  disconnected bridge looks like a healthy fleet unless you read the `serial` pill. This is the
  exact failure the Mirror's triple-rule (§1.1) neutralizes.
- **No rate limits, no confirm dialogs** anywhere in the dashboard: `Sleep 6h` (`S`) and `R1`
  are one-click fleet-wide unconfirmed buttons (`py:673,695`); localhost bind + no auth is the
  only fence on raw `/api/cmd`.
- **"Sent" ≠ delivered.** HTTP 200 only means the serial write didn't raise (`py:1123-1139`).
  ONE closed-loop exception: `m<v10>` polls `/api/state` up to 6 s and reports "Verified" only
  when every fresh peer's `bq_vindpm_mv` matches (`py:1140-1159`). Everything else —
  `S/U/i/I/c/R/C/G/K/P/D` — is fire-and-forget with no verification.

## 3. Fixture firmware — how a light decides to obey

_(agent deep-read, being merged — see §5 status)_

## 4. The chain's honest failure modes (from 26/27 + this pass)

1. Old bridge + new verb = **silent swallow** while UI prints "Sent" — closed Mirror-side by
   the fail-closed capability gates (§1.2); still open for anyone driving the dashboard raw.
2. Serial drop while HTTP serves = **frozen age_ms** — closed Mirror-side by the triple-rule.
3. Dark/tag leases are **RAM-only** — any fixture reboot mid-lease comes back lit/untagged;
   renewal loops are the answer, and they self-revert when their holder dies.
4. Every command is a **broadcast**; targeting is cooperative payload filtering, not unicast.
5. Downlink-deaf units exist (9E5AD4, behavioral) — a command path can be one-way even when
   telemetry looks healthy; `dl_pdr` reads 0.0 on all old images and is not a usable field.

## 5. Status

- §1 verified by direct source read 2026-08-21 (~17:1xZ), Mirror @ `efca6c3c`.
- §2/§3 firmware deep-reads in flight (two Explore agents on this repo @ `23b4aaa`); merged
  next commit.
