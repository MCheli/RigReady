import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { dcsBindingsContract } from './contract';
import { DcsBindings, roleKey } from './core/bindings';
import { listenForInput } from './core/capture';
import { createBindingsCapture, createBindingsCheck, createOpenMigration } from './core/check';
import { copyOps, previewCopy } from './core/copy';
import { applyEdits, cleanupOps, planEdits } from './core/edits';
import { applyMigration, planMigration, scanMigration } from './core/migration';
import {
  applyRestore,
  compareSnapshots,
  createSnapshot,
  deleteSnapshot,
  listSnapshots,
  planRestore,
  renameSnapshot,
} from './core/snapshots';

let stopListening: (() => void) | undefined;

export default defineFeatureMain({
  id: 'dcs-bindings',
  setup(ctx) {
    const bindings = new DcsBindings({ ports: ctx.ports, log: ctx.log, games: ctx.games });
    const service = (): DcsBindings => bindings;

    ctx.checks.registerCheck(createBindingsCheck(service));
    ctx.checks.registerRemediation(
      createOpenMigration(() => ctx.emit(dcsBindingsContract, 'openMigration', {}))
    );
    ctx.checks.registerCapture(createBindingsCapture(service));

    return [
      bind(dcsBindingsContract, {
        async overview() {
          const overview = await bindings.overview();
          if (!overview.ok || !overview.value.found) return overview;
          const scan = await scanMigration(bindings);
          return ok({
            ...overview.value,
            staleDeviceIds: scan.ok
              ? scan.value.orphans.filter((o) => o.status !== 'unplugged').length
              : 0,
          });
        },
        aircraft: ({ id }) => bindings.view(id),

        async setRole({ role, ...device }) {
          const saved = await bindings.updateState((state) => ({
            ...state,
            roles: { ...state.roles, [roleKey(device)]: role },
          }));
          return saved.ok ? ok({ saved: true }) : saved;
        },
        async setExpected({ aircraft, commandId, expected }) {
          const saved = await bindings.updateState((state) => {
            const current = new Set(state.expected[aircraft] ?? []);
            if (expected) current.add(commandId);
            else current.delete(commandId);
            return { ...state, expected: { ...state.expected, [aircraft]: [...current].sort() } };
          });
          return saved.ok ? ok({ saved: true }) : saved;
        },

        plan: ({ ops, summary }) => planEdits(bindings, ops, summary),
        async apply({ ops, summary }) {
          const applied = await applyEdits(bindings, ops, summary);
          if (applied.ok) ctx.log.info(`dcs-bindings: ${applied.value.summary}`);
          return applied;
        },
        async cleanupOps({ aircraft, only }) {
          let ids = aircraft;
          if (ids.length === 0) {
            const all = await bindings.aircraftList(await bindings.locations());
            ids = all.filter((a) => a.hasDefaults).map((a) => a.id);
          }
          const ops = await cleanupOps(bindings, ids, only ? new Set(only) : undefined);
          if (!ops.ok) return ops;
          return ok({ ops: ops.value, aircraft: [...new Set(ops.value.map((o) => o.aircraft))] });
        },
        async undo({ groupId }) {
          if (await bindings.dcsRunning()) {
            return {
              ok: false,
              error: {
                code: 'dcs.running',
                message: 'DCS is running. Close it before undoing a change to its bindings.',
              },
            };
          }
          const undone = await ctx.ports.files.undoGroup(groupId);
          if (!undone.ok) return undone;
          ctx.log.info(`dcs-bindings: undid "${undone.value.reason}"`);
          return ok({ undone: true });
        },

        migrationScan: () => scanMigration(bindings),
        migrationPlan: ({ mappings }) => planMigration(bindings, mappings),
        async migrationApply({ mappings }) {
          const applied = await applyMigration(bindings, mappings);
          if (applied.ok) ctx.log.info(`dcs-bindings: ${applied.value.summary}`);
          return applied;
        },

        copyPreview: ({ from, to, deviceIds }) => previewCopy(bindings, from, to, deviceIds),
        async copyOps({ from, to, deviceIds, selected }) {
          const preview = await previewCopy(bindings, from, to, deviceIds);
          if (!preview.ok) return preview;
          const ops = copyOps(preview.value, to, selected);
          return ok({
            ops,
            summary: `Copy ${ops.length} ${ops.length === 1 ? 'control' : 'controls'} from ${preview.value.from} to ${preview.value.to}`,
          });
        },

        snapshots: () => listSnapshots(bindings),
        snapshotCreate: ({ name, aircraft }) => createSnapshot(bindings, name, aircraft),
        snapshotRename: ({ id, name }) => renameSnapshot(bindings, id, name),
        async snapshotDelete({ id }) {
          const deleted = await deleteSnapshot(bindings, id);
          return deleted.ok ? ok({ deleted: true }) : deleted;
        },
        snapshotRestorePlan: ({ id, remapIds }) => planRestore(bindings, id, remapIds),
        async snapshotRestore({ id, remapIds }) {
          const applied = await applyRestore(bindings, id, remapIds);
          if (applied.ok) ctx.log.info(`dcs-bindings: ${applied.value.summary}`);
          return applied;
        },
        snapshotCompare: ({ left, right }) => compareSnapshots(bindings, left, right),

        async listenStart() {
          const started = await ctx.ports.input.start();
          if (!started.ok) return started;
          stopListening?.();
          stopListening = listenForInput(ctx.ports.input, (pressed) =>
            ctx.emit(dcsBindingsContract, 'pressed', pressed)
          );
          return ok({ listening: true });
        },
        async listenStop() {
          stopListening?.();
          stopListening = undefined;
          return ok({ listening: false });
        },
      }),
    ];
  },
  dispose() {
    stopListening?.();
    stopListening = undefined;
  },
});
