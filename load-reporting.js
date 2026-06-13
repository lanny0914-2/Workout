// load-reporting.js - enhanced load metrics persistence and history UI

(function installLoadReporting() {
  function waitForPersistence() {
    if (typeof app === "undefined" || typeof persistence === "undefined") {
      setTimeout(waitForPersistence, 50);
      return;
    }
    patchPersistence(app, persistence);
  }

  function parseMetadata(metadataJson) {
    if (!metadataJson) return {};
    try {
      const parsed = JSON.parse(metadataJson);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatMaybeWeight(appInstance, value) {
    return value === null || value === undefined || Number.isNaN(Number(value))
      ? "Unavailable"
      : appInstance.formatWeightWithUnit(Number(value));
  }

  function normalizeRep(rep) {
    return {
      repNumber: rep.repNumber ?? rep.rep_number,
      mode: rep.mode,
      repKind: rep.repKind ?? rep.rep_kind ?? "working",
      startedAt: rep.startedAt ?? rep.started_at,
      endedAt: rep.endedAt ?? rep.ended_at,
      upDurationSeconds: rep.upDurationSeconds ?? rep.up_duration_seconds,
      downDurationSeconds: rep.downDurationSeconds ?? rep.down_duration_seconds,
      totalDurationSeconds: rep.totalDurationSeconds ?? rep.total_duration_seconds,
      activeDurationSeconds: rep.activeDurationSeconds ?? rep.active_duration_seconds,
      programmedLoadKg: rep.programmedLoadKg ?? rep.programmed_load_kg,
      averageCommandedLoadKg: rep.averageCommandedLoadKg ?? rep.average_commanded_load_kg,
      averageActualLoadKg: rep.averageActualLoadKg ?? rep.average_actual_load_kg,
      averageActualLoadUpKg: rep.averageActualLoadUpKg ?? rep.average_actual_load_up_kg,
      averageActualLoadDownKg: rep.averageActualLoadDownKg ?? rep.average_actual_load_down_kg,
      peakActualLoadKg: rep.peakActualLoadKg ?? rep.peak_actual_load_kg,
      minimumActualLoadKg: rep.minimumActualLoadKg ?? rep.minimum_actual_load_kg,
      startingActualLoadKg: rep.startingActualLoadKg ?? rep.starting_actual_load_kg,
      endingActualLoadKg: rep.endingActualLoadKg ?? rep.ending_actual_load_kg,
      resistanceVaried: Boolean(rep.resistanceVaried ?? rep.resistance_varied),
      averageActualLoadLeftKg: rep.averageActualLoadLeftKg ?? rep.average_actual_load_left_kg,
      averageActualLoadRightKg: rep.averageActualLoadRightKg ?? rep.average_actual_load_right_kg,
      averageActualLoadCombinedKg: rep.averageActualLoadCombinedKg ?? rep.average_actual_load_combined_kg,
      completionStatus: rep.completionStatus ?? rep.completion_status ?? "completed",
      metadata: rep.metadata || parseMetadata(rep.metadata_json),
    };
  }

  function patchPersistence(appInstance, persistenceInstance) {
    if (persistenceInstance.loadReportingInstalled) return;
    persistenceInstance.loadReportingInstalled = true;

    persistenceInstance.loadWorkoutSessions = async function loadWorkoutSessionsWithMetrics() {
      const data = await this.apiFetch(`/api/profiles/${this.selectedProfileId}/workout-sessions`);
      this.app.workoutHistory = (data.workout_sessions || []).map((session) => {
        const metadata = this.parseMetadata(session.metadata_json);
        const loadSummary = session.load_summary_json ? this.parseMetadata(session.load_summary_json) : metadata.load_summary || null;
        const repSummaries = Array.isArray(session.rep_metrics)
          ? session.rep_metrics.map(normalizeRep)
          : Array.isArray(loadSummary?.reps)
            ? loadSummary.reps.map(normalizeRep)
            : [];
        return {
          id: session.id,
          mode: session.mode || "Workout",
          weightKg: session.weight_kg || 0,
          programmedLoadKg: session.programmed_load_kg ?? loadSummary?.programmedLoadKg ?? session.weight_kg ?? null,
          averageCommandedLoadKg: session.average_commanded_load_kg ?? loadSummary?.averageCommandedLoadKg ?? null,
          averageActualLoadKg: session.average_actual_load_kg ?? loadSummary?.averageActualLoadKg ?? null,
          peakActualLoadKg: session.peak_actual_load_kg ?? loadSummary?.peakActualLoadKg ?? null,
          minimumActualLoadKg: session.minimum_actual_load_kg ?? loadSummary?.minimumActualLoadKg ?? null,
          resistanceVaried: Boolean(session.resistance_varied ?? loadSummary?.resistanceVaried),
          loadSummary,
          repSummaries,
          reps: session.completed_reps || 0,
          targetReps: session.target_reps || 0,
          exerciseCategory: metadata.exercise_category || metadata.exerciseCategory || "",
          exerciseCategoryId: metadata.exercise_category_id || metadata.exerciseCategoryId || "",
          exerciseName: metadata.exercise_name || metadata.exerciseName || "",
          timestamp: session.ended_at ? new Date(session.ended_at) : new Date(session.started_at),
          startTime: new Date(session.started_at),
          warmupEndTime: session.warmup_ended_at ? new Date(session.warmup_ended_at) : null,
          endTime: session.ended_at ? new Date(session.ended_at) : null,
        };
      });
      this.app.updateHistoryDisplay();
    };

    persistenceInstance.saveWorkoutSession = async function saveWorkoutSessionWithMetrics(workout, options = {}) {
      if (!this.selectedProfileId || !this.hasD1 || !workout) return;
      const startedAt = workout.startTime || workout.timestamp || new Date();
      const endedAt = workout.endTime || workout.timestamp || new Date();
      const modeType = String(workout.mode || "").toLowerCase().includes("echo") ? "echo" : "program";
      const loadSummary = workout.loadSummary || null;
      const repSummaries = Array.isArray(workout.repSummaries) ? workout.repSummaries : Array.isArray(loadSummary?.reps) ? loadSummary.reps : [];
      try {
        await this.apiFetch(`/api/profiles/${this.selectedProfileId}/workout-sessions`, {
          method: "POST",
          body: JSON.stringify({
            mode: workout.mode || "Workout",
            mode_type: loadSummary?.modeType || modeType,
            started_at: new Date(startedAt).toISOString(),
            warmup_ended_at: workout.warmupEndTime ? new Date(workout.warmupEndTime).toISOString() : null,
            ended_at: new Date(endedAt).toISOString(),
            target_reps: workout.targetReps || null,
            completed_reps: workout.reps || 0,
            warmup_reps: this.app.warmupTarget || 3,
            weight_kg: workout.weightKg || 0,
            display_unit: this.app.getUnitLabel(),
            programmed_load_kg: loadSummary?.programmedLoadKg ?? workout.programmedLoadKg ?? workout.weightKg ?? null,
            average_commanded_load_kg: loadSummary?.averageCommandedLoadKg ?? workout.averageCommandedLoadKg ?? null,
            average_actual_load_kg: loadSummary?.averageActualLoadKg ?? workout.averageActualLoadKg ?? null,
            peak_actual_load_kg: loadSummary?.peakActualLoadKg ?? workout.peakActualLoadKg ?? null,
            minimum_actual_load_kg: loadSummary?.minimumActualLoadKg ?? workout.minimumActualLoadKg ?? null,
            resistance_varied: Boolean(loadSummary?.resistanceVaried ?? workout.resistanceVaried),
            load_summary: loadSummary,
            rep_summaries: repSummaries,
            metadata: {
              source: "VitruvianApp.addToWorkoutHistory",
              exercise_category: workout.exerciseCategory || "",
              exercise_category_id: workout.exerciseCategoryId || "",
              exercise_name: workout.exerciseName || "",
              load_summary: loadSummary,
            },
          }),
        });
        if (!options.quiet) this.setStatus("Workout saved to profile.", "success");
      } catch (error) {
        this.setStatus(`Could not save workout: ${error.message}`, "error");
      }
    };

    persistenceInstance.renderHistoryDisplay = function renderLoadAwareHistory() {
      const historyList = document.getElementById("historyList");
      if (!historyList) return;

      if (this.app.workoutHistory.length === 0) {
        historyList.innerHTML = `
          <div style="color: #6c757d; font-size: 0.9em; text-align: center; padding: 20px;">
            No workouts completed yet
          </div>
        `;
        return;
      }

      historyList.innerHTML = this.app.workoutHistory.map((workout, index) => {
        const programmed = workout.programmedLoadKg ?? workout.weightKg ?? null;
        const hasActual = workout.averageActualLoadKg !== null && workout.averageActualLoadKg !== undefined;
        const actualLine = hasActual
          ? `<div>Actual set average: ${escapeHtml(formatMaybeWeight(this.app, workout.averageActualLoadKg))}</div>`
          : workout.averageCommandedLoadKg !== null && workout.averageCommandedLoadKg !== undefined
            ? `<div>Commanded average: ${escapeHtml(formatMaybeWeight(this.app, workout.averageCommandedLoadKg))}</div>`
            : `<div>Actual set average: Unavailable</div>`;
        const peakLine = workout.peakActualLoadKg !== null && workout.peakActualLoadKg !== undefined
          ? `<div>Peak actual resistance: ${escapeHtml(formatMaybeWeight(this.app, workout.peakActualLoadKg))}</div>`
          : "";
        const repDetails = Array.isArray(workout.repSummaries) && workout.repSummaries.length
          ? `<details style="margin-top: 8px;"><summary style="cursor: pointer; color: #667eea; font-weight: 600;">Rep details</summary><div style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">${workout.repSummaries.map((rep) => `
              <div style="background: #f8f9fa; border-radius: 6px; padding: 8px;">
                <div style="font-weight: 600; color: #212529;">Rep ${Number(rep.repNumber) || "?"}${rep.repKind === "warmup" ? " (warmup)" : ""}</div>
                <div style="color: #6c757d; font-size: 0.9em;">Up ${rep.upDurationSeconds ?? "?"}s &bull; Down ${rep.downDurationSeconds ?? "?"}s &bull; Avg ${escapeHtml(formatMaybeWeight(this.app, rep.averageActualLoadKg))}</div>
                <div style="color: #6c757d; font-size: 0.85em;">Up avg ${escapeHtml(formatMaybeWeight(this.app, rep.averageActualLoadUpKg))} &bull; Down avg ${escapeHtml(formatMaybeWeight(this.app, rep.averageActualLoadDownKg))}</div>
              </div>
            `).join("")}</div></details>`
          : "";
        const hasTimingData = workout.startTime && workout.endTime;
        const viewButtonHtml = hasTimingData
          ? `<button class="view-graph-btn" onclick="app.viewWorkoutOnGraph(${index})" title="View this workout on the graph">View Graph</button>`
          : "";
        const exerciseTitle = workout.exerciseName || workout.mode;
        const category = workout.exerciseCategory ? `${escapeHtml(workout.exerciseCategory)} &bull; ` : "";
        const mode = workout.exerciseName ? `${escapeHtml(workout.mode)} &bull; ` : "";
        return `
          <div class="history-item">
            <div class="history-item-title">${escapeHtml(exerciseTitle)}</div>
            <div class="history-item-details">${category}${mode}${Number(workout.reps) || 0} reps</div>
            <div style="font-size: 0.88em; color: #495057; line-height: 1.5; margin: 6px 0;">
              <div>Programmed weight: ${escapeHtml(formatMaybeWeight(this.app, programmed))}</div>
              ${actualLine}
              ${peakLine}
              <div>Resistance varied: ${workout.resistanceVaried ? "Yes" : "No"}</div>
            </div>
            ${repDetails}
            ${viewButtonHtml}
          </div>
        `;
      }).join("");
    };
  }

  waitForPersistence();
})();
