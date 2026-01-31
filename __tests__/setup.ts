/**
 * Jest test setup file
 * Runs before each test file
 */

// Extend Jest matchers if needed
// import '@testing-library/jest-dom';

// Global test timeout
jest.setTimeout(10000);

// Suppress console output during tests (optional)
// Uncomment to reduce noise in test output
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
//   // Keep error for debugging
//   error: console.error,
// };

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});
