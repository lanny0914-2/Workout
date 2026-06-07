import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const distDir = path.join(root, "dist");
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
if (!html.includes('src="persistence.js"')) {
  await writeFile(
    indexPath,
    html.replace(
      '<script src="app.js"></script>',
      '<script src="app.js"></script>\n        <script src="persistence.js"></script>',
    ),
  );
}

console.log(`Copied ${staticAssets.length} static JS assets to dist.`);
