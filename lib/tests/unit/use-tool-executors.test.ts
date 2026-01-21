/**
 * Tool Executors Unit Tests
 *
 * Tests for tool executor functions and registry.
 * Hook integration is tested via E2E tests.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  executeChangeBgm,
  executeGetLocation,
  getToolExecutor,
  hasToolExecutor,
  registerToolExecutor,
  resetToolExecutors,
  type ToolExecutorDependencies,
  type ToolExecutorResult,
} from "../../hooks/use-tool-executors";

describe("use-tool-executors", () => {
  describe("Executor Registry", () => {
    beforeEach(() => {
      resetToolExecutors();
    });

    describe("hasToolExecutor", () => {
      it("returns true for built-in executors", () => {
        expect(hasToolExecutor("get_location")).toBe(true);
        expect(hasToolExecutor("change_bgm")).toBe(true);
      });

      it("returns false for unregistered executors", () => {
        expect(hasToolExecutor("unknown_tool")).toBe(false);
        expect(hasToolExecutor("process_payment")).toBe(false);
      });
    });

    describe("getToolExecutor", () => {
      it("returns executor for registered tools", () => {
        const executor = getToolExecutor("get_location");
        expect(executor).toBeDefined();
        expect(typeof executor).toBe("function");
      });

      it("returns undefined for unregistered tools", () => {
        const executor = getToolExecutor("unknown_tool");
        expect(executor).toBeUndefined();
      });
    });

    describe("registerToolExecutor", () => {
      it("registers a new executor", () => {
        const customExecutor = async () => ({
          success: true,
          output: { custom: "data" },
        });

        registerToolExecutor("custom_tool", customExecutor);

        expect(hasToolExecutor("custom_tool")).toBe(true);
        expect(getToolExecutor("custom_tool")).toBe(customExecutor);
      });

      it("overwrites existing executor", () => {
        const newExecutor = async () => ({
          success: true,
          output: { replaced: true },
        });

        registerToolExecutor("get_location", newExecutor);

        expect(getToolExecutor("get_location")).toBe(newExecutor);
      });
    });

    describe("resetToolExecutors", () => {
      it("clears custom executors and restores defaults", () => {
        // Register custom executor
        registerToolExecutor("custom_tool", async () => ({
          success: true,
          output: {},
        }));
        expect(hasToolExecutor("custom_tool")).toBe(true);

        // Reset
        resetToolExecutors();

        // Custom should be gone
        expect(hasToolExecutor("custom_tool")).toBe(false);

        // Defaults should remain
        expect(hasToolExecutor("get_location")).toBe(true);
        expect(hasToolExecutor("change_bgm")).toBe(true);
      });
    });
  });

  describe("executeGetLocation", () => {
    it("returns location data on success", async () => {
      // Mock navigator.geolocation
      const mockPosition = {
        coords: {
          latitude: 35.6762,
          longitude: 139.6503,
          accuracy: 20,
        },
        timestamp: Date.now(),
      };

      const getCurrentPositionMock = vi.fn((success) => {
        success(mockPosition);
      });

      vi.stubGlobal("navigator", {
        geolocation: {
          getCurrentPosition: getCurrentPositionMock,
        },
      });

      const result = await executeGetLocation();

      expect(result.success).toBe(true);
      expect(result.output).toEqual({
        latitude: 35.6762,
        longitude: 139.6503,
        accuracy: 20,
        timestamp: mockPosition.timestamp,
      });

      vi.unstubAllGlobals();
    });

    it("returns error on geolocation failure", async () => {
      const getCurrentPositionMock = vi.fn((_success, error) => {
        error(new Error("User denied geolocation"));
      });

      vi.stubGlobal("navigator", {
        geolocation: {
          getCurrentPosition: getCurrentPositionMock,
        },
      });

      const result = await executeGetLocation();

      expect(result.success).toBe(false);
      expect(result.error).toBe("User denied geolocation");

      vi.unstubAllGlobals();
    });

    it("handles non-Error rejection", async () => {
      const getCurrentPositionMock = vi.fn((_success, error) => {
        error("String error");
      });

      vi.stubGlobal("navigator", {
        geolocation: {
          getCurrentPosition: getCurrentPositionMock,
        },
      });

      const result = await executeGetLocation();

      expect(result.success).toBe(false);
      expect(result.error).toBe("Geolocation failed");

      vi.unstubAllGlobals();
    });
  });

  describe("executeChangeBgm", () => {
    it("switches track when current track differs from target", async () => {
      const mockBgmChannel = {
        currentTrack: 0,
        switchTrack: vi.fn(),
      };

      const deps: ToolExecutorDependencies = {
        bgmChannel: mockBgmChannel,
      };

      // Request track 2 (1-indexed), target audio track is 1 (0-indexed)
      const result = await executeChangeBgm({ track: 2 }, deps);

      expect(result.success).toBe(true);
      expect(mockBgmChannel.switchTrack).toHaveBeenCalledTimes(1);
      expect(result.output).toEqual({
        track: 2,
        message: "BGM changed to track 2",
      });
    });

    it("does not switch track when already on target", async () => {
      const mockBgmChannel = {
        currentTrack: 1, // Already on track 2 (0-indexed = 1)
        switchTrack: vi.fn(),
      };

      const deps: ToolExecutorDependencies = {
        bgmChannel: mockBgmChannel,
      };

      // Request track 2 (1-indexed), target audio track is 1 (0-indexed)
      const result = await executeChangeBgm({ track: 2 }, deps);

      expect(result.success).toBe(true);
      expect(mockBgmChannel.switchTrack).not.toHaveBeenCalled();
    });

    it("defaults to track 1 when no track specified", async () => {
      const mockBgmChannel = {
        currentTrack: 1, // On track 2
        switchTrack: vi.fn(),
      };

      const deps: ToolExecutorDependencies = {
        bgmChannel: mockBgmChannel,
      };

      const result = await executeChangeBgm({}, deps);

      expect(result.success).toBe(true);
      // Target is track 1 (1-indexed) = 0 (0-indexed)
      // Current is 1, so switch should happen
      expect(mockBgmChannel.switchTrack).toHaveBeenCalledTimes(1);
      expect(result.output).toEqual({
        track: 1,
        message: "BGM changed to track 1",
      });
    });

    it("returns error when bgmChannel is not available", async () => {
      const deps: ToolExecutorDependencies = {
        bgmChannel: undefined,
      };

      const result = await executeChangeBgm({ track: 1 }, deps);

      expect(result.success).toBe(false);
      expect(result.error).toBe("BGM channel not available");
    });
  });

  describe("Custom Executor Integration", () => {
    beforeEach(() => {
      resetToolExecutors();
    });

    it("custom executor receives input and deps correctly", async () => {
      const customExecutor = vi.fn(
        async (
          input: Record<string, unknown>,
          deps: ToolExecutorDependencies,
        ): Promise<ToolExecutorResult> => {
          return {
            success: true,
            output: {
              receivedInput: input,
              hasBgmChannel: !!deps.bgmChannel,
            },
          };
        },
      );

      registerToolExecutor("test_tool", customExecutor);

      const executor = getToolExecutor("test_tool");
      expect(executor).toBeDefined();

      const deps: ToolExecutorDependencies = {
        bgmChannel: { currentTrack: 0, switchTrack: vi.fn() },
      };

      const result = await executor!({ foo: "bar" }, deps);

      expect(customExecutor).toHaveBeenCalledWith({ foo: "bar" }, deps);
      expect(result.success).toBe(true);
      expect(result.output).toEqual({
        receivedInput: { foo: "bar" },
        hasBgmChannel: true,
      });
    });

    it("custom executor can return error", async () => {
      const failingExecutor = async (): Promise<ToolExecutorResult> => {
        return {
          success: false,
          error: "Custom error message",
        };
      };

      registerToolExecutor("failing_tool", failingExecutor);

      const executor = getToolExecutor("failing_tool");
      const result = await executor!({}, {});

      expect(result.success).toBe(false);
      expect(result.error).toBe("Custom error message");
    });
  });
});
