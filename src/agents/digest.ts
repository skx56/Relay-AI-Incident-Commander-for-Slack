import { GoogleGenAI } from '@google/genai';
import { getMcpClient } from '../mcp-client';
import { saveIncident } from '../db';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const STATUS_EMOJI: Record<string, string> = {
  todo: '⚪️',
  in_progress: '🔵',
  done: '✅',
};

/**
 * Digest Agent
 *
 * On trigger (manual @Relay digest or scheduled), polls the MCP `list_tasks`
 * tool for live task statuses, uses Gemini 2.5 Flash to produce a skimmable
 * summary paragraph, then renders a Block Kit digest for the incident.
 */
export async function createDigest(incident: any): Promise<any[]> {
  console.log(`[Digest Agent] Building digest for incident: ${incident.title}`);

  const mcpClient = await getMcpClient();

  // --- Step 1: Poll MCP for live task statuses ---
  let currentTasks: any[];
  try {
    const result = await mcpClient.callTool({
      name: 'list_tasks',
      arguments: { incident_id: incident.incident_id },
    });
    currentTasks = JSON.parse((result.content as any)[0].text);
  } catch (e) {
    console.error('[Digest Agent] MCP list_tasks failed:', (e as any).message);
    currentTasks = incident.tasks ?? [];
  }

  if (currentTasks.length === 0) {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📭 No tasks found for incident *${incident.title}*.`,
        },
      },
    ];
  }

  // --- Step 2: Gemini summarises the task statuses ---
  const tasksText = currentTasks
    .map((t: any) => `- [${t.status}] ${t.title}`)
    .join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `You are the Digest Agent. Given the task list below, write a short (1–2 sentence) skimmable executive status update for the incident "${incident.title}". Do not editorialize beyond the retrieved status values.\n\nTasks:\n${tasksText}`,
  });

  const summary = (response.text ?? '').trim() || 'Status summary unavailable.';

  // Update DB with digest timestamp
  await saveIncident({ ...incident, tasks: currentTasks, last_digest_ts: new Date().toISOString() });

  // --- Step 3: Build Block Kit ---
  const todo = currentTasks.filter((t: any) => t.status === 'todo').length;
  const inProgress = currentTasks.filter((t: any) => t.status === 'in_progress').length;
  const done = currentTasks.filter((t: any) => t.status === 'done').length;

  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📊 Executive Digest: ${incident.title}`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: summary },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*⚪️ Todo:*\n${todo}` },
        { type: 'mrkdwn', text: `*🔵 In Progress:*\n${inProgress}` },
        { type: 'mrkdwn', text: `*✅ Done:*\n${done}` },
        { type: 'mrkdwn', text: `*📋 Total:*\n${currentTasks.length}` },
      ],
    },
    { type: 'divider' },
  ];

  // One section per task
  for (const t of currentTasks) {
    const emoji = STATUS_EMOJI[t.status] ?? '⚪️';
    let taskText = `${emoji} *[#${t.id}]* ${t.title}`;
    if (t.assignee_slack_id) taskText += `  —  <@${t.assignee_slack_id}>`;
    if (t.due_date) taskText += `\n_Due: ${t.due_date}_`;

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: taskText },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Digest generated at ${new Date().toISOString()} · Incident ID: \`${incident.incident_id}\``,
      },
    ],
  });

  return blocks;
}
