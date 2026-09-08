import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  parseFrontmatter,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import registerReadOnlyGit from "../extensions/read-only-git.ts";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "pi-read-only-git-"));
const repo = path.join(temp, "repo");
const childRepo = path.join(temp, "child");
const agentDir = path.join(temp, "agent");
const sentinel = path.join(temp, "helper-ran");
const protectedEnvironment = [
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_KEY_0",
  "GIT_CONFIG_VALUE_0",
  "GIT_EXTERNAL_DIFF",
  "GIT_PAGER",
  "GIT_TRACE",
  "PAGER",
  "PATH",
];
const originalEnvironment = new Map(protectedEnvironment.map((name) => [name, process.env[name]]));
const restoreEnvironment = () => {
  for (const [name, value] of originalEnvironment) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
};
let registeredTool;

registerReadOnlyGit({
  registerTool(tool) {
    assert.equal(tool.name, "read_only_git");
    registeredTool = tool;
  },
});
assert.ok(registeredTool, "The extension must register its public tool");

const execGit = (cwd, args, options = {}) => execFileSync("git", args, {
  cwd,
  encoding: "utf8",
  stdio: "pipe",
  ...options,
}).trim();
const git = (...args) => execGit(repo, args);
const call = async (params, signal) => registeredTool.execute("test", params, signal, undefined, { cwd: repo });
const text = (result) => result.content[0].text;
const pageText = (result) => text(result).replace(/\n\[Byte slice \d+:\d+ of \d+\. Request another offset to continue\.\]$/, "");
const parseTools = async (profile) => {
  const source = await readFile(path.join(root, "agents", profile), "utf8");
  const { frontmatter } = parseFrontmatter(source);
  return String(frontmatter.tools).split(",").map((name) => name.trim());
};

try {
  execFileSync("git", ["init", "--quiet", childRepo]);
  execGit(childRepo, ["config", "user.name", "Child Test"]);
  execGit(childRepo, ["config", "user.email", "child@example.test"]);
  await writeFile(path.join(childRepo, "version.txt"), "one\n");
  execGit(childRepo, ["add", "."]);
  execGit(childRepo, ["commit", "--quiet", "-m", "child one"]);
  const childOne = execGit(childRepo, ["rev-parse", "HEAD"]);
  await writeFile(path.join(childRepo, "version.txt"), "two\n");
  execGit(childRepo, ["commit", "--quiet", "-am", "child two"]);
  const childTwo = execGit(childRepo, ["rev-parse", "HEAD"]);

  execFileSync("git", ["init", "--quiet", repo]);
  git("config", "user.name", "Read Only Test");
  git("config", "user.email", "read-only@example.test");
  await writeFile(path.join(repo, ".gitattributes"), "*.special diff=evil\n*.txt filter=evil\n");
  await writeFile(path.join(repo, "file.txt"), "base\n");
  await writeFile(path.join(repo, "large.special"), `${"base-line\n".repeat(9000)}`);
  await writeFile(path.join(repo, "unicode.txt"), "initial\n");
  git("add", ".");
  git("update-index", "--add", "--cacheinfo", `160000,${childOne},vendor/sub`);
  git("commit", "--quiet", "-m", "base");
  const base = git("rev-parse", "HEAD");

  const unicodeContent = "α🙂漢字 café\n".repeat(80);
  await writeFile(path.join(repo, "file.txt"), "head\n");
  await writeFile(path.join(repo, "large.special"), `${"head-line\n".repeat(14000)}`);
  await writeFile(path.join(repo, "added.txt"), "committed content\n");
  await writeFile(path.join(repo, "unicode.txt"), unicodeContent);
  if (process.platform !== "win32") {
    await mkdir(path.join(repo, "literal"));
    await writeFile(path.join(repo, "literal", "name.txt"), "slash path\n");
    await writeFile(path.join(repo, "literal\\name.txt"), "literal backslash path\n");
  }
  git("add", ".");
  git("update-index", "--add", "--cacheinfo", `160000,${childTwo},vendor/sub`);
  git("commit", "--quiet", "-m", "head");
  const head = git("rev-parse", "HEAD");

  const helper = path.join(temp, process.platform === "win32" ? "helper.cmd" : "helper.sh");
  const localGit = path.join(repo, process.platform === "win32" ? "git.cmd" : "git");
  if (process.platform === "win32") {
    const command = `@echo invoked>${sentinel}\r\n@exit /b 99\r\n`;
    await writeFile(helper, command);
    await writeFile(localGit, command);
  } else {
    const command = `#!/bin/sh\nprintf invoked > '${sentinel}'\nexit 99\n`;
    await writeFile(helper, command);
    await writeFile(localGit, command);
    await chmod(helper, 0o755);
    await chmod(localGit, 0o755);
  }

  const unsigned = execGit(repo, ["cat-file", "commit", head]);
  const fakeSignature = "gpgsig -----BEGIN PGP SIGNATURE-----\n fake-signature\n -----END PGP SIGNATURE-----\n";
  const rawCommit = unsigned.replace("\n\n", `\n${fakeSignature}\n`);
  const signedCommit = execGit(repo, ["hash-object", "-t", "commit", "-w", "--stdin"], { input: rawCommit });

  await writeFile(path.join(repo, "file.txt"), "dirty worktree\n");
  await writeFile(path.join(repo, "staged.txt"), "staged and dirty\n");
  git("add", "staged.txt");
  await rm(path.join(repo, "added.txt"));
  await writeFile(path.join(repo, "untracked.txt"), "untracked\n");

  git("config", "diff.external", helper);
  git("config", "diff.evil.textconv", helper);
  git("config", "filter.evil.clean", helper);
  git("config", "filter.evil.process", helper);
  git("config", "core.fsmonitor", helper);
  git("config", "core.pager", helper);
  git("config", "pager.log", helper);
  git("config", "log.showSignature", "true");
  git("config", "gpg.program", helper);
  git("config", "remote.origin.promisor", "true");
  git("config", "remote.origin.partialclonefilter", "blob:none");
  git("config", "remote.origin.url", path.join(temp, "missing-remote"));
  git("config", "remote.origin.uploadpack", helper);

  await rm(sentinel, { force: true });
  try { git("-c", "core.fsmonitor=false", "status", "--short"); } catch {}
  assert.equal((await readFile(sentinel, "utf8")).trim(), "invoked", "Git status can invoke a configured clean/process filter");
  await rm(sentinel, { force: true });
  try { git("-c", "core.fsmonitor=false", "log", "-1", signedCommit); } catch {}
  assert.equal((await readFile(sentinel, "utf8")).trim(), "invoked", "Git log can invoke a configured signature program");
  await rm(sentinel, { force: true });

  const indexPath = path.join(repo, ".git", "index");
  const indexBefore = await readFile(indexPath);
  const indexMtimeBefore = (await stat(indexPath)).mtimeMs;
  const refsBefore = git("show-ref");
  const configBefore = await readFile(path.join(repo, ".git", "config"));
  const worktreeBefore = await readFile(path.join(repo, "file.txt"));
  await rm(sentinel, { force: true });

  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = "core.fsmonitor";
  process.env.GIT_CONFIG_VALUE_0 = helper;
  process.env.GIT_EXTERNAL_DIFF = helper;
  process.env.GIT_PAGER = helper;
  process.env.GIT_TRACE = sentinel;
  process.env.PAGER = helper;
  process.env.PATH = `.${path.delimiter}${path.delimiter}${process.env.PATH ?? ""}`;

  assert.equal(text(await call({ operation: "resolve", commit: "HEAD" })).trim(), head);
  assert.match(text(await call({ operation: "log", commit: signedCommit, maxCount: 1 })), new RegExp(`^${signedCommit}\\t`));
  assert.match(text(await call({ operation: "show", commit: head, path: "added.txt" })), /committed content/);
  if (process.platform !== "win32") {
    assert.equal(text(await call({ operation: "show", commit: head, path: "literal\\name.txt" })), "literal backslash path\n");
  }

  const files = text(await call({ operation: "files", commit: head }));
  assert.match(files, /^added\.txt$/m, "Committed files must include a file removed from the worktree");
  assert.doesNotMatch(files, /^untracked\.txt$/m, "Committed files must exclude worktree-only files");

  const names = text(await call({ operation: "diff", base, head, mode: "names" }));
  assert.match(names, /M\s+file\.txt/);
  assert.match(names, /M\s+vendor\/sub/);
  let completePatch = "";
  let completePatchOffset = 0;
  do {
    const page = await call({ operation: "diff", base, head, mode: "patch", offset: completePatchOffset });
    completePatch += pageText(page);
    completePatchOffset = page.details.nextOffset;
  } while (completePatchOffset !== undefined);
  assert.match(completePatch, new RegExp(`Subproject commit ${childOne}`));
  assert.match(completePatch, new RegExp(`Subproject commit ${childTwo}`));

  const patch = await call({ operation: "diff", base, head, mode: "patch", limit: 2048 });
  assert.match(text(patch), /diff --git a\//);
  assert.equal(patch.details.truncated, true);
  assert.equal(patch.details.nextOffset, 2048);
  assert.ok(patch.details.totalBytes > 2048);
  const laterPatch = await call({ operation: "diff", base, head, mode: "patch", offset: 2048, limit: 1024 });
  assert.equal(laterPatch.details.offset, 2048);
  assert.equal(laterPatch.details.endOffset, 3072);

  let unicodeRoundTrip = "";
  let unicodeOffset = 0;
  do {
    const page = await call({ operation: "show", commit: head, path: "unicode.txt", offset: unicodeOffset, limit: 17 });
    const content = pageText(page);
    assert.doesNotMatch(content, /�/, "UTF-8 page boundaries must not corrupt Unicode text");
    unicodeRoundTrip += content;
    unicodeOffset = page.details.nextOffset;
  } while (unicodeOffset !== undefined);
  assert.equal(unicodeRoundTrip, unicodeContent);

  for (const malicious of [
    { operation: "status" },
    { operation: "commit" },
    { operation: "reset" },
    { operation: "push" },
    { operation: "shell", command: "reset --hard" },
    { operation: "toString" },
    { operation: "resolve", commit: "HEAD~1" },
    { operation: "resolve", commit: "--help" },
    { operation: "show", commit: head, path: "../.git/config" },
    { operation: "show", commit: head, path: ":(attr)file.txt" },
    { operation: "diff", base: `${base}^`, head },
    { operation: "diff", base, head, mode: "--output=/tmp/x" },
    { operation: "log", commit: head, maxCount: 101 },
    { operation: "files", commit: head, command: "sh" },
    { operation: "files", commit: head, limit: 3 },
    { operation: "files", commit: "a".repeat(63) },
  ]) {
    await assert.rejects(call(malicious), /must|Unsupported|path|mode|maxCount|limit|operation/);
  }

  const controller = new AbortController();
  controller.abort(new Error("test cancellation"));
  await assert.rejects(call({ operation: "resolve", commit: "HEAD" }, controller.signal), /test cancellation/);
  const runningController = new AbortController();
  const runningCall = call({ operation: "diff", base, head }, runningController.signal);
  runningController.abort(new Error("running call cancellation"));
  await assert.rejects(runningCall, /running call cancellation/);

  await assert.rejects(
    call({ operation: "show", commit: "1".repeat(40), path: "file.txt" }),
    /Git show failed/,
  );
  await assert.rejects(
    call({ operation: "show", commit: "1".repeat(64), path: "file.txt" }),
    /Git show failed/,
  );
  await assert.rejects(stat(sentinel), { code: "ENOENT" });
  restoreEnvironment();

  assert.deepEqual(await readFile(indexPath), indexBefore, "Inspection must not change the index");
  assert.equal((await stat(indexPath)).mtimeMs, indexMtimeBefore, "Inspection must not refresh the index");
  assert.equal(git("show-ref"), refsBefore, "Inspection must not change refs");
  assert.deepEqual(await readFile(path.join(repo, ".git", "config")), configBefore, "Inspection must not change config");
  assert.deepEqual(await readFile(path.join(repo, "file.txt")), worktreeBefore, "Inspection must not change files");

  const missingBlob = git("rev-parse", `${head}:added.txt`);
  await rm(path.join(repo, ".git", "objects", missingBlob.slice(0, 2), missingBlob.slice(2)));
  git("config", "remote.origin.url", childRepo);
  await rm(sentinel, { force: true });
  try { git("show", `${head}:added.txt`); } catch {}
  assert.equal((await readFile(sentinel, "utf8")).trim(), "invoked", "An ordinary read of a missing promised blob can fetch through upload-pack");
  await rm(sentinel, { force: true });
  await assert.rejects(call({ operation: "show", commit: head, path: "added.txt" }), /Git show failed/);
  await assert.rejects(stat(sentinel), { code: "ENOENT" });

  const sha256Repo = path.join(temp, "sha256");
  execFileSync("git", ["init", "--quiet", "--object-format=sha256", sha256Repo]);
  execGit(sha256Repo, ["config", "user.name", "SHA256 Test"]);
  execGit(sha256Repo, ["config", "user.email", "sha256@example.test"]);
  await writeFile(path.join(sha256Repo, "file.txt"), "SHA256 content\n");
  execGit(sha256Repo, ["add", "."]);
  execGit(sha256Repo, ["commit", "--quiet", "-m", "base"]);
  const sha256 = execGit(sha256Repo, ["rev-parse", "HEAD"]);
  assert.equal(sha256.length, 64);
  const sha256Read = await registeredTool.execute("sha256", { operation: "show", commit: sha256, path: "file.txt" }, undefined, undefined, { cwd: sha256Repo });
  assert.equal(text(sha256Read), "SHA256 content\n");

  const helperTools = await parseTools("review-pass.md");
  const parentTools = await parseTools("reviewer.md");
  assert.deepEqual(helperTools, ["read", "grep", "find", "ls", "read_only_git"]);
  assert.ok(parentTools.includes("read_only_git"), "The parent profile must expose the tool source path");

  const settingsManager = SettingsManager.inMemory();
  const extensionPath = path.join(root, "extensions", "read-only-git.ts");
  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
    modelsStorePath: path.join(agentDir, "models-store.json"),
    allowModelNetwork: false,
  });
  const loaderOptions = {
    cwd: repo,
    agentDir,
    settingsManager,
    additionalExtensionPaths: [extensionPath],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  };
  const parentLoader = new DefaultResourceLoader(loaderOptions);
  await parentLoader.reload();
  const parent = await createAgentSession({
    cwd: repo,
    agentDir,
    tools: parentTools,
    resourceLoader: parentLoader,
    modelRuntime,
    sessionManager: SessionManager.inMemory(repo),
    settingsManager,
  });
  let sourcePath;
  try {
    assert.deepEqual(parent.extensionsResult.errors, []);
    const loaded = parent.extensionsResult.runtime.getAllTools().find((tool) => tool.name === "read_only_git");
    assert.ok(loaded, "The parent Pi consumer must load read_only_git");
    sourcePath = path.resolve(loaded.sourceInfo.path);
    assert.equal(sourcePath, extensionPath);
  } finally {
    parent.session.dispose();
  }

  const helperLoader = new DefaultResourceLoader({ ...loaderOptions, additionalExtensionPaths: [sourcePath] });
  await helperLoader.reload();
  const helperSession = await createAgentSession({
    cwd: repo,
    agentDir,
    tools: helperTools,
    resourceLoader: helperLoader,
    modelRuntime,
    sessionManager: SessionManager.inMemory(repo),
    settingsManager,
  });
  try {
    assert.deepEqual(helperSession.extensionsResult.errors, []);
    const activeNames = helperSession.session.agent.state.tools.map((tool) => tool.name).sort();
    assert.deepEqual(activeNames, [...helperTools].sort());
    for (const forbidden of ["bash", "safe_bash", "write", "edit", "powershell", "exec", "shell"]) {
      assert.equal(activeNames.includes(forbidden), false, `${forbidden} must not be exposed`);
    }
  } finally {
    helperSession.session.dispose();
  }

  console.log("Read-only Git tests passed: committed inspection is bounded, immutable, helper-free, and selected safely.");
} finally {
  restoreEnvironment();
  await rm(temp, { recursive: true, force: true });
}
