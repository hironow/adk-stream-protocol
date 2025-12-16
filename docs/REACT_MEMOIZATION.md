# React Memoization Best Practices

This document outlines memoization best practices for React components in this project, based on real issues discovered and fixed in the codebase.

## Table of Contents

- [Why Memoization Matters](#why-memoization-matters)
- [Context Provider Memoization](#context-provider-memoization)
- [Custom Hooks Memoization](#custom-hooks-memoization)
- [Component Props Memoization](#component-props-memoization)
- [Testing Memoization](#testing-memoization)
- [Common Pitfalls](#common-pitfalls)

## Why Memoization Matters

Improper memoization in React can cause:

1. **Performance Issues**: Unnecessary re-renders of entire component trees
2. **Subtle Bugs**: Objects being recreated when they should remain stable
3. **Resource Leaks**: WebSocket connections, AudioContext instances, or other resources being recreated unnecessarily

## Context Provider Memoization

### The Problem

Context Providers that don't memoize their value object cause **ALL consumers to re-render every time the Provider re-renders**, even if the actual state hasn't changed.

### The Solution

**Always wrap Provider value objects with `useMemo`** and **all functions with `useCallback`**.

### Example from AudioContext

**lib/audio-context.tsx:467-500**

```typescript
// ❌ BAD: Creates new object on every render
const value = {
  voiceChannel: {
    isPlaying,
    sendChunk,
    reset,
  },
  isReady,
  activate,
};

// ✅ GOOD: Memoized value object
const value: AudioContextValue = useMemo(
  () => ({
    voiceChannel: {
      isPlaying,
      chunkCount,
      sendChunk,      // These functions are memoized with useCallback
      reset,
      onComplete: handleAudioComplete,
      lastCompletion,
    },
    bgmChannel: {
      currentTrack: currentBgmTrack,
      switchTrack,
    },
    isReady,
    error,
    needsUserActivation,
    activate,
  }),
  [
    // Include ALL values used in the object
    isPlaying,
    chunkCount,
    sendChunk,
    reset,
    handleAudioComplete,
    lastCompletion,
    currentBgmTrack,
    switchTrack,
    isReady,
    error,
    needsUserActivation,
    activate,
  ],
);
```

### Memoizing Functions

**lib/audio-context.tsx:339-382**

```typescript
// ✅ GOOD: Memoized functions
const sendChunk = useCallback((chunk: PCMChunk) => {
  if (!audioWorkletNodeRef.current) {
    console.warn("[AudioContext] Cannot send chunk: AudioWorklet not ready");
    return;
  }
  // ... implementation
}, []); // Empty deps array means function never changes

const reset = useCallback(() => {
  setChunkCount(0);
  setIsPlaying(false);
  setLastCompletion(null);
  if (audioWorkletNodeRef.current) {
    audioWorkletNodeRef.current.port.postMessage({ command: "reset" });
  }
}, []); // Empty deps array - uses refs and setters which are stable

const activate = useCallback(async () => {
  // ... implementation
}, []); // Empty deps array

const switchTrack = useCallback((track: BgmTrack) => {
  // ... implementation
}, [currentBgmTrack, isPlaying]); // Only depends on these values
```

### Key Points

1. **useMemo for objects**: Wrap the entire value object in `useMemo`
2. **useCallback for functions**: Wrap all functions in `useCallback`
3. **Complete dependency arrays**: Include all values used in the memoized value
4. **Refs are stable**: `useRef` values don't need to be in dependency arrays
5. **Setters are stable**: State setters from `useState` are always stable

## Custom Hooks Memoization

### The Problem

Custom hooks that return functions or objects can cause unnecessary re-renders if those values aren't memoized.

### The Solution

Use `useCallback` for returned functions with appropriate dependency arrays.

### Example from useAudioRecorder

**lib/use-audio-recorder.ts:82-131**

```typescript
// ✅ GOOD: Memoized function with correct dependencies
const startRecording = useCallback(
  async (onChunk: (chunk: AudioChunk) => void) => {
    if (mode !== "adk-bidi") {
      console.warn("Recording only available in BIDI mode");
      return;
    }

    if (isRecording) {
      console.warn("Already recording");
      return;
    }

    try {
      const { AudioRecorder } = await import("@/lib/audio-recorder");
      const recorder = new AudioRecorder();
      await recorder.initialize();
      recorderRef.current = recorder;
      await recorder.start(onChunk);
      setIsRecording(true);
      setError(null);
    } catch (err) {
      // ... error handling
    }
  },
  [mode, isRecording], // Depends on mode and isRecording
);

const stopRecording = useCallback(async () => {
  if (!recorderRef.current || !isRecording) {
    console.warn("Not recording");
    return;
  }

  try {
    await recorderRef.current.close();
    recorderRef.current = null;
    setIsRecording(false);
  } catch (err) {
    // ... error handling
  }
}, [isRecording]); // Only depends on isRecording
```

### Key Points

1. **Minimize dependencies**: Only include values that are actually used
2. **Refs are stable**: Don't include refs in dependency arrays
3. **State setters are stable**: Don't include `useState` setters in dependency arrays

## Component Props Memoization

### When to Memoize Props

**✅ DO memoize when:**
- Passing functions or objects to **React components** (not DOM elements)
- The parent component re-renders frequently
- The child component is expensive to render

**❌ DON'T memoize when:**
- Passing to **DOM elements** (`<button>`, `<div>`, etc.)
- The component rarely re-renders
- Premature optimization

### Example

```typescript
// ❌ BAD: Inline function passed to React component
function ParentComponent() {
  return (
    <ExpensiveChildComponent
      onClick={() => console.log("clicked")}
    />
  );
}

// ✅ GOOD: Memoized function
function ParentComponent() {
  const handleClick = useCallback(() => {
    console.log("clicked");
  }, []);

  return (
    <ExpensiveChildComponent onClick={handleClick} />
  );
}

// ✅ ALSO GOOD: Inline function on DOM element (no React re-render cascade)
function ParentComponent() {
  return (
    <button onClick={() => console.log("clicked")}>
      Click me
    </button>
  );
}
```

## Testing Memoization

### Why Test Memoization?

Tests prevent regressions and document expected behavior.

### Example Test

**lib/audio-context-memoization.test.tsx:26-116**

```typescript
it("should maintain stable value reference when parent re-renders", () => {
  let childRenderCount = 0;
  let previousValue: ReturnType<typeof useAudio> | null = null;

  function ChildComponent() {
    const audioContext = useAudio();
    childRenderCount++;

    // Verify value reference is stable when state unchanged
    if (previousValue && audioContext.error === previousValue.error) {
      expect(audioContext).toBe(previousValue); // Same object reference

      // Verify functions are stable
      expect(audioContext.voiceChannel.sendChunk).toBe(
        previousValue.voiceChannel.sendChunk,
      );
      expect(audioContext.activate).toBe(previousValue.activate);
    }

    // When state changes, value should be different but functions still stable
    if (previousValue && audioContext.error !== previousValue.error) {
      expect(audioContext).not.toBe(previousValue); // Different object

      // But functions should STILL be the same reference
      expect(audioContext.voiceChannel.sendChunk).toBe(
        previousValue.voiceChannel.sendChunk,
      );
    }

    previousValue = audioContext;
    return <div>Child</div>;
  }

  function ParentComponent() {
    const [count, setCount] = useState(0);
    return (
      <div>
        <AudioProvider>
          <ChildComponent />
        </AudioProvider>
        <button
          onClick={() => setCount(count + 1)}
          data-testid="trigger-rerender"
        >
          Re-render
        </button>
      </div>
    );
  }

  const { getByTestId } = render(<ParentComponent />);
  const initialRenderCount = childRenderCount;

  // Trigger parent re-render
  fireEvent.click(getByTestId("trigger-rerender"));

  // Child re-renders, but memoization checks pass
  expect(childRenderCount).toBe(initialRenderCount + 1);
});
```

### Key Testing Patterns

1. **Use `toBe()` for referential equality**: Checks if it's the same object
2. **Test with parent re-renders**: Ensure child doesn't re-render unnecessarily
3. **Test state changes**: Ensure new values are created when state actually changes
4. **Use `fireEvent` from React Testing Library**: Properly handles React's batching

## Common Pitfalls

### 1. Missing Dependencies

```typescript
// ❌ BAD: Missing userId dependency
const loadUser = useCallback(() => {
  fetchUser(userId); // Uses userId but it's not in deps
}, []);

// ✅ GOOD: Include all dependencies
const loadUser = useCallback(() => {
  fetchUser(userId);
}, [userId]);
```

### 2. Over-memoization

```typescript
// ❌ BAD: Unnecessary memoization on DOM element
function Component() {
  const handleClick = useCallback(() => {
    console.log("clicked");
  }, []);

  return <button onClick={handleClick}>Click</button>;
}

// ✅ GOOD: Inline function is fine for DOM elements
function Component() {
  return <button onClick={() => console.log("clicked")}>Click</button>;
}
```

### 3. Memoizing Everything in useMemo

```typescript
// ❌ BAD: Memoizing primitives unnecessarily
const value = useMemo(() => ({
  count: 5, // Primitive - no need to memoize
  label: "Hello", // Primitive - no need to memoize
}), []);

// ✅ GOOD: Only memoize when object identity matters
const value = useMemo(() => ({
  items: computeExpensiveList(),
  onItemClick: handleItemClick,
}), [computeExpensiveList, handleItemClick]);
```

### 4. Forgetting to Memoize Functions in Context

```typescript
// ❌ BAD: Function not memoized but used in Context value
function MyProvider({ children }) {
  const [state, setState] = useState(0);

  function handleUpdate() { // Not memoized!
    setState(state + 1);
  }

  const value = useMemo(() => ({
    state,
    handleUpdate, // This function changes every render!
  }), [state, handleUpdate]); // handleUpdate causes new value every render

  return <MyContext.Provider value={value}>{children}</MyContext.Provider>;
}

// ✅ GOOD: Function memoized
function MyProvider({ children }) {
  const [state, setState] = useState(0);

  const handleUpdate = useCallback(() => {
    setState(prev => prev + 1); // Use functional update
  }, []); // Empty deps - function never changes

  const value = useMemo(() => ({
    state,
    handleUpdate,
  }), [state, handleUpdate]); // handleUpdate is stable

  return <MyContext.Provider value={value}>{children}</MyContext.Provider>;
}
```

## Summary

1. **Context Providers**: Always use `useMemo` for value objects and `useCallback` for functions
2. **Custom Hooks**: Memoize returned functions with `useCallback`
3. **Component Props**: Memoize functions/objects passed to React components, not DOM elements
4. **Testing**: Write tests to verify memoization behavior and prevent regressions
5. **Dependencies**: Always include all used values in dependency arrays
6. **Don't Over-optimize**: Inline functions on DOM elements are fine

## References

- Test suite: `lib/audio-context-memoization.test.tsx`
- Example Context Provider: `lib/audio-context.tsx`
- Example Custom Hook: `lib/use-audio-recorder.ts`
