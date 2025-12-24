/**
 * File Reader Utilities
 *
 * Utilities for reading and validating image files for upload.
 * Handles FileReader operations, validation, and base64 conversion.
 */

export interface ImageValidationOptions {
  supportedFormats?: string[];
  maxSizeBytes?: number;
}

export interface ImageData {
  data: string; // base64-encoded (without data URL prefix)
  media_type: string;
  fileName: string;
  preview: string; // data URL for preview
}

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageValidationError";
  }
}

export class FileReaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileReaderError";
  }
}

/**
 * Validate image file
 */
export function validateImageFile(
  file: File,
  options: ImageValidationOptions = {}
): void {
  const {
    supportedFormats = ["image/png", "image/jpeg", "image/webp"],
    maxSizeBytes = 5 * 1024 * 1024, // 5MB default
  } = options;

  // Validate file type
  if (!file.type.startsWith("image/")) {
    throw new ImageValidationError("Please select an image file");
  }

  // Validate supported formats
  if (!supportedFormats.includes(file.type)) {
    const formats = supportedFormats
      .map((f) => f.replace("image/", "").toUpperCase())
      .join(", ");
    throw new ImageValidationError(
      `Unsupported format. Supported: ${formats}`
    );
  }

  // Validate file size
  if (file.size > maxSizeBytes) {
    const maxSizeMB = Math.round(maxSizeBytes / (1024 * 1024));
    throw new ImageValidationError(`Image too large (max ${maxSizeMB}MB)`);
  }
}

/**
 * Read image file and convert to base64
 */
export function readImageFile(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (!result) {
        reject(new FileReaderError("Failed to read file: no result"));
        return;
      }

      try {
        // Extract base64 data (remove data URL prefix)
        // Format: "data:image/png;base64,iVBORw0KGgo..."
        const base64Data = result.split(",")[1];
        if (!base64Data) {
          reject(new FileReaderError("Invalid data URL format"));
          return;
        }

        const dataUrl = result; // Keep for preview

        resolve({
          data: base64Data,
          media_type: file.type,
          fileName: file.name,
          preview: dataUrl,
        });
      } catch (err) {
        reject(
          new FileReaderError(
            `Failed to process file: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
    };

    reader.onerror = () => {
      reject(new FileReaderError("Failed to read file"));
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Process image file: validate and read
 */
export async function processImageFile(
  file: File,
  validationOptions?: ImageValidationOptions
): Promise<ImageData> {
  // Validate first
  validateImageFile(file, validationOptions);

  // Then read
  return readImageFile(file);
}
