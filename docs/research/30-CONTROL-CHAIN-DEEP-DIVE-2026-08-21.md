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

_Agent deep-read @ `23b4aaa`; `@upstream/main` (`6c046c4`, Ben's tree) cited where marked. Note:
our fork's `origin/main` carries no `firmware/fixture/` at all — fixture "main" ALWAYS means
upstream. As with the bridge, the fleet's flashed image is closer to upstream than to our HEAD._

### 3.1 Reception → targeting → dispatch
- `onEspNowRecv` (`espnow_link.cpp:22-32`): length-gated, RSSI-stamped, ISR-enqueued to a
  32-deep queue; loop drains ≤6/tick and aborts the drain if a command flipped to maintenance
  (`net_peer.cpp:339-345`). Wrong protocol `ver` and own-echo rejected (`net_peer.cpp:145-149`).
- Targeting is cooperative: `nbTargetMatches()` — `00:00:00` = everyone, else exact 3-byte ID
  match. **Asymmetry:** `NB_SLEEP_FOR` accepts broadcast-all, but `NB_TARGET_SLEEP_FOR` and
  `NB_TARGET_SOLENOID` use raw `memcmp` and refuse the all-zero target (`net_peer.cpp:285-309`).
- Full dispatch at HEAD (net_peer.cpp switch): heartbeat/choreo ingest, maint enter/resume,
  rate, **identify** (target-gated, cached color/blink/deadline), maintain-V, capacity
  (**persists then reboots**), charge-mA, sleep (broadcast + targeted), solenoid (refused unless
  `behaviorStrikePermitted()`), **program lease**, profile, neighbor-pin, direct RGBW frame,
  force-lifecycle. Types 27/28 (`NB_TRANSPORT_SLEEP`, `NB_LOCATE_CONTROL`) exist **only
  upstream** (`net_peer.cpp:274-299 @upstream/main`).
- The bridge letters resolve to (`@upstream/main .ino:1468-1550`): `T<id>:1` =
  `sendIdentify(target, 255s, color=2 green, value=128)`; `T<id>:0` = release; `B<sec>` =
  fleet program lease `PROG_COMMISSION_DARK`; `b` = lease 0; `Q<hours>` = transport sleep;
  `L<sec>` = bounded RSSI survey.

### 3.2 Command → state → render → rail
- **The lease is the control primitive** (`runtime.cpp:45-71`): `program_id==0 || lease_s==0`
  releases to autonomy; unknown program id **fails closed**; hard-cut or 2 s crossfade by flag;
  lease expiry/staleness returns to autonomy — never freeze, never blank. SHOWFRAME/DIRECT
  frames carry an implicit 10 s micro-lease; the explicit lease wins.
- **Render arbitration** (`fixture.ino:151-186`): boot-guard park > bench-rail-forced-off >
  identify (**only if color > 0** — the invisible-`i` root cause, `:159`) > smoke > behavior
  frame. `brightness_cap` from the power ladder is applied at the very top — **no command path
  routes around it**; cap 0 cuts the rail. First light-up ramps 4×800 ms with VBAT sampled
  between steps (<2900 mV aborts and parks; <2950 mV caps at 128) (`led_driver.cpp:122-148`).
- **Identify/tag render** (`led_driver.cpp:167-186`): colors 1=R 2=G 3=B 4=Y 5=W, blink at 1 Hz.
  The `value` byte (what makes `T` a *low-glow tag at 128* instead of full-blast) exists only
  `@upstream/main` — **at HEAD a tag renders full-brightness green.**
- **Dark lease, the load-bearing delta**: `PROG_COMMISSION_DARK` emits a cleared frame. At HEAD
  (fleet build flag `RES_BASIC_LISTENER`) `behaviorFrame` returns true unconditionally →
  **rail stays electrically ON rendering black**. `@upstream/main behavior_glue.cpp:508-510`
  adds `darkLeaseActive() → return false` → the rail is physically cut (`EN_3V3` dropped,
  RTC-held). "Dark lease cuts the rail" is TRUE of the fleet image, ABSENT at our HEAD.

### 3.3 What a fixture tells you (and when)
- hb-short every **5 s** (prod): battery mV/mA/SOC, reset reason, ca_state, mode, downlink
  PDR/RSSI, supply. hb-full every **60 s** (±30% jitter): + fw_rev, cfg, BQ regs, and tail-13
  (`profile`, `life_state`, `power_tier`, `active_program`, `night_min`). Choreo state at 1 Hz.
- **The state-change heartbeat trigger is NOT implemented** — call sites are boot ×3, the two
  schedulers, and pre-PROTECT-sleep only. The "every 60 s + state change" comment is
  aspirational. Consequence: tier/lifecycle/program changes lag **up to 60 s** at field cadence
  (corroborates memo 27 gap #6). There is also **no capability advertisement** anywhere — a
  consumer can only infer opcode support from `fw_rev` in hb-full, once per ≤60 s. This is why
  the Mirror's gates key on firmware strings (§1.2) rather than any negotiated capability.

### 3.4 Commands vs autonomy — who wins
- **The voltage ladder wins, always.** PROTECT/OFF force cap 0 at the render top; PROTECT
  release is compound (supply good + no fault + ≥20 mA + ≥3100 mV held 60 s); no radio command
  overrides any of it.
- **Transport/deep sleep beats everything**: rails and radio off, only the 32-bit timer, the
  USER button, or reset wakes it — all mesh commands are silently LOST while asleep. ⚠ EXT0
  button wake fires one **unconditional 40 ms solenoid strike** (`solenoid.cpp:157-161`).
- **Maintenance beats the mesh**: `espNowDeinit()` — every command ignored until resume/timeout.
- **Day/night**: dusk 1800 s no-supply, dawn 300 s, bounded night 630 min; `forceNight`
  overrides but is RAM-only. Any received packet suppresses day-charge sleep for **10 min**
  (`rxHold`) — bridge chatter keeps a prod fleet reachable.
- **Commission vs field**: commission = no dusk/dawn/bounded-night/day-sleep, dark autonomous
  program, strikes gated only on tier==FULL — the ladder is the only protection (memo 27's #1
  readiness gap: the unmade field-profile flip).

### 3.5 The wire's two silence layers (never conflate)
1. **Fixture-side**: unknown packet type / wrong ver / short length → silent `break`. An
   old-firmware fixture receiving `Q` (27) or `L` (28) is inert, and NOTHING on the wire
   distinguishes that from packet loss (field-confirmed in memo 29: "Q silently ignored").
2. **Bridge-side**: unknown serial LETTER swallowed char-by-char while the dashboard prints
   "Sent" (§2.4).

## 4. The chain's honest failure modes (from 26/27 + this pass)

1. Old bridge + new verb = **silent swallow** while UI prints "Sent" — closed Mirror-side by
   the fail-closed capability gates (§1.2); still open for anyone driving the dashboard raw.
2. Serial drop while HTTP serves = **frozen age_ms** — closed Mirror-side by the triple-rule.
3. Dark/tag leases are **RAM-only** — any fixture reboot mid-lease comes back lit/untagged;
   renewal loops are the answer, and they self-revert when their holder dies.
4. Every command is a **broadcast**; targeting is cooperative payload filtering, not unicast.
5. Downlink-deaf units exist (9E5AD4, behavioral) — a command path can be one-way even when
   telemetry looks healthy; `dl_pdr` reads 0.0 on all old images and is not a usable field.
6. **The command plane is unencrypted broadcast on ch 11 with cooperative targeting** — any
   ESP32 on the channel can sleep, darken, or strike the fleet. The localhost bind + no-auth
   dashboard is the only software fence on the bench side. (Known posture, now source-pinned.)
7. State changes lag ≤60 s (no state-change heartbeat trigger) — a command can have WORKED and
   still look ignored for a minute. Judge by the next hb-full, not the next second.

## 5. Status + provenance

- §1: direct source read by lighting-architect, Mirror @ `efca6c3c` (2026-08-21).
- §2: Explore-agent deep-read of `cores3_bridge.ino` + `net_bench_dashboard.py` @ `23b4aaa`,
  upstream deltas cited against `6c046c4`.
- §3: Explore-agent deep-read of `firmware/fixture/` @ `23b4aaa`, upstream deltas ditto.
- Standing rule renewed by this pass: **read control behavior on upstream/main, not our branch
  tip** — our fork's HEAD predates the fleet image on both bridge and fixture lanes.
