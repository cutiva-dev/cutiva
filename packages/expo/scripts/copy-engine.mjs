// Copies the Android engine's sources into android/engine before packing, so the npm package
// builds without the monorepo (android/build.gradle reads them from there).
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "..", "engine-android");
const to = join(root, "android", "engine");
rmSync(to, { recursive: true, force: true });
for (const mod of ["engine", "reframe"]) cpSync(join(from, mod, "src", "main", "kotlin"), join(to, mod, "src", "main", "kotlin"), { recursive: true });
