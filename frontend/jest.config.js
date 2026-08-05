/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/'],
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
