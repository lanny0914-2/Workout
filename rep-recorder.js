// rep-recorder.js - shared mode-independent rep/load recording

(function attachRepRecorder(global) {
  const DEFAULT_MIN_MOVEMENT = 2;
  const MAX_SAMPLE_GAP_MS = 2000;
  const CHANGE_EPSILON_KG = 0.25;

  function toDate(value) {
    if (!value) return new Date();
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  function iso(value) {
    return value ? toDate(value).toISOString() : null;
  }

  function finiteOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function roundOrNull(value, decimals = 4) {
    const number = finiteOrNull(value);
    if (number === null) return null;
    const scale = 10 ** decimals;
    return Math.round(number * scale) / scale;
  }

  function sumKnown(values) {
    const known = values.filter((value) => finiteOrNull(value) !== null);
    if (!known.length) return null;
    return known.reduce((total, value) => total + Number(value), 0);
  }

  class WeightedLoadAccumulator {
    constructor() {
      this.durationMs = 0;
      this.actualMs = 0;
      this.commandedMs = 0;
      this.actualSum = 0;
      this.commandedSum = 0;
      this.actualLeftSum = 0;
      this.actualRightSum = 0;
      this.actualCombinedSum = 0;
      this.actualLeftMs = 0;
      this.actualRightMs = 0;
      this.actualCombinedMs = 0;
      this.peakActual = null;
      this.minActual = null;
      this.startActual = null;
      this.endActual = null;
    }

    add(sample, durationMs) {
      if (!sample || durationMs <= 0) return;
      this.durationMs += durationMs;

      const actualCombined = finiteOrNull(sample.actualLoadCombinedKg);
      const actualLeft = finiteOrNull(sample.actualLoadLeftKg);
      const actualRight = finiteOrNull(sample.actualLoadRightKg);
      const actualForSummary = actualCombined ?? sumKnown([actualLeft, actualRight]);
      const commanded = finiteOrNull(sample.commandedLoadKg);

      if (actualForSummary !== null) {
        this.actualMs += durationMs;
        this.actualSum += actualForSummary * durationMs;
        if (this.startActual === null) this.startActual = actualForSummary;
        this.endActual = actualForSummary;
        this.peakActual = this.peakActual === null ? actualForSummary : Math.max(this.peakActual, actualForSummary);
        this.minActual = this.minActual === null ? actualForSummary : Math.min(this.minActual, actualForSummary);
      }

      if (actualLeft !== null) {
        this.actualLeftMs += durationMs;
        this.actualLeftSum += actualLeft * durationMs;
      }

      if (actualRight !== null) {
        this.actualRightMs += durationMs;
        this.actualRightSum += actualRight * durationMs;
      }

      if (actualCombined !== null) {
        this.actualCombinedMs += durationMs;
        this.actualCombinedSum += actualCombined * durationMs;
      }

      if (commanded !== null) {
        this.commandedMs += durationMs;
        this.commandedSum += commanded * durationMs;
      }
    }

    merge(other) {
      if (!other) return;
      this.durationMs += other.durationMs;
      this.actualMs += other.actualMs;
      this.commandedMs += other.commandedMs;
      this.actualSum += other.actualSum;
      this.commandedSum += other.commandedSum;
      this.actualLeftSum += other.actualLeftSum;
      this.actualRightSum += other.actualRightSum;
      this.actualCombinedSum += other.actualCombinedSum;
      this.actualLeftMs += other.actualLeftMs;
      this.actualRightMs += other.actualRightMs;
      this.actualCombinedMs += other.actualCombinedMs;
      if (other.startActual !== null && this.startActual === null) this.startActual = other.startActual;
      if (other.endActual !== null) this.endActual = other.endActual;
      if (other.peakActual !== null) this.peakActual = this.peakActual === null ? other.peakActual : Math.max(this.peakActual, other.peakActual);
      if (other.minActual !== null) this.minActual = this.minActual === null ? other.minActual : Math.min(this.minActual, other.minActual);
    }

    averageActual() {
      return this.actualMs > 0 ? this.actualSum / this.actualMs : null;
    }

    averageCommanded() {
      return this.commandedMs > 0 ? this.commandedSum / this.commandedMs : null;
    }

    averageActualLeft() {
      return this.actualLeftMs > 0 ? this.actualLeftSum / this.actualLeftMs : null;
    }

    averageActualRight() {
      return this.actualRightMs > 0 ? this.actualRightSum / this.actualRightMs : null;
    }

    averageActualCombined() {
      return this.actualCombinedMs > 0 ? this.actualCombinedSum / this.actualCombinedMs : null;
    }
  }

  class RepRecorder {
    constructor(options = {}) {
      this.minMovement = options.minMovement ?? DEFAULT_MIN_MOVEMENT;
      this.reset();
    }

    reset() {
      this.active = false;
      this.mode = "";
      this.modeType = "";
      this.startedAt = null;
      this.endedAt = null;
      this.programmedLoadKg = null;
      this.commandedLoadKg = null;
      this.commandedLoadLeftKg = null;
      this.commandedLoadRightKg = null;
      this.effectiveLoadKg = null;
      this.metadata = {};
      this.reps = [];
      this.currentRep = null;
      this.currentPhase = "up";
      this.lastSample = null;
      this.lastActiveSample = null;
    }

    startSession(config = {}) {
      this.reset();
      this.active = true;
      this.mode = config.mode || "Workout";
      this.modeType = config.modeType || "program";
      this.startedAt = toDate(config.startedAt);
      this.programmedLoadKg = finiteOrNull(config.programmedLoadKg);
      this.commandedLoadKg = finiteOrNull(config.commandedLoadKg);
      this.commandedLoadLeftKg = finiteOrNull(config.commandedLoadLeftKg);
      this.commandedLoadRightKg = finiteOrNull(config.commandedLoadRightKg);
      this.effectiveLoadKg = finiteOrNull(config.effectiveLoadKg);
      this.metadata = config.metadata || {};
    }

    recordSample(inputSample) {
      if (!this.active || !inputSample) return;
      const sample = this.normalizeSample(inputSample);
      if (!this.currentRep) this.beginRep(sample.timestamp);

      if (this.lastSample) {
        const durationMs = sample.timestamp.getTime() - this.lastSample.timestamp.getTime();
        if (durationMs > 0 && durationMs <= MAX_SAMPLE_GAP_MS && this.isActiveMovement(this.lastSample, sample)) {
          const weightedSample = {
            actualLoadLeftKg: this.lastSample.actualLoadLeftKg,
            actualLoadRightKg: this.lastSample.actualLoadRightKg,
            actualLoadCombinedKg: this.lastSample.actualLoadCombinedKg,
            commandedLoadKg: this.lastSample.commandedLoadKg,
          };
          this.currentRep.total.add(weightedSample, durationMs);
          this.currentRep[this.currentPhase].add(weightedSample, durationMs);
          this.lastActiveSample = sample;
        }
      }

      this.lastSample = sample;
    }

    markTop(timestamp = new Date()) {
      if (!this.active) return;
      if (!this.currentRep) this.beginRep(timestamp);
      this.currentRep.upEndedAt = toDate(timestamp);
      this.currentPhase = "down";
    }

    completeRep(options = {}) {
      if (!this.active || !this.currentRep) return null;
      const endedAt = toDate(options.timestamp || new Date());
      const rep = this.currentRep;
      rep.endedAt = endedAt;
      rep.status = options.status || "completed";
      rep.repKind = options.repKind || "working";
      rep.modeSpecificMetadata = options.metadata || {};
      rep.downEndedAt = rep.downEndedAt || endedAt;
      const summary = this.summarizeRep(rep, this.reps.length + 1);
      this.reps.push(summary);
      this.currentRep = null;
      this.currentPhase = "up";
      this.lastSample = null;
      this.lastActiveSample = null;
      return summary;
    }

    finishSession(options = {}) {
      if (!this.active) return this.getSummary();
      this.endedAt = toDate(options.endedAt || new Date());
      if (options.completeIncompleteRep && this.currentRep) {
        this.completeRep({ timestamp: this.endedAt, status: "incomplete", repKind: options.repKind || "working" });
      }
      const summary = this.getSummary();
      this.active = false;
      return summary;
    }

    beginRep(timestamp) {
      const startedAt = toDate(timestamp);
      this.currentRep = {
        startedAt,
        endedAt: null,
        upEndedAt: null,
        downEndedAt: null,
        total: new WeightedLoadAccumulator(),
        up: new WeightedLoadAccumulator(),
        down: new WeightedLoadAccumulator(),
        status: "incomplete",
        repKind: "working",
        modeSpecificMetadata: {},
      };
      this.currentPhase = "up";
    }

    normalizeSample(sample) {
      const actualLeft = finiteOrNull(sample.actualLoadLeftKg ?? sample.loadA);
      const actualRight = finiteOrNull(sample.actualLoadRightKg ?? sample.loadB);
      const explicitCombined = finiteOrNull(sample.actualLoadCombinedKg);
      const actualCombined = explicitCombined ?? sumKnown([actualLeft, actualRight]);
      return {
        timestamp: toDate(sample.timestamp),
        posA: finiteOrNull(sample.posA),
        posB: finiteOrNull(sample.posB),
        actualLoadLeftKg: actualLeft,
        actualLoadRightKg: actualRight,
        actualLoadCombinedKg: actualCombined,
        commandedLoadKg: finiteOrNull(sample.commandedLoadKg ?? this.commandedLoadKg),
      };
    }

    isActiveMovement(previous, current) {
      const deltaA = previous.posA !== null && current.posA !== null ? Math.abs(current.posA - previous.posA) : 0;
      const deltaB = previous.posB !== null && current.posB !== null ? Math.abs(current.posB - previous.posB) : 0;
      return Math.max(deltaA, deltaB) >= this.minMovement;
    }

    summarizeRep(rep, repNumber) {
      const totalDurationSeconds = Math.max(0, (rep.endedAt.getTime() - rep.startedAt.getTime()) / 1000);
      const upDurationSeconds = rep.upEndedAt
        ? Math.max(0, (rep.upEndedAt.getTime() - rep.startedAt.getTime()) / 1000)
        : rep.up.durationMs / 1000;
      const downDurationSeconds = rep.upEndedAt
        ? Math.max(0, (rep.endedAt.getTime() - rep.upEndedAt.getTime()) / 1000)
        : rep.down.durationMs / 1000;
      const avgActual = rep.total.averageActual();
      return {
        repNumber,
        mode: this.mode,
        repKind: rep.repKind,
        startedAt: iso(rep.startedAt),
        endedAt: iso(rep.endedAt),
        upDurationSeconds: roundOrNull(upDurationSeconds, 3),
        downDurationSeconds: roundOrNull(downDurationSeconds, 3),
        totalDurationSeconds: roundOrNull(totalDurationSeconds, 3),
        activeDurationSeconds: roundOrNull(rep.total.durationMs / 1000, 3),
        programmedLoadKg: roundOrNull(this.programmedLoadKg),
        averageCommandedLoadKg: roundOrNull(rep.total.averageCommanded()),
        averageActualLoadKg: roundOrNull(avgActual),
        averageActualLoadUpKg: roundOrNull(rep.up.averageActual()),
        averageActualLoadDownKg: roundOrNull(rep.down.averageActual()),
        peakActualLoadKg: roundOrNull(rep.total.peakActual),
        minimumActualLoadKg: roundOrNull(rep.total.minActual),
        startingActualLoadKg: roundOrNull(rep.total.startActual),
        endingActualLoadKg: roundOrNull(rep.total.endActual),
        resistanceVaried: this.resistanceVaried(rep.total),
        averageActualLoadLeftKg: roundOrNull(rep.total.averageActualLeft()),
        averageActualLoadRightKg: roundOrNull(rep.total.averageActualRight()),
        averageActualLoadCombinedKg: roundOrNull(rep.total.averageActualCombined()),
        completionStatus: rep.status,
        metadata: rep.modeSpecificMetadata,
      };
    }

    getSummary() {
      const completedReps = this.reps.filter((rep) => rep.completionStatus === "completed" && rep.repKind === "working");
      const allCompleted = this.reps.filter((rep) => rep.completionStatus === "completed");
      const total = new WeightedLoadAccumulator();
      for (const rep of allCompleted) {
        const durationMs = (rep.activeDurationSeconds || rep.totalDurationSeconds || 0) * 1000;
        const pseudo = new WeightedLoadAccumulator();
        if (rep.averageActualLoadKg !== null) pseudo.add({ actualLoadCombinedKg: rep.averageActualLoadKg }, durationMs);
        if (rep.averageCommandedLoadKg !== null) pseudo.add({ commandedLoadKg: rep.averageCommandedLoadKg }, durationMs);
        if (rep.averageActualLoadLeftKg !== null) pseudo.add({ actualLoadLeftKg: rep.averageActualLoadLeftKg }, durationMs);
        if (rep.averageActualLoadRightKg !== null) pseudo.add({ actualLoadRightKg: rep.averageActualLoadRightKg }, durationMs);
        pseudo.peakActual = rep.peakActualLoadKg;
        pseudo.minActual = rep.minimumActualLoadKg;
        total.merge(pseudo);
      }

      const averageActual = total.averageActual();
      return {
        mode: this.mode,
        modeType: this.modeType,
        startedAt: iso(this.startedAt),
        endedAt: iso(this.endedAt || new Date()),
        programmedLoadKg: roundOrNull(this.programmedLoadKg),
        commandedLoadKg: roundOrNull(this.commandedLoadKg),
        commandedLoadLeftKg: roundOrNull(this.commandedLoadLeftKg),
        commandedLoadRightKg: roundOrNull(this.commandedLoadRightKg),
        effectiveLoadKg: roundOrNull(this.effectiveLoadKg),
        averageCommandedLoadKg: roundOrNull(total.averageCommanded()),
        averageActualLoadKg: roundOrNull(averageActual),
        averageActualLoadLeftKg: roundOrNull(total.averageActualLeft()),
        averageActualLoadRightKg: roundOrNull(total.averageActualRight()),
        averageActualLoadCombinedKg: roundOrNull(total.averageActualCombined()),
        peakActualLoadKg: roundOrNull(total.peakActual),
        minimumActualLoadKg: roundOrNull(total.minActual),
        resistanceVaried: this.reps.some((rep) => rep.resistanceVaried),
        completedRepCount: completedReps.length,
        allCompletedRepCount: allCompleted.length,
        telemetrySource: "monitor.loadA/loadB",
        combinedLoadSemantics: "sum_of_reported_cable_loads_pending_device_validation",
        metadata: this.metadata,
        reps: this.reps,
      };
    }

    resistanceVaried(accumulator) {
      if (accumulator.peakActual === null || accumulator.minActual === null) return false;
      return Math.abs(accumulator.peakActual - accumulator.minActual) > CHANGE_EPSILON_KG;
    }
  }

  function parseRepCounters(data) {
    if (!data || data.length < 6) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return {
      topCounter: view.getUint16(0, true),
      completeCounter: view.getUint16(4, true),
    };
  }

  function counterDelta(current, previous) {
    if (previous === undefined || previous === null) return 0;
    return current >= previous ? current - previous : 0xffff - previous + current + 1;
  }

  function installRepRecorder(app) {
    if (!app || app.repRecorderInstalled) return null;
    const recorder = new RepRecorder();
    app.repRecorder = recorder;
    app.repRecorderInstalled = true;
    app.repRecorderLastTopCounter = undefined;
    app.repRecorderLastCompleteCounter = undefined;

    const originalUpdateLiveStats = app.updateLiveStats.bind(app);
    app.updateLiveStats = (sample) => {
      recorder.recordSample(sample);
      originalUpdateLiveStats(sample);
    };

    const originalHandleRepNotification = app.handleRepNotification.bind(app);
    app.handleRepNotification = (data) => {
      const counters = parseRepCounters(data);
      if (counters && app.currentSample && app.currentWorkout) {
        const topDelta = counterDelta(counters.topCounter, app.repRecorderLastTopCounter);
        const completeDelta = counterDelta(counters.completeCounter, app.repRecorderLastCompleteCounter);
        if (app.repRecorderLastTopCounter !== undefined && topDelta > 0) recorder.markTop(app.currentSample.timestamp || new Date());
        if (app.repRecorderLastCompleteCounter !== undefined && completeDelta > 0) {
          const totalReps = app.warmupReps + app.workingReps + 1;
          recorder.completeRep({
            timestamp: app.currentSample.timestamp || new Date(),
            repKind: totalReps <= app.warmupTarget ? "warmup" : "working",
            status: "completed",
          });
        }
        app.repRecorderLastTopCounter = counters.topCounter;
        app.repRecorderLastCompleteCounter = counters.completeCounter;
      }
      originalHandleRepNotification(data);
    };

    const originalStartProgram = app.startProgram.bind(app);
    app.startProgram = async () => {
      const modeSelect = document.getElementById("mode");
      const weightInput = document.getElementById("weight");
      const progressionInput = document.getElementById("progression");
      const justLiftCheckbox = document.getElementById("justLiftCheckbox");
      const baseMode = parseInt(modeSelect?.value || "0", 10);
      const programmedLoadKg = app.convertDisplayToKg(parseFloat(weightInput?.value || "0"));
      const progressionKg = app.convertDisplayToKg(parseFloat(progressionInput?.value || "0"));
      await originalStartProgram();
      if (app.currentWorkout) {
        recorder.startSession({
          mode: app.currentWorkout.mode,
          modeType: "program",
          startedAt: app.currentWorkout.startTime,
          programmedLoadKg,
          commandedLoadKg: Number.isFinite(programmedLoadKg) ? programmedLoadKg : null,
          commandedLoadLeftKg: Number.isFinite(programmedLoadKg) ? programmedLoadKg : null,
          commandedLoadRightKg: Number.isFinite(programmedLoadKg) ? programmedLoadKg : null,
          effectiveLoadKg: Number.isFinite(programmedLoadKg) ? programmedLoadKg + 10 : null,
          metadata: {
            base_mode: Number.isFinite(baseMode) ? baseMode : null,
            base_mode_name: ProgramModeNames[baseMode] || null,
            is_just_lift: Boolean(justLiftCheckbox?.checked),
            progression_kg_per_rep: Number.isFinite(progressionKg) ? progressionKg : null,
          },
        });
        app.repRecorderLastTopCounter = undefined;
        app.repRecorderLastCompleteCounter = undefined;
      }
    };

    const originalStartEcho = app.startEcho.bind(app);
    app.startEcho = async () => {
      const levelSelect = document.getElementById("echoLevel");
      const eccentricInput = document.getElementById("eccentric");
      const echoJustLiftCheckbox = document.getElementById("echoJustLiftCheckbox");
      const level = parseInt(levelSelect?.value || "1", 10) - 1;
      const eccentricPct = parseInt(eccentricInput?.value || "100", 10);
      const echoParams = getEchoParams(level, eccentricPct);
      await originalStartEcho();
      if (app.currentWorkout) {
        recorder.startSession({
          mode: app.currentWorkout.mode,
          modeType: "echo",
          startedAt: app.currentWorkout.startTime,
          programmedLoadKg: null,
          commandedLoadKg: null,
          metadata: {
            echo_level: Number.isFinite(level) ? level : null,
            echo_level_name: EchoLevelNames[level] || null,
            eccentric_pct: Number.isFinite(eccentricPct) ? eccentricPct : null,
            concentric_pct: echoParams.concentricPct,
            gain: echoParams.gain,
            cap: echoParams.cap,
            floor: echoParams.floor,
            smoothing: echoParams.smoothing,
            negative_limit: echoParams.negLimit,
            is_just_lift: Boolean(echoJustLiftCheckbox?.checked),
          },
        });
        app.repRecorderLastTopCounter = undefined;
        app.repRecorderLastCompleteCounter = undefined;
      }
    };

    const originalCompleteWorkout = app.completeWorkout.bind(app);
    app.completeWorkout = () => {
      if (app.currentWorkout) {
        const summary = recorder.finishSession({ endedAt: new Date() });
        app.currentWorkout.loadSummary = summary;
        app.currentWorkout.repSummaries = summary.reps;
        app.currentWorkout.averageActualLoadKg = summary.averageActualLoadKg;
        app.currentWorkout.averageCommandedLoadKg = summary.averageCommandedLoadKg;
        app.currentWorkout.peakActualLoadKg = summary.peakActualLoadKg;
        app.currentWorkout.minimumActualLoadKg = summary.minimumActualLoadKg;
        app.currentWorkout.resistanceVaried = summary.resistanceVaried;
      }
      originalCompleteWorkout();
    };

    return recorder;
  }

  global.RepRecorder = RepRecorder;
  global.installRepRecorder = installRepRecorder;

  if (global.app) installRepRecorder(global.app);
})(typeof globalThis !== "undefined" ? globalThis : window);
