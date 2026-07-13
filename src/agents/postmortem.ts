import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Postmortem Agent
 *
 * Triggered by `@Relay postmortem`. Retrieves the message history of the
 * incident channel and uses Gemini 2.5 Flash to generate a structured postmortem.
 */
export async function generatePostmortem(
  client: any,
  incident: any,
  channelId: string
): Promise<any[]> {
  console.log(`[Postmortem Agent] Generating postmortem for incident: ${incident.title}`);

  let messages: any[] = [];
  try {
    const history = await client.conversations.history({
      channel: channelId,
      limit: 200,
    });
    messages = (history.messages ?? []).reverse(); // Oldest first
  } catch (err) {
    console.error('[Postmortem Agent] conversations.history failed:', (err as any).message);
    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `❌ Could not retrieve channel history for postmortem: ${(err as any).message}` },
      },
    ];
  }

  const transcript = messages
    .filter((m) => m.text)
    .map((m) => {
      const time = new Date(parseFloat(m.ts) * 1000).toISOString();
      return `[${time}] ${m.user || m.username || 'Bot'}: ${m.text}`;
    })
    .join('\n');

  const prompt = `You are the Postmortem Agent. Analyze the following incident channel transcript and generate a professional, structured postmortem report.

Format your output using standard markdown. Use the following sections:
- **Incident Summary**: A brief overview of what happened.
- **Timeline**: 3-5 key events with timestamps (if inferable).
- **Root Cause**: What caused the incident based on the discussion. If not identified, state "Not conclusively identified."
- **Actions Taken**: What was done to mitigate the incident.
- **Follow-ups**: Remaining tasks or long-term fixes.

Keep it concise and objective.

Incident Title: ${incident.title}
Incident Severity: ${incident.severity}

Transcript:
${transcript}`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  });

  const postmortemText = (response.text ?? '').trim() || 'Failed to generate postmortem.';

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📝 Postmortem: ${incident.title}`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: postmortemText },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Generated at ${new Date().toISOString()} · Incident ID: \`${incident.incident_id}\``,
        },
      ],
    }
  ];
}
