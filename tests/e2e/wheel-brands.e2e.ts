import { expect, test } from './harness';

/**
 * The Wheel page for each brand besides Fanatec, on synthetic fixtures
 * (fixtures/scenarios/wheel-*.yaml). Nobody has run RigReady on these wheels yet: the page
 * says so, and links the hardware report form.
 */

const BRANDS = [
  {
    scenario: 'wheel-moza-r9',
    brand: 'moza',
    name: 'MOZA R9 Base',
    mode: 'Moza · Mode not shown by its USB id',
    software: 'MOZA Pit House',
    unverified: 'not yet on a real Moza wheel',
  },
  {
    scenario: 'wheel-logitech-g923',
    brand: 'logitech',
    name: 'Logitech G923 Racing Wheel for Xbox One and PC',
    mode: 'Logitech · PC mode',
    software: 'Logitech G HUB',
    unverified: 'not yet on a real Logitech wheel',
  },
  {
    scenario: 'wheel-simagic-alpha',
    brand: 'simagic',
    name: 'SIMAGIC Alpha',
    mode: 'Simagic · Mode not shown by its USB id',
    software: 'SimPro Manager',
    unverified: 'not yet on a real Simagic wheel',
  },
  {
    scenario: 'wheel-thrustmaster-t300',
    brand: 'thrustmaster',
    name: 'Thrustmaster T300RS Racing wheel',
    mode: 'Thrustmaster · PC mode',
    software: 'Thrustmaster FFB Racing Wheel driver',
    unverified: 'not yet on a real Thrustmaster wheel',
  },
] as const;

for (const b of BRANDS) {
  test(`wheel: the Wheel page for a ${b.brand} base, tested on recorded data only`, async ({
    rig,
  }) => {
    const { page, shot } = await rig.launch(b.scenario, `wheel-${b.brand}`);
    await page.getByTestId('mode-configure').click();
    await page.getByTestId('nav-wheel').click();
    await expect(page.getByTestId('wheel-status')).toHaveAttribute('data-brand', b.brand);
    await expect(page.getByTestId('wheel-name')).toHaveText(b.name);
    await expect(page.getByTestId('wheel-mode')).toContainText(b.mode);
    await expect(page.getByTestId('wheel-unverified')).toContainText(b.unverified);
    await expect(page.getByTestId('wheel-unverified').getByRole('link')).toHaveAttribute(
      'href',
      /issues\/new\?template=hardware\.yml$/
    );
    await expect(page.getByTestId('wheel-software').first()).toContainText(b.software);
    await expect(page.getByTestId('wheel-axis').first()).toBeVisible();
    // Fanatec's tuning presets belong to Fanatec bases only.
    await expect(page.getByTestId('wheel-presets')).toHaveCount(0);
    await shot('wheel');
    if (b.brand === 'logitech') {
      await expect(page.getByTestId('wheel-profile')).toContainText('On this PC');
      await page.getByTestId('wheel-profiles').scrollIntoViewIfNeeded();
      await shot('profiles');
    }
  });
}
