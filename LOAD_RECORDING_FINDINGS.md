# Workout Load Recording Findings

## Scope Inspected

- Program modes in `modes.js`: Old School, Pump, TUT, TUT Beast, Eccentric Only.
- Echo mode in `modes.js` and `protocol.js`.
- Program and Echo command frames in `protocol.js`.
- BLE connection, monitor polling, property polling, rep notifications, and monitor parsing in `device.js`.
- Existing shared rep and phase handling in `app.js`.
- Existing D1 schema in `migrations/0001_profiles_workouts.sql`.
- Existing workout session API in `functions/api/profiles/[profileId]/workout-sessions.js`.
- Existing workout history rendering in `persistence.js`.
- Weight-unit conversion in `app.js`.

## Shared Terminology

- `programmedLoad`: the load selected/configured by the user. For Program modes this is currently the per-cable weight in kg from the `weight` input. Echo has no fixed programmed load.
- `commandedLoad`: resistance requested from the device. For Program modes this includes the per-cable command, effective command, and progression/regression settings sent in the 96-byte frame. Echo includes level, eccentric percentage, concentric percentage, gain, cap, floor, smoothing, and negative limit in the Echo command frame.
- `actualLoad`: device-reported monitor telemetry currently parsed as `loadA` and `loadB` in kg from the monitor characteristic. The app already labels these as live cable loads. Exact physical semantics still need physical-device validation.
- `effectiveLoad`: the existing Program-mode effective value `perCableKg + 10.0`. It is a command-frame value, not measured actual load.

## Mode Findings

| Mode | Programmed/configured load | Commanded load | Reported actual load | Rep/phase source | Notes |
| --- | --- | --- | --- | --- | --- |
| Old School | Per-cable `weight` input | Program frame `perCableKg`, `effectiveKg`, progression, mode profile | Monitor `loadA`, `loadB` | Rep notify top counter and bottom/complete counter | Fixed command profile; actual load may still vary in monitor telemetry. |
| Pump | Per-cable `weight` input | Program frame `perCableKg`, `effectiveKg`, progression, Pump profile | Monitor `loadA`, `loadB` | Same shared Program rep path | Mode profile differs; recorder should remain mode-independent. |
| TUT | Per-cable `weight` input | Program frame `perCableKg`, `effectiveKg`, progression, TUT profile | Monitor `loadA`, `loadB` | Same shared Program rep path | User-facing request expects fatigue/assistance changes; only monitor telemetry should be called actual. |
| TUT Beast | Per-cable `weight` input | Program frame `perCableKg`, `effectiveKg`, progression, TUT Beast profile | Monitor `loadA`, `loadB` | Same shared Program rep path | Same reporting path as TUT. |
| Eccentric Only | Per-cable `weight` input | Program frame `perCableKg`, `effectiveKg`, progression, Eccentric Only profile | Monitor `loadA`, `loadB` | Same shared Program rep path | Profile suggests different behavior by phase; summaries must keep up/down averages separate. |
| Echo | No fixed programmed weight; level/eccentric config | Echo frame level-derived gain/cap/floor/smoothing, eccentric %, concentric % | Monitor `loadA`, `loadB` | Same monitor and rep notification path | Commanded load is not a single kg value, so set programmed load remains null. |
| Just Lift variants | Base Program or Echo config; target reps unlimited | Same command frame with `0xff` reps | Monitor `loadA`, `loadB` | Shared rep notify path plus auto-stop | Completed reps are recorded when rep-complete notifications occur. |

## Telemetry Details

- Monitor characteristic is polled every 100 ms.
- Parsed monitor fields currently include `timestamp`, `ticks`, `posA`, `posB`, `loadA`, and `loadB`.
- `loadA` and `loadB` are parsed as kg from `u16 / 100.0`.
- Position spikes above 50000 are rejected by carrying forward the last good value.
- Rep notifications are parsed as little-endian `u16` values.
- Existing app logic uses `u16[0]` as the top counter and `u16[2]` as the complete/bottom counter.
- Up/concentric and down/eccentric naming is inferred from the existing top/bottom event flow: rep starts in the up phase, top event switches to down, bottom/complete event completes the rep. The app does not currently have exercise-specific direction configuration.

## Persistence Findings

- `workout_sessions` currently stores set-level summary fields plus `metadata_json`.
- `workout_entries` currently stores a single summary row per session.
- No normalized per-rep table exists yet.
- Old records only contain programmed/summary weight and metadata; they cannot be backfilled with actual load.

## Implementation Constraints

- Do not overwrite `weight_kg`; it remains the historical programmed/program summary weight.
- Store actual telemetry separately from programmed and commanded values.
- Store unavailable values as null, never as zero.
- Use app canonical kg internally and convert only in the history UI.
- Combined left/right actual load may be shown only as the sum of reported cable loads, with metadata documenting that assumption and pending physical validation.
