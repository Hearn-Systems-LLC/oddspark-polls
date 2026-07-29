import { test, expect } from "@playwright/test";

test.describe("placeholder foundation page", () => {
  test("renders with smoke marker and both type families in use", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("[data-smoke-marker='oddspark-token-solar']")).toBeVisible();
    await expect(page.getByRole("heading", { name: "oddspark polls" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Vote" })).toBeVisible();
    await expect(page.getByText("47% · 122")).toBeVisible();
  });

  test("mode toggle persists and applies data-mode", async ({ page }) => {
    await page.goto("/");
    const toggle = page.locator("[data-mode-toggle]");
    await expect(toggle).toBeVisible();

    // Force dark first via evaluate, then toggle to light
    await page.evaluate(() => {
      localStorage.setItem("oddspark-mode", "dark");
      document.documentElement.setAttribute("data-mode", "dark");
    });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");

    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-mode", "light");

    const stored = await page.evaluate(() => localStorage.getItem("oddspark-mode"));
    expect(stored).toBe("light");
  });

  test("focus ring tokens are applied on focusable primitives", async ({
    page,
  }) => {
    await page.goto("/");
    const vote = page.getByRole("button", { name: "Vote" });
    // Keyboard navigation triggers :focus-visible (element.focus() may not)
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      if (await vote.evaluate((el) => document.activeElement === el)) break;
    }
    await expect(vote).toBeFocused();
    const outline = await vote.evaluate((el) => {
      const styles = getComputedStyle(el);
      return {
        outlineWidth: styles.outlineWidth,
        outlineStyle: styles.outlineStyle,
        outlineOffset: styles.outlineOffset,
      };
    });
    // Focus-visible outline is exactly 2px solid with 2px offset
    expect(outline.outlineWidth).toBe("2px");
    expect(outline.outlineStyle).toBe("solid");
    expect(outline.outlineOffset).toBe("2px");
  });
});
