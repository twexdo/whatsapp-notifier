import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { sendNotification } from './sendNotification.js';
import { startSshLoginWatcher } from './sshLoginWatcher.js';

type WhatsAppMessage = {
  id?: unknown;
  from?: unknown;
  type?: unknown;
  text?: { body?: unknown };
};

type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: WhatsAppMessage[];
      };
    }>;
  }>;
};

const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

if (!verifyToken) {
  throw new Error('Missing environment variable: WHATSAPP_VERIFY_TOKEN');
}

const port = Number(process.env.PORT ?? 3000);
const app = new Hono();
const processedMessages = new Map<string, number>();
const processedMessageTtlMs = 10 * 60 * 1000;

function hasProcessedMessage(messageId: string): boolean {
  const processedAt = processedMessages.get(messageId);

  if (!processedAt) {
    return false;
  }

  if (Date.now() - processedAt > processedMessageTtlMs) {
    processedMessages.delete(messageId);
    return false;
  }

  return true;
}

function markMessageAsProcessed(messageId: string): void {
  processedMessages.set(messageId, Date.now());
}

app.use('*', async (context, next) => {
  const requestUrl = new URL(context.req.url);
  const callerIp =
    context.req.header('cf-connecting-ip') ??
    context.req.header('x-forwarded-for') ??
    context.req.header('x-real-ip') ??
    'unknown';
  const userAgent = context.req.header('user-agent') ?? 'unknown';

  console.log(
    `Webhook request: ${context.req.method} ${requestUrl.pathname} caller=${callerIp} user-agent="${userAgent}"`,
  );
  await next();
});
app.use('*', logger());

app.get('/webhook', (context) => {
  const mode = context.req.query('hub.mode');
  const token = context.req.query('hub.verify_token');
  const challenge = context.req.query('hub.challenge');

  if (!mode && !token && !challenge) {
    return context.text('WhatsApp webhook is running');
  }

  if (mode === 'subscribe' && token === verifyToken && challenge) {
    return context.text(challenge);
  }

  return context.text('Forbidden', 403);
});

app.post('/webhook', async (context) => {
  let payload: WhatsAppWebhookPayload;

  try {
    payload = await context.req.json<WhatsAppWebhookPayload>();
  } catch {
    return context.text('Invalid JSON', 400);
  }

  const messages =
    payload.entry?.flatMap((entry) =>
      entry.changes?.flatMap((change) => change.value?.messages ?? []) ?? [],
    ) ?? [];

  if (messages.length === 0) {
    console.log('Webhook received a non-message event');
    return context.text('OK');
  }

  for (const message of messages) {
    const messageId = typeof message.id === 'string' ? message.id : undefined;
    const sender = typeof message.from === 'string' ? message.from : undefined;

    if (!sender) {
      continue;
    }

    if (messageId && hasProcessedMessage(messageId)) {
      console.log(`Duplicate WhatsApp message ignored: ${messageId}`);
      continue;
    }

    if (messageId) {
      markMessageAsProcessed(messageId);
    }

    const text = typeof message.text?.body === 'string' ? message.text.body : undefined;
    const messageType = typeof message.type === 'string' ? message.type : 'unknown';
    console.log(
      text
        ? `WhatsApp message received from ${sender}: ${text}`
        : `WhatsApp ${messageType} message received from ${sender}`,
    );

    void sendNotification('HELLO WORLD').catch((error: unknown) =>
      console.error(`Failed to send automatic reply for ${sender}:`, error),
    );
  }

  return context.text('OK');
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
  startSshLoginWatcher();
  void sendNotification('The WhatsApp notifier has started.')
    .then(() => console.log('Startup notification sent'))
    .catch((error: unknown) => console.error('Failed to send startup notification:', error));
});
