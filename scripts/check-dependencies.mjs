import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const ignoredDirectories = new Set([".git", "node_modules"]);
const sourceExtensions = new Set([".js", ".cjs", ".mjs", ".ts", ".cts", ".mts", ".tsx"]);
const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

function isLegacyPiPackage(specifier) {
  return specifier === "@sinclair/typebox"
    || specifier.startsWith("@sinclair/typebox/")
    || specifier.startsWith("@mariozechner/pi-");
}

async function collectSourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(fullPath));
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function importedSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

const failures = [];
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

for (const field of dependencyFields) {
  for (const name of Object.keys(packageJson[field] ?? {})) {
    if (isLegacyPiPackage(name)) failures.push(`package.json ${field} contains ${name}`);
  }
}

for (const file of await collectSourceFiles(root)) {
  const source = await readFile(file, "utf8");
  for (const specifier of importedSpecifiers(source)) {
    if (isLegacyPiPackage(specifier)) {
      failures.push(`${path.relative(root, file)} imports ${specifier}`);
    }
  }
}

const lockPath = path.join(root, "package-lock.json");
const lock = JSON.parse(await readFile(lockPath, "utf8"));
for (const packagePath of Object.keys(lock.packages ?? {})) {
  const dependencyName = packagePath.match(/(?:^|\/)node_modules\/(?:[^/]+\/node_modules\/)*(@[^/]+\/[^/]+|[^/]+)$/)?.[1];
  if (dependencyName && isLegacyPiPackage(dependencyName)) {
    failures.push(`package-lock.json resolves ${dependencyName} at ${packagePath}`);
  }
}

if (failures.length > 0) {
  console.error("Legacy Pi dependencies are forbidden:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error("\nUse @earendil-works Pi packages and typebox instead.");
  process.exit(1);
}

console.log("Dependency guard passed: no legacy Pi imports or dependencies found.");
