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

Meta must reach the server over HTTPS. During local development, expose port `3000` through an HTTPS tunnel and use its public URL plus `/webhook` as the Meta callback URL. Use the same value from `WHATSAPP_VERIFY_TOKEN` in Meta's Verify token field.

Incoming messages arrive at `POST /webhook` and receive `HELLO WORLD` through the configured `PHONE`. Application jobs can send an outgoing message to `PHONE` by importing the single sender function:

```ts
import { sendNotification } from './sendNotification.js';

await sendNotification('Your notification text');
```

## Fedora SSH Login Notifications

While the app is running, it follows `sshd.service` in the system journal and sends `SSH login: <username> from <remote IP>` to `PHONE` for each accepted SSH login. It uses `journalctl --follow`, so no PAM hook or polling interval is needed. Logins that happen while the app is stopped are not reported.

The account running the app must be able to read the system journal. On Fedora, you can grant access with `sudo usermod -aG systemd-journal <app-user>`, then start a new login session for that account. This group can read system journal entries, not only SSH logs.

WhatsApp may reject free-form login notifications when the recipient's 24-hour customer service window is closed. For reliable proactive alerts, configure an approved template with `WHATSAPP_TEMPLATE_NAME` in `.env`.
