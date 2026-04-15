---
name: cross-shell-command-execution
description: 'Use when an agent needs to run commands reliably across PowerShell, pwsh, cmd, bash, or sh; choose between exec, spawn, and execFile; debug shell-specific failures; or normalize cwd, env, quoting, and output handling for cross-platform command execution.'
---

# Cross-shell command execution

Use this skill when the job is to run commands safely and predictably across Windows and Unix-like environments without turning shell choice into guesswork.

Typical triggers:

- a command works in one shell but fails in another
- an agent needs to run scripts on Windows and Linux/macOS
- PowerShell, cmd, bash, or sh syntax differences are breaking execution
- `exec()` is behaving differently than expected
- quoting, env vars, pipes, or redirection are failing cross-platform
- the right choice between `exec`, `spawn`, and `execFile` is unclear

## What this skill optimizes for

- reliable command execution across operating systems
- explicit shell choice instead of accidental defaults
- fewer quoting and environment bugs
- predictable cwd, env, timeout, and output handling
- clear failure diagnosis with enough evidence to act

## Workflow

1. Decide whether a shell is needed.
   - Use `execFile` or `spawn` when you are launching a real executable with structured args.
   - Use `exec` only when shell behavior is actually required, such as pipes, redirection, glob expansion, chaining, or shell built-ins.

2. Identify the runtime environment.
   - Check the operating system first.
   - On Windows, prefer `pwsh` or `powershell.exe` for scriptable workflows, with `cmd.exe` as a compatibility fallback.
   - On Unix-like systems, prefer `/bin/sh` for simple portable commands and `/bin/bash` only when bash-specific behavior is required.

3. Choose the shell explicitly when shell parsing is required.
   - Do not rely on Node.js defaults unless compatibility with the default shell is the point.
   - Remember the default behavior for `exec()`:
     - Windows: `process.env.ComSpec` or `cmd.exe`
     - Unix-like: `/bin/sh`

4. Keep command intent separate from shell rendering.
   - Prefer representing execution as executable + args + env + cwd.
   - Render shell-native syntax only for the selected shell.
   - Do not reuse bash syntax in PowerShell or cmd.

5. Normalize execution options.
   - Set `cwd` intentionally.
   - Pass `env` explicitly, usually starting from `process.env`.
   - Set a reasonable `timeout`.
   - Set `maxBuffer` for `exec` when output might be non-trivial.
   - Capture `stdout`, `stderr`, exit code, and the chosen shell for diagnosis.

6. Debug failures with evidence, not guesses.
   - Verify the shell exists.
   - Verify the command syntax matches that shell.
   - Check `PATH`, `cwd`, permissions, and environment variables.
   - Distinguish shell startup failure from command-not-found from command-specific non-zero exit.

## Shell selection policy

### Windows

Preferred order:

1. `pwsh`
2. `powershell.exe`
3. `cmd.exe`

Use PowerShell when:

- the workflow is script-heavy
- object-oriented shell behavior helps
- you need modern Windows automation

Use `cmd.exe` when:

- you need compatibility with classic Windows command behavior
- the command relies on cmd built-ins or cmd-specific syntax

### Unix-like systems

Preferred order:

1. `/bin/sh` for simple portable shell commands
2. `/bin/bash` when bash-specific features are required

Use bash only when needed for features such as:

- arrays
- bash-specific parameter expansion
- bash-only test or function behavior

## Decision guide: exec vs spawn vs execFile

### Prefer `execFile`

Use when:

- you know the executable path or name
- arguments are already structured
- no shell syntax is needed

Why:

- avoids shell quoting problems
- safer for variable input
- more predictable cross-platform

### Prefer `spawn`

Use when:

- output may be large or streaming
- you want fine-grained stdio control
- the process may run for a while

Why:

- avoids `exec` buffer limits
- works well for interactive or long-running commands

### Use `exec`

Use when:

- you explicitly need shell parsing
- the command uses pipes, redirects, chaining, wildcards, or shell built-ins

Why:

- simplest way to run true shell command strings
- appropriate when the shell is part of the requirement

## Cross-shell syntax reminders

### Environment variables

- PowerShell: `$env:NAME`
- cmd: `%NAME%`
- bash/sh: `$NAME`

### Simple output

- PowerShell: `Write-Output "hello"`
- cmd: `echo hello`
- bash/sh: `echo "hello"`

### Chaining

- PowerShell: `;` or conditional patterns
- cmd: `&&`
- bash/sh: `&&`

Do not assume one shell's variable or quoting syntax will work in another.

## Node.js examples

### Direct execution with execFile

```js
const { execFile } = require('node:child_process');

execFile('node', ['-v'], {
  cwd: process.cwd(),
  env: process.env,
}, (error, stdout, stderr) => {
  if (error) {
    console.error({ error, stderr });
    return;
  }
  console.log(stdout);
});
```

### Streaming execution with spawn

```js
const { spawn } = require('node:child_process');

const child = spawn('node', ['-v'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'pipe',
});

child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
});

child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

child.on('close', (code) => {
  console.log('exit code:', code);
});
```

### Shell-specific execution with exec

```js
const { exec } = require('node:child_process');

const isWindows = process.platform === 'win32';
const shell = isWindows ? 'powershell.exe' : '/bin/sh';
const command = isWindows
  ? 'Write-Output "hello from powershell"'
  : 'echo "hello from sh"';

exec(command, {
  shell,
  cwd: process.cwd(),
  env: process.env,
  timeout: 15000,
  maxBuffer: 1024 * 1024,
}, (error, stdout, stderr) => {
  if (error) {
    console.error({ shell, command, error, stderr });
    return;
  }
  console.log(stdout);
});
```

## Failure checklist

When a command fails, check in this order:

1. Was a shell actually required?
2. Which shell was selected?
3. Does that shell exist on this machine?
4. Is the command valid syntax for that shell?
5. Is `cwd` correct?
6. Is the required executable on `PATH`?
7. Are required env vars present?
8. Did `exec` hit `maxBuffer`?
9. Is this a permission problem or a genuine non-zero exit from the command?

## Guardrails

- do not default to shell execution when direct execution is enough
- do not rely on interactive terminal assumptions about profile loading or environment setup
- do not mix bash, cmd, and PowerShell syntax in one command string
- do not diagnose cross-shell failures without capturing the selected shell, cwd, env assumptions, stdout, and stderr
- do not hide shell choice when reproducibility matters

## Successful outcome

- commands run with an intentional execution strategy
- shell choice is explicit and appropriate to the platform and syntax
- cross-platform failures become easier to diagnose
- agents can run scripts across PowerShell, pwsh, cmd, bash, and sh without avoidable guesswork
