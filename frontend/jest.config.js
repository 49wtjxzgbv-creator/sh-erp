/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/'],
  // Next.js 16 upgrade (2026-10-31) bumped next-intl to a version that
  // ships pure ESM (`export`/`import`, no CJS build) — Jest's default
  // transformIgnorePatterns excludes ALL of node_modules from transforms,
  // so these two packages' ESM syntax hit Node's CJS `require()` loader
  // untransformed ("Unexpected token 'export'"). Carve them out so ts-jest
  // still transforms them into CommonJS for the test environment.
  transformIgnorePatterns: ['/node_modules/(?!(next-intl|use-intl|intl-messageformat|@formatjs|icu-minify|@schummar)/)'],
  transform: {
    // tsconfig.json sets jsx: "preserve" (left for Next.js's own bundler to
    // transform) — ts-jest respects that by default, which means any .tsx
    // file imported into a test (even transitively, e.g. a .test.ts
    // importing a helper out of a component file) fails with "Unexpected
    // token '<'" because the JSX was never converted to JS. Override just
    // for the test run.
    '^.+\\.(t|j)sx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }],
  },
};
