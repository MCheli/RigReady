import { expect, test } from './harness';

/**
 * The binding guide for Nuclear Option on fixtures/scenarios/nuclear-option-bindings.yaml:
 * one guide for every aircraft, with what the game has bound and what it has not. Nothing is
 * bound from the guide; it says where each thing is bound and links to the bindings page.
 */
test('binding guide for nuclear option: the walkthrough and the priorities on what the game saved, and where to bind', async ({
  rig,
}) => {
  const { page, shot } = await rig.launch('nuclear-option-bindings', 'ai-assist-nuclear-option');
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-ai-assist').click();
  await expect(page.getByTestId('ai-guide-page')).toBeVisible();

  // The one game here, and its one entry.
  await expect(page.getByTestId('ai-game')).toContainText('Nuclear Option');
  await expect(page.getByTestId('ai-aircraft')).toContainText('All aircraft');
  await expect(page.getByTestId('ai-guide-page')).toContainText(
    'For Nuclear Option: what matters when you fly it'
  );
  const where = page.getByTestId('ai-nuclear-option-where');
  await expect(where).toContainText(
    'This guide works on the one set of bindings Nuclear Option has for every aircraft.'
  );
  await expect(where).toContainText('To bind a controller button, use the Nuclear Option bindings');
  // No AI help for this game, with or without a key.
  await expect(page.getByTestId('ai-tab-ai')).toHaveCount(0);
  await expect(page.locator('.v-alert.text-error, .v-alert.bg-error')).toHaveCount(0);

  // 1. The walkthrough opens on the first item: bound on the stick, and not bound from here.
  const item = page.getByTestId('ai-current-item');
  await expect(item).toHaveAttribute('data-item', 'pitch-roll');
  await expect(page.getByTestId('ai-item-status')).toHaveText('Bound');
  await expect(item).toContainText('Joystick - HOTAS Warthog');
  await expect(item.getByTestId('ai-bind')).toHaveCount(0);
  await expect(item.getByTestId('ai-not-writable').first()).toHaveText(
    'Bind it in the game: Settings, then Controls'
  );
  await shot('walkthrough');

  // An item nothing has yet: a button, which the bindings page binds.
  await page.getByTestId('ai-item-nav-lights').click();
  await expect(item).toHaveAttribute('data-item', 'nav-lights');
  await expect(page.getByTestId('ai-item-status')).toHaveText('Not bound on a controller');
  await expect(item.getByTestId('ai-not-writable')).toHaveText(
    'A controller button: bind it on the Nuclear Option bindings page'
  );
  await shot('not-bound');

  // 2. The priorities: every tier, each item with its state from what the game saved.
  await page.getByTestId('ai-tab-priorities').click();
  await expect(page.getByTestId('ai-priorities')).toBeVisible();
  await expect(page.getByTestId('ai-tier-must')).toContainText('Must have to fly and fight');
  const row = (id: string) => page.locator(`[data-testid="ai-priority-item"][data-item="${id}"]`);
  await expect(row('fire')).toHaveAttribute('data-status', 'bound');
  await expect(row('nav-lights')).toHaveAttribute('data-status', 'unbound');
  await expect(page.locator('[data-testid="ai-priority-item"][data-status="missing"]')).toHaveCount(
    0
  );
  await shot('priorities');

  // 3. The link goes to the bindings page, where a button is bound.
  await page.getByTestId('ai-nuclear-option-page').click();
  await expect(page.getByTestId('nuclear-option-bindings-page')).toBeVisible();
});
