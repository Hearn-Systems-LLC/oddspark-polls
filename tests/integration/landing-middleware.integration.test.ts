import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it, vi } from "vitest";
import { onRequest } from "../../src/middleware";
import Landing from "../../src/pages/index.astro";

type MiddlewareContext = Parameters<typeof onRequest>[0];

function makeContext(request: Request): MiddlewareContext {
  return { request, locals: {} } as unknown as MiddlewareContext;
}

async function dispatch(request: Request): Promise<Response> {
  const context = makeContext(request);
  const container = await AstroContainer.create();
  return (await onRequest(
    context,
    (() =>
      container.renderToResponse(Landing, {
        request: context.request,
        locals: context.locals,
      })) as never,
  )) as Response;
}

describe("landing delivery middleware chain", () => {
  it("tags the root response and emits exactly one matching telemetry record", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const response = await dispatch(new Request("https://polls.example.test/"));
      const requestId = response.headers.get("x-request-id");

      expect(response.status).toBe(200);
      expect(requestId).toBeTruthy();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toEqual(
        expect.objectContaining({
          requestId,
          operation: "GET /",
          result: "ok",
        }),
      );
    } finally {
      spy.mockRestore();
    }
  });
});
