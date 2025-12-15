"""
Unit tests for adk_ag_runner module.

Tests tool functions and agent configurations.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from adk_ag_runner import (
    TOOLS_REQUIRING_APPROVAL,
    calculate,
    change_bgm,
    get_current_time,
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
        monkeypatch.setattr("adk_ag_runner.CACHE_DIR", tmp_path / ".cache")

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
        monkeypatch.setattr("adk_ag_runner.CACHE_DIR", tmp_path / ".cache")

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
        monkeypatch.setattr("adk_ag_runner.CACHE_DIR", cache_dir)
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
    @patch("adk_ag_runner.aiohttp.ClientSession")
    async def test_get_weather_with_api_success(self, mock_session_class, monkeypatch, tmp_path):
        """
        Should call OpenWeatherMap API when API key is set.
        """
        # given: API key is set and clean cache directory
        monkeypatch.setenv("OPENWEATHERMAP_API_KEY", "test_api_key")
        monkeypatch.setattr("adk_ag_runner.CACHE_DIR", tmp_path / ".cache")

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
    @patch("adk_ag_runner.aiohttp.ClientSession")
    async def test_get_weather_api_error(self, mock_session_class, monkeypatch, tmp_path):
        """
        Should handle API errors gracefully.
        """
        # given: API key is set but API returns error, clean cache directory
        monkeypatch.setenv("OPENWEATHERMAP_API_KEY", "test_api_key")
        monkeypatch.setattr("adk_ag_runner.CACHE_DIR", tmp_path / ".cache")

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


class TestCalculateTool:
    """Tests for the calculate tool."""

    def test_calculate_simple_addition(self):
        """Should calculate simple addition."""
        result = calculate("2 + 2")
        assert result["success"] is True
        assert result["result"] == 4
        assert result["expression"] == "2 + 2"

    def test_calculate_multiplication(self):
        """Should calculate multiplication."""
        result = calculate("10 * 5")
        assert result["success"] is True
        assert result["result"] == 50
        assert result["expression"] == "10 * 5"

    def test_calculate_complex_expression(self):
        """Should calculate complex expressions."""
        result = calculate("(10 + 5) * 2 - 3")
        assert result["success"] is True
        assert result["result"] == 27
        assert result["expression"] == "(10 + 5) * 2 - 3"

    def test_calculate_division(self):
        """Should calculate division with float result."""
        result = calculate("10 / 3")
        assert result["success"] is True
        assert abs(result["result"] - 3.333333) < 0.001
        assert result["expression"] == "10 / 3"

    def test_calculate_invalid_expression(self):
        """Should handle invalid expressions gracefully."""
        result = calculate("invalid math")
        assert result["success"] is False
        assert "error" in result
        assert result["expression"] == "invalid math"

    def test_calculate_division_by_zero(self):
        """Should handle division by zero."""
        result = calculate("10 / 0")
        assert result["success"] is False
        assert "error" in result
        assert "division by zero" in result["error"].lower()

    def test_calculate_prevents_code_injection(self):
        """Should prevent code injection attempts."""
        # Try to import a module (should fail)
        result = calculate("__import__('os').system('echo hacked')")
        assert result["success"] is False
        assert "error" in result


class TestGetCurrentTime:
    """Tests for the get_current_time tool."""

    @patch("adk_ag_runner.datetime")
    def test_get_current_time_default_utc(self, mock_datetime):
        """Should return current time in UTC by default."""
        # given: Fixed datetime
        fixed_time = datetime(2024, 1, 15, 10, 30, 45, tzinfo=UTC)
        mock_datetime.now.return_value = fixed_time

        # when: Get current time
        result = get_current_time()

        # then: Should return UTC time
        assert result["timezone"] == "UTC"
        # The actual result will use real datetime formatting
        # Just check that we have the expected fields
        assert "datetime" in result
        assert "formatted" in result

    def test_get_current_time_with_timezone(self):
        """Should accept timezone parameter."""
        # when: Get current time with timezone
        result = get_current_time("America/New_York")

        # then: Should include timezone in result
        assert result["timezone"] == "America/New_York"
        assert "datetime" in result
        assert "formatted" in result

    def test_get_current_time_format(self):
        """Should return properly formatted time strings."""
        # when: Get current time
        result = get_current_time()

        # then: Should have all expected fields
        assert "datetime" in result  # ISO format
        assert "timezone" in result
        assert "formatted" in result  # Human-readable format

        # Check format patterns
        import re

        # ISO format: 2024-01-15T10:30:45.123456+00:00
        assert re.match(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", result["datetime"])
        # Formatted: 2024-01-15 10:30:45
        assert re.match(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", result["formatted"])


class TestFrontendDelegatedTools:
    """Tests for tools that delegate to frontend (change_bgm, get_location)."""

    @pytest.mark.asyncio
    @patch("tool_delegate.frontend_delegate")
    async def test_change_bgm_success(self, mock_delegate):
        """
        Should delegate BGM change to frontend and return result.
        """
        # given: Mock tool context and delegate
        tool_context = MagicMock()
        tool_context.function_call_id = "bgm_call_123"
        tool_context.state = {}  # No temp:delegate, will use global

        expected_result = {"success": True, "message": "BGM changed to track 1"}
        mock_delegate.execute_on_frontend = AsyncMock(return_value=expected_result)

        # when: Change BGM
        result = await change_bgm(track=1, tool_context=tool_context)

        # then: Should delegate and return result
        assert result == expected_result
        mock_delegate.execute_on_frontend.assert_called_once_with(
            tool_call_id="bgm_call_123", tool_name="change_bgm", args={"track": 1}
        )

    @pytest.mark.asyncio
    async def test_change_bgm_missing_call_id(self):
        """
        Should handle missing function_call_id gracefully.
        """
        # given: Tool context without function_call_id
        tool_context = MagicMock()
        tool_context.function_call_id = None
        tool_context.state = {}

        # when: Change BGM
        result = await change_bgm(track=0, tool_context=tool_context)

        # then: Should return error
        assert result["success"] is False
        assert "Missing function_call_id" in result["error"]

    @pytest.mark.asyncio
    @patch("tool_delegate.frontend_delegate")
    async def test_get_location_success(self, mock_delegate):
        """
        Should delegate location request to frontend and return result.
        """
        # given: Mock tool context and delegate
        tool_context = MagicMock()
        tool_context.function_call_id = "loc_call_456"
        tool_context.state = {}

        expected_result = {
            "success": True,
            "latitude": 35.6762,
            "longitude": 139.6503,
            "accuracy": 10,
        }
        mock_delegate.execute_on_frontend = AsyncMock(return_value=expected_result)

        # when: Get location
        result = await get_location(tool_context=tool_context)

        # then: Should delegate and return result
        assert result == expected_result
        mock_delegate.execute_on_frontend.assert_called_once_with(
            tool_call_id="loc_call_456", tool_name="get_location", args={}
        )

    @pytest.mark.asyncio
    async def test_get_location_with_temp_delegate(self):
        """
        Should use temp:delegate from tool_context.state when available.
        """
        # given: Tool context with temp delegate
        temp_delegate = MagicMock()
        temp_delegate.execute_on_frontend = AsyncMock(
            return_value={"success": True, "from": "temp_delegate"}
        )

        tool_context = MagicMock()
        tool_context.function_call_id = "loc_call_789"
        tool_context.state = {"temp:delegate": temp_delegate}

        # when: Get location
        result = await get_location(tool_context=tool_context)

        # then: Should use temp delegate, not global
        assert result == {"success": True, "from": "temp_delegate"}
        temp_delegate.execute_on_frontend.assert_called_once()

    @pytest.mark.asyncio
    @patch("tool_delegate.frontend_delegate")
    async def test_change_bgm_user_denial(self, mock_delegate):
        """
        Should handle user denial of permission.
        """
        # given: User denies permission
        tool_context = MagicMock()
        tool_context.function_call_id = "bgm_denied_123"
        tool_context.state = {}

        denial_result = {"success": False, "error": "User denied permission", "denied": True}
        mock_delegate.execute_on_frontend = AsyncMock(return_value=denial_result)

        # when: Try to change BGM
        result = await change_bgm(track=0, tool_context=tool_context)

        # then: Should return denial result
        assert result == denial_result
        assert result["success"] is False
        assert result["denied"] is True


class TestToolApprovalConfiguration:
    """Tests for tool approval configuration."""

    def test_tools_requiring_approval_set(self):
        """Should have correct tools marked as requiring approval."""
        assert "change_bgm" in TOOLS_REQUIRING_APPROVAL
        assert "get_location" in TOOLS_REQUIRING_APPROVAL
        assert len(TOOLS_REQUIRING_APPROVAL) == 2

    def test_regular_tools_not_requiring_approval(self):
        """Regular tools should not be in the approval set."""
        assert "get_weather" not in TOOLS_REQUIRING_APPROVAL
        assert "calculate" not in TOOLS_REQUIRING_APPROVAL
        assert "get_current_time" not in TOOLS_REQUIRING_APPROVAL
