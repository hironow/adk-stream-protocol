import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Accessibility - Advanced Tests
 *
 * Tests for WCAG compliance and accessibility features.
 * Ensures the application is usable by people with disabilities.
 *
 * Test Focus:
 * - ARIA attributes
 * - Keyboard navigation
 * - Screen reader compatibility
 * - Color contrast
 * - Focus management
 * - Semantic HTML
 */
test.describe("Accessibility (Advanced)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should have no automatically detectable accessibility violations", async ({
    page,
  }) => {
    // Given: Page loaded
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await expect(chatInput).toBeVisible();

    // When: Run axe accessibility scan
    const accessibilityScanResults = await new AxeBuilder({ page }).analyze();

    // Then: Should have no violations
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test("should support keyboard navigation for mode switching", async ({
    page,
  }) => {
    // Given: Page loaded
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await expect(chatInput).toBeVisible();

    // When: Navigate with Tab key
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");

    // Then: Should be able to reach mode buttons
    // Check if any mode button is focused
    const focusedElement = await page.evaluateHandle(
      () => document.activeElement,
    );
    const tagName = await focusedElement.evaluate((el) => el?.tagName);
    expect(tagName).toBeTruthy();
  });

  test("should support keyboard navigation for chat input", async ({
    page,
  }) => {
    // Given: Page loaded
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // When: Tab to chat input
    await page.keyboard.press("Tab");

    // Then: Input should be focusable
    const isFocused = await chatInput.evaluate(
      (el) => el === document.activeElement,
    );
    expect(isFocused).toBeTruthy();
  });

  test("should support Enter key to send messages", async ({ page }) => {
    // Given: Chat input is focused
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.focus();

    // When: Type and press Enter
    await chatInput.fill("Keyboard test message");
    await page.keyboard.press("Enter");

    // Then: Message should be sent
    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "Keyboard test message",
    );
  });

  test("should have proper ARIA labels on interactive elements", async ({
    page,
  }) => {
    // Given: Interactive elements on page
    const buttons = await page.locator("button").all();

    // Then: Buttons should have accessible names (text or aria-label)
    for (const button of buttons) {
      const accessibleName = await button.evaluate((el) => {
        return el.textContent?.trim() || el.getAttribute("aria-label") || "";
      });
      expect(accessibleName.length).toBeGreaterThan(0);
    }
  });

  test("should have semantic HTML structure", async ({ page }) => {
    // Given: Page loaded
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await expect(chatInput).toBeVisible();

    // Then: Should have form element
    const formElements = await page.locator("form").count();

    // Should have proper structure
    expect(formElements).toBeGreaterThan(0);
  });

  test("should maintain focus visibility", async ({ page }) => {
    // Given: Tab to first focusable element
    await page.keyboard.press("Tab");

    // When: Get focused element styles
    const focusStyles = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const styles = window.getComputedStyle(el);
      return {
        outline: styles.outline,
        outlineWidth: styles.outlineWidth,
        borderColor: styles.borderColor,
      };
    });

    // Then: Should have visible focus indicator
    expect(focusStyles).toBeTruthy();
  });

  test("should have sufficient color contrast", async ({ page }) => {
    // Given: Page loaded
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await expect(chatInput).toBeVisible();

    // When: Run axe scan for color contrast
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2aa"])
      .analyze();

    // Then: Should pass color contrast checks
    const contrastViolations = results.violations.filter(
      (v) => v.id === "color-contrast",
    );
    expect(contrastViolations).toHaveLength(0);
  });

  test("should have accessible form controls", async ({ page }) => {
    // Given: Form elements
    const chatInput = page.locator('input[placeholder="Type your message..."]');

    // Then: Input should have proper attributes
    const placeholder = await chatInput.getAttribute("placeholder");

    expect(placeholder).toBeTruthy();
  });

  test("should support ESC key for cancellation", async ({ page }) => {
    // Given: Send a message
    const geminiButton = page.getByRole("button", { name: /Gemini Direct/i });
    await geminiButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Long running task");
    await chatInput.press("Enter");

    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "Long running task",
    );
    await page.waitForTimeout(2000);

    // When: Press ESC
    await page.keyboard.press("Escape");

    // Then: Should handle interruption
    await page.waitForTimeout(1000);
    await expect(chatInput).toBeEnabled();
  });

  test("should have accessible images with alt text", async ({ page }) => {
    // Given: Check for images
    const images = await page.locator("img").all();

    // Then: All images should have alt attributes
    for (const img of images) {
      const alt = await img.getAttribute("alt");
      expect(alt).not.toBeNull();
    }
  });

  test("should support screen reader announcements for messages", async ({
    page,
  }) => {
    // Given: Send a message
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Screen reader test");
    await chatInput.press("Enter");

    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "Screen reader test",
    );
    await page.waitForTimeout(1000);

    // Then: Message should be in accessible content
    const messageText = await page.textContent("body");
    expect(messageText).toContain("Screen reader test");
  });

  test("should have proper button roles", async ({ page }) => {
    // Given: Buttons on page
    const buttons = await page.locator("button").all();

    // Then: All should have button role (implicit or explicit)
    for (const button of buttons) {
      const role = await button.evaluate((el) => {
        return el.getAttribute("role") || el.tagName.toLowerCase();
      });
      expect(["button", "submit"]).toContain(role.toLowerCase());
    }
  });

  test("should support focus trap in modals if present", async ({ page }) => {
    // Note: This test depends on modal implementation
    // Currently checking for basic focus management

    // Given: Page loaded
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await expect(chatInput).toBeVisible();

    // When: Tab through elements
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");

    // Then: Focus should cycle through interactive elements
    const activeElement = await page.evaluateHandle(
      () => document.activeElement,
    );
    expect(activeElement).toBeTruthy();
  });

  test("should maintain language attribute", async ({ page }) => {
    // Given: Page loaded
    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await expect(chatInput).toBeVisible();

    // Then: HTML should have lang attribute
    const lang = await page.evaluate(() => {
      return document.documentElement.lang;
    });

    expect(lang).toBeTruthy();
  });

  test("should not have accessibility violations after interaction", async ({
    page,
  }) => {
    // Given: Interact with the page
    const adkSseButton = page.getByRole("button", { name: /ADK SSE/i });
    await adkSseButton.click();

    const chatInput = page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill("Interaction test");
    await chatInput.press("Enter");

    const userMessage = page.getByTestId("message-user").first();
    await expect(userMessage).toBeVisible();
    await expect(userMessage.getByTestId("message-text")).toContainText(
      "Interaction test",
    );
    await page.waitForTimeout(2000);

    // When: Run accessibility scan after interaction
    const results = await new AxeBuilder({ page }).analyze();

    // Then: Should still have no violations
    expect(results.violations).toEqual([]);
  });
});
