// `bun scripts/aphrody/standalone-local.ts [--out=<file>]`: standalone CLI for the
// host only, compiled with the running (fork) Bun as runtime, so nothing is
// downloaded from npm. Version is `<package>-aphrody+<commit>`.
// Prerequisites: `bun run build:platform` in crates/node, then `bun run build:fast`.

import { $ } from "bun";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const STANDALONE = resolve(ROOT, "packages", "@tailwindcss-standalone");
const exe = process.platform === "win32" ? ".exe" : "";
const outArg = process.argv.find(a => a.startsWith("--out="));
const outfile = resolve(outArg ? outArg.slice(6) : resolve(STANDALONE, "dist", `tailwindcss${exe}`));

const base = (await Bun.file(resolve(ROOT, "packages", "tailwindcss", "package.json")).json()).version;
const sha = (await $`git -C ${ROOT} rev-parse --short HEAD`.text()).trim();
const version = `${base.replace(/-aphrody\.\d+$/, "")}-aphrody+${sha}`;
const musl = process.platform === "linux" && !(process.report?.getReport() as any)?.header?.glibcVersionRuntime;

const result = await Bun.build({
  entrypoints: [resolve(STANDALONE, "src", "index.ts")],
  target: "node",
  minify: { whitespace: false, syntax: true, identifiers: false, keepNames: true },
  define: {
    "process.env.PLATFORM_LIBC": JSON.stringify(musl ? "musl" : "glibc"),
    "process.env.NAPI_RS_FORCE_WASI": JSON.stringify(""),
    "process.env.NAPI_RS_NATIVE_LIBRARY_PATH": JSON.stringify(""),
  },
  compile: { outfile, autoloadDotenv: false, autoloadBunfig: false },
  plugins: [
    {
      name: "tailwindcss-aphrody-standalone",
      setup(build) {
        build.onLoad({ filter: /tailwindcss-oxide\.wasi\.cjs$/ }, () => ({ contents: "" }));
        build.onLoad({ filter: /[\\/]packages[\\/]tailwindcss[\\/]package\.json$/ }, async args => {
          let pkg = await Bun.file(args.path).json();
          return { contents: JSON.stringify({ ...pkg, version }), loader: "json" };
        });
      },
    },
  ],
});

if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}
console.log(`${outfile} (${version}, bun ${Bun.version})`);
