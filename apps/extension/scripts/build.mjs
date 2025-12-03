import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const root = join(__dirname, "..");
const outdir = join(root, "extension");

await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [join(root, "src/main.ts")],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  outfile: join(outdir, "main.js"),
  sourcemap: true,
  logLevel: "info",
});
