// persistence.js - D1-backed profile settings and workout history persistence

const SELECTED_PROFILE_KEY = "vitruvian.selectedProfileId";
const SETTING_WEIGHT_UNIT = "vitruvian.weightUnit";
const SETTING_STOP_AT_TOP = "vitruvian.stopAtTop";
const SETTING_COLOR_PRESET = "vitruvian.colorPreset";
const SETTING_COLOR_1 = "vitruvian.color1";
const SETTING_COLOR_2 = "vitruvian.color2";
const SETTING_COLOR_3 = "vitruvian.color3";

class WorkoutPersistence {
  constructor(appInstance) {
    this.app = appInstance;
    this.profiles = [];
    this.selectedProfileId = this.getStoredSelectedProfileId();
    this.settings = new Map();
    this.isApplyingSettings = false;
    this.hasD1 = true;
    this.colorApplyTimer = null;
    this.colorApplyRequestId = 0;
  }

  async init() {
    this.injectProfileSection();
    this.injectProfileHandlers();
    this.patchAppMethods();
    await this.refreshProfiles();
  }

  getStoredSelectedProfileId() {
    try {
      return localStorage.getItem(SELECTED_PROFILE_KEY) || "";
    } catch {
      return "";
    }
  }

  setStoredSelectedProfileId(profileId) {
    try {
      if (profileId) localStorage.setItem(SELECTED_PROFILE_KEY, profileId);
      else localStorage.removeItem(SELECTED_PROFILE_KEY);
    } catch {
      // Ignore localStorage errors.
    }
  }

  injectProfileSection() {
    if (document.getElementById("profileSection")) return;
    const configSection = document.getElementById("configSection");
    if (!configSection) return;

    const section = document.createElement("div");
    section.className = "section";
    section.id = "profileSection";
    section.innerHTML = `
      <h2>Profile</h2>
      <div class="form-group">
        <label for="profileSelector">Selected profile:</label>
        <div style="display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: end;">
          <select id="profileSelector"><option value="">No profile selected</option></select>
          <button id="refreshProfilesBtn" type="button" style="width: auto; min-width: 90px; margin-top: 0; padding: 10px 14px;">Refresh</button>
        </div>
      </div>
      <div class="form-group">
        <label for="newProfileName">Add profile:</label>
        <div style="display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: end;">
          <input type="text" id="newProfileName" placeholder="Profile name" autocomplete="off" />
          <button id="addProfileBtn" type="button" style="width: auto; min-width: 90px; margin-top: 0; padding: 10px 14px;">Add</button>
        </div>
        <label style="display: flex; align-items: center; gap: 8px; margin-top: 10px; cursor: pointer;">
          <input type="checkbox" id="importLocalProfileData" checked style="width: auto; cursor: pointer;" />
          <span>Copy current local settings and workout history</span>
        </label>
        <div style="font-size: 0.8em; color: #6c757d; line-height: 1.4; margin-top: 8px;">
          Profiles save display units, stop-at-top, color preferences, and completed workout history to D1.
        </div>
      </div>
      <div id="profileStatus" style="font-size: 0.82em; color: #495057; margin-top: 10px; min-height: 1.4em;"></div>
    `;
    configSection.parentNode.insertBefore(section, configSection);
  }

  injectProfileHandlers() {
    document.getElementById("profileSelector")?.addEventListener("change", (event) => this.selectProfile(event.target.value));
    document.getElementById("refreshProfilesBtn")?.addEventListener("click", () => this.refreshProfiles());
    document.getElementById("addProfileBtn")?.addEventListener("click", () => this.createProfile());
    document.getElementById("newProfileName")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.createProfile();
      }
    });
  }

  patchAppMethods() {
    const originalConnect = this.app.connect.bind(this.app);
    this.app.connect = async () => {
      await originalConnect();
      this.scheduleLoadedColorSchemeApply({ quietIfDisconnected: true, delayMs: 300 });
    };

    const originalSaveWeightUnit = this.app.saveWeightUnitPreference.bind(this.app);
    this.app.saveWeightUnitPreference = () => {
      originalSaveWeightUnit();
      this.saveSetting(SETTING_WEIGHT_UNIT, this.app.weightUnit, "string");
    };

    const originalToggleStopAtTop = this.app.toggleStopAtTop.bind(this.app);
    this.app.toggleStopAtTop = () => {
      originalToggleStopAtTop();
      this.saveSetting(SETTING_STOP_AT_TOP, String(this.app.stopAtTop), "boolean");
    };

    const originalLoadColorPreset = this.app.loadColorPreset.bind(this.app);
    this.app.loadColorPreset = () => {
      originalLoadColorPreset();
      this.saveColorSettings();
    };

    const originalSetColorScheme = this.app.setColorScheme.bind(this.app);
    this.app.setColorScheme = async () => {
      await originalSetColorScheme();
      this.saveColorSettings();
    };

    const originalAddToWorkoutHistory = this.app.addToWorkoutHistory.bind(this.app);
    this.app.addToWorkoutHistory = (workout) => {
      originalAddToWorkoutHistory(workout);
      this.saveWorkoutSession(workout);
    };
  }

  async apiFetch(path, options = {}) {
    const response = await fetch(path, {
      headers: { "content-type": "application/json", ...options.headers },
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Persistence request failed");
    return data;
  }

  setStatus(message, type = "") {
    const status = document.getElementById("profileStatus");
    if (!status) return;
    status.textContent = message;
    status.style.color = type === "error" ? "#c92a2a" : type === "success" ? "#2b8a3e" : "#495057";
  }

  renderProfiles() {
    const selector = document.getElementById("profileSelector");
    if (!selector) return;
    selector.innerHTML = '<option value="">No profile selected</option>';
    for (const profile of this.profiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.name;
      option.selected = profile.id === this.selectedProfileId;
      selector.appendChild(option);
    }
  }

  async refreshProfiles() {
    try {
      const data = await this.apiFetch("/api/profiles");
      this.hasD1 = true;
      this.profiles = data.profiles || [];
      if (!this.profiles.some((profile) => profile.id === this.selectedProfileId)) {
        this.selectedProfileId = this.profiles[0]?.id || "";
        this.setStoredSelectedProfileId(this.selectedProfileId);
      }
      this.renderProfiles();
      if (this.selectedProfileId) {
        await this.loadProfileData();
        this.setStatus("Profile loaded from D1.", "success");
      } else {
        this.setStatus("Add a profile to save settings and workout history.");
      }
    } catch (error) {
      this.hasD1 = false;
      this.setStatus(`D1 persistence unavailable: ${error.message}`, "error");
    }
  }

  async createProfile() {
    const input = document.getElementById("newProfileName");
    const name = input ? input.value.trim() : "";
    if (!name) {
      this.setStatus("Enter a profile name first.", "error");
      return;
    }
    try {
      const data = await this.apiFetch("/api/profiles", { method: "POST", body: JSON.stringify({ name }) });
      this.selectedProfileId = data.profile.id;
      this.setStoredSelectedProfileId(this.selectedProfileId);
      if (input) input.value = "";
      await this.refreshProfiles();
      if (document.getElementById("importLocalProfileData")?.checked) await this.importCurrentLocalData();
      this.setStatus("Profile created.", "success");
    } catch (error) {
      this.setStatus(error.message, "error");
    }
  }

  async selectProfile(profileId) {
    this.selectedProfileId = profileId;
    this.setStoredSelectedProfileId(profileId);
    if (!profileId) {
      this.settings = new Map();
      this.setStatus("No profile selected.");
      return;
    }
    try {
      await this.loadProfileData();
      this.setStatus("Profile switched.", "success");
    } catch (error) {
      this.setStatus(error.message, "error");
    }
  }

  async loadProfileData() {
    await this.loadSettings();
    await this.loadWorkoutSessions();
  }

  async loadSettings() {
    if (!this.selectedProfileId) return;
    const data = await this.apiFetch(`/api/profiles/${this.selectedProfileId}/settings`);
    this.settings = new Map((data.settings || []).map((setting) => [setting.key, setting]));
    this.applySettings();
  }

  applySettings() {
    this.isApplyingSettings = true;
    let shouldApplyColors = false;
    try {
      const weightUnit = this.settings.get(SETTING_WEIGHT_UNIT)?.value;
      if (weightUnit === "kg" || weightUnit === "lb") this.app.setWeightUnit(weightUnit, { force: true, previousUnit: this.app.weightUnit });

      const stopAtTopSetting = this.settings.get(SETTING_STOP_AT_TOP);
      if (stopAtTopSetting) {
        const stopAtTop = stopAtTopSetting.value === "true";
        this.app.stopAtTop = stopAtTop;
        const stopAtTopCheckbox = document.getElementById("stopAtTopCheckbox");
        if (stopAtTopCheckbox) stopAtTopCheckbox.checked = stopAtTop;
      }

      shouldApplyColors = this.applyColorInputsFromSettings();
    } finally {
      this.isApplyingSettings = false;
    }

    if (shouldApplyColors) this.scheduleLoadedColorSchemeApply();
  }

  applyColorInputsFromSettings() {
    let hasColorSettings = false;
    const colorPreset = this.settings.get(SETTING_COLOR_PRESET)?.value;
    if (colorPreset !== undefined) {
      this.setInputValue("colorPreset", colorPreset || "");
      if (colorPreset) this.app.loadColorPreset();
      hasColorSettings = true;
    }

    for (const [inputId, settingKey] of [
      ["color1", SETTING_COLOR_1],
      ["color2", SETTING_COLOR_2],
      ["color3", SETTING_COLOR_3],
    ]) {
      const value = this.settings.get(settingKey)?.value;
      if (value !== undefined && value !== null) {
        this.setInputValue(inputId, value);
        hasColorSettings = true;
      }
    }

    return hasColorSettings;
  }

  scheduleLoadedColorSchemeApply(options = {}) {
    if (!this.hasLoadedColorSettings()) return;
    const requestId = ++this.colorApplyRequestId;
    if (this.colorApplyTimer) clearTimeout(this.colorApplyTimer);

    const delayMs = options.delayMs ?? 100;
    this.colorApplyTimer = setTimeout(async () => {
      const applied = await this.applyLoadedColorScheme(options);
      if (applied && requestId === this.colorApplyRequestId) {
        setTimeout(() => {
          if (requestId === this.colorApplyRequestId) this.applyLoadedColorScheme({ quietSuccess: true, quietIfDisconnected: true });
        }, 700);
      }
    }, delayMs);
  }

  async applyLoadedColorScheme(options = {}) {
    const colors = this.getLoadedColorScheme();
    if (!colors) return false;

    if (!this.app.device?.isConnected) {
      if (!options.quietIfDisconnected) this.app.addLogEntry("Profile colors loaded; connect to the device to apply them.", "info");
      return false;
    }

    const wasApplyingSettings = this.isApplyingSettings;
    this.isApplyingSettings = true;
    try {
      await this.app.device.setColorScheme(0.4, colors);
      if (!options.quietSuccess) {
        this.app.addLogEntry("Profile color scheme applied to device.", "success");
        this.setStatus("Profile colors applied to device.", "success");
      }
      return true;
    } catch (error) {
      this.app.addLogEntry(`Could not apply profile colors: ${error.message}`, "error");
      this.setStatus(`Could not apply profile colors: ${error.message}`, "error");
      return false;
    } finally {
      this.isApplyingSettings = wasApplyingSettings;
    }
  }

  getLoadedColorScheme() {
    const color1 = this.parseHexColor(document.getElementById("color1")?.value);
    const color2 = this.parseHexColor(document.getElementById("color2")?.value);
    const color3 = this.parseHexColor(document.getElementById("color3")?.value);
    if (!color1 || !color2 || !color3) return null;
    return [color1, color2, color3];
  }

  parseHexColor(value) {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(value || "");
    if (!match) return null;
    return {
      r: parseInt(match[1], 16),
      g: parseInt(match[2], 16),
      b: parseInt(match[3], 16),
    };
  }

  hasLoadedColorSettings() {
    return [SETTING_COLOR_PRESET, SETTING_COLOR_1, SETTING_COLOR_2, SETTING_COLOR_3].some((key) => this.settings.has(key));
  }

  setInputValue(id, value) {
    const input = document.getElementById(id);
    if (input && value !== undefined && value !== null) input.value = value;
  }

  async saveSetting(key, value, valueType = "string") {
    if (this.isApplyingSettings || !this.selectedProfileId || !this.hasD1) return;
    const nextSettings = Array.from(this.settings.values()).map((setting) => ({ key: setting.key, value: setting.value, value_type: setting.value_type }));
    const index = nextSettings.findIndex((setting) => setting.key === key);
    const nextSetting = { key, value: String(value), value_type: valueType };
    if (index >= 0) nextSettings[index] = nextSetting;
    else nextSettings.push(nextSetting);
    try {
      const data = await this.apiFetch(`/api/profiles/${this.selectedProfileId}/settings`, { method: "PUT", body: JSON.stringify({ settings: nextSettings }) });
      this.settings = new Map((data.settings || []).map((setting) => [setting.key, setting]));
      this.setStatus("Profile setting saved.", "success");
    } catch (error) {
      this.setStatus(`Could not save setting: ${error.message}`, "error");
    }
  }

  saveColorSettings() {
    if (this.isApplyingSettings) return;
    this.saveSetting(SETTING_COLOR_PRESET, document.getElementById("colorPreset")?.value || "", "string");
    this.saveSetting(SETTING_COLOR_1, document.getElementById("color1")?.value || "", "string");
    this.saveSetting(SETTING_COLOR_2, document.getElementById("color2")?.value || "", "string");
    this.saveSetting(SETTING_COLOR_3, document.getElementById("color3")?.value || "", "string");
  }

  async importCurrentLocalData() {
    const settings = [
      { key: SETTING_WEIGHT_UNIT, value: this.app.weightUnit, value_type: "string" },
      { key: SETTING_STOP_AT_TOP, value: String(this.app.stopAtTop), value_type: "boolean" },
      { key: SETTING_COLOR_PRESET, value: document.getElementById("colorPreset")?.value || "", value_type: "string" },
      { key: SETTING_COLOR_1, value: document.getElementById("color1")?.value || "", value_type: "string" },
      { key: SETTING_COLOR_2, value: document.getElementById("color2")?.value || "", value_type: "string" },
      { key: SETTING_COLOR_3, value: document.getElementById("color3")?.value || "", value_type: "string" },
    ];
    await this.apiFetch(`/api/profiles/${this.selectedProfileId}/settings`, { method: "PUT", body: JSON.stringify({ settings }) });
    for (const workout of this.app.workoutHistory) await this.saveWorkoutSession(workout, { quiet: true });
    await this.loadProfileData();
  }

  async loadWorkoutSessions() {
    const data = await this.apiFetch(`/api/profiles/${this.selectedProfileId}/workout-sessions`);
    this.app.workoutHistory = (data.workout_sessions || []).map((session) => ({
      id: session.id,
      mode: session.mode || "Workout",
      weightKg: session.weight_kg || 0,
      reps: session.completed_reps || 0,
      targetReps: session.target_reps || 0,
      timestamp: session.ended_at ? new Date(session.ended_at) : new Date(session.started_at),
      startTime: new Date(session.started_at),
      warmupEndTime: session.warmup_ended_at ? new Date(session.warmup_ended_at) : null,
      endTime: session.ended_at ? new Date(session.ended_at) : null,
    }));
    this.app.updateHistoryDisplay();
  }

  async saveWorkoutSession(workout, options = {}) {
    if (!this.selectedProfileId || !this.hasD1 || !workout) return;
    const startedAt = workout.startTime || workout.timestamp || new Date();
    const endedAt = workout.endTime || workout.timestamp || new Date();
    const modeType = String(workout.mode || "").toLowerCase().includes("echo") ? "echo" : "program";
    try {
      await this.apiFetch(`/api/profiles/${this.selectedProfileId}/workout-sessions`, {
        method: "POST",
        body: JSON.stringify({
          mode: workout.mode || "Workout",
          mode_type: modeType,
          started_at: new Date(startedAt).toISOString(),
          warmup_ended_at: workout.warmupEndTime ? new Date(workout.warmupEndTime).toISOString() : null,
          ended_at: new Date(endedAt).toISOString(),
          target_reps: workout.targetReps || null,
          completed_reps: workout.reps || 0,
          warmup_reps: this.app.warmupTarget || 3,
          weight_kg: workout.weightKg || 0,
          display_unit: this.app.getUnitLabel(),
          metadata: { source: "VitruvianApp.addToWorkoutHistory" },
        }),
      });
      if (!options.quiet) this.setStatus("Workout saved to profile.", "success");
    } catch (error) {
      this.setStatus(`Could not save workout: ${error.message}`, "error");
    }
  }
}

const persistence = new WorkoutPersistence(app);
persistence.init();
