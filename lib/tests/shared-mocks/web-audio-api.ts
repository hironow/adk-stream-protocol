/**
 * Shared Web Audio API mocks for tests
 *
 * Provides mock implementations of Web Audio API classes that are not
 * available in jsdom test environment. Used by audio-related e2e and
 * integration tests.
 *
 * Mocked APIs:
 * - AudioContext / AudioWorkletNode
 * - MediaStream / MediaStreamTrack
 * - navigator.mediaDevices.getUserMedia
 *
 * Usage:
 * ```typescript
 * import { setupWebAudioMocks, createMockMediaStream } from '../shared-mocks/web-audio-api';
 *
 * describe('my audio tests', () => {
 *   const { mockAudioContext, mockWorkletNode } = setupWebAudioMocks();
 *
 *   it('should handle audio', async () => {
 *     // mockAudioContext and mockWorkletNode are available
 *   });
 * });
 * ```
 */

import { afterEach, beforeEach, vi } from "vitest";

/**
 * Mock AudioContext with all required properties for testing
 */
export class MockAudioContext {
  sampleRate = 16000;
  state: AudioContextState = "running";
  destination = {} as AudioDestinationNode;

  audioWorklet = {
    addModule: vi.fn().mockResolvedValue(undefined),
  };

  createMediaStreamSource = vi.fn().mockReturnValue({
    connect: vi.fn(),
    disconnect: vi.fn(),
  });

  createGain = vi.fn().mockReturnValue({
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  });

  createBufferSource = vi.fn().mockReturnValue({
    buffer: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null,
  });

  createBuffer = vi.fn(
    (channels: number, length: number, sampleRate: number) => ({
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: vi.fn().mockReturnValue(new Float32Array(length)),
      copyToChannel: vi.fn(),
    }),
  );

  resume = vi.fn().mockResolvedValue(undefined);
  suspend = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
}

/**
 * Mock AudioWorkletNode for testing
 */
export class MockAudioWorkletNode {
  port = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: vi.fn(),
  };

  connect = vi.fn();
  disconnect = vi.fn();

  /**
   * Simulate receiving a message from the AudioWorklet processor
   */
  simulateMessage(data: Float32Array): void {
    if (this.port.onmessage) {
      this.port.onmessage(new MessageEvent("message", { data }));
    }
  }
}

/**
 * Mock MediaStreamTrack for testing
 */
export class MockMediaStreamTrack {
  kind = "audio";
  enabled = true;
  id = `mock-track-${Date.now()}`;
  readyState: MediaStreamTrackState = "live";

  stop = vi.fn(() => {
    this.readyState = "ended";
  });

  clone = vi.fn(() => new MockMediaStreamTrack());
}

/**
 * Mock MediaStream for testing
 */
export class MockMediaStream {
  private tracks: MockMediaStreamTrack[] = [];

  constructor(tracks?: MockMediaStreamTrack[]) {
    this.tracks = tracks ?? [new MockMediaStreamTrack()];
  }

  getTracks = vi.fn(() => this.tracks);
  getAudioTracks = vi.fn(() => this.tracks.filter((t) => t.kind === "audio"));
  getVideoTracks = vi.fn(() => this.tracks.filter((t) => t.kind === "video"));
  addTrack = vi.fn((track: MockMediaStreamTrack) => this.tracks.push(track));
  removeTrack = vi.fn((track: MockMediaStreamTrack) => {
    const index = this.tracks.indexOf(track);
    if (index > -1) this.tracks.splice(index, 1);
  });
}

/**
 * Mock HTMLAudioElement for BGM testing
 */
export class MockHTMLAudioElement {
  src = "";
  currentTime = 0;
  duration = 120; // 2 minutes
  paused = true;
  volume = 1;
  muted = false;
  loop = false;

  play = vi.fn().mockImplementation(() => {
    this.paused = false;
    return Promise.resolve();
  });

  pause = vi.fn().mockImplementation(() => {
    this.paused = true;
  });

  load = vi.fn();

  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

/**
 * State tracking for mocks
 */
interface MockState {
  audioContextInstance: MockAudioContext | null;
  workletNodeInstances: MockAudioWorkletNode[];
  mediaStreams: MockMediaStream[];
  audioElements: MockHTMLAudioElement[];
}

let mockState: MockState = {
  audioContextInstance: null,
  workletNodeInstances: [],
  mediaStreams: [],
  audioElements: [],
};

/**
 * Setup Web Audio API mocks for tests
 *
 * Call this in describe block or beforeEach to enable audio mocking.
 * Mocks are automatically cleaned up in afterEach.
 *
 * @returns Object with access to mock instances for assertions
 */
export function setupWebAudioMocks(): {
  getMockAudioContext: () => MockAudioContext | null;
  getMockWorkletNodes: () => MockAudioWorkletNode[];
  getMockMediaStreams: () => MockMediaStream[];
  createMockMediaStream: () => MockMediaStream;
  simulateGetUserMediaFailure: (error: Error) => void;
} {
  beforeEach(() => {
    // Reset state
    mockState = {
      audioContextInstance: null,
      workletNodeInstances: [],
      mediaStreams: [],
      audioElements: [],
    };

    // Mock AudioContext
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function (this: MockAudioContext) {
        const ctx = new MockAudioContext();
        mockState.audioContextInstance = ctx;
        return ctx;
      }),
    );

    // Mock AudioWorkletNode
    vi.stubGlobal(
      "AudioWorkletNode",
      vi.fn(function (
        this: MockAudioWorkletNode,
        _context: AudioContext,
        _name: string,
        _options?: AudioWorkletNodeOptions,
      ) {
        const node = new MockAudioWorkletNode();
        mockState.workletNodeInstances.push(node);
        return node;
      }),
    );

    // Mock navigator.mediaDevices.getUserMedia
    const mockGetUserMedia = vi.fn().mockImplementation(() => {
      const stream = new MockMediaStream();
      mockState.mediaStreams.push(stream);
      return Promise.resolve(stream);
    });

    Object.defineProperty(global, "navigator", {
      writable: true,
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: mockGetUserMedia,
          enumerateDevices: vi.fn().mockResolvedValue([
            {
              deviceId: "default",
              kind: "audioinput",
              label: "Default Microphone",
            },
            {
              deviceId: "default",
              kind: "audiooutput",
              label: "Default Speaker",
            },
          ]),
        },
        permissions: {
          query: vi.fn().mockResolvedValue({ state: "granted" }),
        },
      },
    });

    // Mock HTMLAudioElement constructor
    vi.stubGlobal(
      "Audio",
      vi.fn(function (this: MockHTMLAudioElement, src?: string) {
        const audio = new MockHTMLAudioElement();
        if (src) audio.src = src;
        mockState.audioElements.push(audio);
        return audio;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockState = {
      audioContextInstance: null,
      workletNodeInstances: [],
      mediaStreams: [],
      audioElements: [],
    };
  });

  return {
    /**
     * Get the current mock AudioContext instance
     */
    getMockAudioContext: () => mockState.audioContextInstance,

    /**
     * Get all created mock AudioWorkletNode instances
     */
    getMockWorkletNodes: () => [...mockState.workletNodeInstances],

    /**
     * Get all created mock MediaStream instances
     */
    getMockMediaStreams: () => [...mockState.mediaStreams],

    /**
     * Create a new mock MediaStream manually
     */
    createMockMediaStream: () => {
      const stream = new MockMediaStream();
      mockState.mediaStreams.push(stream);
      return stream;
    },

    /**
     * Make the next getUserMedia call fail with the given error
     */
    simulateGetUserMediaFailure: (error: Error) => {
      (
        navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(error);
    },
  };
}

/**
 * Create a mock AudioBuffer for testing audio playback
 */
export function createMockAudioBuffer(
  options: { channels?: number; length?: number; sampleRate?: number } = {},
): AudioBuffer {
  const { channels = 1, length = 1024, sampleRate = 16000 } = options;

  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: vi.fn().mockReturnValue(new Float32Array(length)),
    copyToChannel: vi.fn(),
    copyFromChannel: vi.fn(),
  } as unknown as AudioBuffer;
}

/**
 * Create mock PCM data as base64 string
 */
export function createMockPCMData(
  samples: number[] = [0, 0.5, -0.5, 1, -1],
): string {
  const int16Samples = samples.map((s) =>
    Math.round(Math.max(-1, Math.min(1, s)) * 0x7fff),
  );
  const buffer = new ArrayBuffer(int16Samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < int16Samples.length; i++) {
    view.setInt16(i * 2, int16Samples[i], true);
  }

  // Convert to base64
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}
