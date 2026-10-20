import type { Page, Response } from "@playwright/test";

/**
 * Loads `url` and waits for the app's code to run. The server's HTML shows
 * every button at once, but menus, dialogs and the sign-in form do nothing
 * until then, so a tap that comes first is lost. The root layout marks
 * <body> with "started" when it mounts, as SvelteKit's own tests do. Use
 * page.goto instead only to see a page before its code runs.
 */
export async function visit(page: Page, url: string): Promise<Response | null> {
  const response = await page.goto(url);
  await page.locator("body.started").waitFor();
  return response;
}
