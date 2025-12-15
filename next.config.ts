import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: {
    position: "top-right",
  },

  // Note: WebSocket payload size issues should be handled at the server level
  // Next.js doesn't directly proxy WebSocket connections
  // The "Max payload size exceeded" error is likely from the backend or a proxy
};

export default nextConfig;
