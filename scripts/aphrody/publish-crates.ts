// Publishes the oxide crates to crates.io under aphrody-tailwindcss-* (see scope.ts).
//
// Each crate is copied to dist/aphrody-crates/<name>/ with a rewritten
// Cargo.toml: new package name, `[lib] name` kept so `use ignore::...` still
// compiles, path dependencies on sibling crates turned into
// `<lib> = { package = "<new name>", version = "=<v>" }`, and the metadata
// crates.io requires. Versions already on crates.io are skipped.
//
//   bun scripts/aphrody/publish-crates.ts [--version=4.3.3-aphrody.1] [--dry-run]
//
// --version publishes every crate at the npm release version, so crates and
// @aphrody/tailwindcss-oxide move together; without it the Cargo.toml versions are used.

import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CRATES, REPOSITORY, type Crate } from "./scope.ts";
import { ROOT } from "./workspaces.ts";

export function crateVersion(toml: string): string {
  let m = /^\[package\][^[]*?^version\s*=\s*"([^"]+)"/ms.exec(toml);
  if (!m) throw new Error("Cargo.toml has no [package] version");
  return m[1];
}

/** Cargo.toml of the staged crate. `versions` maps upstream crate names to the versions being published. */
export function stagedToml(crate: Crate, toml: string, versions: Record<string, string>): string {
  let out = toml
    .replace(/^(\[package\][^[]*?^name\s*=\s*)"[^"]+"/ms, `$1"${crate.name}"`)
    .replace(/^(\[package\][^[]*?^version\s*=\s*)"[^"]+"/ms, `$1"${versions[crate.upstream]}"`);
  let set = (key: string, value: string) => {
    let re = new RegExp(`^${key}\\s*=\\s*(?:"""[\\s\\S]*?"""|"[^"]*")[^\\n]*$`, "m");
    let line = `${key} = ${JSON.stringify(value)}`;
    let pkgEnd = out.search(/^\[(?!package\])/m);
    let head = pkgEnd === -1 ? out : out.slice(0, pkgEnd);
    let tail = pkgEnd === -1 ? "" : out.slice(pkgEnd);
    head = re.test(head) ? head.replace(re, line) : head.replace(/\n*$/, `\n${line}\n\n`);
    out = head + tail;
  };
  set("description", crate.description);
  set("repository", REPOSITORY);
  set("homepage", REPOSITORY);
  set("documentation", `https://docs.rs/${crate.name}`);
  if (!/^license\s*=/m.test(out)) set("license", "MIT");
  if (!/^\[lib\]/m.test(out)) out += `\n[lib]\nname = "${crate.lib}"\n`;
  else if (!/^\[lib\][^[]*^name\s*=/ms.test(out)) out = out.replace(/^\[lib\]\n/m, `[lib]\nname = "${crate.lib}"\n`);
  for (let dep of CRATES) {
    let re = new RegExp(`^${dep.upstream}\\s*=\\s*\\{\\s*path\\s*=\\s*"[^"]+"\\s*\\}`, "m");
    out = out.replace(
      re,
      `${dep.lib.replaceAll("_", "-")} = { package = "${dep.name}", version = "=${versions[dep.upstream]}" }`,
    );
  }
  return out;
}

async function isPublished(name: string, version: string): Promise<boolean> {
  let res = await fetch(`https://crates.io/api/v1/crates/${name}/${version}`, {
    headers: { "user-agent": "aphrody-labs/tailwindcss publish-crates" },
  });
  return res.ok;
}

async function main() {
  let dryRun = process.argv.includes("--dry-run");
  let stageRoot = join(ROOT, "dist", "aphrody-crates");
  rmSync(stageRoot, { recursive: true, force: true });
  let tomls = Object.fromEntries(
    CRATES.map(c => [c.upstream, require("node:fs").readFileSync(join(ROOT, c.dir, "Cargo.toml"), "utf8") as string]),
  );
  let pinned = process.argv.find(a => a.startsWith("--version="))?.slice(10);
  let versions = Object.fromEntries(CRATES.map(c => [c.upstream, pinned ?? crateVersion(tomls[c.upstream])]));
  let failed: string[] = [];
  // CRATES is in dependency order: macros, ignore, oxide.
  for (let crate of CRATES) {
    let version = versions[crate.upstream];
    if (!dryRun && (await isPublished(crate.name, version))) {
      console.log(`skip ${crate.name}@${version}: already published`);
      continue;
    }
    let stage = join(stageRoot, crate.name);
    cpSync(join(ROOT, crate.dir), stage, {
      recursive: true,
      filter: src => !/[\\/](target|node_modules)([\\/]|$)/.test(src),
    });
    for (let f of ["LICENSE"])
      if (!existsSync(join(stage, f)) && existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(stage, f));
    await Bun.write(join(stage, "Cargo.toml"), stagedToml(crate, tomls[crate.upstream], versions));
    // The staged crate is outside the cargo workspace; give it its own.
    await Bun.write(join(stage, "Cargo.toml"), (await Bun.file(join(stage, "Cargo.toml")).text()) + "\n[workspace]\n");
    let cmd = ["cargo", "publish", "--allow-dirty", ...(dryRun ? ["--dry-run", "--no-verify"] : [])];
    let proc = Bun.spawnSync(cmd, { cwd: stage, stdout: "inherit", stderr: "inherit", env: process.env });
    if (proc.exitCode !== 0) failed.push(`${crate.name}: cargo publish exited ${proc.exitCode}`);
    else console.log(`${dryRun ? "checked" : "published"} ${crate.name}@${version}`);
  }
  for (let f of failed) console.error(f);
  if (failed.length) process.exit(1);
}

if (import.meta.main) await main();
