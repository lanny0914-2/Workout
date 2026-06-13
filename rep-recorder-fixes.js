// rep-recorder-fixes.js - small compatibility patches for shared load recording

(function patchRepRecorder(global) {
  function boot() {
    if (!global.RepRecorder) {
      setTimeout(boot, 50);
      return;
    }

    function toDate(value) {
      if (!value) return new Date();
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? new Date() : date;
    }

    function iso(value) {
      return value ? toDate(value).toISOString() : null;
    }

    function finiteOrNull(value) {
      if (value === null || value === undefined || value === "") return null;
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

    function addWeighted(target, keyMs, keySum, value, durationMs) {
      const number = finiteOrNull(value);
      if (number === null) return;
      target[keyMs] += durationMs;
      target[keySum] += number * durationMs;
    }

    function average(sum, ms) {
      return ms > 0 ? sum / ms : null;
    }

    function copyKnownLoadFields(sample) {
      const known = {};
      if (sample.actualLoadLeftKg !== null) known.actualLoadLeftKg = sample.actualLoadLeftKg;
      if (sample.actualLoadRightKg !== null) known.actualLoadRightKg = sample.actualLoadRightKg;
      if (sample.actualLoadCombinedKg !== null) known.actualLoadCombinedKg = sample.actualLoadCombinedKg;
      if (sample.commandedLoadKg !== null) known.commandedLoadKg = sample.commandedLoadKg;
      return known;
    }

    global.RepRecorder.prototype.normalizeSample = function normalizeSample(sample) {
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
    };

    global.RepRecorder.prototype.recordSample = function recordSample(inputSample) {
      if (!this.active || !inputSample) return;
      const sample = this.normalizeSample(inputSample);
      if (!this.currentRep) this.beginRep(sample.timestamp);

      if (this.lastSample) {
        const durationMs = sample.timestamp.getTime() - this.lastSample.timestamp.getTime();
        if (durationMs > 0 && durationMs <= 2000 && this.isActiveMovement(this.lastSample, sample)) {
          const weightedSample = copyKnownLoadFields(this.lastSample);
          this.currentRep.total.add(weightedSample, durationMs);
          this.currentRep[this.currentPhase].add(weightedSample, durationMs);
          this.lastActiveSample = sample;
        }
      }

      this.lastSample = sample;
    };

    global.RepRecorder.prototype.summarizeRep = function summarizeRep(rep, repNumber) {
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
    };

    global.RepRecorder.prototype.getSummary = function getSummary() {
      const completedReps = this.reps.filter((rep) => rep.completionStatus === "completed" && rep.repKind === "working");
      const allCompleted = this.reps.filter((rep) => rep.completionStatus === "completed");
      const total = {
        durationMs: 0,
        actualMs: 0,
        commandedMs: 0,
        actualLeftMs: 0,
        actualRightMs: 0,
        actualCombinedMs: 0,
        actualSum: 0,
        commandedSum: 0,
        actualLeftSum: 0,
        actualRightSum: 0,
        actualCombinedSum: 0,
        peakActual: null,
        minActual: null,
        startActual: null,
        endActual: null,
      };

      for (const rep of allCompleted) {
        const durationMs = (rep.activeDurationSeconds || rep.totalDurationSeconds || 0) * 1000;
        if (durationMs <= 0) continue;
        total.durationMs += durationMs;
        addWeighted(total, "actualMs", "actualSum", rep.averageActualLoadKg, durationMs);
        addWeighted(total, "commandedMs", "commandedSum", rep.averageCommandedLoadKg, durationMs);
        addWeighted(total, "actualLeftMs", "actualLeftSum", rep.averageActualLoadLeftKg, durationMs);
        addWeighted(total, "actualRightMs", "actualRightSum", rep.averageActualLoadRightKg, durationMs);
        addWeighted(total, "actualCombinedMs", "actualCombinedSum", rep.averageActualLoadCombinedKg, durationMs);
        if (rep.startingActualLoadKg !== null && total.startActual === null) total.startActual = rep.startingActualLoadKg;
        if (rep.endingActualLoadKg !== null) total.endActual = rep.endingActualLoadKg;
        if (rep.peakActualLoadKg !== null) total.peakActual = total.peakActual === null ? rep.peakActualLoadKg : Math.max(total.peakActual, rep.peakActualLoadKg);
        if (rep.minimumActualLoadKg !== null) total.minActual = total.minActual === null ? rep.minimumActualLoadKg : Math.min(total.minActual, rep.minimumActualLoadKg);
      }

      const averageActual = average(total.actualSum, total.actualMs);
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
        averageCommandedLoadKg: roundOrNull(average(total.commandedSum, total.commandedMs)),
        averageActualLoadKg: roundOrNull(averageActual),
        averageActualLoadLeftKg: roundOrNull(average(total.actualLeftSum, total.actualLeftMs)),
        averageActualLoadRightKg: roundOrNull(average(total.actualRightSum, total.actualRightMs)),
        averageActualLoadCombinedKg: roundOrNull(average(total.actualCombinedSum, total.actualCombinedMs)),
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
    };
  }

  boot();
})(typeof globalThis !== "undefined" ? globalThis : window);
