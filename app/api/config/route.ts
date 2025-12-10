export async function GET() {
  return Response.json({
    backendMode: process.env.BACKEND_MODE || "openai",
    adkBackendUrl: process.env.ADK_BACKEND_URL || "http://localhost:8000",
  });
}
