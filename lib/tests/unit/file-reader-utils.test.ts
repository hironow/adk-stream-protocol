/**
 * File Reader Utils Unit Tests
 *
 * Tests image validation and file reading utilities.
 * Uses mocks to avoid browser-specific FileReader dependencies.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateImageFile,
  readImageFile,
  processImageFile,
  ImageValidationError,
  FileReaderError,
} from "@/lib/file-reader-utils";

describe("validateImageFile", () => {
  describe("File Type Validation", () => {
    it("should accept valid image file", () => {
      const file = new File(["content"], "test.png", { type: "image/png" });

      expect(() => validateImageFile(file)).not.toThrow();
    });

    it("should reject non-image file", () => {
      const file = new File(["content"], "test.txt", { type: "text/plain" });

      expect(() => validateImageFile(file)).toThrow(ImageValidationError);
      expect(() => validateImageFile(file)).toThrow(
        "Please select an image file"
      );
    });

    it("should accept all default supported formats", () => {
      const formats = ["image/png", "image/jpeg", "image/webp"];

      for (const format of formats) {
        const file = new File(["content"], `test.${format.split("/")[1]}`, {
          type: format,
        });

        expect(() => validateImageFile(file)).not.toThrow();
      }
    });

    it("should reject unsupported image format", () => {
      const file = new File(["content"], "test.gif", { type: "image/gif" });

      expect(() => validateImageFile(file)).toThrow(ImageValidationError);
      expect(() => validateImageFile(file)).toThrow("Unsupported format");
    });

    it("should accept custom supported formats", () => {
      const file = new File(["content"], "test.gif", { type: "image/gif" });

      expect(() =>
        validateImageFile(file, { supportedFormats: ["image/gif"] })
      ).not.toThrow();
    });
  });

  describe("File Size Validation", () => {
    it("should accept file within size limit", () => {
      const file = new File(["x".repeat(1024)], "test.png", {
        type: "image/png",
      }); // 1KB

      expect(() => validateImageFile(file)).not.toThrow();
    });

    it("should reject file exceeding default size limit (5MB)", () => {
      const largeContent = new Array(6 * 1024 * 1024).fill("x").join(""); // 6MB
      const file = new File([largeContent], "test.png", { type: "image/png" });

      expect(() => validateImageFile(file)).toThrow(ImageValidationError);
      expect(() => validateImageFile(file)).toThrow("Image too large");
    });

    it("should accept file within custom size limit", () => {
      const content = new Array(2 * 1024 * 1024).fill("x").join(""); // 2MB
      const file = new File([content], "test.png", { type: "image/png" });

      expect(() =>
        validateImageFile(file, { maxSizeBytes: 3 * 1024 * 1024 })
      ).not.toThrow();
    });

    it("should reject file exceeding custom size limit", () => {
      const content = new Array(2 * 1024 * 1024).fill("x").join(""); // 2MB
      const file = new File([content], "test.png", { type: "image/png" });

      expect(() =>
        validateImageFile(file, { maxSizeBytes: 1 * 1024 * 1024 })
      ).toThrow(ImageValidationError);
    });
  });
});

describe("readImageFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should read file and convert to base64", async () => {
    const file = new File(["test"], "test.png", { type: "image/png" });

    // Mock FileReader
    const mockResult = "data:image/png;base64,dGVzdA=="; // "test" in base64
    global.FileReader = vi.fn().mockImplementation(function (this: any) {
      this.readAsDataURL = vi.fn(function (this: any) {
        setTimeout(() => {
          this.result = mockResult;
          this.onload?.({ target: this });
        }, 0);
      });
    }) as any;

    const result = await readImageFile(file);

    expect(result).toEqual({
      data: "dGVzdA==",
      media_type: "image/png",
      fileName: "test.png",
      preview: mockResult,
    });
  });

  it("should handle FileReader error", async () => {
    const file = new File(["test"], "test.png", { type: "image/png" });

    // Mock FileReader with error
    global.FileReader = vi.fn().mockImplementation(function (this: any) {
      this.readAsDataURL = vi.fn(function (this: any) {
        setTimeout(() => {
          this.onerror?.();
        }, 0);
      });
    }) as any;

    await expect(readImageFile(file)).rejects.toThrow(FileReaderError);
    await expect(readImageFile(file)).rejects.toThrow("Failed to read file");
  });

  it("should handle empty result", async () => {
    const file = new File(["test"], "test.png", { type: "image/png" });

    // Mock FileReader with null result
    global.FileReader = vi.fn().mockImplementation(function (this: any) {
      this.readAsDataURL = vi.fn(function (this: any) {
        setTimeout(() => {
          this.result = null;
          this.onload?.({ target: this });
        }, 0);
      });
    }) as any;

    await expect(readImageFile(file)).rejects.toThrow(FileReaderError);
    await expect(readImageFile(file)).rejects.toThrow("no result");
  });

  it("should handle invalid data URL format", async () => {
    const file = new File(["test"], "test.png", { type: "image/png" });

    // Mock FileReader with invalid format
    global.FileReader = vi.fn().mockImplementation(function (this: any) {
      this.readAsDataURL = vi.fn(function (this: any) {
        setTimeout(() => {
          this.result = "invalid-format"; // Missing comma
          this.onload?.({ target: this });
        }, 0);
      });
    }) as any;

    await expect(readImageFile(file)).rejects.toThrow(FileReaderError);
    await expect(readImageFile(file)).rejects.toThrow(
      "Invalid data URL format"
    );
  });
});

describe("processImageFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should validate and read file successfully", async () => {
    const file = new File(["test"], "test.png", { type: "image/png" });

    // Mock FileReader
    const mockResult = "data:image/png;base64,dGVzdA==";
    global.FileReader = vi.fn().mockImplementation(function (this: any) {
      this.readAsDataURL = vi.fn(function (this: any) {
        setTimeout(() => {
          this.result = mockResult;
          this.onload?.({ target: this });
        }, 0);
      });
    }) as any;

    const result = await processImageFile(file);

    expect(result.data).toBe("dGVzdA==");
    expect(result.media_type).toBe("image/png");
    expect(result.fileName).toBe("test.png");
  });

  it("should throw validation error before reading", async () => {
    const file = new File(["test"], "test.txt", { type: "text/plain" });

    // Validation should fail before FileReader is called
    await expect(processImageFile(file)).rejects.toThrow(
      ImageValidationError
    );
  });

  it("should handle FileReader error after validation", async () => {
    const file = new File(["test"], "test.png", { type: "image/png" });

    // Mock FileReader with error
    global.FileReader = vi.fn().mockImplementation(function (this: any) {
      this.readAsDataURL = vi.fn(function (this: any) {
        setTimeout(() => {
          this.onerror?.();
        }, 0);
      });
    }) as any;

    await expect(processImageFile(file)).rejects.toThrow(FileReaderError);
  });

  it("should pass validation options", async () => {
    const file = new File(["test"], "test.gif", { type: "image/gif" });

    // Mock FileReader
    const mockResult = "data:image/gif;base64,dGVzdA==";
    global.FileReader = vi.fn().mockImplementation(function (this: any) {
      this.readAsDataURL = vi.fn(function (this: any) {
        setTimeout(() => {
          this.result = mockResult;
          this.onload?.({ target: this });
        }, 0);
      });
    }) as any;

    const result = await processImageFile(file, {
      supportedFormats: ["image/gif"],
    });

    expect(result.media_type).toBe("image/gif");
  });
});
