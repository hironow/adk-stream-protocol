# Code Style and Conventions

## General Principles
- **TDD Approach**: RED → GREEN → REFACTOR cycle (Kent Beck's methodology)
- **Tidy First**: Separate structural changes from behavioral changes (separate commits)
- **Type Safety**: Full type annotations (Python mypy strict, TypeScript strict mode)
- **Result Pattern**: Rust-style error handling (Ok/Error), avoid try-except in production code
- **No Premature Abstraction**: ABC/Protocol forbidden, inheritance limited to 1 level

## Python Style (`.semgrep/python-rules.yaml`, `pyproject.toml`)

### Linting (Ruff)
- **Tool**: `ruff` (replaces flake8, black, isort, pyupgrade)
- **Rules**: FAST, C90, NPY, PD, B, A, DTZ, T20, N, I, E, F, PLE, PLR, UP, FURB, RUF
- **Ignored**: E501 (line length), RUF002, RUF003
- **Format**: `uv run ruff format .`
- **Check**: `uv run ruff check .` (auto-fixes with `--fix`)

### Type Checking (mypy)
- **Tool**: `mypy` with strict mode
- **Requirement**: All code must have type annotations
- **No**: `# type: ignore` unless absolutely necessary with justification

### Naming Conventions
- **Classes**: PascalCase, avoid `*Manager`, `*Service`, `*Helper`, `*Util` suffixes
- **Functions/Variables**: snake_case
- **Constants**: UPPER_SNAKE_CASE
- **Private**: Leading underscore (`_private_method`)

### Python-Specific Rules
- **Imports**: Always at top of file, no inline imports
- **Paths**: Use `pathlib.Path`, not `os.path`
- **Dict iteration**: `for key in dict` not `for key in dict.keys()`
- **Async**: Use `await asyncio.sleep()` not `time.sleep()` in async functions
- **Logging**: Use `loguru`, not standard `logging`
- **HTTP**: Use `aiohttp`, not `requests` or `httpx`

## TypeScript Style (`biome.json`)

### Linting/Formatting (Biome)
- **Tool**: `biome` (replaces ESLint + Prettier)
- **Format**: `pnpm run format`
- **Check**: `pnpm run lint` (auto-fixes with `--write`)

### TypeScript-Specific Rules
- **Strict Mode**: Enabled in `tsconfig.json`
- **No Any**: Avoid `any`, use proper types or `unknown`
- **Naming**: camelCase for variables/functions, PascalCase for components/classes
- **React**: Functional components, hooks, no class components
- **Async**: Proper Promise typing, avoid unhandled rejections

## File Naming Conventions
- **YAML**: Always use `.yaml` extension, NOT `.yml`
- **Tests**: `test_*.py` (Python), `*.test.ts(x)` (TypeScript)
- **Components**: PascalCase (e.g., `ChatComponent.tsx`)
- **Utilities**: kebab-case (e.g., `use-chat-transport.ts`)

## Commit Guidelines
- **Conventional Commits**: `type(scope): subject`
- **Types**: feat, fix, docs, style, refactor, test, chore
- **Structural vs Behavioral**: Separate commits, structural first
- **Requirements**: All tests passing, all linting passing, all type checks passing
- **Co-Authored**: Include Claude Code attribution
