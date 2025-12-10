/**
 * Image Upload Component
 *
 * Allows users to upload images to send to the AI assistant.
 * Converts images to base64 for transmission via WebSocket.
 */

"use client";

import { useState } from "react";

interface ImageUploadProps {
  /** Callback when image is selected and converted to base64 */
  onImageSelect: (imageData: {
    data: string; // base64 encoded (without data URL prefix)
    media_type: string;
    fileName: string;
  }) => void;
  /** Callback when image is removed */
  onImageRemove?: () => void;
}

export function ImageUpload({ onImageSelect, onImageRemove }: ImageUploadProps) {
  const [selectedImage, setSelectedImage] = useState<{
    data: string;
    media_type: string;
    fileName: string;
    preview: string; // data URL for preview
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setIsProcessing(true);

    try {
      // Validate file type
      if (!file.type.startsWith("image/")) {
        throw new Error("Please select an image file");
      }

      // Validate supported formats
      const supportedFormats = ["image/png", "image/jpeg", "image/webp"];
      if (!supportedFormats.includes(file.type)) {
        throw new Error(`Unsupported format. Supported: PNG, JPEG, WebP`);
      }

      // Validate file size (max 5MB)
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (file.size > maxSize) {
        throw new Error("Image too large (max 5MB)");
      }

      // Read file and convert to base64
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        if (!result) return;

        // Extract base64 data (remove data URL prefix)
        // Format: "data:image/png;base64,iVBORw0KGgo..."
        const base64Data = result.split(",")[1];
        const dataUrl = result; // Keep for preview

        const imageData = {
          data: base64Data,
          media_type: file.type,
          fileName: file.name,
          preview: dataUrl,
        };

        setSelectedImage(imageData);
        setIsProcessing(false);

        // Notify parent
        onImageSelect({
          data: base64Data,
          media_type: file.type,
          fileName: file.name,
        });
      };

      reader.onerror = () => {
        setError("Failed to read file");
        setIsProcessing(false);
      };

      reader.readAsDataURL(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setIsProcessing(false);
    }
  };

  const handleRemove = () => {
    setSelectedImage(null);
    setError(null);
    onImageRemove?.();
  };

  return (
    <div style={{ marginBottom: "0.5rem" }}>
      {!selectedImage ? (
        <div>
          <label
            style={{
              display: "inline-block",
              padding: "0.5rem 1rem",
              background: "#1e40af",
              color: "white",
              borderRadius: "6px",
              cursor: isProcessing ? "not-allowed" : "pointer",
              opacity: isProcessing ? 0.5 : 1,
              fontSize: "0.875rem",
              fontWeight: 500,
            }}
          >
            {isProcessing ? "Processing..." : "📎 Attach Image"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFileSelect}
              disabled={isProcessing}
              style={{ display: "none" }}
            />
          </label>

          {error && (
            <div
              style={{
                marginTop: "0.5rem",
                padding: "0.5rem",
                background: "#7f1d1d",
                color: "#fca5a5",
                borderRadius: "4px",
                fontSize: "0.875rem",
              }}
            >
              ⚠️ {error}
            </div>
          )}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "0.75rem",
            padding: "0.75rem",
            background: "#0a0a0a",
            border: "1px solid #374151",
            borderRadius: "8px",
          }}
        >
          {/* Image preview */}
          <img
            src={selectedImage.preview}
            alt="Preview"
            style={{
              width: "80px",
              height: "80px",
              objectFit: "cover",
              borderRadius: "4px",
              border: "1px solid #4b5563",
            }}
          />

          {/* Image info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: "0.875rem",
                fontWeight: 500,
                color: "#d1d5db",
                marginBottom: "0.25rem",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {selectedImage.fileName}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
              {selectedImage.media_type}
            </div>
          </div>

          {/* Remove button */}
          <button
            onClick={handleRemove}
            style={{
              padding: "0.25rem 0.5rem",
              background: "#374151",
              color: "#d1d5db",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.75rem",
              fontWeight: 500,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#4b5563";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#374151";
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
