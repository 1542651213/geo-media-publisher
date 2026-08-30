import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const WAIT_MS = 8_000;

type BrowserLike = ReturnType<Awaited<ReturnType<typeof chromium.launchPersistentContext>>["browser"]>;

const wait = async (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function launchSmokeContext(profilePath: string) {
  const context = await chromium.launchPersistentContext(profilePath, { channel: "chrome", headless: false });
  const browser = context.browser();
  if (!browser) throw new Error("Persistent context did not expose a Browser handle");
  return { context, browser };
}

async function closeAfterObservation(context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>, browser: NonNullable<BrowserLike>): Promise<void> {
  if (browser.isConnected()) await context.close().catch(() => undefined);
}

async function runLastPageCloseSmoke(): Promise<Record<string, unknown>> {
  const profilePath = await mkdtemp(join(tmpdir(), "gmp-xhs-last-page-close-"));
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    const launched = await launchSmokeContext(profilePath);
    context = launched.context;
    const { browser } = launched;
    let disconnectedAt: string | null = null;
    browser.once("disconnected", () => { disconnectedAt = new Date().toISOString(); });
    const initialPages = context.pages();
    const page = initialPages[0] ?? await context.newPage();
    if (context.pages().length !== 1) throw new Error(`Expected one smoke Page, got ${context.pages().length}`);
    const pageCountBeforeClose = context.pages().length;
    const browserConnectedBeforeClose = browser.isConnected();
    await page.close();
    await wait(WAIT_MS);
    return {
      profilePath,
      channel: "chrome",
      headless: false,
      pageCountBeforeClose,
      pageClosed: page.isClosed(),
      explicitContextCloseCallsBeforeObservation: 0,
      explicitBrowserCloseCallsBeforeObservation: 0,
      browserConnectedBeforeClose,
      browserConnectedAfterWait: browser.isConnected(),
      contextPageCountAfterWait: context.pages().length,
      disconnectedEventObserved: disconnectedAt !== null,
      disconnectedAt,
      waitMs: WAIT_MS
    };
  } finally {
    if (context) await closeAfterObservation(context, context.browser() as NonNullable<BrowserLike>);
    await rm(profilePath, { recursive: true, force: true });
  }
}

async function runSecondPageControl(): Promise<Record<string, unknown>> {
  const profilePath = await mkdtemp(join(tmpdir(), "gmp-xhs-second-page-control-"));
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    const launched = await launchSmokeContext(profilePath);
    context = launched.context;
    const { browser } = launched;
    let disconnectedAt: string | null = null;
    browser.once("disconnected", () => { disconnectedAt = new Date().toISOString(); });
    const pageA = context.pages()[0] ?? await context.newPage();
    const pageB = await context.newPage();
    if (context.pages().length !== 2) throw new Error(`Expected two smoke Pages, got ${context.pages().length}`);
    await pageA.close();
    await wait(WAIT_MS);
    return {
      profilePath,
      channel: "chrome",
      headless: false,
      pageCountBeforeClose: 2,
      pageAClosed: pageA.isClosed(),
      pageBClosedAfterWait: pageB.isClosed(),
      pageBRemainsInContext: context.pages().includes(pageB),
      explicitContextCloseCallsBeforeObservation: 0,
      explicitBrowserCloseCallsBeforeObservation: 0,
      browserConnectedAfterWait: browser.isConnected(),
      contextPageCountAfterWait: context.pages().length,
      disconnectedEventObserved: disconnectedAt !== null,
      disconnectedAt,
      waitMs: WAIT_MS
    };
  } finally {
    if (context) await closeAfterObservation(context, context.browser() as NonNullable<BrowserLike>);
    await rm(profilePath, { recursive: true, force: true });
  }
}

const lastPageClose = await runLastPageCloseSmoke();
const secondPageControl = await runSecondPageControl();
console.log(JSON.stringify({
  LAST_PAGE_CLOSE_SMOKE_RESULT: lastPageClose,
  SECOND_PAGE_CONTROL_RESULT: secondPageControl,
  LAST_PAGE_CLOSE_CAUSES_BROWSER_EXIT: lastPageClose.browserConnectedAfterWait === false && lastPageClose.disconnectedEventObserved === true,
  SECOND_PAGE_PREVENTS_BROWSER_EXIT: secondPageControl.browserConnectedAfterWait === true && secondPageControl.pageBRemainsInContext === true && secondPageControl.disconnectedEventObserved === false
}, null, 2));
