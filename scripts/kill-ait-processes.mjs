#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

function killPorts() {
  if (process.platform === 'win32') {
    return run('cmd.exe', ['/d', '/s', '/c', 'pnpm exec kill-port 3000 3001 3002']);
  }

  return run('pnpm', ['exec', 'kill-port', '3000', '3001', '3002']);
}

function killMatchingProcessesOnWindows() {
  const script = `
$targets = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and (
    ($_.CommandLine -match '(?i)\\bait\\.cmd\\b.*\\bui\\b') -or
    (($_.CommandLine -match '(?i)packages\\\\cli\\\\dist\\\\cli\\.js') -and ($_.CommandLine -match '(?i)\\bui\\b')) -or
    ($_.CommandLine -match '(?i)packages\\\\api-server\\\\src\\\\index\\.ts') -or
    ($_.CommandLine -match '(?i)packages\\\\api-server\\\\dist\\\\index\\.js')
  )
}
$pids = @($targets | Select-Object -ExpandProperty ProcessId)
if ($pids.Count -gt 0) {
  Stop-Process -Id $pids -Force -ErrorAction SilentlyContinue
  Write-Output ("Stopped AIT process IDs: " + ($pids -join ', '))
} else {
  Write-Output 'No matching AIT processes found.'
}
`;

  return run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
}

function isAitProcessCommand(commandLine) {
  return (
    /\bait(?:\.cmd)?\b.*\bui\b/i.test(commandLine) ||
    /packages[\\/]+cli[\\/]+dist[\\/]+cli\.js.*\bui\b/i.test(commandLine) ||
    /packages[\\/]+api-server[\\/]+src[\\/]+index\.ts/i.test(commandLine) ||
    /packages[\\/]+api-server[\\/]+dist[\\/]+index\.js/i.test(commandLine)
  );
}

function killMatchingProcessesOnLinux() {
  const psResult = spawnSync('ps', ['-eo', 'pid=,args='], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  if (psResult.error) {
    throw psResult.error;
  }

  if ((psResult.status ?? 1) !== 0) {
    return psResult.status ?? 1;
  }

  const matchingPids = psResult.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const firstSpace = line.indexOf(' ');
      if (firstSpace === -1) return null;
      const pidText = line.slice(0, firstSpace).trim();
      const commandLine = line.slice(firstSpace + 1);
      const pid = Number.parseInt(pidText, 10);
      if (!Number.isInteger(pid) || pid <= 0) return null;
      if (!isAitProcessCommand(commandLine)) return null;
      if (pid === process.pid) return null;
      return pid;
    })
    .filter((pid) => pid !== null);

  if (matchingPids.length === 0) {
    console.log('No matching AIT processes found.');
    return 0;
  }

  for (const pid of matchingPids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code !== 'ESRCH') {
        throw error;
      }
    }
  }

  for (const pid of matchingPids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code !== 'ESRCH') {
        throw error;
      }
    }
  }

  console.log(`Stopped AIT process IDs: ${matchingPids.join(', ')}`);
  return 0;
}

const portStatus = killPorts();
if (portStatus !== 0) {
  process.exit(portStatus);
}

if (process.platform === 'win32') {
  const processStatus = killMatchingProcessesOnWindows();
  process.exit(processStatus);
}

if (process.platform === 'linux') {
  const processStatus = killMatchingProcessesOnLinux();
  process.exit(processStatus);
}

process.exit(0);
