# Code Style and Conventions

## Development Philosophy
- **TDD (Test-Driven Development)**: RED → GREEN → REFACTOR cycle
- **Tidy First**: Separate structural changes from behavioral changes
- **Decision Priorities**: Safety > Tests > Readability > Explicitness

## Python Conventions
- **Type Hints**: 100% coverage required
- **Linting**: ruff with comprehensive rules (see pyproject.toml)
- **Formatting**: ruff format (100 char line length)
- **Imports**: At top of file, sorted by isort rules
- **File Paths**: Use pathlib.Path, not os.path
- **Testing**: pytest with given-when-then structure

## TypeScript Conventions
- **Strict Mode**: Enabled in TypeScript config
- **Linting/Formatting**: Biome for both
- **Testing**: Vitest for unit tests, Playwright for E2E
- **React**: Functional components with hooks

## File Conventions
- **YAML**: Always use .yaml extension (NOT .yml)
- **Task Runner**: justfile (lowercase, no extension)
- **Environment**: .env.local for local configuration

## Package Management Rules
- **Python**: uv only (no pip, poetry, pipenv)
- **Node.js**: pnpm only (no npm, yarn, bun)
- **Task Automation**: just only (no make, npm scripts for complex tasks)

## Commit Discipline
- Commits only when ALL tests pass
- ALL linter warnings resolved
- Separate commits for structural vs behavioral changes
- Clear commit messages stating change type