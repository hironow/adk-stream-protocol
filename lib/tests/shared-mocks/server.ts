import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";

/**
 * MSW server for mocking HTTP requests in tests
 */
export const server = setupServer(
  // Mock BGM file requests
  http.get("/bgm.wav", () => {
    return HttpResponse.arrayBuffer(new ArrayBuffer(1024));
  }),
  http.get("/bgm2.wav", () => {
    return HttpResponse.arrayBuffer(new ArrayBuffer(1024));
  }),
);

// Export handlers for use in individual tests
export const handlers = {
  bgm: http.get("/bgm.wav", () => {
    return HttpResponse.arrayBuffer(new ArrayBuffer(1024));
  }),
  bgm2: http.get("/bgm2.wav", () => {
    return HttpResponse.arrayBuffer(new ArrayBuffer(1024));
  }),
};
