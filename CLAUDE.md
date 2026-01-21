use `bun` instead of `pnpm`.
use `uv run python` instead of `python` only.

read this @SPEC.md and interview me in detail using the AskUserQuestionTool about literally anything: technical implementation, UI & UX, concerns, tradeoffs, etc. but make sure the questions are not obvious

You do not need to start the server or run the tests yourself, as the user will do that. Instead, provide instructions to the user on how to do so. The user will provide you with server logs and test results. So do not execute anything yourself, just give instructions.

The logs/ directory contains logs generated during server startup, while the chunk_logs/ directory contains logs related to chunk processing. The folder names are determined based on environment variables. Please refer to them for more information.
