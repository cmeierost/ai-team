import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChatMessage } from '@ai-team/core';

export interface OnboardingTranscriptOptions {
  workspaceRoot: string;
  relativePath: string;
  title: string;
  intro: string[];
  history: ChatMessage[];
  developerLabel?: string;
  agentLabel: string;
}

export function buildOnboardingTranscriptMarkdown(options: {
  title: string;
  intro: string[];
  history: ChatMessage[];
  developerLabel?: string;
  agentLabel: string;
}): string {
  const lines: string[] = [`# ${options.title}`, ''];

  for (const line of options.intro) {
    lines.push(line);
  }
  lines.push('');

  for (const msg of options.history) {
    const speaker = msg.isHuman
      ? options.developerLabel?.trim() || 'Developer'
      : options.agentLabel;
    lines.push(`**${speaker}:** ${msg.content}`);
    lines.push('');
  }

  return lines.join('\n');
}

export async function saveOnboardingTranscriptAsync(
  options: OnboardingTranscriptOptions
): Promise<string> {
  const content = buildOnboardingTranscriptMarkdown({
    title: options.title,
    intro: options.intro,
    history: options.history,
    developerLabel: options.developerLabel,
    agentLabel: options.agentLabel,
  });

  const filePath = path.join(options.workspaceRoot, options.relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}
