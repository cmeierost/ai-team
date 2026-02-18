/**
 * Init command - initialize AI Team in workspace
 */

import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { ensureAiTeamDirectory } from '@ai-team/core';

interface InitOptions {
  template?: string;
  force?: boolean;
}

export async function initCommand(options: InitOptions) {
  const workspaceRoot = process.cwd();
  const aiTeamDir = path.join(workspaceRoot, '.ai-team');

  // Check if already initialized
  try {
    const stats = await fs.stat(aiTeamDir);
    if (stats.isDirectory()) {
      console.log(chalk.yellow('⚠ AI Team is already initialized in this workspace'));
      console.log(chalk.dim('  Location: ' + aiTeamDir));
      console.log(chalk.dim('\n  To reinitialize, delete .ai-team/ first or use --force flag'));
      
      if (!options.force) {
        return;
      }
      
      console.log(chalk.yellow('  Force flag detected - reinitializing...\n'));
    }
  } catch (error) {
    // Directory doesn't exist, proceed with init
  }

  const spinner = ora('Initializing AI Team workspace...').start();

  try {
    const workspaceRoot = process.cwd();

    // Create directory structure
    await ensureAiTeamDirectory(workspaceRoot);
    spinner.text = 'Created .ai-team directory structure';

    // Create starter templates
    await createStarterTemplates(workspaceRoot, options.template || 'basic');
    spinner.text = 'Created starter templates';

    // Create .gitignore additions
    await updateGitignore(workspaceRoot);
    spinner.text = 'Updated .gitignore';

    spinner.succeed(chalk.green('AI Team initialized successfully!'));

    console.log('\n' + chalk.bold('Next steps:'));
    console.log(chalk.dim('  1. Review agents in .ai-team/agents/'));
    console.log(chalk.dim('  2. Customize roles in .ai-team/roles/'));
    console.log(chalk.dim('  3. Run') + ' ai-team list ' + chalk.dim('to see your team'));
    console.log(chalk.dim('  4. Run') + ' ai-team chat <agent-id> ' + chalk.dim('to start chatting'));
  } catch (error) {
    spinner.fail(chalk.red('Failed to initialize AI Team'));
    console.error(error);
    process.exit(1);
  }
}

async function createStarterTemplates(workspaceRoot: string, template: string) {
  const aiTeamDir = path.join(workspaceRoot, '.ai-team');

  // Create a basic CTO agent
  const ctoAgent = `---
name: CTO
role: cto
type: executive
contextLevel: organization
permissions:
  read:
    - "**/*"
  write:
    - ".ai-team/**/*"
    - "docs/**/*"
  manage_agents: true
tools:
  - read_file
  - file_search
  - semantic_search
  - create_agent
  - archive_agent
  - assess_performance
personality:
  communication_style: strategic
  expertise_level: executive
avatar:
  type: ai-generated
  style: professional-headshot
  seed: cto-executive
---

I am the Chief Technology Officer overseeing the entire technical organization.
`;

  await fs.writeFile(
    path.join(aiTeamDir, 'agents', 'cto.md'),
    ctoAgent,
    'utf-8'
  );

  // Create CTO role template
  const ctoRole = `---
name: cto
type: executive
description: Chief Technology Officer - Strategic technical leadership
contextLevel: organization
responsibilities:
  - Define technical strategy and architecture
  - Oversee all development teams
  - Make technology decisions
  - Assess team performance
tools:
  - read_file
  - file_search
  - semantic_search
  - create_agent
  - archive_agent
  - assess_performance
permissions:
  read:
    - "**/*"
  write:
    - ".ai-team/**/*"
    - "docs/**/*"
  manage_agents: true
canDelegate: true
---

As CTO, you have strategic oversight of the entire technical organization. You can:

1. Review high-level architecture and design decisions
2. Create and manage team members
3. Assess team performance and productivity
4. Delegate tasks to appropriate team leads
5. Provide strategic technical guidance

Focus on the big picture rather than implementation details.
`;

  await fs.writeFile(
    path.join(aiTeamDir, 'roles', 'cto.md'),
    ctoRole,
    'utf-8'
  );

  // Create a README
  const readme = `# AI Team

This directory contains your virtual AI development team configuration.

## Structure

- \`agents/\` - Individual team members
- \`roles/\` - Role templates/skills
- \`features/\` - Feature teams and assignments
- \`meetings/\` - Meeting summaries (committed to git)
- \`private/\` - Private chat logs (gitignored)
- \`avatars/\` - AI-generated team member avatars

## Getting Started

1. List your team: \`ai-team list\`
2. Chat with the CTO: \`ai-team chat cto\`
3. Create a new developer: \`ai-team create agent --interactive\`

## Learn More

- See ARCHITECTURE.md for system design
- See COPILOT-CONTEXT.md for project overview
`;

  await fs.writeFile(
    path.join(aiTeamDir, 'README.md'),
    readme,
    'utf-8'
  );
}

async function updateGitignore(workspaceRoot: string) {
  const gitignorePath = path.join(workspaceRoot, '.gitignore');
  const additions = `
# AI Team private data
.ai-team/private/
**/*.jsonl
`;

  try {
    let content = await fs.readFile(gitignorePath, 'utf-8');
    if (!content.includes('.ai-team/private/')) {
      content += additions;
      await fs.writeFile(gitignorePath, content, 'utf-8');
    }
  } catch (error) {
    // .gitignore doesn't exist, create it
    await fs.writeFile(gitignorePath, additions.trim(), 'utf-8');
  }
}
