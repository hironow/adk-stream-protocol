import type { Page } from '@playwright/test';

/**
 * Page Object for Chat page
 *
 * Encapsulates all interactions with the main chat interface.
 * Following the Page Object pattern for maintainable E2E tests.
 *
 * Usage:
 * ```typescript
 * const chatPage = new ChatPage(page);
 * await chatPage.goto();
 * await chatPage.selectMode('adk-bidi');
 * await chatPage.sendMessage('Hello');
 * ```
 */
export class ChatPage {
  constructor(private page: Page) {}

  /**
   * Navigate to the chat page (root)
   */
  async goto() {
    await this.page.goto('/');
  }

  /**
   * Select a streaming mode
   * @param mode - The mode to select ('gemini', 'adk-sse', or 'adk-bidi')
   */
  async selectMode(mode: 'gemini' | 'adk-sse' | 'adk-bidi') {
    const modeNames = {
      'gemini': /Gemini Direct/i,
      'adk-sse': /ADK SSE/i,
      'adk-bidi': /ADK BIDI/i,
    };
    await this.page.getByRole('button', { name: modeNames[mode] }).click();
  }

  /**
   * Send a message in the chat
   * @param text - The message text to send
   */
  async sendMessage(text: string) {
    const chatInput = this.page.locator('input[placeholder="Type your message..."]');
    await chatInput.fill(text);
    await chatInput.press('Enter');
  }

  /**
   * Wait for assistant response to appear
   */
  async waitForAssistantResponse() {
    await this.page.getByTestId('message-assistant').first().waitFor();
  }

  /**
   * Approve a tool invocation
   * @param index - The index of the tool to approve (default: 0)
   */
  async approveTool(index: number = 0) {
    await this.page.getByTestId(`approve-button-${index}`).click();
  }

  /**
   * Deny a tool invocation
   * @param index - The index of the tool to deny (default: 0)
   */
  async denyTool(index: number = 0) {
    await this.page.getByTestId(`deny-button-${index}`).click();
  }

  /**
   * Get the current mode from the mode selector
   */
  async getCurrentMode(): Promise<string> {
    const modeSelector = this.page.getByTestId('mode-selector');
    return (await modeSelector.inputValue()) || '';
  }

  /**
   * Get all messages in the chat
   */
  async getAllMessages() {
    return this.page.getByTestId(/^message-(user|assistant)-\d+$/).all();
  }

  /**
   * Upload an image
   * @param filePath - Path to the image file to upload
   */
  async uploadImage(filePath: string) {
    const fileInput = this.page.getByTestId('image-upload-input');
    await fileInput.setInputFiles(filePath);
  }

  /**
   * Start voice recording (push-to-talk)
   */
  async startRecording() {
    await this.page.keyboard.down('Meta'); // CMD key
  }

  /**
   * Stop voice recording
   */
  async stopRecording() {
    await this.page.keyboard.up('Meta'); // CMD key
  }

  /**
   * Click play on BGM controls
   */
  async playBGM() {
    await this.page.getByTestId('bgm-play-button').click();
  }

  /**
   * Click pause on BGM controls
   */
  async pauseBGM() {
    await this.page.getByTestId('bgm-pause-button').click();
  }

  /**
   * Get the current BGM track name
   */
  async getCurrentBGMTrack(): Promise<string> {
    return this.page.getByTestId('bgm-track-name').textContent() || '';
  }
}
