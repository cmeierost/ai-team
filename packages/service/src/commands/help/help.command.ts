import type {
  ICommand,
  CommandResponse,
  ExecutionContext,
  ICommandDescriptor,
} from '@ai-team/core';
import { GROUP_REGISTRY } from '../groups.js';
import { ZodSchemaTools } from '../../utils/zod-schema.js';

type RegistryEntry = Pick<
  ICommandDescriptor,
  'usage' | 'description' | 'key' | 'group' | 'availableIn' | 'path'
> & { parameters?: unknown };

interface HelpPayload {
  extra?: RegistryEntry[];
  filter?: string;
}

function parseHelpPayload(args: string): HelpPayload {
  try {
    const candidate: unknown = JSON.parse(args);
    if (candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const obj = candidate as Record<string, unknown>;
      return {
        extra: Array.isArray(obj.extra) ? (obj.extra as RegistryEntry[]) : undefined,
        filter: typeof obj.filter === 'string' ? obj.filter : undefined,
      };
    }
  } catch {
    // plain string arg — ignore
  }
  return {};
}

interface ParamInfo {
  name: string;
  description: string;
  optional: boolean;
  isFlag: boolean;
}

function parseCommandParams(parameters: unknown): ParamInfo[] {
  if (!parameters) return [];
  const schemaTools = new ZodSchemaTools();
  const json = schemaTools.toJsonSchema(parameters);
  const props = json.properties as
    | Record<string, { type?: unknown; description?: string }>
    | undefined;
  const required = Array.isArray(json.required) ? (json.required as string[]) : [];
  if (!props) return [];
  return Object.entries(props).map(([name, field]) => ({
    name,
    description: field.description ?? '',
    optional: !required.includes(name),
    isFlag: field.type === 'boolean',
  }));
}

function buildDetailPrefix(entry: RegistryEntry, isCliInvocation: boolean): string {
  if (isCliInvocation) {
    return entry.group ? `ait ${entry.group} ${entry.key}` : `ait ${entry.key}`;
  }
  return entry.group ? `/${entry.group} ${entry.key}` : `/${entry.key}`;
}

function buildParamSuffix(p: ParamInfo): string {
  const tags: string[] = [];
  if (p.optional) tags.push('optional');
  if (p.isFlag) tags.push('flag');
  return tags.length > 0 ? ` (${tags.join(', ')})` : '';
}

function renderDetailView(entry: RegistryEntry, isCliInvocation: boolean): string {
  const usageSuffix = entry.usage ? ` ${entry.usage}` : '';
  const lines: string[] = [
    `${buildDetailPrefix(entry, isCliInvocation)}${usageSuffix}`,
    '',
    `  ${entry.description}`,
  ];
  const params = parseCommandParams(entry.parameters);
  if (params.length > 0) {
    lines.push('', 'Parameters:');
    for (const p of params) {
      lines.push(`  ${p.name.padEnd(20)} ${p.description}${buildParamSuffix(p)}`);
    }
  }
  return lines.join('\n');
}

export const HelpChatCommandMetadata = {
  key: 'help',
  group: 'system',
  description: 'Show this help',
  availableIn: { chat: true, tool: true, cli: true },
} satisfies ICommandDescriptor;

export class HelpChatCommand implements ICommand<string, string> {
  readonly metadata = HelpChatCommandMetadata;

  constructor(private readonly getRegistry: () => RegistryEntry[]) {}

  async execute(args: string, ctx: ExecutionContext): Promise<CommandResponse<string>> {
    const surface = ctx.invocationSurface;
    const isToolInvocation = surface === 'tool';
    const isCliInvocation = surface === 'cli';
    const entries = this.getRegistry();

    // CLI callers may inject local-only entries (e.g. chat, serve) that live
    // outside the service registry, via a JSON payload { extra: RegistryEntry[], filter?: string }.
    const payload = isCliInvocation && args ? parseHelpPayload(args) : {};
    const extraEntries = payload.extra ?? [];

    let visibleEntries: RegistryEntry[];
    if (isToolInvocation) {
      visibleEntries = entries.filter((entry) => entry.availableIn?.tool);
    } else if (isCliInvocation) {
      visibleEntries = [...entries.filter((entry) => entry.availableIn?.cli), ...extraEntries];
    } else {
      visibleEntries = entries;
    }

    // Single-command detail view
    if (payload.filter) {
      const target = visibleEntries.find((e) => {
        const match = e.group ? `${e.group} ${e.key}` : e.key;
        return match === payload.filter;
      });
      const text = target
        ? renderDetailView(target, isCliInvocation)
        : `Unknown command: ${payload.filter}\nRun 'ait help' to see all available commands.`;
      return { status: 'ok', message: text, data: text };
    }

    const staticEntries = visibleEntries.filter((entry) => entry.path?.[0] !== 'dynamic');
    const dynamicEntries = visibleEntries.filter((entry) => entry.path?.[0] === 'dynamic');

    const lines: string[] = [];

    const formatInvocation = (c: RegistryEntry): string => {
      if (isCliInvocation) {
        return c.group ? `ait ${c.group} ${c.key}` : `ait ${c.key}`;
      }
      return c.group ? `/${c.group} ${c.key}` : `/${c.key}`;
    };

    const formatEntry = (c: RegistryEntry) => {
      const invocation = formatInvocation(c);
      const usageHint = c.usage && c.usage !== c.key ? ` (${c.usage})` : '';
      lines.push(`    ${invocation.padEnd(28)} ${c.description}${usageHint}`);
    };

    const appendGroupedSection = (title: string, entries: RegistryEntry[]) => {
      if (entries.length === 0) return;
      lines.push(`\n${title}\n`);
      // Collect groups present, preserving GROUP_REGISTRY insertion order
      const groupOrder = Object.keys(GROUP_REGISTRY);
      const byGroup = new Map<string, RegistryEntry[]>();
      const ungrouped: RegistryEntry[] = [];
      for (const entry of entries) {
        if (entry.group) {
          const list = byGroup.get(entry.group) ?? [];
          list.push(entry);
          byGroup.set(entry.group, list);
        } else {
          ungrouped.push(entry);
        }
      }
      // Render groups in registry order, then any unknown groups alphabetically
      const knownGroups = groupOrder.filter((g) => byGroup.has(g));
      const unknownGroups = [...byGroup.keys()]
        .filter((g) => !groupOrder.includes(g))
        .sort((a, b) => a.localeCompare(b));
      for (const g of [...knownGroups, ...unknownGroups]) {
        const info = GROUP_REGISTRY[g];
        const header = info ? `  ${info.displayName}` : `  ${g}`;
        lines.push(`\n${header}`);
        for (const c of byGroup.get(g)!) formatEntry(c);
      }
      if (ungrouped.length > 0) {
        lines.push(`\n  General`);
        for (const c of ungrouped) formatEntry(c);
      }
    };

    const sectionTitle = isToolInvocation
      ? 'Available tool-callable commands:'
      : 'Available commands:';
    appendGroupedSection(sectionTitle, staticEntries);
    if (dynamicEntries.length > 0) {
      lines.push(`\n  Dynamic commands\n`);
      for (const c of dynamicEntries) formatEntry(c);
    }

    if (!isToolInvocation && !isCliInvocation) {
      lines.push(`  ${'#<tool> <json>'.padEnd(26)} Run a direct tool call`);
    }

    const text = lines.join('\n');
    return { status: 'ok', message: text, data: text };
  }
}
