/**
 * Image Display Component
 *
 * Displays images received from the AI assistant.
 * Handles data-image custom events from AI SDK v6 Data Stream Protocol.
 */

interface ImageDisplayProps {
  /** Base64-encoded image data */
  content: string;
  /** MIME type (e.g., "image/png", "image/jpeg", "image/webp") */
  mediaType: string;
  /** Optional alt text */
  alt?: string;
}

export function ImageDisplay({ content, mediaType, alt }: ImageDisplayProps) {
  // Construct data URL from base64 content and media type
  const dataUrl = `data:${mediaType};base64,${content}`;

  return (
    <div
      style={{
        marginTop: "0.5rem",
        marginBottom: "0.5rem",
      }}
    >
      <img
        src={dataUrl}
        alt={alt || "AI-generated image"}
        style={{
          maxWidth: "300px",
          width: "100%",
          height: "auto",
          borderRadius: "8px",
          border: "1px solid #374151",
        }}
        onError={(e) => {
          console.error("Failed to load image:", e);
          // Show error placeholder
          (e.target as HTMLImageElement).style.display = "none";
          if (e.target && (e.target as HTMLElement).nextElementSibling) {
            ((e.target as HTMLElement).nextElementSibling as HTMLElement).style.display = "block";
          }
        }}
      />
      <div
        style={{
          display: "none",
          padding: "1rem",
          background: "#0a0a0a",
          border: "1px solid #ef4444",
          borderRadius: "8px",
          color: "#fca5a5",
        }}
      >
        ⚠️ Failed to load image (media type: {mediaType})
      </div>
    </div>
  );
}
