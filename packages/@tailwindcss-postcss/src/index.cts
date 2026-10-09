import tailwindcss, * as allExports from './index.ts'

// This is used instead of `export default` to work around a bug in
// `postcss-load-config`

for (let key in allExports) {
  if (key === 'default') continue
  // @ts-ignore
  tailwindcss[key] = allExports[key]
}

// @ts-ignore
export = tailwindcss
