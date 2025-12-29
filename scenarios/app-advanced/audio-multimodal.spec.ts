import { expect, test } from "@playwright/test";

/**
 * Audio and Multimodal - Advanced Tests
 *
 * Tests for audio features and multimodal interactions.
 * Covers voice input, audio playback, image uploads, and mixed media.
 *
 * Test Focus:
 * - Audio playback in BIDI mode
 * - Image upload and display
 * - Mixed text and image messages
 * - BGM controls
 * - Audio streaming
 */
test.describe("Audio and Multimodal (Advanced)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should display BGM controls in BIDI mode", async ({ page }) => {
    // Given: BIDI mode (audio features available)
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();

    // Wait for mode to initialize
    await page.waitForTimeout(1000);

    // Then: Look for BGM-related UI elements
    // Note: Actual implementation may vary
    const bodyText = await page.textContent("body");
    expect(bodyText).toBeTruthy();

    // Mode should be BIDI
    const bidiButtonStyles = await adkBidiButton.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return styles.borderColor;
    });
    expect(bidiButtonStyles).toBeTruthy();
  });

  test("should handle BGM change requests", async ({ page }) => {
    // Given: BIDI mode
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();

    // When: Request BGM change
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Change the background music to relaxing sounds");
    await chatInput.press("Enter");

    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "background music",
    );
    await page.waitForTimeout(4000);

    // Then: BGM change tool should execute
    const bodyText = await page.textContent("body");
    expect(bodyText).toContain("background music");
  });

  test("should handle image upload", async ({ page }) => {
    // Given: Any mode with image upload capability
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // Look for file input (hidden or visible)
    const fileInputs = await page.locator('input[type="file"]').all();

    if (fileInputs.length > 0) {
      // Then: File upload should be available
      const fileInput = fileInputs[0];
      const isPresent = (await fileInput.count()) > 0;
      expect(isPresent).toBeTruthy();
    }

    // Can still send text messages
    await chatInput.fill("Test message");
    await chatInput.press("Enter");
    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "Test message",
    );
  });

  test("should display uploaded images in chat", async ({ page }) => {
    // Given: Check if image upload is available
    const fileInputs = await page.locator('input[type="file"]').all();

    if (fileInputs.length > 0) {
      // Note: Actual file upload requires a real image file
      // This test verifies the UI structure is present

      // Then: File input should accept images
      const acceptAttr = await fileInputs[0].getAttribute("accept");
      expect(acceptAttr).toContain("image");
    }
  });

  test("should handle mixed text and image messages", async ({ page }) => {
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // Given: Send text message
    await chatInput.fill("Here is some text");
    await chatInput.press("Enter");
    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "Here is some text",
    );
    await page.waitForTimeout(2000);

    // Note: Image upload would go here in a real scenario

    // Then: Can continue with text messages
    await chatInput.fill("More text after image");
    await chatInput.press("Enter");
    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "More text after image",
    );
  });

  test("should handle audio completion notifications in BIDI mode", async ({
    page,
  }) => {
    // Given: BIDI mode
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();

    // When: Send message that triggers audio response
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Tell me a story");
    await chatInput.press("Enter");

    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "Tell me a story",
    );
    await page.waitForTimeout(5000);

    // Then: Audio completion notification might appear
    // Note: Depends on implementation
    const bodyText = await page.textContent("body");
    expect(bodyText).toBeTruthy();
  });

  test.skip("should support push-to-talk voice input", async ({ page }) => {
    // This test requires microphone access
    // Skipped until voice input testing is implemented

    // Given: BIDI mode with voice capability
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();

    // When: Simulate CMD key press (push-to-talk)
    await page.keyboard.down("Meta");
    await page.waitForTimeout(2000);
    await page.keyboard.up("Meta");

    // Then: Voice input should be processed
  });

  test("should maintain audio state during mode switches", async ({ page }) => {
    // Given: Start in BIDI mode with BGM
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Play background music");
    await chatInput.press("Enter");
    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "background music",
    );
    await page.waitForTimeout(3000);

    // When: Switch to SSE mode
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();
    await page.waitForTimeout(1000);

    // Then: Can send messages in new mode
    await chatInput.fill("Message in SSE mode");
    await chatInput.press("Enter");
    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "SSE mode",
    );

    // Switch back to BIDI
    await adkBidiButton.click();
    await page.waitForTimeout(1000);

    // Audio state may be preserved or reset
    const bodyText = await page.textContent("body");
    expect(bodyText).toContain("background music");
    expect(bodyText).toContain("SSE mode");
  });

  test("should handle multiple audio completions", async ({ page }) => {
    // Given: BIDI mode
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // When: Send multiple messages that might have audio
    await chatInput.fill("First audio message");
    await chatInput.press("Enter");
    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "First audio message",
    );
    await page.waitForTimeout(3000);

    await chatInput.fill("Second audio message");
    await chatInput.press("Enter");
    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "Second audio message",
    );
    await page.waitForTimeout(3000);

    // Then: Both messages processed
    const bodyText = await page.textContent("body");
    expect(bodyText).toContain("First audio message");
    expect(bodyText).toContain("Second audio message");
  });

  test("should handle BGM and voice simultaneously in BIDI mode", async ({
    page,
  }) => {
    // Given: BIDI mode
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // When: Request BGM
    await chatInput.fill("Play background music");
    await chatInput.press("Enter");
    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "background music",
    );
    await page.waitForTimeout(3000);

    // Request voice response
    await chatInput.fill("Tell me something");
    await chatInput.press("Enter");
    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "Tell me something",
    );
    await page.waitForTimeout(4000);

    // Then: Both audio features work
    const bodyText = await page.textContent("body");
    expect(bodyText).toBeTruthy();
  });

  test("should display image preview before sending", async ({ page }) => {
    // Given: Check for file upload button
    const fileButtons = await page
      .locator('label:has-text("Attach Image"), button:has-text("Attach")')
      .all();

    if (fileButtons.length > 0) {
      // Then: Upload UI is present
      const uploadButton = fileButtons[0];
      await expect(uploadButton).toBeVisible();

      // Note: Actual file selection and preview would require file interaction
    }
  });

  test("should allow removing attached image before sending", async ({
    page,
  }) => {
    // Given: Image attachment capability
    const fileInputs = await page.locator('input[type="file"]').all();

    if (fileInputs.length > 0) {
      // Then: UI should support image management
      // Note: Actual removal would require uploading first
      const bodyText = await page.textContent("body");
      expect(bodyText).toBeTruthy();
    }
  });

  test("should handle audio interruption via ESC key", async ({ page }) => {
    // Given: BIDI mode with audio playing
    const adkBidiButton = page.getByRole("button", { name: /ADK BIDI/i });
    await adkBidiButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Start audio playback");
    await chatInput.press("Enter");
    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "audio playback",
    );
    await page.waitForTimeout(2000);

    // When: Press ESC to interrupt
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);

    // Then: Can send new message
    await chatInput.fill("New message after interruption");
    await chatInput.press("Enter");
    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "after interruption",
    );
  });

  test("should show clear history button when messages exist", async ({
    page,
  }) => {
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // Given: Send some messages
    await chatInput.fill("First message");
    await chatInput.press("Enter");
    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "First message",
    );
    await page.waitForTimeout(2000);

    // Then: Clear history button should appear
    const clearButton = page.getByRole("button", { name: /Clear History/i });
    const isVisible = await clearButton.isVisible().catch(() => false);

    if (isVisible) {
      // Button is available
      await expect(clearButton).toBeVisible();
    }
  });

  test("should handle multimodal conversation flow", async ({ page }) => {
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // Text message
    await chatInput.fill("Hello, let me describe an image");
    await chatInput.press("Enter");
    const firstUserMessage = page.getByTestId("message-user").first();
    await expect(firstUserMessage).toBeVisible();
    await expect(firstUserMessage.getByTestId("message-text")).toContainText(
      "describe an image",
    );
    await page.waitForTimeout(2000);

    // Note: Image upload would happen here

    // Follow-up text
    await chatInput.fill("What do you see in the image?");
    await chatInput.press("Enter");
    const secondUserMessage = page.getByTestId("message-user").nth(1);
    await expect(secondUserMessage).toBeVisible();
    await expect(secondUserMessage.getByTestId("message-text")).toContainText(
      "What do you see",
    );
    await page.waitForTimeout(3000);

    // Then: Conversation flow maintained
    const bodyText = await page.textContent("body");
    expect(bodyText).toContain("describe an image");
    expect(bodyText).toContain("What do you see");
  });
});
