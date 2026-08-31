import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const settings = JSON.parse(await readFile(path.join(root, "config", "settings.json"), "utf8"));

assert.equal(packageJson.pi?.themes, undefined, "pi-setup must not publish themes managed by Dots");
assert.equal(settings.theme, "dots-system", "Pi settings should continue selecting the Dots-managed theme");

console.log("Theme ownership check passed: dots-system is selected here and supplied only by Dots.");
