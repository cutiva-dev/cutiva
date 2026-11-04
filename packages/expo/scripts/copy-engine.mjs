// Before packing, copies the native engines' sources into the package so it builds without the
// monorepo: the Android engine into android/engine (android/build.gradle reads it from there) and
// the iOS engine into ios/Engine (the podspec compiles it; in the monorepo the podspec fills
// ios/Engine with symlinks instead). With `--restore` (postpack), removes the iOS copy so the
// next `pod install` links the sources again.
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const iosEngine = join(root, "ios", "Engine");

if (process.argv.includes("--restore")) {
  rmSync(iosEngine, { recursive: true, force: true });
} else {
  const android = join(root, "..", "engine-android");
  const to = join(root, "android", "engine");
  rmSync(to, { recursive: true, force: true });
  for (const mod of ["engine", "reframe"]) cpSync(join(android, mod, "src", "main", "kotlin"), join(to, mod, "src", "main", "kotlin"), { recursive: true });

  rmSync(iosEngine, { recursive: true, force: true });
  cpSync(join(root, "..", "engine-ios", "Sources", "CutivaEngine"), iosEngine, { recursive: true, dereference: true });
}
