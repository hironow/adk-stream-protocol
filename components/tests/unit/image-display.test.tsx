/**
 * Image Display Component Unit Tests
 *
 * Tests the ImageDisplay component's rendering and error handling.
 *
 * Test Categories:
 * 1. Basic Rendering - Image display with data URL
 * 2. Alt Text - Default and custom alt text
 * 3. Error Handling - Failed image load fallback
 *
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageDisplay } from "@/components/image-display";

describe("ImageDisplay", () => {
  describe("Basic Rendering", () => {
    it("should render image with correct data URL", () => {
      const content =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const mediaType = "image/png";

      render(<ImageDisplay content={content} mediaType={mediaType} />);

      const img = screen.getByRole("img");
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute("src", `data:${mediaType};base64,${content}`);
    });

    it("should render image with correct styling", () => {
      render(<ImageDisplay content="AAAA" mediaType="image/png" />);

      const img = screen.getByRole("img");
      expect(img).toHaveStyle({
        maxWidth: "300px",
        borderRadius: "8px",
      });
    });

    it("should handle different media types", () => {
      const testCases = [
        { mediaType: "image/png", content: "PNG_DATA" },
        { mediaType: "image/jpeg", content: "JPEG_DATA" },
        { mediaType: "image/webp", content: "WEBP_DATA" },
        { mediaType: "image/gif", content: "GIF_DATA" },
      ];

      testCases.forEach(({ mediaType, content }) => {
        const { unmount } = render(
          <ImageDisplay content={content} mediaType={mediaType} />,
        );

        const img = screen.getByRole("img");
        expect(img).toHaveAttribute(
          "src",
          `data:${mediaType};base64,${content}`,
        );

        unmount();
      });
    });
  });

  describe("Alt Text", () => {
    it("should use default alt text when not provided", () => {
      render(<ImageDisplay content="AAAA" mediaType="image/png" />);

      const img = screen.getByAltText("AI-generated image");
      expect(img).toBeInTheDocument();
    });

    it("should use custom alt text when provided", () => {
      const customAlt = "A beautiful sunset";
      render(
        <ImageDisplay content="AAAA" mediaType="image/png" alt={customAlt} />,
      );

      const img = screen.getByAltText(customAlt);
      expect(img).toBeInTheDocument();
    });

    it("should use default alt text when empty string is provided", () => {
      render(<ImageDisplay content="AAAA" mediaType="image/png" alt="" />);

      const img = screen.getByRole("img");
      // Empty string alt falls back to default alt text
      expect(img).toHaveAttribute("alt", "AI-generated image");
    });
  });

  describe("Error Handling", () => {
    it("should show error message when image fails to load", () => {
      // Mock console.error to avoid noise in test output
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      render(<ImageDisplay content="INVALID" mediaType="image/png" />);

      const img = screen.getByRole("img");

      // Simulate image load error
      fireEvent.error(img);

      // Image should be hidden
      expect(img).toHaveStyle({ display: "none" });

      // Error message should be visible
      const errorDiv = screen.getByText(/Failed to load image/);
      expect(errorDiv).toBeVisible();
      expect(errorDiv).toHaveTextContent("media type: image/png");

      // Console error should be logged
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to load image:",
        expect.any(Object),
      );

      consoleSpy.mockRestore();
    });

    it("should display media type in error message", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});

      const mediaType = "image/webp";
      render(<ImageDisplay content="INVALID" mediaType={mediaType} />);

      const img = screen.getByRole("img");
      fireEvent.error(img);

      expect(screen.getByText(/media type: image\/webp/)).toBeVisible();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty content gracefully", () => {
      render(<ImageDisplay content="" mediaType="image/png" />);

      const img = screen.getByRole("img");
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute("src", "data:image/png;base64,");
    });

    it("should handle very long content", () => {
      const longContent = "A".repeat(10000);
      render(<ImageDisplay content={longContent} mediaType="image/png" />);

      const img = screen.getByRole("img");
      expect(img).toBeInTheDocument();
      expect(img.getAttribute("src")).toContain(longContent);
    });

    it("should handle special characters in media type", () => {
      const mediaType = "image/svg+xml";
      render(<ImageDisplay content="SVG_DATA" mediaType={mediaType} />);

      const img = screen.getByRole("img");
      expect(img).toHaveAttribute("src", `data:${mediaType};base64,SVG_DATA`);
    });
  });
});
