/**
 * Audio Player Component Unit Tests
 *
 * Tests the AudioPlayer component's rendering and basic functionality.
 * Web Audio API (AudioContext, AudioWorklet) are mocked as they require browser environment.
 *
 * Test Categories:
 * 1. Component Rendering - Basic UI elements
 * 2. Audio Initialization - AudioContext and AudioWorklet setup
 * 3. Chunk Processing - Handling PCM audio chunks
 * 4. Error Handling - Display and recovery from errors
 *
 * @vitest-environment jsdom
 */

import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioPlayer } from "@/components/audio-player";

// Mock Web Audio API
class MockAudioContext {
  sampleRate = 24000;
  destination = {};
  state = "running";

  audioWorklet = {
    addModule: vi.fn().mockResolvedValue(undefined),
  };

  close = vi.fn().mockResolvedValue(undefined);
}

class MockAudioWorkletNode {
  connect = vi.fn();
  disconnect = vi.fn();
  port = {
    postMessage: vi.fn(),
  };
}

describe("AudioPlayer", () => {
  let mockAudioContext: MockAudioContext;
  let mockAudioWorkletNode: MockAudioWorkletNode;

  beforeEach(() => {
    // Reset mocks
    mockAudioContext = new MockAudioContext();
    mockAudioWorkletNode = new MockAudioWorkletNode();

    // Setup global mocks using class constructors
    global.AudioContext = vi.fn(function (this: any, _options?: any) {
      return mockAudioContext;
    }) as any;
    global.AudioWorkletNode = vi.fn(function (
      this: any,
      _context: any,
      _name: string,
    ) {
      return mockAudioWorkletNode;
    }) as any;

    // Clear console to avoid noise
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Component Rendering", () => {
    it("should render without errors", () => {
      const { container } = render(<AudioPlayer chunks={[]} />);
      expect(container).toBeInTheDocument();
    });

    it("should render with audio player UI elements", async () => {
      const chunks = [
        {
          content: "AAAA",
          sampleRate: 24000,
          channels: 1,
          bitDepth: 16,
        },
      ];

      render(<AudioPlayer chunks={chunks} />);

      // Wait for AudioWorklet initialization
      await waitFor(() => {
        expect(mockAudioContext.audioWorklet.addModule).toHaveBeenCalledWith(
          "/pcm-player-processor.js",
        );
      });
    });
  });

  describe("Audio Initialization", () => {
    it("should initialize AudioContext with correct sample rate", async () => {
      render(<AudioPlayer chunks={[]} />);

      await waitFor(() => {
        expect(global.AudioContext).toHaveBeenCalledWith({ sampleRate: 24000 });
      });
    });

    it("should load AudioWorklet processor module", async () => {
      render(<AudioPlayer chunks={[]} />);

      await waitFor(() => {
        expect(mockAudioContext.audioWorklet.addModule).toHaveBeenCalledWith(
          "/pcm-player-processor.js",
        );
      });
    });

    it("should create AudioWorkletNode and connect to destination", async () => {
      render(<AudioPlayer chunks={[]} />);

      await waitFor(() => {
        expect(global.AudioWorkletNode).toHaveBeenCalledWith(
          mockAudioContext,
          "pcm-player-processor",
        );
        expect(mockAudioWorkletNode.connect).toHaveBeenCalledWith(
          mockAudioContext.destination,
        );
      });
    });
  });

  describe("Chunk Processing", () => {
    // Note: Chunk processing implementation details are tested in lib/tests/unit/audio-worklet-manager.test.ts
    // Component tests focus on UI/UX behavior

    it("should handle multiple chunks", async () => {
      const chunks = [
        {
          content: "AAAA",
          sampleRate: 24000,
          channels: 1,
          bitDepth: 16,
        },
        {
          content: "BBBB",
          sampleRate: 24000,
          channels: 1,
          bitDepth: 16,
        },
      ];

      render(<AudioPlayer chunks={chunks} />);

      await waitFor(() => {
        expect(mockAudioContext.audioWorklet.addModule).toHaveBeenCalled();
      });
    });

    it("should handle empty chunks array", () => {
      const { container } = render(<AudioPlayer chunks={[]} />);
      expect(container).toBeInTheDocument();
    });
  });

  describe("Error Handling", () => {
    // Note: Error handling implementation details are tested in lib/tests/unit/audio-worklet-manager.test.ts
    // Component tests focus on UI error display

    it("should not crash when AudioContext is not available", async () => {
      // Remove AudioContext from global
      (global as any).AudioContext = undefined;

      const { container } = render(<AudioPlayer chunks={[]} />);

      expect(container).toBeInTheDocument();

      await waitFor(() => {
        // Should show error about AudioContext not being available
        expect(console.error).toHaveBeenCalled();
      });
    });
  });

  describe("Cleanup", () => {
    it("should disconnect AudioWorkletNode on unmount", async () => {
      const { unmount } = render(<AudioPlayer chunks={[]} />);

      await waitFor(() => {
        expect(mockAudioWorkletNode.connect).toHaveBeenCalled();
      });

      unmount();

      expect(mockAudioWorkletNode.disconnect).toHaveBeenCalled();
    });

    it("should close AudioContext on unmount", async () => {
      const { unmount } = render(<AudioPlayer chunks={[]} />);

      await waitFor(() => {
        expect(global.AudioContext).toHaveBeenCalled();
      });

      unmount();

      expect(mockAudioContext.close).toHaveBeenCalled();
    });
  });
});
