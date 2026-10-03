import type { MainContext } from '../../../core/feature';
import { err, ok, type Result } from '../../../core/result';
import { AI_KEY_SECRET, type AppSettingsPatch } from '../../../core/settings';
import type { SettingsView } from '../contract';

type Ctx = Pick<MainContext, 'ports' | 'settings' | 'layouts' | 'log'>;

export async function readView(ctx: Ctx): Promise<Result<SettingsView>> {
  const settings = await ctx.settings.get();
  if (!settings.ok) return settings;
  const layouts = await ctx.layouts.list();
  if (!layouts.ok) return layouts;
  const login = await ctx.ports.loginItem.isEnabled();
  const view: SettingsView = {
    settings: settings.value,
    layouts: layouts.value,
    startsWithWindows: login.ok ? login.value : null,
  };
  if (!login.ok) view.startWithWindowsProblem = login.error.message;
  return ok(view);
}

/**
 * Applies a settings change. Anything that has an effect outside the settings file
 * happens first, so the file never says something that is not true.
 */
export async function applyPatch(ctx: Ctx, patch: AppSettingsPatch): Promise<Result<SettingsView>> {
  if (typeof patch.deskLayoutId === 'string') {
    const layout = await ctx.layouts.get(patch.deskLayoutId);
    if (!layout.ok) return layout;
  }
  if (patch.aiKeyPresent !== undefined) {
    return err('settings.invalid', 'The AI key is set or removed with its own action.');
  }
  if (patch.startWithWindows !== undefined) {
    const changed = await ctx.ports.loginItem.setEnabled(patch.startWithWindows);
    if (!changed.ok) return changed;
    const now = await ctx.ports.loginItem.isEnabled();
    if (now.ok && now.value !== patch.startWithWindows) {
      return err(
        'login.write',
        patch.startWithWindows
          ? 'Windows did not accept the Start with Windows entry. It may be turned off in Task Manager > Startup apps.'
          : 'Windows still lists RigReady as a startup app.'
      );
    }
  }
  const updated = await ctx.settings.update(patch);
  if (!updated.ok) return updated;
  return readView(ctx);
}

export async function saveCurrentLayout(ctx: Ctx, name: string): Promise<Result<SettingsView>> {
  const created = await ctx.layouts.createFromCurrent(name, ctx.ports.displays);
  if (!created.ok) return created;
  return readView(ctx);
}

export async function renameLayout(
  ctx: Ctx,
  id: string,
  name: string
): Promise<Result<SettingsView>> {
  const renamed = await ctx.layouts.rename(id, name);
  if (!renamed.ok) return renamed;
  return readView(ctx);
}

export async function removeLayout(ctx: Ctx, id: string): Promise<Result<SettingsView>> {
  const removed = await ctx.layouts.remove(id);
  if (!removed.ok) return removed;
  const settings = await ctx.settings.get();
  if (settings.ok && settings.value.deskLayoutId === id) {
    const cleared = await ctx.settings.update({ deskLayoutId: null });
    if (!cleared.ok) return cleared;
  }
  return readView(ctx);
}

export async function setAiKey(ctx: Ctx, key: string): Promise<Result<SettingsView>> {
  const stored = await ctx.ports.secrets.set(AI_KEY_SECRET, key);
  if (!stored.ok) return stored;
  // Read it back: the flag must only say "present" when the key really can be used.
  const check = await ctx.ports.secrets.get(AI_KEY_SECRET);
  if (!check.ok) return check;
  if (check.value !== key) return err('secret.write', 'The key could not be stored.');
  const updated = await ctx.settings.update({ aiKeyPresent: true });
  if (!updated.ok) return updated;
  ctx.log.info('AI key stored');
  return readView(ctx);
}

export async function clearAiKey(ctx: Ctx): Promise<Result<SettingsView>> {
  const removed = await ctx.ports.secrets.remove(AI_KEY_SECRET);
  if (!removed.ok) return removed;
  const updated = await ctx.settings.update({ aiKeyPresent: false });
  if (!updated.ok) return updated;
  ctx.log.info('AI key removed');
  return readView(ctx);
}
