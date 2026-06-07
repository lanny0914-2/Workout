# Database Plan

## Current Data Discovered

The real deployed app is `lanny0914-2/Workout` on `main`. It is a Cloudflare Pages static app built with Vite, but the runtime is classic HTML plus root-level scripts: `index.html`, `app.js`, `device.js`, `modes.js`, `protocol.js`, and `chart.js`.

Current data model:

- `app.js` owns `VitruvianApp`, device state, UI state, current workout state, rep counters, and workout history.
- `device.js` owns Web Bluetooth/Vitruvian BLE connection state and monitor/rep notifications.
- `modes.js` owns Program/Echo mode constants and color presets.
- `protocol.js` builds Vitruvian command frames for init, program, echo, and colors.
- `chart.js` owns live load/position history in memory and CSV export.

## Current Workout Data

The app currently tracks:

- `currentWorkout`: `mode`, `weightKg`, `targetReps`, `startTime`, `warmupEndTime`, `endTime`.
- Completed workout history: `mode`, `weightKg`, `reps`, `timestamp`, `startTime`, `warmupEndTime`, `endTime`.
- Rep counters: `warmupReps`, `workingReps`, `warmupTarget`, `targetReps`.
- Live samples: `loadA`, `loadB`, `posA`, `posB`, `ticks`, `timestamp`.
- Side-specific state: cable A/B top and bottom rolling windows, min/max ranges, and uncertainty bands.
- Chart data: up to two hours of live samples, held in memory only.

## Current Settings

- Display unit: `vitruvian.weightUnit` in `localStorage`, values `kg` or `lb`.
- Stop at top: `stopAtTop`, currently in memory only.
- Program settings: mode, per-cable weight, progression/regression, reps, Just Lift.
- Echo settings: level, eccentric percentage, target reps, Just Lift.
- Color settings: preset plus three color inputs.

## Concept Mapping

- Exercises: not present as named records.
- Workouts/sessions: present as active/completed workout summaries.
- Sets: not present as durable records.
- Reps: present through counters and notifications.
- Weight: present for Program mode as per-cable kg; Echo mode is adaptive.
- Duration/time: present through start/warmup/end timestamps.
- Resistance mode: Program and Echo modes.
- Side-specific movement: cable A/B load/position data.
- Vitruvian settings: existing app controls only; no guessed hardware fields.
- LED/color preferences: existing color preset and three colors.

## Proposed D1 Tables

### `profiles`

Simple named profiles, no auth.

### `profile_settings`

Flexible key/value settings for current preferences:

- `vitruvian.weightUnit`
- `vitruvian.stopAtTop`
- `vitruvian.colorPreset`
- `vitruvian.color1`
- `vitruvian.color2`
- `vitruvian.color3`

### `workout_sessions`

Completed workout summaries using fields already produced by `app.js`.

### `workout_entries`

Reserved for future set/rep/detail rows. The current UI does not have durable set rows, so this table remains flexible.

## Implemented API Routes

- `GET /api/profiles`
- `POST /api/profiles`
- `GET /api/profiles/:profileId/settings`
- `PUT /api/profiles/:profileId/settings`
- `GET /api/profiles/:profileId/workout-sessions`
- `POST /api/profiles/:profileId/workout-sessions`

## Assumptions

- D1 binding name is `DB`.
- Profiles are local app profiles, not login accounts.
- Existing localStorage is not deleted.
- Completed workout history is persisted as profile-specific session summaries.
- Large chart sample history is not persisted yet.

## Intentionally Not Included

- Passwords, auth, emails, cookies, tokens.
- Cloudflare account/database/zone IDs or secrets.
- Named exercises, because the app has no exercise model yet.
- Guessed Vitruvian hardware settings beyond current UI controls.
- Per-sample chart storage, pending a retention decision.
