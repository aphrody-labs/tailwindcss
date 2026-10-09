# Plan of the Aphrody Tailwind CSS fork

Tracked from `C:\bun\PLAN.md` (chantier Q). Status as of 2026-10-09.

## Done

- origin `aphrody-labs/tailwindcss`, upstream `tailwindlabs/tailwindcss`; upstream workflows disabled on the fork.
- pnpm to Bun: root `package.json` workspaces/catalog/patches/trustedDependencies, `bun.lock`, `bunfig.toml`, scripts
  bunified (`scripts/aphrody/bunify.ts`), `scripts/*.mjs` use `scripts/aphrody/workspaces.ts` and `bun pm pack`.
- Scope and publishing: `scope.ts`, `publish-npm.ts`, `publish-crates.ts`, `place-bindings.ts`.
- Upstream sync: `sync-upstream.ts` and the 6-hourly workflow.
- CI and release workflows (`aphrody-ci.yml`, `aphrody-release.yml`).
- Oxide (napi) loads under Bun.

## Open

1. First release `4.3.3-aphrody.1` to npm and crates.io (needs the release workflow run or a local build).
2. `bun test` parity with vitest on `packages/`: 5238 of 5494 pass before the Bun core patches (getState/setState,
   rejects/resolves on functions, snapshot serializers, vitest test context, `test.for`); rerun once they land.
3. Integration suite under `bun test` (vitest test context: `expect`, `onTestFinished`, retry).
4. `bench` still uses `vitest bench`.
5. Measures before/after (large project CSS build, cold start) once the release exists.
6. `@aphrody/bun-plugin-tailwind` switches to `@aphrody/tailwindcss*` after the first release.
