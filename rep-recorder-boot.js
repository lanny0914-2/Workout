// rep-recorder-boot.js - installs the shared recorder after app.js creates the app binding

(function bootRepRecorder() {
  if (typeof globalThis.installRepRecorder === "function" && typeof app !== "undefined") {
    globalThis.installRepRecorder(app);
    return;
  }
  setTimeout(bootRepRecorder, 50);
})();
