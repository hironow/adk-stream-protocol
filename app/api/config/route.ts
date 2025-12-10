export async function GET() {
  return Response.json({
    backendMode: process.env.BACKEND_MODE || "gemini",
    adkBackendUrl: process.env.ADK_BACKEND_URL || "http://localhost:8000",
  });
}
