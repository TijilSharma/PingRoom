import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const output = 'docs/screenshots';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:3100', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${output}/login.png`, fullPage: true });
  await page.getByRole('button', { name: 'Let’s talk' }).click();
  await page.getByText('Messages', { exact: false }).first().waitFor();
  await page.getByText('Database lab').first().click();
  await page.getByText('Hey team! Ready for the database review?').first().waitFor();
  await page.screenshot({ path: `${output}/chat.png`, fullPage: true });
  await page.getByTitle('Database studio').click();
  await page.getByText('Conversation activity').waitFor();
  await page.screenshot({ path: `${output}/database.png`, fullPage: true });
  if (errors.length) throw Error(errors.join('\n'));
  console.log('Captured login, chat, and database screens without page errors.');
} finally {
  await browser.close();
}
