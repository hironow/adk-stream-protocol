"""Backend Fixture-based E2E Tests

Tests that verify backend behavior against frontend baseline fixtures.
Each test file corresponds to one fixture file in fixtures/frontend/.

Test Strategy:
1. Load fixture file (input + expected rawEvents)
2. Send request to real backend server
3. Collect actual rawEvents from backend response
4. Compare actual vs expected (golden file comparison)

Per CLAUDE.md guidelines:
- No mocks in E2E tests - uses real backend server
- Given-When-Then structure
- Tests complete invocation flows
"""
