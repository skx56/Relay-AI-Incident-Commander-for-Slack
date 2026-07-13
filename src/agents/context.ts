import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface ThreadSummary {
  channel: string;
  ts: string;
  summary: string;
}

/**
 * Context Agent
 *
 * Given an incident description and channel_id, searches recent Slack history across
 * the channel (simulating an RTS call) and uses Gemini to summarize the top 5
 * most relevant messages as 1–2 sentence summaries.
 */
export async function getContext(
  client: any,
  description: string,
  channel_id: string
): Promise<ThreadSummary[]> {
  console.log('[Context Agent] Searching history for incident:', description.slice(0, 80));

  // Extract keywords (>4 chars) from the description for relevance filtering
  const keywords = description
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 4);
    
  // Add common incident keywords to boost past outage matches
  keywords.push('outage', 'incident', 'error', 'failed', 'down', 'sev', 'issue');

  let messages: any[] = [];

  try {
    const history = await client.conversations.history({
      channel: channel_id,
      limit: 100,
    });
    messages = (history.messages ?? []).filter(
      (m: any) => m.text && m.subtype !== 'bot_message'
    );
  } catch (err) {
    console.warn('[Context Agent] conversations.history failed:', (err as any).message);
    return [];
  }

  // Score each message by keyword overlap
  const scored = messages
    .map((m: any) => {
      const lower = m.text.toLowerCase();
      const hits = keywords.filter((k) => lower.includes(k)).length;
      return { msg: m, hits };
    })
    .filter(({ hits }) => hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 5);

  if (scored.length === 0) {
    console.log('[Context Agent] No relevant messages found.');
    return [];
  }

  // Summarise each message with Gemini 2.5 Flash
  const summaries: ThreadSummary[] = [];
  for (const { msg } of scored) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `You are the Context Agent. Summarise the following Slack message in 1-2 sentences, focusing on technical details, previous outages, or system context. Ground your summary only in the text below.\n\nMessage:\n"${msg.text}"`,
      });
      summaries.push({
        channel: channel_id,
        ts: msg.ts,
        summary: (response.text ?? '').trim(),
      });
    } catch (err) {
      console.error('[Context Agent] Gemini summarisation error:', (err as any).message);
    }
  }

  console.log(`[Context Agent] Returning ${summaries.length} context summaries.`);
  return summaries;
}
