"""
Unit tests for API key authentication.

Tests the API key authentication pattern introduced in Phase 1:
- Valid API key allows access
- Invalid API key returns 401 Unauthorized
- Missing API key returns 401 Unauthorized
- User ID is derived from API key

TDD: These tests are written BEFORE implementation (Red phase).
"""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


# ============================================================
# API Key Verification Tests
# ============================================================


@pytest.fixture
def valid_api_key() -> str:
    """Valid API key for testing."""
    return "test-api-key-12345"


@pytest.fixture
def invalid_api_key() -> str:
    """Invalid API key for testing."""
    return "invalid-key-xyz"


@pytest.fixture
def test_client(valid_api_key: str):
    """Create test client with mocked API_KEY module variable."""
    import server

    # Patch the module-level API_KEY directly (already loaded at import time)
    # Using yield to keep patch active during test execution
    with patch.object(server, "API_KEY", valid_api_key):
        yield TestClient(server.app)


class TestApiKeyAuthentication:
    """Test API key authentication on endpoints."""

    def test_health_endpoint_requires_no_auth(self, test_client: TestClient) -> None:
        """Health check endpoint should be accessible without authentication."""
        # given: No API key header
        # when: Request health endpoint
        response = test_client.get("/health")

        # then: Should return 200 OK
        assert response.status_code == 200
        assert response.json()["status"] == "healthy"

    def test_stream_endpoint_with_valid_api_key(
        self, test_client: TestClient, valid_api_key: str
    ) -> None:
        """Stream endpoint should accept requests with valid API key."""
        # given: Valid API key in header
        headers = {"X-API-Key": valid_api_key}
        payload = {
            "messages": [{"role": "user", "content": "Hello"}],
        }

        # when: Request stream endpoint
        response = test_client.post("/stream", json=payload, headers=headers)

        # then: Should not return 401 (may return other errors, but not auth error)
        assert response.status_code != 401

    def test_stream_endpoint_with_invalid_api_key(
        self, test_client: TestClient, invalid_api_key: str
    ) -> None:
        """Stream endpoint should reject requests with invalid API key."""
        # given: Invalid API key in header
        headers = {"X-API-Key": invalid_api_key}
        payload = {
            "messages": [{"role": "user", "content": "Hello"}],
        }

        # when: Request stream endpoint
        response = test_client.post("/stream", json=payload, headers=headers)

        # then: Should return 401 Unauthorized
        assert response.status_code == 401
        assert "Invalid API key" in response.json()["detail"]

    def test_stream_endpoint_without_api_key(self, test_client: TestClient) -> None:
        """Stream endpoint should reject requests without API key."""
        # given: No API key header
        payload = {
            "messages": [{"role": "user", "content": "Hello"}],
        }

        # when: Request stream endpoint
        response = test_client.post("/stream", json=payload)

        # then: Should return 401 Unauthorized (or 422 for missing header)
        assert response.status_code in [401, 422]


class TestGetUserFromApiKey:
    """Test user ID derivation from API key."""

    def test_get_user_returns_consistent_id(self, valid_api_key: str) -> None:
        """Same API key should always return same user ID."""
        # given: Import _get_user function
        from server import _get_user

        # when: Call _get_user with same API key multiple times
        user_id_1 = _get_user(valid_api_key)
        user_id_2 = _get_user(valid_api_key)

        # then: Should return consistent user ID
        assert user_id_1 == user_id_2
        assert user_id_1.startswith("user_")

    def test_different_api_keys_return_different_users(self) -> None:
        """Different API keys should return different user IDs."""
        # given: Two different API keys
        from server import _get_user

        api_key_1 = "api-key-user-alice"
        api_key_2 = "api-key-user-bob"

        # when: Call _get_user with different API keys
        user_id_1 = _get_user(api_key_1)
        user_id_2 = _get_user(api_key_2)

        # then: Should return different user IDs
        assert user_id_1 != user_id_2
