/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/__tests__'],
  testMatch: ['**/__tests__/unit/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/e2e/'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.node.json',
      },
    ],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/main/preload.ts', // Preload has special context
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },
  // Mock native modules that don't work in Jest
  moduleNameMapper: {
    '^electron$': '<rootDir>/__tests__/__mocks__/electron.ts',
    '^node-hid$': '<rootDir>/__tests__/__mocks__/node-hid.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],
  // Clear mocks between tests
  clearMocks: true,
  // Verbose output
  verbose: true,
};
