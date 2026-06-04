import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const distDir = path.join(root, "dist");
const staticAssets = [
  "app.js",
  "chart.js",
  "device.js",
  "modes.js",
  "protocol.js",
];

await mkdir(distDir, { recursive: true });

await Promise.all(
  staticAssets.map((asset) =>
    copyFile(path.join(root, asset), path.join(distDir, asset)),
  ),
);

console.log(`Copied ${staticAssets.length} static JS assets to dist.`);
