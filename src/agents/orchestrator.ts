import { getContext } from './context';
import { routeTasks } from './router';
import { saveIncident } from '../db';

/**
 * Orchestrator Agent
 *
 * Receives the parsed intent from app.ts and orchestrates the incident response:
 *   1. Call Context Agent → retrieve related Slack history (past outages, etc.)
 *   2. Create a new war room channel for the incident
 *   3. Create a new incident record in the DB
 *   4. Call Router Agent → LLM task breakdown + MCP create_task calls
 *   5. Post Block Kit confirmation to the new channel
 */
export async function handleDeclareIncident(
  client: any,
  event: { ts: string; channel: string; user: string },
  say: any,
  severity: string,
  description: string
): Promise<void> {
  const incidentId = `inc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const title = `SEV-${severity}: ${description.slice(0, 30)}${description.length > 30 ? '...' : ''}`;

  console.log(`[Orchestrator] Declaring incident "${title}" (${incidentId})`);

  // Immediate acknowledgment in the original channel
  await say({
    text: `🚨 Got it! Declaring **SEV-${severity}**. Gathering context, setting up a war room, and generating response tasks…`,
  });

  // ── STEP 1: Context Agent ─────────────────────────────────────────────────
  let contextSummaries: any[] = [];
  try {
    contextSummaries = await getContext(client, description, event.channel);
  } catch (e) {
    console.error('[Orchestrator] Step 1 failed:', e);
    await say({ text: `❌ *Step 1 failed* (context retrieval): ${(e as any).message}` });
    return;
  }

  // ── STEP 2: Create War Room Channel ───────────────────────────────────────
  let incidentChannelId = event.channel;
  try {
    const channelName = `incident-${Date.now().toString().slice(-6)}`;
    const createRes = await client.conversations.create({
      name: channelName,
      is_private: false
    });
    incidentChannelId = createRes.channel.id;
    
    // Invite the declaring user
    await client.conversations.invite({
      channel: incidentChannelId,
      users: event.user
    });

    await say({ text: `✅ War room created: <#${incidentChannelId}>` });
  } catch (e) {
    console.error('[Orchestrator] Step 2 failed (falling back to current channel):', e);
    // Continue in the same channel if channel creation fails (e.g., missing scopes)
  }

  // ── STEP 3: Create Incident Record ────────────────────────────────────────
  const incident: any = {
    incident_id: incidentId,
    title,
    severity,
    incident_channel_id: incidentChannelId,
    description,
    context: contextSummaries,
    tasks: [],
    last_digest_ts: null,
  };

  try {
    await saveIncident(incident);
  } catch (e) {
    console.error('[Orchestrator] Step 3 failed:', e);
    await say({ text: `❌ *Step 3 failed* (incident record creation): ${(e as any).message}` });
    return;
  }

  // ── STEP 4: Router Agent (LLM decomp + MCP task creation) ─────────────────
  let tasks: any[] = [];
  try {
    tasks = await routeTasks(incidentId, description, contextSummaries);
    incident.tasks = tasks;
    await saveIncident(incident);
  } catch (e) {
    console.error('[Orchestrator] Step 4 failed:', e);
    await say({ text: `❌ *Step 4 failed* (task routing via MCP): ${(e as any).message}` });
    return;
  }

  // ── STEP 5: Post Block Kit confirmation to the incident channel ────────────
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🚨 SEV-${severity} Declared`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Description:* ${description}` },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*📎 Related Context Found:*\n${contextSummaries.length} past discussions`,
        },
        {
          type: 'mrkdwn',
          text: `*📋 Action Items Tracked:*\n${tasks.length} tasks created`,
        },
      ],
    },
  ];

  if (contextSummaries.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*🔍 Relevant Past Context:*\n${contextSummaries.map((c) => `• _${c.summary}_`).join('\n')}`,
      },
    });
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*📌 Initial Response Tasks:*' },
  });

  for (const t of tasks) {
    let taskLine = `⚪️ *[#${t.task_id}]* ${t.title}`;
    if (t.assignee_slack_id) taskLine += `  —  <@${t.assignee_slack_id}>`;
    if (t.due_date) taskLine += `  ·  _Due: ${t.due_date}_`;

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: taskLine },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: [
          `Incident ID: \`${incidentId}\``,
          `Get a status update anytime: \`@Relay digest\``,
          `Update a task: \`@Relay status <task_id> <todo|in_progress|done>\``,
          `Generate final report: \`@Relay postmortem\``
        ].join('  ·  '),
      },
    ],
  });

  await client.chat.postMessage({
    channel: incidentChannelId,
    blocks,
    text: `SEV-${severity} declared. War room ready.`
  });
  console.log(`[Orchestrator] Incident "${title}" (${incidentId}) fully initialized in channel ${incidentChannelId}.`);
}
