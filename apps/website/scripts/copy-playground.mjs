// Copy the playground build into public/play so the website serves it at /play.
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const from = fileURLToPath(new URL("../../playground/dist", import.meta.url));
const to = fileURLToPath(new URL("../public/play", import.meta.url));

if (!existsSync(from)) throw new Error(`Playground build not found at ${from}. Run the playground build first.`);
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log(`Copied playground to ${to}`);
