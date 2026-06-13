import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const distDir = path.join(root, "dist");
const scriptSources = {
  "rep-recorder.js": "rep-recorder.js?v=load-recorder-20260613",
  "persistence.js": "persistence.js?v=load-reporting-20260613",
  "rep-history-bridge.js": "rep-history-bridge.js?v=load-bridge-20260613",
  "load-reporting.js": "load-reporting.js?v=load-reporting-20260613",
  "programs.js": "programs.js?v=profile-program-editor-20260607",
};
const staticAssets = [
  "app.js",
  "chart.js",
  "device.js",
  "load-reporting.js",
  "modes.js",
  "programs.js",
  "protocol.js",
  "persistence.js",
  "rep-history-bridge.js",
  "rep-recorder.js",
];

await mkdir(distDir, { recursive: true });

await Promise.all(
  staticAssets.map((asset) =>
    copyFile(path.join(root, asset), path.join(distDir, asset)),
  ),
);

const indexPath = path.join(distDir, "index.html");
let html = await readFile(indexPath, "utf8");

for (const [fileName, src] of Object.entries(scriptSources)) {
  const pattern = new RegExp(`src=["']${fileName.replace(".", "\\.")}(?:[?#][^"']*)?["']`);
  if (pattern.test(html)) {
    html = html.replace(pattern, `src="${src}"`);
  }
}

const requiredOrder = [
  "rep-recorder.js",
  "persistence.js",
  "rep-history-bridge.js",
  "load-reporting.js",
  "programs.js",
];
const requiredTags = requiredOrder.map((fileName) => `        <script src="${scriptSources[fileName]}"></script>`).join("\n");
const firstRequiredPattern = /\s*<script src="rep-recorder\.js(?:[?#][^"]*)?"><\/script>[\s\S]*?<script src="programs\.js(?:[?#][^"]*)?"><\/script>/;

if (firstRequiredPattern.test(html)) {
  html = html.replace(firstRequiredPattern, `\n${requiredTags}`);
} else {
  html = html.replace(
    /\s*<script src="persistence\.js(?:[?#][^"]*)?"><\/script>(?:\s*<script src="programs\.js(?:[?#][^"]*)?"><\/script>)?\s*<\/body>/,
    `\n${requiredTags}\n    </body>`,
  );
}

await writeFile(indexPath, html);

console.log(`Copied ${staticAssets.length} static JS assets to dist.`);
