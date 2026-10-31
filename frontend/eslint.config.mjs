import nextConfig from 'eslint-config-next';

// ESLint 9 migration (Next.js 16 upgrade, 2026-10-31) — replaces the old
// .eslintrc.json (`{ "extends": "next/core-web-vitals" }`). eslint-config-
// next's default export is already a native flat-config array as of this
// version (no FlatCompat bridge needed — that path hit a circular-JSON
// crash going through the legacy `next/core-web-vitals` shareable-config
// shape instead).
export default [
  ...nextConfig,
  { ignores: ['.next/**', 'node_modules/**'] },
  {
    rules: {
      // eslint-config-next's updated react-hooks plugin (pulled in by the
      // Next.js 16 upgrade) bundles a whole new family of "React Compiler
      // readiness" rules, all firing exclusively in pre-existing, working
      // code this upgrade didn't touch — not Next-version-compatibility
      // bugs, a separate "make this codebase React Compiler compatible"
      // initiative. set-state-in-effect alone was ~95 hits (the standard
      // "hydrate client-only state — localStorage, matchMedia — after
      // mount" idiom); the rest (refs/immutability/purity/
      // incompatible-library/static-components) hit real, deliberate
      // patterns elsewhere (e.g. the PDF annotation editor's ref-based
      // popup positioning). Off for now rather than either refactoring
      // ~100+ unrelated call sites as a side effect of this upgrade, or
      // silently shipping with `lint` broken.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/incompatible-library': 'off',
      'react-hooks/static-components': 'off',
    },
  },
];
