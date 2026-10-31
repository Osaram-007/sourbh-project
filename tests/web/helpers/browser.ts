import { chromium, type Browser, type Page } from "playwright";

export const VIEWPORTS = {
  mobile: { width: 360, height: 800 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
} as const;
export type ViewportName = keyof typeof VIEWPORTS;

export interface CspViolation {
  /** e.g. "script-src-elem" */
  directive: string;
  blockedUri: string;
  /** "enforce" for Content-Security-Policy, "report" for Content-Security-Policy-Report-Only */
  disposition: string;
  /** First 40 chars of the blocked inline code, if the browser provides it. */
  sample: string;
  frameUrl: string;
}

export interface Captured {
  /** console.error() calls and failed-resource messages ("Failed to load resource: ...") */
  consoleErrors: string[];
  /** uncaught exceptions / unhandled rejections in the page */
  pageErrors: string[];
  cspViolations: CspViolation[];
}

/** Headless Chromium. Browsers come from `npx playwright install chromium`; nothing is committed. */
export const launchBrowser = (): Promise<Browser> => chromium.launch();

/**
 * Fresh isolated context + page at a named viewport, with console / pageerror / CSP capture on every frame.
 * `captured` is only complete after a page round-trip: `await flush()` before reading it.
 */
export async function openPage(browser: Browser, viewport: ViewportName) {
  const context = await browser.newContext({ viewport: VIEWPORTS[viewport] });
  const captured: Captured = { consoleErrors: [], pageErrors: [], cspViolations: [] };

  await context.exposeBinding("__fcCsp", ({ frame }, v: Omit<CspViolation, "frameUrl">) => {
    captured.cspViolations.push({ ...v, frameUrl: frame.url() });
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as Record<string, (v: unknown) => void>).__fcCsp({
        directive: e.effectiveDirective,
        blockedUri: e.blockedURI,
        disposition: e.disposition,
        sample: e.sample,
      });
    });
  });

  const page: Page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") captured.consoleErrors.push(`${m.text()} (${m.location().url})`);
  });
  page.on("pageerror", (e) => captured.pageErrors.push(e.message));

  return {
    page,
    captured,
    /** CDP events arrive in order, so one round-trip drains any capture still in flight. */
    flush: () => page.evaluate(() => 0),
    close: () => context.close(),
  };
}
