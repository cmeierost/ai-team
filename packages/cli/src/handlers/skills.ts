import chalk from 'chalk';
import type { SearchSkillsResponse, UpdateAgentSkillResponse } from '@ai-team/api-client';

interface SkillsRenderOptions {
  json?: boolean;
}

function printSkills(response: SearchSkillsResponse): void {
  if (response.entries.length === 0) {
    console.log(chalk.yellow('No matching skills found.'));
    return;
  }

  if (response.agent) {
    console.log(
      chalk.bold(
        `\nSkills for ${chalk.cyan(response.agent.name)} ${chalk.dim(`(${response.agent.id})`)}`
      )
    );
    console.log(chalk.dim(`Role: ${response.agent.role}`));
  } else {
    console.log(chalk.bold('\nAvailable Skills'));
  }

  for (const skill of response.entries) {
    const assignedBadge =
      typeof skill.assignedToAgent === 'boolean'
        ? skill.assignedToAgent
          ? chalk.green(' [assigned]')
          : chalk.dim(' [not assigned]')
        : '';

    console.log(`\n${chalk.cyan(skill.name)}${assignedBadge}`);
    console.log(chalk.dim(`  ${skill.description}`));
    if (skill.type || skill.contextLevel) {
      console.log(
        chalk.dim(`  type: ${skill.type ?? '—'} | context: ${skill.contextLevel ?? '—'}`)
      );
    }
    if ((skill.tools?.length ?? 0) > 0) {
      console.log(chalk.dim(`  tools: ${skill.tools?.join(', ')}`));
    }
  }

  console.log(
    chalk.dim(`\n${response.entries.length} skill${response.entries.length === 1 ? '' : 's'}\n`)
  );
}

export function renderSkillsList(
  response: SearchSkillsResponse,
  options: SkillsRenderOptions = {}
): void {
  if (options.json) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }
  printSkills(response);
}

export function renderSkillsAdd(
  result: UpdateAgentSkillResponse,
  options: SkillsRenderOptions = {}
): void {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.changed) {
    console.log(
      chalk.green(
        `✔ Added skill ${chalk.cyan(result.skill)} to ${chalk.cyan(result.agent.name)} (${result.agent.id})`
      )
    );
  } else {
    console.log(
      chalk.yellow(
        `Skill ${chalk.cyan(result.skill)} was already assigned to ${chalk.cyan(result.agent.name)} (${result.agent.id})`
      )
    );
  }

  console.log(chalk.dim(`skills: ${result.skills.join(', ') || '(none)'}`));
}

export function renderSkillsRemove(
  result: UpdateAgentSkillResponse,
  options: SkillsRenderOptions = {}
): void {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.changed) {
    console.log(
      chalk.green(
        `✔ Removed skill ${chalk.cyan(result.skill)} from ${chalk.cyan(result.agent.name)} (${result.agent.id})`
      )
    );
  } else {
    console.log(
      chalk.yellow(
        `Skill ${chalk.cyan(result.skill)} was not assigned to ${chalk.cyan(result.agent.name)} (${result.agent.id})`
      )
    );
  }

  console.log(chalk.dim(`skills: ${result.skills.join(', ') || '(none)'}`));
}
