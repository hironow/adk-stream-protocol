/**
 * ADR Validation Tests
 *
 * These tests verify that the implementation matches the claims made in
 * Architecture Decision Records (ADRs). This ensures documentation stays
 * in sync with actual code behavior.
 *
 * Each test corresponds to a specific ADR and validates its key claims.
 */

import { describe, expect, it } from "vitest";
import getLocationApprovedBidiBaseline from "../../../fixtures/frontend/get_location-approved-bidi-baseline.json";
import processPaymentApprovedBidiBaseline from "../../../fixtures/frontend/process_payment-approved-bidi-baseline.json";

describe("ADR Validation - Frontend Protocol", () => {
  describe("Tool Approval Request Architecture", () => {
    it("ADR Claim: tool-approval-request events are sent for confirmation-required tools", () => {
      // Given: Baseline fixture for get_location with approval
      const baseline = getLocationApprovedBidiBaseline;

      // When: Parse raw events to find tool-approval-request
      const rawEvents = baseline.output.rawEvents;
      const approvalRequestEvents = rawEvents.filter((event: string) =>
        event.includes('"type": "tool-approval-request"'),
      );

      // Then: tool-approval-request event must exist
      expect(approvalRequestEvents.length).toBeGreaterThan(0);

      // And: Parse the event structure
      const approvalEvent = JSON.parse(
        approvalRequestEvents[0].replace("data: ", "").replace("\n\n", ""),
      );

      // And: Event must reference the original tool
      expect(approvalEvent.type).toBe("tool-approval-request");
      expect(approvalEvent.toolCallId).toBeDefined();
      expect(approvalEvent.approvalId).toBeDefined();

      // CRITICAL: toolCallId should match the original tool's ID, not a separate confirmation tool
      // This validates that we're using the new architecture where approval is attached to the original tool
      const toolInputAvailableEvents = rawEvents.filter(
        (event: string) =>
          event.includes('"type": "tool-input-available"') &&
          event.includes('"toolName": "get_location"'),
      );

      const toolInputEvent = JSON.parse(
        toolInputAvailableEvents[0].replace("data: ", "").replace("\n\n", ""),
      );

      expect(approvalEvent.toolCallId).toBe(toolInputEvent.toolCallId);
    });

    it("ADR Claim: adk_request_confirmation tool does NOT appear in frontend protocol", () => {
      // Given: Multiple baseline fixtures
      const baselines = [
        getLocationApprovedBidiBaseline,
        processPaymentApprovedBidiBaseline,
      ];

      for (const baseline of baselines) {
        // When: Search for adk_request_confirmation in raw events
        const rawEvents = baseline.output.rawEvents;
        const confirmationToolEvents = rawEvents.filter((event: string) =>
          event.includes('"toolName": "adk_request_confirmation"'),
        );

        // Then: adk_request_confirmation tool must NOT exist in frontend protocol
        expect(confirmationToolEvents.length).toBe(0);
      }
    });

    it("ADR Claim: approvalId is different from original toolCallId", () => {
      // Given: Baseline fixture
      const baseline = getLocationApprovedBidiBaseline;
      const rawEvents = baseline.output.rawEvents;

      // When: Extract tool-approval-request event
      const approvalRequestEvent = rawEvents.find((event: string) =>
        event.includes('"type": "tool-approval-request"'),
      );

      expect(approvalRequestEvent).toBeDefined();

      const approval = JSON.parse(
        approvalRequestEvent!.replace("data: ", "").replace("\n\n", ""),
      );

      // Then: approvalId must be different from toolCallId
      // This validates the ID mapping architecture where:
      // - toolCallId: Original tool's ID (e.g., "function-call-xxx")
      // - approvalId: Unique approval ID (e.g., "adk-uuid")
      expect(approval.toolCallId).toBeDefined();
      expect(approval.approvalId).toBeDefined();
      expect(approval.toolCallId).not.toBe(approval.approvalId);

      // And: approvalId should have backend-generated prefix ("adk-" legacy or "confirm-" current)
      expect(approval.approvalId).toMatch(/^(adk-|confirm-)/);
    });
  });

  describe("BIDI Blocking Mode Mode - Single Stream Behavior", () => {
    it("ADR Claim: BIDI Blocking Mode sends exactly one [DONE] signal", () => {
      // Given: BIDI Blocking Mode baseline
      const baseline = getLocationApprovedBidiBaseline;

      // Verify this is BIDI Blocking Mode mode
      expect(baseline.description).toContain("BIDI Blocking Mode");
      expect(baseline.description).toContain("SINGLE CONTINUOUS STREAM");

      // When: Count [DONE] signals in raw events
      const rawEvents = baseline.output.rawEvents;
      const doneSignals = rawEvents.filter((event: string) =>
        event.includes("data: [DONE]"),
      );

      // Then: Exactly one [DONE] signal must be present
      expect(doneSignals.length).toBe(1);

      // And: [DONE] must be the last event
      const lastEvent = rawEvents[rawEvents.length - 1];
      expect(lastEvent).toContain("data: [DONE]");
    });

    it("ADR Claim: tool-output-available comes AFTER user approval in BIDI Blocking Mode", () => {
      // Given: BIDI Blocking Mode baseline
      const baseline = getLocationApprovedBidiBaseline;
      const rawEvents = baseline.output.rawEvents;

      // When: Find event indices
      const approvalRequestIndex = rawEvents.findIndex((event: string) =>
        event.includes('"type": "tool-approval-request"'),
      );

      const toolOutputIndex = rawEvents.findIndex((event: string) =>
        event.includes('"type": "tool-output-available"'),
      );

      // Then: Approval request must come before tool output
      expect(approvalRequestIndex).toBeGreaterThan(-1);
      expect(toolOutputIndex).toBeGreaterThan(-1);
      expect(toolOutputIndex).toBeGreaterThan(approvalRequestIndex);

      // This validates that the tool blocks awaiting approval,
      // then returns output after approval is received
    });
  });

  describe("Event Ordering Guarantees", () => {
    it("ADR Claim: tool-input-available comes before tool-approval-request", () => {
      // Given: Baseline fixture
      const baseline = getLocationApprovedBidiBaseline;
      const rawEvents = baseline.output.rawEvents;

      // When: Find event indices
      const toolInputIndex = rawEvents.findIndex(
        (event: string) =>
          event.includes('"type": "tool-input-available"') &&
          event.includes('"toolName": "get_location"'),
      );

      const approvalRequestIndex = rawEvents.findIndex((event: string) =>
        event.includes('"type": "tool-approval-request"'),
      );

      // Then: tool-input-available must come before tool-approval-request
      expect(toolInputIndex).toBeGreaterThan(-1);
      expect(approvalRequestIndex).toBeGreaterThan(-1);
      expect(approvalRequestIndex).toBeGreaterThan(toolInputIndex);

      // This ensures frontend sees the original tool call before approval UI
    });
  });
});
