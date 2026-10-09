# Aphrody fork of Tailwind CSS

`aphrody-labs/tailwindcss` is Tailwind CSS v4 driven by Bun only (package manager, scripts, test runner), published
under the `@aphrody` scope. Upstream is `tailwindlabs/tailwindcss`.

| Upstream                                                                                                     | Fork                                                                                                   |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `tailwindcss`                                                                                                | `@aphrody/tailwindcss`                                                                                 |
| `@tailwindcss/<x>` (node, cli, postcss, vite, webpack, turbopack, upgrade, browser, oxide, oxide-<platform>) | `@aphrody/tailwindcss-<x>`                                                                             |
| crates `classification-macros`, `ignore`, `tailwindcss-oxide`                                                | `aphrody-tailwindcss-classification-macros`, `aphrody-tailwindcss-ignore`, `aphrody-tailwindcss-oxide` |
| version `X.Y.Z`                                                                                              | `X.Y.Z-aphrody.N` (npm dist-tag `latest`; crates at the same version)                                  |

Sources keep upstream's names. The rename only happens in the staged copies that get published
(`scripts/aphrody/publish-npm.ts`, `scripts/aphrody/publish-crates.ts`); published packages depend on each other
through npm aliases (`"tailwindcss": "npm:@aphrody/tailwindcss@<v>"`), so `@import "tailwindcss"`,
`require('@tailwindcss/oxide')` and the napi platform loader keep resolving. The packages stay usable from Node.

## Bun

- `bun install` (lockfile `bun.lock`, isolated linker). Workspaces, catalog, patched dependencies and the build allow
  list live in the root `package.json`; `pnpm-workspace.yaml` and `pnpm-lock.yaml` are removed.
- `bun run build`, `bun run test` (`cargo test && bun test`), `bun run test:integrations`.
- Script rewrite (pnpm/npm/node/vitest to bun): `scripts/aphrody/bunify.ts` (`--check`, `--write`).
- Workspace helpers (replace `pnpm -r`): `scripts/aphrody/workspaces.ts`.
- Integration test projects are still installed with pnpm, like a user's project.

## Upstream sync

`bun scripts/aphrody/sync-upstream.ts [--push]`, every 6 hours in `.github/workflows/aphrody-upstream-sync.yml`
(secret `APHRODY_SYNC_TOKEN`, `workflow` scope). Conflicted manifests are merged after passing the base and upstream
sides through the bunify rewrite; upstream edits of `pnpm-workspace.yaml` are folded into `package.json`; `bun.lock` is
refreshed. A real conflict fails the run and leaves `main` untouched.

## Release

`.github/workflows/aphrody-release.yml` (manual or tag `aphrody-v*`): builds the oxide binding for every platform
(FreeBSD with Node's napi CLI, Bun has no FreeBSD build), places them (`scripts/aphrody/place-bindings.ts`), builds,
then `publish-npm.ts` and `publish-crates.ts`. Secrets `NPM_TOKEN`, `CARGO_REGISTRY_TOKEN`. Already published versions
are skipped. Upstream's workflows are disabled on the fork.

Fork tooling tests: `bun test scripts/aphrody/aphrody.test.ts`. Name check: `bun scripts/aphrody/scope.ts --check`.

Consumer in the Bun fork: `packages/bun-plugin-tailwind` (`@aphrody/bun-plugin-tailwind`).
