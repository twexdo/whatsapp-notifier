# WhatsApp Notifier

Minimal Hono + TypeScript service that sends WhatsApp notifications through Meta's Cloud API and keeps a webhook available for incoming events.

## Setup

```sh
npm install
cp .env.example .env
```

Set these values in `.env`:

```env
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_VERIFY_TOKEN=...
PHONE=+15551234567
# Optional, for proactive notifications outside the 24-hour window:
# WHATSAPP_TEMPLATE_NAME=your_approved_template_name
# WHATSAPP_TEMPLATE_LANGUAGE=en_US
PORT=3000
```

`PHONE` is the only destination for outgoing messages, in international format. The Phone Number ID and access token are used to send messages. The Verify Token is a secret you choose and enter in Meta's webhook configuration.

Without a template, notifications use free-form text and require an active WhatsApp conversation window. For proactive notifications, configure an approved `WHATSAPP_TEMPLATE_NAME` whose body has one text parameter; `WHATSAPP_TEMPLATE_LANGUAGE` defaults to `en_US`.

## Run

```sh
npm run dev
```

Each time the server starts, it sends `The WhatsApp notifier has started.` to `PHONE`.

### Run with Podman

Install Podman and a Compose provider, create `.env` as described above, then run:

```sh
podman compose up --build -d
```

The container publishes `PORT` (default `3000`) and mounts `/var/log/journal` read-only so the SSH login watcher can use `journalctl`. On Fedora, the Compose configuration disables SELinux labeling for this container because the default policy blocks journal access. This disables SELinux separation for the container; it still runs rootless and the journal mount is read-only. Add the host account running rootless Podman to `systemd-journal` and start a new login session:

```sh
sudo usermod -aG systemd-journal "$USER"
```

If the host stores its journal somewhere other than `/var/log/journal`, set `JOURNAL_DIR` to that path in `.env`. Follow output with `podman compose logs -f` and stop the service with `podman compose down`.

Meta must reach the server over HTTPS. During local development, expose port `3000` through an HTTPS tunnel and use its public URL plus `/webhook` as the Meta callback URL. Use the same value from `WHATSAPP_VERIFY_TOKEN` in Meta's Verify token field.

Incoming messages arrive at `POST /webhook` and receive `HELLO WORLD` through the configured `PHONE`. Application jobs can send an outgoing message to `PHONE` by importing the single sender function:

```ts
import { sendNotification } from './sendNotification.js';

await sendNotification('Your notification text');
```

## Fedora SSH Login Notifications

While the app is running, it follows `sshd.service` and `fail2ban.service` in the system journal. Accepted SSH logins send `SSH login: <username> from <remote IP>`; Fail2ban `Ban` events send `SECURITY: Fail2ban banned <IP> in <jail>`. Ban alerts include the approximate city, region, and country from ipwho.is over HTTPS; this sends the source IP to that third-party service, and the location may be unavailable or inaccurate. Failed authentication attempts are not sent. Configure Fail2ban to log to journald by adding `logtarget = SYSTEMD-JOURNAL` under `[Definition]` in `/etc/fail2ban/fail2ban.local`, then restart Fail2ban. Logins and bans that happen while the app is stopped are not reported.

The account running the app must be able to read the system journal. On Fedora, you can grant access with `sudo usermod -aG systemd-journal <app-user>`, then start a new login session for that account. This group can read system journal entries, not only SSH logs.

WhatsApp may reject free-form login notifications when the recipient's 24-hour customer service window is closed. For reliable proactive alerts, configure an approved template with `WHATSAPP_TEMPLATE_NAME` in `.env`.
