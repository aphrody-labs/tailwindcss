// Publishes the fork's npm packages under @aphrody (see scope.ts).
//
// Each public workspace is copied to dist/aphrody/<name>/ with a rewritten
// manifest: @aphrody name, `<upstream>-aphrody.<n>` version, `workspace:` deps
// turned into exact npm aliases (`"tailwindcss": "npm:@aphrody/tailwindcss@<v>"`),
// `catalog:` resolved from the root catalog, `publishConfig` fields applied,
// scripts and devDependencies dropped. Versions already on the registry are
// skipped, so a failed run can be resumed.
//
// Platform packages (crates/node/npm/*) need their .node/.wasm built first (the
// release workflow downloads them there). Missing binaries are skipped unless
// --require-native.
//
//   bun scripts/aphrody/publish-npm.ts [--version=4.3.3-aphrody.1] [--dry-run] [--require-native] [--tag=latest]

import { Glob } from "bun";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { forkVersion, publicWorkspaces, REPOSITORY, scopedName, type Workspace } from "./scope.ts";
import { ROOT } from "./workspaces.ts";

const REGISTRY = (process.env.NPM_CONFIG_REGISTRY ?? "https://registry.npmjs.org").replace(/\/$/, "");
const DEP_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"] as const;

export function rootCatalog(root = ROOT): Record<string, string> {
  let pkg = JSON.parse(require("node:fs").readFileSync(join(root, "package.json"), "utf8"));
  return pkg.workspaces?.catalog ?? pkg.catalog ?? {};
}

/** The manifest published for `w` at fork version `version`. */
export function stagedManifest(
  w: Workspace,
  version: string,
  names: Set<string>,
  catalog: Record<string, string>,
): any {
  let { scripts, devDependencies, publishConfig = {}, ...pkg } = structuredClone(w.manifest);
  let { provenance, access, ...overrides } = publishConfig;
  Object.assign(pkg, overrides);
  pkg.name = scopedName(w.name);
  pkg.version = version;
  pkg.publishConfig = { access: "public" };
  pkg.repository = { type: "git", url: `git+${REPOSITORY}.git`, directory: w.rel };
  pkg.bugs = `${REPOSITORY}/issues`;
  if (pkg.napi?.packageName) pkg.napi.packageName = scopedName(pkg.napi.packageName);
  for (let field of DEP_FIELDS) {
    let deps = pkg[field];
    if (!deps) continue;
    for (let [dep, spec] of Object.entries<string>(deps)) {
      if (names.has(dep)) deps[dep] = `npm:${scopedName(dep)}@${version}`;
      else if (spec.startsWith("catalog:")) {
        let resolved = catalog[dep];
        if (!resolved) throw new Error(`${w.rel}: ${field}.${dep} is catalog: but the root catalog has no entry`);
        deps[dep] = resolved;
      } else if (spec.startsWith("workspace:")) {
        throw new Error(`${w.rel}: ${field}.${dep} is a private workspace package`);
      }
    }
  }
  return pkg;
}

/** napi's loader pins the binding version it expects; keep it in sync with the fork version. */
export function patchLoader(source: string, base: string, version: string): string {
  return source.replaceAll(`'${base}'`, `'${version}'`).replaceAll(`expected ${base} `, `expected ${version} `);
}

function filesOf(w: Workspace): string[] {
  let out = new Set<string>(["package.json"]);
  for (let extra of ["README.md", "LICENSE"]) if (existsSync(join(w.dir, extra))) out.add(extra);
  for (let entry of w.manifest.files ?? []) {
    let pattern = entry.replace(/^\.\//, "").replace(/\/$/, "");
    let glob = new Glob(existsSync(join(w.dir, pattern)) && !pattern.includes("*") ? `${pattern}{,/**}` : pattern);
    for (let f of glob.scanSync({ cwd: w.dir, onlyFiles: true, dot: true })) out.add(f.replaceAll("\\", "/"));
  }
  return [...out];
}

function isPlatformPackage(w: Workspace) {
  return w.rel.startsWith("crates/node/npm/");
}

/** Platform packages first, then oxide, tailwindcss, @tailwindcss/node, then everything else. */
export function publishOrder(ws: Workspace[]): Workspace[] {
  let rank = (w: Workspace) =>
    isPlatformPackage(w)
      ? 0
      : w.name === "@tailwindcss/oxide"
        ? 1
        : w.name === "tailwindcss"
          ? 2
          : w.name === "@tailwindcss/node"
            ? 3
            : 4;
  return [...ws].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export async function isPublished(name: string, version: string): Promise<boolean> {
  let res = await fetch(`${REGISTRY}/${name.replace("/", "%2f")}/${version}`);
  return res.ok;
}

/** Next `<base>-aphrody.<n>` not yet on the registry for @aphrody/tailwindcss. */
export async function nextVersion(base: string): Promise<string> {
  let res = await fetch(`${REGISTRY}/${scopedName("tailwindcss").replace("/", "%2f")}`);
  let versions: string[] = res.ok ? Object.keys(((await res.json()) as any).versions ?? {}) : [];
  let prefix = forkVersion(base, 0).replace(/0$/, "");
  let n = Math.max(0, ...versions.filter(v => v.startsWith(prefix)).map(v => Number(v.slice(prefix.length)) || 0));
  return forkVersion(base, n + 1);
}

async function main() {
  let args = process.argv.slice(2);
  let flag = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  let dryRun = args.includes("--dry-run");
  let requireNative = args.includes("--require-native");
  let tag = flag("tag") ?? "latest";

  let workspaces = publicWorkspaces();
  let base = workspaces.find(w => w.name === "tailwindcss")!.version;
  let version = flag("version") ?? (await nextVersion(base));
  let names = new Set(workspaces.map(w => w.name));
  let catalog = rootCatalog();
  let stageRoot = join(ROOT, "dist", "aphrody");
  rmSync(stageRoot, { recursive: true, force: true });
  console.log(`publishing ${version} (upstream ${base}) with tag ${tag}${dryRun ? " (dry run)" : ""}`);

  let failed: string[] = [];
  for (let w of publishOrder(workspaces)) {
    let name = scopedName(w.name);
    if (isPlatformPackage(w)) {
      let missing = (w.manifest.files ?? [w.manifest.main]).filter((f: string) => !existsSync(join(w.dir, f)));
      if (missing.length) {
        let msg = `${name}: missing ${missing.join(", ")} (build the binding first)`;
        if (requireNative) failed.push(msg);
        console.warn(`skip ${msg}`);
        continue;
      }
    }
    if (!dryRun && (await isPublished(name, version))) {
      console.log(`skip ${name}@${version}: already published`);
      continue;
    }
    let stage = join(stageRoot, name.replace("/", "__"));
    for (let f of filesOf(w)) {
      if (f === "package.json") continue;
      mkdirSync(dirname(join(stage, f)), { recursive: true });
      cpSync(join(w.dir, f), join(stage, f));
    }
    await Bun.write(
      join(stage, "package.json"),
      JSON.stringify(stagedManifest(w, version, names, catalog), null, 2) + "\n",
    );
    if (w.name === "@tailwindcss/oxide" && existsSync(join(stage, "index.js"))) {
      let loader = join(stage, "index.js");
      await Bun.write(loader, patchLoader(await Bun.file(loader).text(), base, version));
    }
    let cmd = ["bun", "publish", "--access", "public", "--tag", tag, ...(dryRun ? ["--dry-run"] : [])];
    let proc = Bun.spawnSync(cmd, { cwd: stage, stdout: "inherit", stderr: "inherit", env: process.env });
    if (proc.exitCode !== 0) failed.push(`${name}: bun publish exited ${proc.exitCode}`);
    else console.log(`${dryRun ? "staged" : "published"} ${name}@${version}`);
  }
  for (let f of failed) console.error(f);
  if (failed.length) process.exit(1);
}

if (import.meta.main) await main();
