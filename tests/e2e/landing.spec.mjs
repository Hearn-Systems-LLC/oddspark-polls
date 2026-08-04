import { expect, test } from "@playwright/test";

test.describe("Landing page", () => {
  test("binds the plain statement to Newsreader and the build account to Courier Prime", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    const statement = await page.locator("[data-landing-statement]").evaluate(
      (node) => {
        const style = getComputedStyle(node);
        return { family: style.fontFamily, weight: style.fontWeight };
      },
    );
    const buildAccount = await page
      .locator("[data-landing-build-copy]")
      .evaluate((node) => {
        const style = getComputedStyle(node);
        return { family: style.fontFamily, size: style.fontSize };
      });

    expect(statement.family).toContain("Newsreader");
    expect(statement.weight).toBe("400");
    expect(buildAccount.family).toContain("Courier Prime");
    expect(buildAccount.size).toBe("16px");
  });
});
