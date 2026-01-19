/**
 * Tool Utilities Unit Tests
 *
 * Tests for tool name extraction and Frontend Execute detection logic.
 * Covers ADR 0005 (Frontend Execute pattern) compliance.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  extractToolName,
  extractToolNameFromType,
  getFrontendExecuteTools,
  getFrontendExecuteToolsByCategory,
  isFrontendExecuteTool,
  isToolType,
  registerFrontendExecuteTool,
  resetFrontendExecuteTools,
} from "../../tool-utils";

describe("tool-utils", () => {
  describe("extractToolName", () => {
    it("extracts tool name from toolName field", () => {
      const part = { toolName: "process_payment" };
      expect(extractToolName(part)).toBe("process_payment");
    });

    it("extracts tool name from tool- prefixed type", () => {
      const part = { type: "tool-get_location" };
      expect(extractToolName(part)).toBe("get_location");
    });

    it("prioritizes toolName over type", () => {
      const part = { toolName: "actual_name", type: "tool-different_name" };
      expect(extractToolName(part)).toBe("actual_name");
    });

    it("returns fallback when no tool name found", () => {
      const part = { type: "text" };
      expect(extractToolName(part, "unknown")).toBe("unknown");
    });

    it("returns empty string as default fallback", () => {
      const part = {};
      expect(extractToolName(part)).toBe("");
    });

    it("handles undefined type gracefully", () => {
      const part = { type: undefined };
      expect(extractToolName(part, "fallback")).toBe("fallback");
    });
  });

  describe("extractToolNameFromType", () => {
    it("extracts tool name from tool- prefixed type", () => {
      expect(extractToolNameFromType("tool-change_bgm")).toBe("change_bgm");
    });

    it("returns original type if not tool- prefixed", () => {
      expect(extractToolNameFromType("text")).toBe("text");
    });

    it("handles empty string", () => {
      expect(extractToolNameFromType("")).toBe("");
    });

    it("handles type with only tool- prefix", () => {
      expect(extractToolNameFromType("tool-")).toBe("");
    });
  });

  describe("isToolType", () => {
    it("returns true for tool- prefixed types", () => {
      expect(isToolType("tool-get_location")).toBe(true);
      expect(isToolType("tool-process_payment")).toBe(true);
      expect(isToolType("tool-change_bgm")).toBe(true);
    });

    it("returns false for non-tool types", () => {
      expect(isToolType("text")).toBe(false);
      expect(isToolType("reasoning")).toBe(false);
      expect(isToolType("")).toBe(false);
    });

    it("returns false for partial matches", () => {
      expect(isToolType("tooling")).toBe(false);
      expect(isToolType("my-tool-name")).toBe(false);
    });
  });

  describe("Frontend Execute Detection", () => {
    beforeEach(() => {
      // Reset to default state before each test
      resetFrontendExecuteTools();
    });

    describe("isFrontendExecuteTool", () => {
      it("returns true for built-in Frontend Execute tools", () => {
        expect(isFrontendExecuteTool("get_location")).toBe(true);
        expect(isFrontendExecuteTool("take_photo")).toBe(true);
        expect(isFrontendExecuteTool("get_camera")).toBe(true);
      });

      it("returns false for Server Execute tools", () => {
        expect(isFrontendExecuteTool("process_payment")).toBe(false);
        expect(isFrontendExecuteTool("send_email")).toBe(false);
        expect(isFrontendExecuteTool("unknown_tool")).toBe(false);
      });

      it("returns true for custom registered tools", () => {
        registerFrontendExecuteTool({
          name: "scan_qr_code",
          category: "camera",
          description: "Scans QR codes",
        });

        expect(isFrontendExecuteTool("scan_qr_code")).toBe(true);
      });
    });

    describe("registerFrontendExecuteTool", () => {
      it("registers a new Frontend Execute tool", () => {
        registerFrontendExecuteTool({
          name: "get_clipboard",
          category: "clipboard",
          description: "Reads clipboard content",
        });

        expect(isFrontendExecuteTool("get_clipboard")).toBe(true);
      });

      it("overwrites existing tool with same name", () => {
        registerFrontendExecuteTool({
          name: "get_location",
          category: "geolocation",
          description: "Updated description",
        });

        const tools = getFrontendExecuteTools();
        const locationTool = tools.find((t) => t.name === "get_location");
        expect(locationTool?.description).toBe("Updated description");
      });
    });

    describe("getFrontendExecuteTools", () => {
      it("returns all registered tools", () => {
        const tools = getFrontendExecuteTools();
        expect(tools.length).toBeGreaterThanOrEqual(3);

        const names = tools.map((t) => t.name);
        expect(names).toContain("get_location");
        expect(names).toContain("take_photo");
        expect(names).toContain("get_camera");
      });

      it("includes custom registered tools", () => {
        registerFrontendExecuteTool({
          name: "custom_tool",
          category: "other",
        });

        const tools = getFrontendExecuteTools();
        const names = tools.map((t) => t.name);
        expect(names).toContain("custom_tool");
      });
    });

    describe("getFrontendExecuteToolsByCategory", () => {
      it("returns tools filtered by category", () => {
        const cameraTools = getFrontendExecuteToolsByCategory("camera");
        expect(cameraTools.length).toBe(2);

        const names = cameraTools.map((t) => t.name);
        expect(names).toContain("take_photo");
        expect(names).toContain("get_camera");
      });

      it("returns geolocation tools", () => {
        const geoTools = getFrontendExecuteToolsByCategory("geolocation");
        expect(geoTools.length).toBe(1);
        expect(geoTools[0].name).toBe("get_location");
      });

      it("returns empty array for category with no tools", () => {
        const notificationTools =
          getFrontendExecuteToolsByCategory("notification");
        expect(notificationTools.length).toBe(0);
      });

      it("includes custom tools in category filter", () => {
        registerFrontendExecuteTool({
          name: "record_audio",
          category: "microphone",
        });

        const micTools = getFrontendExecuteToolsByCategory("microphone");
        expect(micTools.length).toBe(1);
        expect(micTools[0].name).toBe("record_audio");
      });
    });

    describe("resetFrontendExecuteTools", () => {
      it("clears custom tools and restores defaults", () => {
        // Add custom tool
        registerFrontendExecuteTool({
          name: "custom_tool",
          category: "other",
        });
        expect(isFrontendExecuteTool("custom_tool")).toBe(true);

        // Reset
        resetFrontendExecuteTools();

        // Custom tool should be gone
        expect(isFrontendExecuteTool("custom_tool")).toBe(false);

        // Defaults should remain
        expect(isFrontendExecuteTool("get_location")).toBe(true);
        expect(isFrontendExecuteTool("take_photo")).toBe(true);
        expect(isFrontendExecuteTool("get_camera")).toBe(true);
      });
    });
  });
});
