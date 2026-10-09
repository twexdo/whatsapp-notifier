import { isIP } from 'node:net';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { sendNotification } from './sendNotification.js';

const acceptedLoginPattern = /^Accepted \S+ for (\S+) from (\S+)(?:\s|$)/;
const failedLoginPattern = /^Failed (\S+) for (?:invalid user )?(\S+) from (\S+)(?:\s|$)/;
const otherLoginAttemptPatterns = [
  /^Invalid user (\S+) from (\S+)(?:\s|$)/,
  /^(?:Connection (?:closed|reset) by|Disconnected from) authenticating user (\S+) (\S+)(?:\s|$)/,
];

type LoginAttempt = { user: string; remoteHost: string; authMethod?: string };

function getLoginAttempt(line: string): LoginAttempt | undefined {
  const failedLoginMatch = line.match(failedLoginPattern);
  if (failedLoginMatch) {
    return {
      authMethod: failedLoginMatch[1],
      user: failedLoginMatch[2],
      remoteHost: failedLoginMatch[3],
    };
  }

  for (const pattern of otherLoginAttemptPatterns) {
    const match = line.match(pattern);
    if (match) {
      return { user: match[1], remoteHost: match[2] };
    }
  }

  return undefined;
}

async function getIpLocation(ip: string): Promise<string | undefined> {
  if (!isIP(ip)) {
    return undefined;
  }

  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return undefined;
    }

    const result = (await response.json()) as {
      success?: boolean;
      city?: string;
      region?: string;
      country?: string;
    };
    if (!result.success) {
      return undefined;
    }

    const locationParts = [result.city, result.region, result.country].filter(
      (part): part is string => Boolean(part),
    );
    return [...new Set(locationParts)].join(', ') || undefined;
  } catch {
    return undefined;
  }
}

function sendLoginNotification(message: string, remoteHost: string, eventLabel: string): void {
  void getIpLocation(remoteHost)
    .then((location) => {
      const notification = location ? `${message} (${location})` : message;
      console.log(`${eventLabel}: ${notification}`);
      return sendNotification(notification);
    })
    .then(() => console.log(`${eventLabel} notification sent`))
    .catch((error: unknown) => console.error(`Failed to send ${eventLabel} notification:`, error));
}

export function startSshLoginWatcher(): void {
  let stopped = false;
  let journalProcess: ReturnType<typeof spawn> | undefined;
  let restartTimer: NodeJS.Timeout | undefined;

  const startJournalFollower = (): void => {
    if (stopped) {
      return;
    }

    const child = spawn(
      'journalctl',
      ['--follow', '--lines=0', '--unit=sshd.service', '--output=cat'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    journalProcess = child;

    if (child.stdout) {
      const lines = createInterface({ input: child.stdout });
      lines.on('line', (line) => {
        const loginAttempt = getLoginAttempt(line);

        if (loginAttempt) {
          const method = loginAttempt.authMethod ? ` via ${loginAttempt.authMethod}` : '';
          const message = `SECURITY: SSH login attempt for ${loginAttempt.user}${method} from ${loginAttempt.remoteHost}`;
          sendLoginNotification(message, loginAttempt.remoteHost, 'SSH login attempt');
          return;
        }

        const match = line.match(acceptedLoginPattern);

        if (!match) {
          return;
        }

        const [, user, remoteHost] = match;
        sendLoginNotification(`SSH login: ${user} from ${remoteHost}`, remoteHost, 'SSH login');
      });
    }

    child.stderr?.on('data', (chunk: Buffer) => {
      const message = chunk.toString().trim();
      if (message) {
        console.error(`sshd journal watcher: ${message}`);
      }
    });

    child.on('error', (error) => {
      console.error('Could not start sshd journal watcher:', error);
    });

    child.on('close', (code, signal) => {
      if (journalProcess === child) {
        journalProcess = undefined;
      }

      if (stopped) {
        return;
      }

      console.error(
        `sshd journal watcher exited (code ${code ?? 'none'}, signal ${signal ?? 'none'}); retrying in 5 seconds`,
      );
      restartTimer = setTimeout(startJournalFollower, 5000);
      restartTimer.unref();
    });
  };

  process.once('exit', () => {
    stopped = true;
    if (restartTimer) {
      clearTimeout(restartTimer);
    }
    journalProcess?.kill('SIGTERM');
  });

  startJournalFollower();
}