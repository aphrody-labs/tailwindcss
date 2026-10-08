// Merge upstream tailwindlabs/tailwindcss into the fork and keep it on Bun.
//
//   bun scripts/aphrody/sync-upstream.ts [--push] [--dry-run] [--keep-conflicts]
//       [--root <dir>] [--remote upstream] [--ref upstream/main] [--branch main] [--no-fetch] [--no-install] [--no-index]
//
// What the fork changes mechanically, and how a merge keeps it:
// - package.json scripts (bunify.ts): conflicted manifests are retried as a
//   three-way merge whose base and upstream side went through `rewrite()` first,
//   so only real divergences remain; manifests upstream adds are bunified after.
// - pnpm-workspace.yaml / pnpm-lock.yaml are deleted in the fork. Upstream edits
//   to the workspace file are folded into the root package.json (workspaces.ts
//   `applyPnpm`) and both files are removed again; bun.lock is refreshed with
//   `bun install --lockfile-only`.
// Anything still conflicting stops the sync (exit 2) with the merge aborted,
// unless --keep-conflicts.

import { join } from "node:path";
import { apply, rewrite } from "./bunify.ts";
import { check } from "./scope.ts";
import { applyPnpm } from "./workspaces.ts";

const PNPM_WORKSPACE = "pnpm-workspace.yaml";
const PNPM_LOCK = "pnpm-lock.yaml";

type Options = {
  root: string;
  remote: string;
  ref: string;
  branch: string;
  fetch: boolean;
  push: boolean;
  dryRun: boolean;
  keepConflicts: boolean;
  install: boolean;
  index: boolean;
};

export type SyncResult =
  | { status: "up-to-date"; behind: 0 }
  | { status: "merged"; behind: number; commit: string; resolved: string[]; pushed: boolean }
  | { status: "dry-run"; behind: number; conflicts: string[] }
  | { status: "conflicts"; behind: number; conflicts: string[] };

export function parseArgs(argv: string[]): Options {
  let value = (flag: string, fallback: string) => {
    let i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  let remote = value("--remote", "upstream");
  return {
    root: value("--root", join(import.meta.dir, "..", "..")),
    remote,
    ref: value("--ref", `${remote}/main`),
    branch: value("--branch", "main"),
    fetch: !argv.includes("--no-fetch"),
    push: argv.includes("--push"),
    dryRun: argv.includes("--dry-run"),
    keepConflicts: argv.includes("--keep-conflicts"),
    install: !argv.includes("--no-install"),
    index: !argv.includes("--no-index"),
  };
}

function git(root: string, args: string[], input?: string) {
  let proc = Bun.spawnSync(["git", ...args], {
    cwd: root,
    stdin: input === undefined ? "ignore" : Buffer.from(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

function gitOk(root: string, args: string[]): string {
  let r = git(root, args);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed (exit ${r.code}): ${r.err.trim()}`);
  return r.out.trim();
}

/** Blob of `path` at `rev`, or null when absent. */
function show(root: string, spec: string): string | null {
  let r = git(root, ["show", spec]);
  return r.code === 0 ? r.out : null;
}

/**
 * Upstream's view of a file after the fork's mechanical rewrite. The root
 * package.json also absorbs that side's pnpm-workspace.yaml, as the fork does.
 */
export function forkView(path: string, text: string, pnpmYaml: string | null): string {
  let out = rewrite(path, text);
  if (path === "package.json" && pnpmYaml) out = applyPnpm(out, pnpmYaml);
  return out;
}

async function resolveRewritten(root: string, path: string, revs: { base: string; theirs: string }) {
  let base = show(root, `:1:${path}`);
  let ours = show(root, `:2:${path}`);
  let theirs = show(root, `:3:${path}`);
  if (base === null || ours === null || theirs === null) return false;
  let tmp = join(root, ".git", "aphrody-sync");
  let files = { ours: join(tmp, "ours"), base: join(tmp, "base"), theirs: join(tmp, "theirs") };
  await Bun.write(files.ours, ours);
  await Bun.write(files.base, forkView(path, base, show(root, `${revs.base}:${PNPM_WORKSPACE}`)));
  await Bun.write(files.theirs, forkView(path, theirs, show(root, `${revs.theirs}:${PNPM_WORKSPACE}`)));
  let merged = Bun.spawnSync(["git", "merge-file", "-p", files.ours, files.base, files.theirs], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (merged.exitCode !== 0) return false;
  await Bun.write(join(root, path), merged.stdout);
  gitOk(root, ["add", "--", path]);
  return true;
}

/** Folds upstream's pnpm-workspace.yaml into package.json and drops the pnpm files again. */
async function dropPnpm(root: string, ref: string, base: string): Promise<string[]> {
  let touched: string[] = [];
  let theirsYaml = show(root, `${ref}:${PNPM_WORKSPACE}`);
  let baseYaml = show(root, `${base}:${PNPM_WORKSPACE}`);
  if (theirsYaml !== null && theirsYaml !== baseYaml) {
    let pkgPath = join(root, "package.json");
    await Bun.write(pkgPath, applyPnpm(await Bun.file(pkgPath).text(), theirsYaml));
    gitOk(root, ["add", "--", "package.json"]);
    touched.push("package.json");
  }
  for (let file of [PNPM_WORKSPACE, PNPM_LOCK]) {
    if (
      git(root, ["ls-files", "--error-unmatch", "--", file]).code === 0 ||
      git(root, ["ls-files", "-u", "--", file]).out
    ) {
      gitOk(root, ["rm", "--quiet", "--force", "--ignore-unmatch", "--", file]);
      touched.push(file);
    }
  }
  return touched;
}

export async function sync(opts: Options): Promise<SyncResult> {
  let { root } = opts;
  if (gitOk(root, ["status", "--porcelain", "--untracked-files=no"]) !== "") {
    throw new Error("working tree has uncommitted changes to tracked files; commit them first");
  }
  let current = gitOk(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (current !== opts.branch) throw new Error(`on branch "${current}", expected "${opts.branch}"`);
  if (opts.fetch) gitOk(root, ["fetch", "--quiet", opts.remote]);

  let behind = Number(gitOk(root, ["rev-list", "--count", `HEAD..${opts.ref}`]));
  if (behind === 0) return { status: "up-to-date", behind: 0 };

  let upstreamHead = gitOk(root, ["rev-parse", "--short", opts.ref]);
  let base = gitOk(root, ["merge-base", "HEAD", opts.ref]);
  let merge = git(root, ["merge", "--no-ff", "--no-commit", opts.ref]);
  let conflicted = gitOk(root, ["diff", "--name-only", "--diff-filter=U"]).split("\n").filter(Boolean);
  if (merge.code !== 0 && conflicted.length === 0) {
    git(root, ["merge", "--abort"]);
    throw new Error(`git merge ${opts.ref} failed: ${merge.err.trim() || merge.out.trim()}`);
  }

  let resolved: string[] = [];
  let conflicts: string[] = [];
  for (let path of conflicted) {
    if (path === PNPM_WORKSPACE || path === PNPM_LOCK) continue;
    if (await resolveRewritten(root, path, { base, theirs: opts.ref })) resolved.push(path);
    else conflicts.push(path);
  }

  if (opts.dryRun || conflicts.length) {
    if (!(conflicts.length && opts.keepConflicts)) git(root, ["merge", "--abort"]);
    return opts.dryRun && !conflicts.length
      ? { status: "dry-run", behind, conflicts }
      : { status: "conflicts", behind, conflicts };
  }

  resolved.push(...(await dropPnpm(root, opts.ref, base)));

  let bunified = await apply(root, true);
  if (bunified.length) gitOk(root, ["add", "--", ...bunified]);
  let leftover = await apply(root, false);
  if (leftover.length) {
    git(root, ["merge", "--abort"]);
    throw new Error(`bunify rewrite is not idempotent for: ${leftover.join(", ")}`);
  }
  let problems = check(root);
  if (problems.length) {
    git(root, ["merge", "--abort"]);
    throw new Error(`scope check failed:\n${problems.join("\n")}`);
  }

  if (opts.install) {
    let install = Bun.spawnSync(["bun", "install", "--lockfile-only"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    if (install.exitCode !== 0) {
      git(root, ["merge", "--abort"]);
      throw new Error(`bun install --lockfile-only failed: ${install.stderr.toString().trim()}`);
    }
    gitOk(root, ["add", "--", "bun.lock"]);
  }

  let lines = [`Merge ${opts.ref} (${upstreamHead}) into ${opts.branch}`, ""];
  lines.push(`${behind} upstream commit(s).`);
  if (resolved.length) lines.push(`Resolved for the Bun fork: ${resolved.join(", ")}.`);
  if (bunified.length) lines.push(`Bunified: ${bunified.join(", ")}.`);
  let commit = git(root, ["commit", "--quiet", "-F", "-"], lines.join("\n") + "\n");
  if (commit.code !== 0) throw new Error(`git commit failed: ${commit.err.trim()}`);
  let head = gitOk(root, ["rev-parse", "--short", "HEAD"]);

  let pushed = false;
  if (opts.push) {
    gitOk(root, ["push", "--quiet", "origin", opts.branch]);
    pushed = true;
  }
  if (opts.index) refreshIndex(root, head);
  return { status: "merged", behind, commit: head, resolved, pushed };
}

// Optional: keep the aphrody memory in step. A missing or failing `aphrody` never fails the sync.
function refreshIndex(root: string, head: string) {
  if (!Bun.which("aphrody")) return;
  let note = `tailwindcss upstream sync merged at ${head} on ${new Date().toISOString()}.`;
  Bun.spawnSync(
    [
      "aphrody",
      "memory",
      "write",
      "--agent-id",
      "bun",
      "--id",
      "tailwindcss-upstream-sync-last",
      "--tag",
      "tailwindcss",
      "--tag",
      "sync",
      "--content",
      "-",
    ],
    { cwd: root, stdin: Buffer.from(note), stdout: "ignore", stderr: "ignore" },
  );
}

if (import.meta.main) {
  let opts = parseArgs(process.argv.slice(2));
  try {
    let result = await sync(opts);
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "conflicts") {
      console.error(
        `${result.conflicts.length} file(s) conflict beyond the Bun rewrite; ` +
          (opts.keepConflicts ? "the merge is left in progress." : "the merge was aborted."),
      );
      process.exit(2);
    }
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    process.exit(1);
  }
}
