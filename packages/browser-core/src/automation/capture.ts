/**
 * Screenshot and PDF capture over CDP (PRD M3.3). Returns raw bytes; the CLI
 * writes them to the requested path. PDF requires headless Chromium.
 */
import type { CdpConnection } from './cdp-client.js';

export interface ScreenshotOptions {
  fullPage?: boolean;
}

interface LayoutMetrics {
  cssContentSize?: { width: number; height: number };
  contentSize?: { width: number; height: number };
}

/** Capture a PNG screenshot of the current page. */
export async function screenshotPng(
  conn: CdpConnection,
  options: ScreenshotOptions = {},
): Promise<Uint8Array> {
  await conn.send('Page.enable');
  const params: Record<string, unknown> = {
    format: 'png',
    captureBeyondViewport: options.fullPage === true,
  };
  if (options.fullPage) {
    const metrics = await conn.send<LayoutMetrics>('Page.getLayoutMetrics');
    const size = metrics.cssContentSize ?? metrics.contentSize;
    if (size) {
      params.clip = { x: 0, y: 0, width: size.width, height: size.height, scale: 1 };
    }
  }
  const res = await conn.send<{ data: string }>('Page.captureScreenshot', params);
  return Buffer.from(res.data, 'base64');
}

/** Print the current page to PDF (headless only). */
export async function printPdf(conn: CdpConnection): Promise<Uint8Array> {
  await conn.send('Page.enable');
  const res = await conn.send<{ data: string }>('Page.printToPDF', { printBackground: true });
  return Buffer.from(res.data, 'base64');
}
