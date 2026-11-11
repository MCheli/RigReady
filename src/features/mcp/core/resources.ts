import type {
  McpCallContext,
  McpResourceDefinition,
  McpResourceTemplateDefinition,
} from '../../../core/mcp';
import { err, ok, type Result } from '../../../core/result';
import type { Envelope } from '../../../shared/ipc';
import type { ActivityLog } from './activity';
import { renderFeatureIndex, renderFeatureReference, type ChannelReference } from './catalogue';
import { GUIDE, GUIDE_URI } from './guide';
import { DOCS_URI, readManualPage, renderContents, type ManualPage } from './manual';

/**
 * What an assistant can read without calling anything: the guide, the manual, the channel
 * reference, and the state of the rig and the app. Reads only; every one goes through the
 * app's own channels or the bundled text.
 */

export interface ResourceDeps {
  manual(): ManualPage[];
  reference(): ChannelReference[];
  activity: ActivityLog;
  /** Reads one of RigReady's own files (a setup's YAML). */
  readFile(file: string): Promise<Result<string>>;
}

const unwrap = <T>(envelope: Envelope): Result<T> =>
  envelope.ok ? ok(envelope.value as T) : envelope;

const json = (value: unknown): string => JSON.stringify(value, null, 2);

interface FlyState {
  profiles: {
    id: string;
    name: string;
    game?: string;
    gameName?: string;
    lastUsed?: string;
    canLaunch: boolean;
  }[];
  activeProfileId?: string;
  notice?: string;
}

interface Report {
  ready: boolean;
  failed: number;
  warnings: number;
  fixable: number;
  results: {
    itemId: string;
    title: string;
    group: string;
    required: boolean;
    status: string;
    summary: string;
    fix?: string;
    fixKind?: string;
    disabled?: boolean;
  }[];
}

/** The setup in use, its last check, the session and the other setups, as one JSON document. */
export async function rigState(ctx: McpCallContext): Promise<Result<unknown>> {
  const state = unwrap<FlyState>(await ctx.invoke('fly:state'));
  if (!state.ok) return state;
  const session = unwrap<unknown>(await ctx.invoke('fly:session'));
  const active = state.value.profiles.find((p) => p.id === state.value.activeProfileId);
  let check: Report | { error: string } | undefined;
  if (active) {
    const checked = unwrap<Report>(
      await ctx.invoke('fly:check', { profileId: active.id, remember: false })
    );
    check = checked.ok
      ? {
          ready: checked.value.ready,
          failed: checked.value.failed,
          warnings: checked.value.warnings,
          fixable: checked.value.fixable,
          results: checked.value.results.map((r) => ({
            itemId: r.itemId,
            title: r.title,
            group: r.group,
            required: r.required,
            status: r.status,
            summary: r.summary,
            ...(r.fix ? { fix: r.fix, fixKind: r.fixKind } : {}),
            ...(r.disabled ? { disabled: true } : {}),
          })),
        }
      : { error: checked.error.message };
  }
  return ok({
    setupInUse: active ?? null,
    check: check ?? null,
    session: session.ok ? session.value : null,
    setups: state.value.profiles,
    ...(state.value.notice ? { notice: state.value.notice } : {}),
  });
}

export function builtinResources(deps: ResourceDeps): {
  resources: McpResourceDefinition[];
  templates: McpResourceTemplateDefinition[];
} {
  const resources: McpResourceDefinition[] = [
    {
      uri: GUIDE_URI,
      name: 'guide',
      title: 'How to work with RigReady',
      description:
        'The operating rules for an assistant: check before fixing, preview before writing, never guess an id, what the user confirms in the app, and which tools and resources to use for what.',
      mimeType: 'text/markdown',
      read: async () => ok(GUIDE),
    },
    {
      uri: DOCS_URI,
      name: 'docs',
      title: 'The manual: contents',
      description:
        'Every section and page of the RigReady manual with a one-line description and the URI to read it (rigready://docs/<section>/<page>).',
      mimeType: 'text/markdown',
      read: async () => ok(renderContents(deps.manual())),
    },
    {
      uri: 'rigready://ipc',
      name: 'ipc',
      title: 'The IPC channels, by feature',
      description:
        'The features of RigReady with how many channels each offers an assistant; read rigready://ipc/<feature> for the fields of each channel.',
      mimeType: 'text/markdown',
      read: async () => ok(renderFeatureIndex(deps.reference())),
    },
    {
      uri: 'rigready://rig/state',
      name: 'rig-state',
      title: 'The rig right now',
      description:
        'The setup in use with the result of a fresh check (every item, met or not, with its fix), the session of the moment, and the other setups. Runs the checklist, so it takes a few seconds.',
      mimeType: 'application/json',
      read: async (ctx) => {
        const state = await rigState(ctx);
        return state.ok ? ok(json(state.value)) : state;
      },
    },
    {
      uri: 'rigready://setups',
      name: 'setups',
      title: 'The setups',
      description:
        'Every setup on this PC: id, name, game, when it was last used and whether it can launch. Read rigready://setups/<id> for one as YAML.',
      mimeType: 'application/json',
      read: async (ctx) => {
        const state = unwrap<FlyState>(await ctx.invoke('fly:state'));
        return state.ok ? ok(json(state.value.profiles)) : state;
      },
    },
    {
      uri: 'rigready://log',
      name: 'log',
      title: "RigReady's log",
      description:
        "The newest lines of the app's log file (personal details already masked): what the app did and what went wrong, for troubleshooting.",
      mimeType: 'text/plain',
      read: async (ctx) => {
        const log = unwrap<{
          entries: { time: string; level: string; scope: string; text: string }[];
          older: number;
        }>(await ctx.invoke('diagnostics:log', { limit: 400 }));
        if (!log.ok) return log;
        return ok(
          [
            `${log.value.older} older entries not shown.`,
            ...log.value.entries.map(
              (e) => `${e.time} ${e.level.toUpperCase()} [${e.scope}] ${e.text}`
            ),
          ].join('\n')
        );
      },
    },
    {
      uri: 'rigready://safety',
      name: 'safety',
      title: 'Every change RigReady made',
      description:
        "The Safety page as data: every change the app made outside its own folder, by action, newest first, with the files and whether it was undone. An assistant's changes are here too, under the action it caused.",
      mimeType: 'application/json',
      read: async (ctx) => {
        const view = unwrap<unknown>(await ctx.invoke('safety:journal'));
        return view.ok ? ok(json(view.value)) : view;
      },
    },
    {
      uri: 'rigready://activity',
      name: 'activity',
      title: 'What assistants did',
      description:
        'Every tool call assistants made in this run of RigReady, newest first: who, which tool, how it ended, and the Safety page actions it left.',
      mimeType: 'application/json',
      read: async () => ok(json(deps.activity.list(100))),
    },
  ];

  const templates: McpResourceTemplateDefinition[] = [
    {
      uriTemplate: 'rigready://docs/{section}/{page}',
      name: 'docs-page',
      title: 'A page of the manual',
      description: 'One page of the RigReady manual as Markdown. rigready://docs lists them.',
      mimeType: 'text/markdown',
      list: async () =>
        ok(
          deps
            .manual()
            .filter((p) => p.page !== '')
            .map((p) => ({ uri: p.uri, title: p.title, description: p.description }))
        ),
      read: async (variables) =>
        readPage(deps.manual(), `${variables['section']}/${variables['page']}`),
    },
    {
      uriTemplate: 'rigready://docs/{section}',
      name: 'docs-section',
      title: 'A section of the manual',
      description:
        "A section's own page of the RigReady manual: what the section covers and its pages.",
      mimeType: 'text/markdown',
      list: async () =>
        ok(
          deps
            .manual()
            .filter((p) => p.page === '' && p.section !== '')
            .map((p) => ({ uri: p.uri, title: p.title, description: p.description }))
        ),
      read: async (variables) => readPage(deps.manual(), variables['section'] ?? ''),
    },
    {
      uriTemplate: 'rigready://ipc/{feature}',
      name: 'ipc-feature',
      title: "A feature's channels",
      description:
        'The IPC channels of one feature: what each does, its tool name, its tier, and the JSON Schema of what it takes and answers.',
      mimeType: 'text/markdown',
      list: async () => {
        const features = [...new Set(deps.reference().map((r) => r.feature))].sort();
        return ok(
          features.map((feature) => ({
            uri: `rigready://ipc/${feature}`,
            title: `Channels of ${feature}`,
          }))
        );
      },
      read: async (variables) => {
        const feature = variables['feature'] ?? '';
        if (!deps.reference().some((r) => r.feature === feature)) {
          return err(
            'mcp.resource',
            `There is no feature "${feature}". Read rigready://ipc for the list.`
          );
        }
        return ok(renderFeatureReference(deps.reference(), feature));
      },
    },
    {
      uriTemplate: 'rigready://setups/{id}',
      name: 'setup',
      title: 'A setup file',
      description:
        'One setup as RigReady stores it (YAML): its checks with their parameters, actions, tracked files and the game it launches.',
      mimeType: 'application/yaml',
      list: async (ctx) => {
        const state = unwrap<FlyState>(await ctx.invoke('fly:state'));
        if (!state.ok) return state;
        return ok(
          state.value.profiles.map((p) => ({
            uri: `rigready://setups/${p.id}`,
            title: p.name,
            ...(p.gameName ? { description: p.gameName } : {}),
          }))
        );
      },
      read: async (variables, ctx) => {
        const id = variables['id'] ?? '';
        const edit = unwrap<{ file: string }>(await ctx.invoke('profiles:edit', { id }));
        if (!edit.ok) return edit;
        return deps.readFile(edit.value.file);
      },
    },
  ];
  return { resources, templates };
}

function readPage(pages: ManualPage[], path: string): Result<string> {
  const read = readManualPage(pages, path);
  return read.ok ? ok(read.text) : err('mcp.resource', read.message);
}
