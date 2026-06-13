// rep-history-bridge.js - carries recorder summaries into the history object saved by persistence

(function installRepHistoryBridge() {
  function waitForApp() {
    if (typeof app === "undefined" || !app.addToWorkoutHistory) {
      setTimeout(waitForApp, 50);
      return;
    }
    if (app.repHistoryBridgeInstalled) return;
    app.repHistoryBridgeInstalled = true;
    const originalAddToWorkoutHistory = app.addToWorkoutHistory.bind(app);
    app.addToWorkoutHistory = (workout) => {
      const source = app.currentWorkout || {};
      if (source.loadSummary && !workout.loadSummary) workout.loadSummary = source.loadSummary;
      if (Array.isArray(source.repSummaries) && !workout.repSummaries) workout.repSummaries = source.repSummaries;
      for (const key of [
        "programmedLoadKg",
        "averageActualLoadKg",
        "averageCommandedLoadKg",
        "peakActualLoadKg",
        "minimumActualLoadKg",
        "resistanceVaried",
        "exerciseCategory",
        "exerciseCategoryId",
        "exerciseName",
      ]) {
        if (source[key] !== undefined && workout[key] === undefined) workout[key] = source[key];
      }
      originalAddToWorkoutHistory(workout);
    };
  }

  waitForApp();
})();
