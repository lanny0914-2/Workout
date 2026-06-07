import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const distDir = path.join(root, "dist");
const persistenceScriptSrc = "persistence.js?v=exercise-history-20260607";
const staticAssets = [
  "app.js",
  "chart.js",
  "device.js",
  "modes.js",
  "protocol.js",
  "persistence.js",
];

await mkdir(distDir, { recursive: true });

await Promise.all(
  staticAssets.map((asset) =>
    copyFile(path.join(root, asset), path.join(distDir, asset)),
  ),
);

const indexPath = path.join(distDir, "index.html");
const html = await readFile(indexPath, "utf8");
const persistenceScriptPattern = /src=["']persistence\.js(?:[?#][^"']*)?["']/;
const versionedHtml = persistenceScriptPattern.test(html)
  ? html.replace(persistenceScriptPattern, `src="${persistenceScriptSrc}"`)
  : html.replace(
      '<script src="app.js"></script>',
      `<script src="app.js"></script>\n        <script src="${persistenceScriptSrc}"></script>`,
    );

if (versionedHtml !== html) {
  await writeFile(indexPath, versionedHtml);
}

console.log(`Copied ${staticAssets.length} static JS assets to dist.`);
