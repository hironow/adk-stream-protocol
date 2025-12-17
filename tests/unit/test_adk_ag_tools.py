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

    def test_change_bgm_returns_success(self):
        """Should return success message immediately (frontend handles execution)."""
        # when: Change BGM to track 0
        result = change_bgm(track=0)

        # then: Should return success
        assert result["success"] is True
        assert result["track"] == 0
        assert "BGM change to track 0" in result["message"]

    def test_change_bgm_track_1(self):
        """Should handle track 1."""
        # when: Change BGM to track 1
        result = change_bgm(track=1)

        # then: Should return success with track 1
        assert result["success"] is True
        assert result["track"] == 1


class TestGetLocation:
    """Tests for the get_location tool (frontend auto-execute)."""

    def test_get_location_returns_success(self):
        """Should return success message immediately (frontend handles execution)."""
        # when: Get location
        result = get_location()

        # then: Should return success
        assert result["success"] is True
        assert "Location request initiated" in result["message"]
