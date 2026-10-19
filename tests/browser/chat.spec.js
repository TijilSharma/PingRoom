import { test, expect } from '@playwright/test';

async function login(page, email = 'tijil@vitstudent.ac.in') {
  await page.goto('/');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Let’s talk' }).click();
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
}

test('two users exchange, edit, search and delete a live message', async ({
  page,
  browser,
}) => {
  const peerContext = await browser.newContext();
  const peer = await peerContext.newPage();
  const text = `Browser verification ${Date.now()}`;
  try {
    await login(page);
    await login(peer, 'aria@vitstudent.ac.in');
    await page.getByRole('button', { name: /Database lab/ }).click();
    await peer.getByRole('button', { name: /Database lab/ }).click();
    await page.getByLabel('Message', { exact: true }).fill(text);
    await page.getByTitle('Send message').click();
    await expect(
      peer.locator('.bubble').filter({ hasText: text }),
    ).toBeVisible();
    let message = page.locator('article').filter({ hasText: text });
    await message.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Message', { exact: true }).fill(`${text} edited`);
    await page.getByTitle('Save message').click();
    await expect(
      peer.locator('.bubble').filter({ hasText: `${text} edited` }),
    ).toBeVisible();
    await page.getByLabel('Search messages').fill('verification');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(
      page.locator('.bubble').filter({ hasText: text }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await message.getByRole('button', { name: 'Delete', exact: true }).click();
    await page
      .getByRole('button', { name: 'Delete permanently', exact: true })
      .click();
    await expect(peer.locator('.bubble').filter({ hasText: text })).toHaveCount(
      0,
    );
  } finally {
    await peerContext.close();
  }
});

test('database studio and keyboard dialog navigation', async ({ page }) => {
  await login(page);
  await page.getByTitle('Database studio').click();
  await expect(
    page.getByRole('heading', { name: 'Query inspection' }),
  ).toBeVisible();
  await expect(page.getByText('Replica set · rs0')).toBeVisible();
  await page.getByTitle('Messages', { exact: true }).click();
  await page.getByTitle('New conversation').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTitle('New conversation')).toBeFocused();
});

test('mobile conversation layout fits and back navigation works', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole('button', { name: /Database lab/ }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.locator('.back').click();
  await expect(page.getByLabel('Search conversations')).toBeVisible();
});

test('Database Studio does not mark a hidden conversation as read', async ({
  page,
  browser,
}) => {
  const peerContext = await browser.newContext();
  const peer = await peerContext.newPage();
  const text = `Hidden conversation ${Date.now()}`;
  try {
    await login(page);
    await login(peer, 'aria@vitstudent.ac.in');
    await page.getByRole('button', { name: /Database lab/ }).click();
    await page.getByTitle('Database studio').click();
    await expect(
      page.getByText('Conversation activity', { exact: true }),
    ).toBeVisible();
    await peer.getByRole('button', { name: /Database lab/ }).click();
    await peer.getByLabel('Message', { exact: true }).fill(text);
    const sent = peer.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/messages$/.test(r.url()),
    );
    await peer.getByTitle('Send message').click();
    const message = await (await sent).json();
    const token = await page.evaluate(() =>
      sessionStorage.getItem('pingroom-token'),
    );
    const me = await (
      await page.request.get('/api/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json();
    const readIds = async () => {
      const data = await (
        await page.request.get(
          `/api/conversations/${message.conversationId}/messages`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
      ).json();
      return data.messages.find((m) => m._id === message._id);
    };
    await expect
      .poll(async () => (await readIds()).deliveredTo)
      .toContain(me._id);
    expect((await readIds()).readBy).not.toContain(me._id);
    await page.getByTitle('Messages', { exact: true }).click();
    await expect.poll(async () => (await readIds()).readBy).toContain(me._id);
    await peer
      .locator('article')
      .filter({ hasText: text })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await peer
      .getByRole('button', { name: 'Delete permanently', exact: true })
      .click();
  } finally {
    await peerContext.close();
  }
});
