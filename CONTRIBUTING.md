# Contributing to RigReady

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js 18 or higher
- Git
- Windows 10/11 (primary platform)
- Python 3.10+ (for DirectInput support)

### Getting Started

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/rigready.git
   cd rigready
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up Python environment** (optional, for DirectInput)
   ```bash
   npm run setup:python
   ```

4. **Run the app**
   ```bash
   npm run dev
   ```

## Code Style

We use ESLint and Prettier to maintain consistent code style.

### Formatting

```bash
# Check formatting
npm run format:check

# Auto-fix formatting
npm run format
```

### Linting

```bash
# Check for issues
npm run lint

# Auto-fix issues
npm run lint:fix
```

### Pre-commit Hooks

We use Husky to run lint-staged on commit. This automatically:
- Runs ESLint on staged `.ts` and `.js` files
- Formats code with Prettier

If a commit fails, fix the issues and try again.

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Writing Tests

- Place unit tests in `__tests__/unit/`
- Place integration tests in `__tests__/integration/`
- Place E2E tests in `__tests__/e2e/`
- Name test files as `*.test.ts` or `*.spec.ts`

### Test Guidelines

1. **Mock external dependencies** - Use Jest mocks for `node-hid`, `electron`, file system
2. **Test behavior, not implementation** - Focus on what the code does, not how
3. **One assertion per test** (when practical) - Makes failures easier to diagnose
4. **Use descriptive test names** - `it('should return empty array when no devices connected')`

## Pull Request Process

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Write tests for new functionality
   - Update documentation if needed
   - Ensure all tests pass

3. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

   We follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation changes
   - `test:` - Adding or updating tests
   - `refactor:` - Code refactoring
   - `chore:` - Maintenance tasks

4. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   ```
   Then create a Pull Request on GitHub.

5. **PR Requirements**
   - All tests pass
   - No linting errors
   - Code is formatted
   - Description explains the changes
   - Screenshots for UI changes

## Project Architecture

### Main Process (`src/main/`)

The Electron main process handles:
- Device communication (HID, DirectInput)
- File system operations
- System integration (displays, processes)

Key files:
- `main.ts` - App entry point and IPC handlers
- `preload.ts` - Bridge between main and renderer
- `devices/*.ts` - Device management modules

### Renderer Process (`src/renderer/`)

The UI runs in a Chromium renderer:
- `index.html` - Main HTML structure
- `renderer.js` - UI logic and state management
- `styles.css` - Styling

### Shared Types (`src/shared/`)

Types used by both processes (when converting to TypeScript):
- Device interfaces
- IPC message types
- Configuration schemas

## Adding New Features

### Adding a New IPC Handler

1. Add handler in `src/main/main.ts`:
   ```typescript
   ipcMain.handle('feature:action', async (_, arg) => {
     return someService.doAction(arg);
   });
   ```

2. Expose in `src/main/preload.ts`:
   ```typescript
   feature: {
     action: (arg: string) => ipcRenderer.invoke('feature:action', arg),
   }
   ```

3. Use in renderer:
   ```javascript
   const result = await window.rigReady.feature.action('value');
   ```

### Adding a New Device Manager

1. Create `src/main/devices/yourManager.ts`
2. Follow the pattern of existing managers
3. Add IPC handlers in `main.ts`
4. Expose API in `preload.ts`
5. Write unit tests in `__tests__/unit/yourManager.test.ts`

## Questions?

- Open an issue for bugs or feature requests
- Start a discussion for questions
