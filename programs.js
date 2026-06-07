// programs.js - Profile-backed workout program builder and set runner

const PROGRAMS_STORAGE_KEY = "vitruvian.programs";
const PROGRAMS_SETTING_KEY = "vitruvian.programs";

class WorkoutProgramManager {
  constructor(appInstance, persistenceInstance) {
    this.app = appInstance;
    this.persistence = persistenceInstance;
    this.programs = [];
    this.selectedProgramId = "";
    this.activeSetIndex = 0;
    this.isSaving = false;
  }

  init() {
    this.injectProgramSection();
    this.injectHandlers();
    this.patchAppMethods();
    this.patchPersistenceMethods();
    this.loadProgramsFromLocalStorage();
    this.loadProgramsFromSettings();
    this.render();
  }

  injectProgramSection() {
    if (document.getElementById("programBuilderSection")) return;
    const exerciseSection = document.getElementById("exerciseSection");
    const programSection = document.getElementById("programSection");
    const sidebarContent = document.querySelector(".sidebar-content");
    if (!sidebarContent) return;

    const section = document.createElement("div");
    section.className = "section";
    section.id = "programBuilderSection";
    section.innerHTML = `
      <h2>Programs</h2>
      <div class="form-group">
        <label for="savedProgramSelector">Saved program:</label>
        <select id="savedProgramSelector"><option value="">New program</option></select>
      </div>
      <div class="form-group">
        <label for="programNameInput">Program name:</label>
        <input type="text" id="programNameInput" placeholder="Leg day" autocomplete="off" />
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 15px;">
        <button type="button" id="newProgramBtn" class="secondary" style="margin-top: 0;">New</button>
        <button type="button" id="deleteProgramBtn" class="secondary" style="margin-top: 0;">Delete</button>
      </div>
      <div class="form-group">
        <label for="programSetCategory">Add exercise:</label>
        <select id="programSetCategory"></select>
      </div>
      <div class="form-group">
        <select id="programSetExercise"></select>
      </div>
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px;">
        <div>
          <label for="programSetCount">Sets</label>
          <input type="number" id="programSetCount" value="1" min="1" max="20" step="1" />
        </div>
        <div>
          <label for="programSetWeight">Weight</label>
          <input type="number" id="programSetWeight" value="10" min="0" step="1" />
        </div>
        <div>
          <label for="programSetReps">Reps</label>
          <input type="number" id="programSetReps" value="10" min="1" max="100" step="1" />
        </div>
      </div>
      <button type="button" id="addProgramSetsBtn">Add Sets</button>
      <div id="programSetList" style="display: flex; flex-direction: column; gap: 8px; margin-top: 12px;"></div>
      <button type="button" id="saveProgramBtn" style="margin-top: 12px;">Save Program</button>
      <div id="programRunner" style="margin-top: 12px;"></div>
      <div id="programStatus" style="font-size: 0.82em; color: #495057; margin-top: 10px; min-height: 1.4em;"></div>
    `;

    if (exerciseSection?.nextSibling) {
      sidebarContent.insertBefore(section, exerciseSection.nextSibling);
    } else if (programSection) {
      sidebarContent.insertBefore(section, programSection);
    } else {
      sidebarContent.appendChild(section);
    }

    this.renderSetCategoryOptions();
  }

  injectHandlers() {
    document.getElementById("savedProgramSelector")?.addEventListener("change", (event) => this.selectProgram(event.target.value));
    document.getElementById("newProgramBtn")?.addEventListener("click", () => this.newProgram());
    document.getElementById("deleteProgramBtn")?.addEventListener("click", () => this.deleteSelectedProgram());
    document.getElementById("programSetCategory")?.addEventListener("change", () => this.renderSetExerciseOptions());
    document.getElementById("addProgramSetsBtn")?.addEventListener("click", () => this.addSetsFromInputs());
    document.getElementById("saveProgramBtn")?.addEventListener("click", () => this.saveCurrentProgram());
    document.getElementById("programNameInput")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.saveCurrentProgram();
      }
    });
  }

  patchAppMethods() {
    const originalStartProgram = this.app.startProgram.bind(this.app);
    this.app.startProgram = async () => {
      const currentSet = this.getActiveSet();
      await originalStartProgram();
      if (currentSet && this.app.currentWorkout) {
        const program = this.getSelectedProgram();
        this.app.currentWorkout.mode = `${program?.name || "Program"}: ${currentSet.name}`;
        this.app.currentWorkout.exerciseCategory = currentSet.category;
        this.app.currentWorkout.exerciseCategoryId = currentSet.categoryId;
        this.app.currentWorkout.exerciseName = currentSet.name;
        this.app.currentWorkout.programName = program?.name || "";
        this.app.currentWorkout.programSetIndex = this.activeSetIndex + 1;
        this.app.currentWorkout.programSetCount = program?.sets?.length || 0;
      }
    };

    const originalCompleteWorkout = this.app.completeWorkout.bind(this.app);
    this.app.completeWorkout = () => {
      const hadProgramWorkout = Boolean(this.app.currentWorkout?.programName);
      originalCompleteWorkout();
      if (hadProgramWorkout) this.advanceAfterCompletion();
    };
  }

  patchPersistenceMethods() {
    if (!this.persistence) return;

    const originalApplySettings = this.persistence.applySettings.bind(this.persistence);
    this.persistence.applySettings = () => {
      originalApplySettings();
      this.loadProgramsFromSettings();
    };

    const originalImportCurrentLocalData = this.persistence.importCurrentLocalData.bind(this.persistence);
    this.persistence.importCurrentLocalData = async () => {
      await originalImportCurrentLocalData();
      await this.savePrograms();
    };
  }

  renderSetCategoryOptions() {
    const categorySelect = document.getElementById("programSetCategory");
    if (!categorySelect || !Array.isArray(EXERCISE_CATALOG)) return;

    categorySelect.innerHTML = "";
    for (const category of EXERCISE_CATALOG) {
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = category.label;
      categorySelect.appendChild(option);
    }
    this.renderSetExerciseOptions();
  }

  renderSetExerciseOptions(selectedExercise = "") {
    const categorySelect = document.getElementById("programSetCategory");
    const exerciseSelect = document.getElementById("programSetExercise");
    if (!categorySelect || !exerciseSelect) return;

    const category = this.getExerciseCategory(categorySelect.value) || EXERCISE_CATALOG[0];
    exerciseSelect.innerHTML = "";
    for (const exercise of category.exercises) {
      const option = document.createElement("option");
      option.value = exercise;
      option.textContent = exercise;
      exerciseSelect.appendChild(option);
    }
    if (selectedExercise && category.exercises.includes(selectedExercise)) exerciseSelect.value = selectedExercise;
  }

  getExerciseCategory(categoryId) {
    return EXERCISE_CATALOG.find((category) => category.id === categoryId) || null;
  }

  getSelectedProgram() {
    return this.programs.find((program) => program.id === this.selectedProgramId) || null;
  }

  getActiveSet() {
    const program = this.getSelectedProgram();
    if (!program?.sets?.length) return null;
    return program.sets[this.activeSetIndex] || program.sets[0] || null;
  }

  newProgram() {
    this.selectedProgramId = "";
    this.activeSetIndex = 0;
    this.setInputValue("programNameInput", "");
    this.render();
    this.setStatus("New program ready.");
  }

  selectProgram(programId) {
    this.selectedProgramId = programId;
    this.activeSetIndex = 0;
    const program = this.getSelectedProgram();
    this.setInputValue("programNameInput", program?.name || "");
    this.render();
    if (program?.sets?.length) this.applyProgramSet(0);
  }

  addSetsFromInputs() {
    const categoryId = document.getElementById("programSetCategory")?.value || "chest";
    const category = this.getExerciseCategory(categoryId) || EXERCISE_CATALOG[0];
    const exerciseName = document.getElementById("programSetExercise")?.value || category.exercises[0];
    const count = parseInt(document.getElementById("programSetCount")?.value || "1", 10);
    const reps = parseInt(document.getElementById("programSetReps")?.value || "10", 10);
    const displayWeight = parseFloat(document.getElementById("programSetWeight")?.value || "0");
    const weightKg = this.app.convertDisplayToKg(displayWeight);

    if (!Number.isInteger(count) || count < 1 || count > 20) {
      this.setStatus("Enter 1-20 sets.", "error");
      return;
    }
    if (!Number.isInteger(reps) || reps < 1 || reps > 100) {
      this.setStatus("Enter 1-100 reps.", "error");
      return;
    }
    if (Number.isNaN(weightKg) || weightKg < 0 || weightKg > 100) {
      this.setStatus(`Enter a valid weight (${this.app.getWeightRangeText()}).`, "error");
      return;
    }

    const program = this.ensureDraftProgram();
    for (let i = 0; i < count; i++) {
      program.sets.push({
        id: this.createId(),
        categoryId: category.id,
        category: category.label,
        name: exerciseName,
        weightKg,
        reps,
      });
    }
    this.activeSetIndex = Math.max(0, program.sets.length - count);
    this.render();
    this.applyProgramSet(this.activeSetIndex);
    this.setStatus(`${count} set${count === 1 ? "" : "s"} added. Save the program when ready.`, "success");
  }

  ensureDraftProgram() {
    let program = this.getSelectedProgram();
    if (program) return program;

    const name = document.getElementById("programNameInput")?.value.trim() || "New Program";
    program = { id: this.createId(), name, sets: [] };
    this.programs.push(program);
    this.selectedProgramId = program.id;
    return program;
  }

  async saveCurrentProgram() {
    const program = this.ensureDraftProgram();
    const name = document.getElementById("programNameInput")?.value.trim();
    if (!name) {
      this.setStatus("Name the program first.", "error");
      return;
    }
    if (!program.sets.length) {
      this.setStatus("Add at least one set first.", "error");
      return;
    }

    program.name = name;
    await this.savePrograms();
    this.render();
    this.setStatus("Program saved to profile.", "success");
  }

  async deleteSelectedProgram() {
    const program = this.getSelectedProgram();
    if (!program) {
      this.newProgram();
      return;
    }
    this.programs = this.programs.filter((item) => item.id !== program.id);
    this.selectedProgramId = "";
    this.activeSetIndex = 0;
    await this.savePrograms();
    this.newProgram();
    this.setStatus("Program deleted.", "success");
  }

  removeSet(index) {
    const program = this.getSelectedProgram();
    if (!program) return;
    program.sets.splice(index, 1);
    this.activeSetIndex = Math.min(this.activeSetIndex, Math.max(0, program.sets.length - 1));
    this.render();
  }

  moveSet(index, direction) {
    const program = this.getSelectedProgram();
    if (!program) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= program.sets.length) return;
    const [set] = program.sets.splice(index, 1);
    program.sets.splice(nextIndex, 0, set);
    this.activeSetIndex = nextIndex;
    this.render();
  }

  applyProgramSet(index = this.activeSetIndex) {
    const program = this.getSelectedProgram();
    if (!program?.sets?.length) return;
    this.activeSetIndex = Math.max(0, Math.min(index, program.sets.length - 1));
    const set = program.sets[this.activeSetIndex];

    this.persistence?.applyExerciseSelection(set.categoryId, set.name);
    this.persistence?.saveExercisePreference();
    this.setInputValue("weight", this.app.formatWeightValue(set.weightKg, this.app.getWeightInputDecimals()));
    this.setInputValue("reps", String(set.reps));

    const justLiftCheckbox = document.getElementById("justLiftCheckbox");
    if (justLiftCheckbox?.checked) {
      justLiftCheckbox.checked = false;
      this.app.toggleJustLiftMode();
    }

    this.render();
    this.setStatus(`Loaded ${program.name}: set ${this.activeSetIndex + 1} of ${program.sets.length}.`, "success");
    this.app.addLogEntry(`Loaded ${program.name} set ${this.activeSetIndex + 1}: ${set.name}`, "info");
  }

  async startActiveSet() {
    this.applyProgramSet(this.activeSetIndex);
    await this.app.startProgram();
  }

  nextSet() {
    const program = this.getSelectedProgram();
    if (!program?.sets?.length) return;
    if (this.activeSetIndex >= program.sets.length - 1) {
      this.setStatus("Program complete.", "success");
      this.app.addLogEntry(`${program.name} complete.`, "success");
      return;
    }
    this.applyProgramSet(this.activeSetIndex + 1);
  }

  previousSet() {
    if (this.activeSetIndex <= 0) return;
    this.applyProgramSet(this.activeSetIndex - 1);
  }

  advanceAfterCompletion() {
    const program = this.getSelectedProgram();
    if (!program?.sets?.length) return;
    if (this.activeSetIndex < program.sets.length - 1) {
      this.applyProgramSet(this.activeSetIndex + 1);
      this.app.addLogEntry("Next program set is loaded.", "success");
    } else {
      this.setStatus(`${program.name} complete.`, "success");
      this.app.addLogEntry(`${program.name} complete.`, "success");
    }
  }

  render() {
    this.renderProgramSelector();
    this.renderSetList();
    this.renderRunner();
  }

  renderProgramSelector() {
    const selector = document.getElementById("savedProgramSelector");
    if (!selector) return;
    selector.innerHTML = '<option value="">New program</option>';
    for (const program of this.programs) {
      const option = document.createElement("option");
      option.value = program.id;
      option.textContent = `${program.name} (${program.sets.length})`;
      option.selected = program.id === this.selectedProgramId;
      selector.appendChild(option);
    }
  }

  renderSetList() {
    const list = document.getElementById("programSetList");
    if (!list) return;
    const program = this.getSelectedProgram();
    if (!program?.sets?.length) {
      list.innerHTML = '<div style="color: #6c757d; font-size: 0.85em; text-align: center; padding: 10px;">No sets added yet</div>';
      return;
    }

    list.innerHTML = program.sets.map((set, index) => `
      <div style="border: 1px solid ${index === this.activeSetIndex ? "#667eea" : "#e0e0e0"}; border-radius: 6px; padding: 10px; background: ${index === this.activeSetIndex ? "#f1f3ff" : "#f8f9fa"};">
        <div style="font-weight: 600; color: #212529; margin-bottom: 4px;">${index + 1}. ${this.escapeHtml(set.name)}</div>
        <div style="color: #6c757d; font-size: 0.85em; margin-bottom: 8px;">${this.escapeHtml(set.category)} &bull; ${this.escapeHtml(this.app.formatWeightWithUnit(set.weightKg))} &bull; ${Number(set.reps) || 0} reps</div>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;">
          <button type="button" onclick="workoutProgramManager.applyProgramSet(${index})" style="padding: 6px; margin: 0;">Load</button>
          <button type="button" class="secondary" onclick="workoutProgramManager.moveSet(${index}, -1)" style="padding: 6px; margin: 0;">Up</button>
          <button type="button" class="secondary" onclick="workoutProgramManager.moveSet(${index}, 1)" style="padding: 6px; margin: 0;">Down</button>
          <button type="button" class="secondary" onclick="workoutProgramManager.removeSet(${index})" style="padding: 6px; margin: 0;">Remove</button>
        </div>
      </div>
    `).join("");
  }

  renderRunner() {
    const runner = document.getElementById("programRunner");
    if (!runner) return;
    const program = this.getSelectedProgram();
    if (!program?.sets?.length) {
      runner.innerHTML = "";
      return;
    }
    const set = program.sets[this.activeSetIndex] || program.sets[0];
    runner.innerHTML = `
      <div style="background: #e7f5ff; border-left: 4px solid #1971c2; padding: 10px; border-radius: 6px; margin-bottom: 8px;">
        <div style="font-weight: 700; color: #1864ab; margin-bottom: 4px;">Set ${this.activeSetIndex + 1} of ${program.sets.length}</div>
        <div style="font-size: 0.9em; color: #212529;">${this.escapeHtml(set.name)} &bull; ${this.escapeHtml(this.app.formatWeightWithUnit(set.weightKg))} &bull; ${Number(set.reps) || 0} reps</div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
        <button type="button" class="secondary" onclick="workoutProgramManager.previousSet()" style="margin: 0;">Previous</button>
        <button type="button" class="secondary" onclick="workoutProgramManager.nextSet()" style="margin: 0;">Next</button>
      </div>
      <button type="button" onclick="workoutProgramManager.startActiveSet()">Start Loaded Set</button>
    `;
  }

  loadProgramsFromSettings() {
    const settingValue = this.persistence?.settings?.get(PROGRAMS_SETTING_KEY)?.value;
    if (!settingValue) {
      this.loadProgramsFromLocalStorage();
      this.render();
      return;
    }

    const programs = this.parsePrograms(settingValue);
    if (programs) {
      this.programs = programs;
      if (!this.programs.some((program) => program.id === this.selectedProgramId)) {
        this.selectedProgramId = this.programs[0]?.id || "";
      }
      this.activeSetIndex = 0;
      this.saveProgramsToLocalStorage();
      const program = this.getSelectedProgram();
      this.setInputValue("programNameInput", program?.name || "");
      this.render();
    }
  }

  loadProgramsFromLocalStorage() {
    try {
      const programs = this.parsePrograms(localStorage.getItem(PROGRAMS_STORAGE_KEY));
      if (programs) {
        this.programs = programs;
        this.selectedProgramId = this.programs[0]?.id || "";
        this.setInputValue("programNameInput", this.programs[0]?.name || "");
      }
    } catch {
      // Ignore localStorage errors.
    }
  }

  async savePrograms() {
    if (this.isSaving) return;
    this.isSaving = true;
    try {
      this.saveProgramsToLocalStorage();
      if (this.persistence?.selectedProfileId && this.persistence?.hasD1) {
        await this.persistence.saveSetting(PROGRAMS_SETTING_KEY, JSON.stringify(this.programs), "json");
      }
    } finally {
      this.isSaving = false;
    }
  }

  saveProgramsToLocalStorage() {
    try {
      localStorage.setItem(PROGRAMS_STORAGE_KEY, JSON.stringify(this.programs));
    } catch {
      // Ignore localStorage errors.
    }
  }

  parsePrograms(value) {
    if (!value) return null;
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) return null;
      return parsed
        .map((program) => ({
          id: String(program.id || this.createId()),
          name: String(program.name || "Program"),
          sets: Array.isArray(program.sets)
            ? program.sets.map((set) => ({
                id: String(set.id || this.createId()),
                categoryId: String(set.categoryId || set.exerciseCategoryId || "other"),
                category: String(set.category || set.exerciseCategory || "Other"),
                name: String(set.name || set.exerciseName || "Other"),
                weightKg: Number(set.weightKg) || 0,
                reps: Number(set.reps) || 1,
              }))
            : [],
        }))
        .filter((program) => program.name);
    } catch {
      return null;
    }
  }

  setStatus(message, type = "") {
    const status = document.getElementById("programStatus");
    if (!status) return;
    status.textContent = message;
    status.style.color = type === "error" ? "#c92a2a" : type === "success" ? "#2b8a3e" : "#495057";
  }

  setInputValue(id, value) {
    const input = document.getElementById(id);
    if (input && value !== undefined && value !== null) input.value = value;
  }

  createId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return `program-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}

function bootWorkoutPrograms() {
  if (typeof app === "undefined" || typeof persistence === "undefined" || typeof EXERCISE_CATALOG === "undefined") {
    setTimeout(bootWorkoutPrograms, 50);
    return;
  }

  window.workoutProgramManager = new WorkoutProgramManager(app, persistence);
  window.workoutProgramManager.init();
}

bootWorkoutPrograms();
