import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import Landing from "../../src/pages/index.astro";
import tokensCss from "../../src/styles/tokens.css?raw";

const ORIGIN = "https://polls.example.test";
const solarHex = tokensCss.match(
  /--color-solar-dark:\s*(#[0-9a-fA-F]{3,8})\s*;/,
)?.[1];

async function render(request: Request): Promise<Response> {
  const container = await AstroContainer.create();
  return container.renderToResponse(Landing, { request });
}

describe("SSR / landing route", () => {
  it("renders indexable canonical HTML with the current solar smoke marker", async () => {
    expect(tokensCss).toContain("--color-solar-dark");
    expect(solarHex).toBeTruthy();
    const response = await render(new Request(`${ORIGIN}/`));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(
      "Oddspark Polls is where a casual question gets an honest answer",
    );
    expect(html).toContain(
      'rel="canonical" href="https://polls.example.test/"',
    );
    expect(html).not.toContain('name="robots" content="noindex"');
    expect(response.headers.get("x-robots-tag")).toBeNull();
    expect(html).toContain('data-smoke-marker="oddspark-token-solar"');
    expect(html).toContain(`data-token-solar="${solarHex}"`);
  });

  it("rejects unsupported methods with an explicit GET and HEAD allowance", async () => {
    const response = await render(
      new Request(`${ORIGIN}/`, { method: "POST" }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect(await response.text()).toBe("Method not allowed.");
  });
});
