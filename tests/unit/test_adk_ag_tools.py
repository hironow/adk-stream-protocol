"""
Unit tests for adk_ag_tools module.

Tests tool functions used by ADK agents.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from adk_ag_tools import (
    change_bgm,
    get_location,
    get_weather,
)


class TestWeatherTool:
    """Tests for the get_weather tool."""

    @pytest.mark.asyncio
    async def test_get_weather_with_mock_data(self, monkeypatch, tmp_path):
        """
        Should return mock weather data when API key is not set.

        This is the default behavior in development environments.
        """
        # given: No API key and clean cache directory
        monkeypatch.delenv("OPENWEATHERMAP_API_KEY", raising=False)
        monkeypatch.setattr("adk_ag_tools.CACHE_DIR", tmp_path / ".cache")

        # when: Request weather for known city
        result = await get_weather("Tokyo")

        # then: Should return mock data
        assert result["temperature"] == 18
        assert result["condition"] == "Cloudy"
        assert result["humidity"] == 65

    @pytest.mark.asyncio
    async def test_get_weather_unknown_city_mock(self, monkeypatch, tmp_path):
        """
        Should return default mock data for unknown cities.
        """
        # given: No API key and clean cache directory
        monkeypatch.delenv("OPENWEATHERMAP_API_KEY", raising=False)
        monkeypatch.setattr("adk_ag_tools.CACHE_DIR", tmp_path / ".cache")

        # when: Request weather for unknown city
        result = await get_weather("Unknown City")

        # then: Should return default mock data
        assert result["temperature"] == 20
        assert result["condition"] == "Unknown"
        assert result["humidity"] == 60
        assert "Mock data" in result["note"]

    @pytest.mark.asyncio
    async def test_get_weather_caching(self, tmp_path, monkeypatch):
        """
        Should cache weather data to file and reuse from cache.
        """
        # given: Set cache directory to temp path
        cache_dir = tmp_path / ".cache"
        monkeypatch.setattr("adk_ag_tools.CACHE_DIR", cache_dir)
        monkeypatch.delenv("OPENWEATHERMAP_API_KEY", raising=False)

        # when: First call (should save to cache)
        result1 = await get_weather("London")
        assert "cached" not in result1  # First call is not cached

        # Verify cache file was created
        cache_file = cache_dir / "weather_london.json"
        assert cache_file.exists()

        # Second call (should read from cache)
        result2 = await get_weather("London")

        # then: Should return cached data
        assert result2["cached"] is True
        assert result2["temperature"] == result1["temperature"]
        assert result2["condition"] == result1["condition"]

    @pytest.mark.asyncio
    @patch("adk_ag_tools.aiohttp.ClientSession")
    async def test_get_weather_with_api_success(self, mock_session_class, monkeypatch, tmp_path):
        """
        Should call OpenWeatherMap API when API key is set.
        """
        # given: API key is set and clean cache directory
        monkeypatch.setenv("OPENWEATHERMAP_API_KEY", "test_api_key")
        monkeypatch.setattr("adk_ag_tools.CACHE_DIR", tmp_path / ".cache")

        # Mock API response
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(
            return_value={
                "main": {
                    "temp": 22.5,
                    "feels_like": 21.0,
                    "humidity": 70,
                },
                "weather": [{"main": "Partly Cloudy", "description": "scattered clouds"}],
                "wind": {"speed": 3.5},
            }
        )

        # Create the session mock with proper async context manager protocol
        mock_session = MagicMock()
        mock_session.get.return_value.__aenter__ = AsyncMock(return_value=mock_response)
        mock_session.get.return_value.__aexit__ = AsyncMock(return_value=None)

        # Configure ClientSession to return our mock session
        mock_session_class.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_class.return_value.__aexit__ = AsyncMock(return_value=None)

        # when: Request weather
        result = await get_weather("Paris")

        # then: Should return API data
        assert result["temperature"] == 22.5
        assert result["condition"] == "Partly Cloudy"
        assert result["description"] == "scattered clouds"
        assert result["humidity"] == 70
        assert result["feels_like"] == 21.0
        assert result["wind_speed"] == 3.5

        # Verify API was called correctly
        mock_session.get.assert_called_once()
        call_args = mock_session.get.call_args
        assert call_args[0][0] == "https://api.openweathermap.org/data/2.5/weather"
        assert call_args[1]["params"]["q"] == "Paris"
        assert call_args[1]["params"]["appid"] == "test_api_key"

    @pytest.mark.asyncio
    @patch("adk_ag_tools.aiohttp.ClientSession")
    async def test_get_weather_api_error(self, mock_session_class, monkeypatch, tmp_path):
        """
        Should handle API errors gracefully.
        """
        # given: API key is set but API returns error, clean cache directory
        monkeypatch.setenv("OPENWEATHERMAP_API_KEY", "test_api_key")
        monkeypatch.setattr("adk_ag_tools.CACHE_DIR", tmp_path / ".cache")

        mock_response = MagicMock()
        mock_response.status = 404  # City not found

        # Create the session mock with proper async context manager protocol
        mock_session = MagicMock()
        mock_session.get.return_value.__aenter__ = AsyncMock(return_value=mock_response)
        mock_session.get.return_value.__aexit__ = AsyncMock(return_value=None)

        # Configure ClientSession to return our mock session
        mock_session_class.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_class.return_value.__aexit__ = AsyncMock(return_value=None)

        # when: Request weather
        result = await get_weather("NonExistentCity")

        # then: Should return error info
        assert "error" in result
        assert "404" in result["error"]
        assert result["location"] == "NonExistentCity"


class TestChangeBgm:
    """Tests for the change_bgm tool."""

    @pytest.mark.asyncio
    async def test_change_bgm_returns_success(self):
        """Should return success message immediately (frontend handles execution)."""
        # when: Change BGM to track 1
        result = await change_bgm(track=1)

        # then: Should return success
        assert result["success"] is True
        assert result["track"] == 1
        assert "BGM change to track 1" in result["message"]

    @pytest.mark.asyncio
    async def test_change_bgm_track_2(self):
        """Should handle track 2."""
        # when: Change BGM to track 2
        result = await change_bgm(track=2)

        # then: Should return success with track 2
        assert result["success"] is True
        assert result["track"] == 2


class TestGetLocation:
    """Tests for the get_location tool with approval flow."""

    # Removed: test_get_location_returns_success_without_context
    # New implementation requires tool_context (past implementation pattern)

    @pytest.mark.asyncio
    async def test_get_location_with_bidi_delegate_approval_granted(self):
        """
        BIDI mode: Should delegate to frontend when tool_context with delegate is provided.

        When user approves, frontend returns location data.
        """
        # given: Mock tool_context with frontend delegate (BIDI mode)
        mock_delegate = AsyncMock()
        mock_delegate.execute_on_frontend.return_value = {
            "success": True,
            "latitude": 35.6762,
            "longitude": 139.6503,
            "accuracy": 10,
            "message": "Location retrieved successfully",
        }

        mock_session = MagicMock()
        mock_session.state = {"frontend_delegate": mock_delegate}

        mock_tool_context = MagicMock()
        mock_tool_context.session = mock_session
        mock_tool_context.invocation_id = "test-invocation-123"

        # when: Call get_location with tool_context
        result = await get_location(tool_context=mock_tool_context)

        # then: Should delegate to frontend and return location data
        mock_delegate.execute_on_frontend.assert_called_once_with(
            tool_call_id="test-invocation-123",
            tool_name="get_location",
            args={},
        )
        assert result["success"] is True
        assert result["latitude"] == 35.6762
        assert result["longitude"] == 139.6503
        assert result["accuracy"] == 10

    @pytest.mark.asyncio
    async def test_get_location_with_bidi_delegate_approval_denied(self):
        """
        BIDI mode: Should handle approval denial from frontend delegate.

        When user denies, frontend returns error.
        """
        # given: Mock tool_context with frontend delegate that returns denial
        mock_delegate = AsyncMock()
        mock_delegate.execute_on_frontend.return_value = {
            "success": False,
            "error": "User denied location access",
            "code": "PERMISSION_DENIED",
        }

        mock_session = MagicMock()
        mock_session.state = {"frontend_delegate": mock_delegate}

        mock_tool_context = MagicMock()
        mock_tool_context.session = mock_session
        mock_tool_context.invocation_id = "test-invocation-456"

        # when: Call get_location with tool_context
        result = await get_location(tool_context=mock_tool_context)

        # then: Should return denial error
        assert result["success"] is False
        assert "denied" in result["error"].lower()
        assert result["code"] == "PERMISSION_DENIED"

    @pytest.mark.asyncio
    async def test_get_location_with_context_but_no_delegate_returns_error(self):
        """
        Should return error when tool_context exists but frontend_delegate is not set.

        Past implementation pattern: delegate is always required (set in session.state).
        If delegate is missing, it's a configuration error.
        """
        # given: Mock tool_context WITHOUT frontend delegate
        mock_session = MagicMock()
        mock_session.state = {}  # No frontend_delegate

        mock_tool_context = MagicMock()
        mock_tool_context.session = mock_session
        mock_tool_context.invocation_id = "test-invocation-error"

        # when: Call get_location with tool_context but no delegate
        result = await get_location(tool_context=mock_tool_context)

        # then: Should return error (can be either session.state or frontend_delegate missing)
        assert result["success"] is False
        assert "error" in result
        # Error message varies depending on mock behavior
        assert "frontend_delegate" in result["error"] or "session.state" in result["error"]
