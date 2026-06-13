import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadRecorder() {
  const context = {
    console,
    setTimeout() {},
    document: undefined,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL("../rep-recorder.js", import.meta.url), "utf8"), context);
  return context.RepRecorder;
}

const RepRecorder = loadRecorder();

function sample(ms, { pos = 0, loadA = null, loadB = null, commanded = null } = {}) {
  return {
    timestamp: new Date(ms),
    posA: pos,
    posB: pos,
    loadA,
    loadB,
    commandedLoadKg: commanded,
  };
}

test("programmed, commanded, and actual loads remain separate", () => {
  const recorder = new RepRecorder();
  recorder.startSession({ mode: "TUT", programmedLoadKg: 20, commandedLoadKg: 22 });
  recorder.recordSample(sample(0, { pos: 0, loadA: 9, loadB: 9, commanded: 22 }));
  recorder.recordSample(sample(1000, { pos: 10, loadA: 8, loadB: 8, commanded: 22 }));
  recorder.markTop(new Date(1000));
  recorder.recordSample(sample(2000, { pos: 0, loadA: 7, loadB: 7, commanded: 22 }));
  recorder.completeRep({ timestamp: new Date(2000), repKind: "working" });
  const summary = recorder.finishSession({ endedAt: new Date(2000) });
  assert.equal(summary.programmedLoadKg, 20);
  assert.equal(summary.commandedLoadKg, 22);
  assert.notEqual(summary.averageActualLoadKg, summary.programmedLoadKg);
  assert.notEqual(summary.averageActualLoadKg, summary.commandedLoadKg);
});

test("each rep receives its own average actual load", () => {
  const recorder = new RepRecorder();
  recorder.startSession({ mode: "Old School", programmedLoadKg: 10, commandedLoadKg: 10 });
  recorder.recordSample(sample(0, { pos: 0, loadA: 5, loadB: 5 }));
  recorder.recordSample(sample(1000, { pos: 10, loadA: 5, loadB: 5 }));
  recorder.completeRep({ timestamp: new Date(1000), repKind: "working" });
  recorder.recordSample(sample(2000, { pos: 0, loadA: 10, loadB: 10 }));
  recorder.recordSample(sample(3000, { pos: 10, loadA: 10, loadB: 10 }));
  recorder.completeRep({ timestamp: new Date(3000), repKind: "working" });
  const summary = recorder.finishSession({ endedAt: new Date(3000) });
  assert.equal(summary.reps.length, 2);
  assert.equal(summary.reps[0].averageActualLoadKg, 10);
  assert.equal(summary.reps[1].averageActualLoadKg, 20);
});

test("rest time is excluded by movement threshold", () => {
  const recorder = new RepRecorder();
  recorder.startSession({ mode: "Pump", programmedLoadKg: 10 });
  recorder.recordSample(sample(0, { pos: 0, loadA: 100, loadB: 100 }));
  recorder.recordSample(sample(1000, { pos: 0, loadA: 100, loadB: 100 }));
  recorder.recordSample(sample(2000, { pos: 10, loadA: 5, loadB: 5 }));
  recorder.completeRep({ timestamp: new Date(2000), repKind: "working" });
  const [rep] = recorder.finishSession({ endedAt: new Date(2000) }).reps;
  assert.equal(rep.averageActualLoadKg, 200);
  assert.equal(rep.activeDurationSeconds, 1);
});

test("upward and downward averages are separate", () => {
  const recorder = new RepRecorder();
  recorder.startSession({ mode: "Eccentric Only" });
  recorder.recordSample(sample(0, { pos: 0, loadA: 5, loadB: 5 }));
  recorder.recordSample(sample(1000, { pos: 10, loadA: 15, loadB: 15 }));
  recorder.markTop(new Date(1000));
  recorder.recordSample(sample(2000, { pos: 0, loadA: 15, loadB: 15 }));
  recorder.completeRep({ timestamp: new Date(2000), repKind: "working" });
  const [rep] = recorder.finishSession({ endedAt: new Date(2000) }).reps;
  assert.equal(rep.averageActualLoadUpKg, 10);
  assert.equal(rep.averageActualLoadDownKg, 30);
});

test("irregular intervals use time-weighted averaging", () => {
  const recorder = new RepRecorder();
  recorder.startSession({ mode: "TUT" });
  recorder.recordSample(sample(0, { pos: 0, loadA: 10, loadB: 0 }));
  recorder.recordSample(sample(1000, { pos: 10, loadA: 20, loadB: 0 }));
  recorder.recordSample(sample(3000, { pos: 20, loadA: 20, loadB: 0 }));
  recorder.completeRep({ timestamp: new Date(3000), repKind: "working" });
  const [rep] = recorder.finishSession({ endedAt: new Date(3000) }).reps;
  assert.equal(rep.averageActualLoadKg, 16.6667);
});

test("set-level averages are duration weighted", () => {
  const recorder = new RepRecorder();
  recorder.startSession({ mode: "TUT" });
  recorder.recordSample(sample(0, { pos: 0, loadA: 10, loadB: 0 }));
  recorder.recordSample(sample(1000, { pos: 10, loadA: 10, loadB: 0 }));
  recorder.completeRep({ timestamp: new Date(1000), repKind: "working" });
  recorder.recordSample(sample(2000, { pos: 0, loadA: 20, loadB: 0 }));
  recorder.recordSample(sample(4000, { pos: 10, loadA: 20, loadB: 0 }));
  recorder.completeRep({ timestamp: new Date(4000), repKind: "working" });
  const summary = recorder.finishSession({ endedAt: new Date(4000) });
  assert.equal(summary.averageActualLoadKg, 16.6667);
});

test("missing actual load remains null", () => {
  const recorder = new RepRecorder();
  recorder.startSession({ mode: "Echo", commandedLoadKg: 12 });
  recorder.recordSample(sample(0, { pos: 0, commanded: 12 }));
  recorder.recordSample(sample(1000, { pos: 10, commanded: 12 }));
  recorder.completeRep({ timestamp: new Date(1000), repKind: "working" });
  const summary = recorder.finishSession({ endedAt: new Date(1000) });
  assert.equal(summary.averageActualLoadKg, null);
  assert.equal(summary.averageCommandedLoadKg, 12);
});

test("commanded load is never labeled as actual load", () => {
  const recorder = new RepRecorder();
  recorder.startSession({ mode: "Echo", commandedLoadKg: 30 });
  recorder.recordSample(sample(0, { pos: 0, commanded: 30 }));
  recorder.recordSample(sample(1000, { pos: 10, commanded: 30 }));
  recorder.completeRep({ timestamp: new Date(1000), repKind: "working" });
  const [rep] = recorder.finishSession({ endedAt: new Date(1000) }).reps;
  assert.equal(rep.averageActualLoadKg, null);
  assert.equal(rep.averageCommandedLoadKg, 30);
});

test("variable resistance during a rep is summarized", () => {
  const recorder = new RepRecorder();
  recorder.startSession({ mode: "Echo" });
  recorder.recordSample(sample(0, { pos: 0, loadA: 5, loadB: 5 }));
  recorder.recordSample(sample(1000, { pos: 10, loadA: 10, loadB: 10 }));
  recorder.recordSample(sample(2000, { pos: 20, loadA: 20, loadB: 20 }));
  recorder.recordSample(sample(3000, { pos: 30, loadA: 20, loadB: 20 }));
  recorder.completeRep({ timestamp: new Date(3000), repKind: "working" });
  const [rep] = recorder.finishSession({ endedAt: new Date(3000) }).reps;
  assert.equal(rep.resistanceVaried, true);
  assert.equal(rep.minimumActualLoadKg, 10);
  assert.equal(rep.peakActualLoadKg, 40);
});

test("resistance changes between phases are preserved", () => {
  const recorder = new RepRecorder();
  recorder.startSession({ mode: "Eccentric Only" });
  recorder.recordSample(sample(0, { pos: 0, loadA: 5, loadB: 5 }));
  recorder.recordSample(sample(1000, { pos: 10, loadA: 20, loadB: 20 }));
  recorder.markTop(new Date(1000));
  recorder.recordSample(sample(2000, { pos: 0, loadA: 20, loadB: 20 }));
  recorder.completeRep({ timestamp: new Date(2000), repKind: "working" });
  const [rep] = recorder.finishSession({ endedAt: new Date(2000) }).reps;
  assert.notEqual(rep.averageActualLoadUpKg, rep.averageActualLoadDownKg);
});

test("old workout-like records can omit detailed telemetry", () => {
  const oldRecord = { weightKg: 20, repSummaries: undefined, averageActualLoadKg: undefined };
  assert.equal(oldRecord.averageActualLoadKg, undefined);
  assert.equal(oldRecord.weightKg, 20);
});

test("unit conversion does not alter stored kg values", () => {
  const recorder = new RepRecorder();
  recorder.startSession({ mode: "Old School", programmedLoadKg: 10 });
  recorder.recordSample(sample(0, { pos: 0, loadA: 5, loadB: 5 }));
  recorder.recordSample(sample(1000, { pos: 10, loadA: 5, loadB: 5 }));
  recorder.completeRep({ timestamp: new Date(1000), repKind: "working" });
  const summary = recorder.finishSession({ endedAt: new Date(1000) });
  assert.equal(summary.programmedLoadKg, 10);
  assert.equal(summary.averageActualLoadKg, 10);
});

test("left and right values are preserved with explicit combined semantics", () => {
  const recorder = new RepRecorder();
  recorder.startSession({ mode: "Old School" });
  recorder.recordSample(sample(0, { pos: 0, loadA: 4, loadB: 6 }));
  recorder.recordSample(sample(1000, { pos: 10, loadA: 4, loadB: 6 }));
  recorder.completeRep({ timestamp: new Date(1000), repKind: "working" });
  const summary = recorder.finishSession({ endedAt: new Date(1000) });
  assert.equal(summary.averageActualLoadLeftKg, 4);
  assert.equal(summary.averageActualLoadRightKg, 6);
  assert.equal(summary.averageActualLoadCombinedKg, 10);
  assert.equal(summary.combinedLoadSemantics, "sum_of_reported_cable_loads_pending_device_validation");
});

test("incomplete reps are not counted as completed working reps", () => {
  const recorder = new RepRecorder();
  recorder.startSession({ mode: "Just Lift" });
  recorder.recordSample(sample(0, { pos: 0, loadA: 5, loadB: 5 }));
  recorder.recordSample(sample(1000, { pos: 10, loadA: 5, loadB: 5 }));
  const summary = recorder.finishSession({ endedAt: new Date(1000), completeIncompleteRep: true });
  assert.equal(summary.completedRepCount, 0);
  assert.equal(summary.reps[0].completionStatus, "incomplete");
});

test("shared recorder works for fixed, TUT, and Echo modes", () => {
  for (const mode of ["Old School", "TUT", "Echo Hard"]) {
    const recorder = new RepRecorder();
    recorder.startSession({ mode, programmedLoadKg: mode.startsWith("Echo") ? null : 10 });
    recorder.recordSample(sample(0, { pos: 0, loadA: 5, loadB: 5 }));
    recorder.recordSample(sample(1000, { pos: 10, loadA: 5, loadB: 5 }));
    recorder.completeRep({ timestamp: new Date(1000), repKind: "working" });
    assert.equal(recorder.finishSession({ endedAt: new Date(1000) }).completedRepCount, 1);
  }
});

test("mode-specific metadata does not break summary", () => {
  const recorder = new RepRecorder();
  recorder.startSession({ mode: "Echo", metadata: { gain: 1.25, cap: 40 } });
  recorder.recordSample(sample(0, { pos: 0, loadA: 5, loadB: 5 }));
  recorder.recordSample(sample(1000, { pos: 10, loadA: 5, loadB: 5 }));
  recorder.completeRep({ timestamp: new Date(1000), repKind: "working", metadata: { echo_response: "sample" } });
  const summary = recorder.finishSession({ endedAt: new Date(1000) });
  assert.deepEqual(summary.metadata, { gain: 1.25, cap: 40 });
  assert.deepEqual(summary.reps[0].metadata, { echo_response: "sample" });
});
