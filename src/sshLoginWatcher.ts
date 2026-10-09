import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { sendNotification } from './sendNotification.js';

const acceptedLoginPattern = /^Accepted \S+ for (\S+) from (\S+)(?:\s|$)/;
const loginAttemptPatterns = [
  /^Failed \S+ for (?:invalid user )?(\S+) from (\S+)(?:\s|$)/,
  /^Invalid user (\S+) from (\S+)(?:\s|$)/,
  /^(?:Connection (?:closed|reset) by|Disconnected from) authenticating user (\S+) (\S+)(?:\s|$)/,
];

function getLoginAttempt(line: string): { user: string; remoteHost: string } | undefined {
  for (const pattern of loginAttemptPatterns) {
    const match = line.match(pattern);
    if (match) {
      return { user: match[1], remoteHost: match[2] };
    }
  }

  return undefined;
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
          const notification = `SECURITY: SSH login attempt for ${loginAttempt.user} from ${loginAttempt.remoteHost}`;
          console.log(`SSH login attempt detected: ${notification}`);

          void sendNotification(notification)
            .then(() => console.log('SSH login attempt notification sent'))
            .catch((error: unknown) =>
              console.error('Failed to send SSH login attempt notification:', error),
            );
          return;
        }

        const match = line.match(acceptedLoginPattern);

        if (!match) {
          return;
        }

        const [, user, remoteHost] = match;
        const notification = `SSH login: ${user} from ${remoteHost}`;
        console.log(`SSH login detected: ${notification}`);

        void sendNotification(notification)
          .then(() => console.log('SSH login notification sent'))
          .catch((error: unknown) => console.error('Failed to send SSH login notification:', error));
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