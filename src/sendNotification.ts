import 'dotenv/config';

export async function sendNotification(message: string): Promise<void> {
  const requiredEnvironment = [
    'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_ACCESS_TOKEN',
    'PHONE',
  ] as const;
  const missing = requiredEnvironment.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }

  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
  const messageContent = templateName
    ? {
        type: 'template',
        template: {
          name: templateName,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? 'en_US' },
          components: [
            {
              type: 'body',
              parameters: [{ type: 'text', text: message }],
            },
          ],
        },
      }
    : { type: 'text', text: { body: message } };

  const response = await fetch(
    `https://graph.facebook.com/v23.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: process.env.PHONE,
        ...messageContent,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`WhatsApp API request failed: ${response.status} ${await response.text()}`);
  }
}