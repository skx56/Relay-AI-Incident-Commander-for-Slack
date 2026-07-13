import { App } from '@slack/bolt';
import { initDb, getIncidentsByChannel, getIncident } from './db';
import { initMcpClient, getMcpClient } from './mcp-client';
import { handleDeclareIncident } from './agents/orchestrator';
import { createDigest } from './agents/digest';
import { generatePostmortem } from './agents/postmortem';
import * as dotenv from 'dotenv';

dotenv.config();

if (!process.env.SLACK_BOT_TOKEN) throw new Error('SLACK_BOT_TOKEN is required');
if (!process.env.SLACK_APP_TOKEN) throw new Error('SLACK_APP_TOKEN is required');
if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// ─── Listener: @Relay SEV-<level>: <description> ──────────────────────────────
app.event('app_mention', async ({ event, client, say }) => {
  try {
    const text = (event as any).text.replace(/<@[A-Z0-9]+>/g, '').trim();

    // 1. Declare an incident
    const initiateMatch = text.match(/SEV-(\d+):\s+([\s\S]+)/i);
    if (initiateMatch) {
      const severity = initiateMatch[1].trim();
      const description = initiateMatch[2].trim();
      await handleDeclareIncident(client, event as any, say, severity, description);
      return;
    }

    // 2. Request a digest: "@Relay digest [incident_id]"
    const digestMatch = text.match(/^digest(?:\s+(inc_[a-zA-Z0-9_]+))?$/i);
    if (digestMatch) {
      const specificIncidentId = digestMatch[1];

      let incidents: any[] = [];
      if (specificIncidentId) {
        const p = await getIncident(specificIncidentId);
        if (p) incidents.push(p);
      } else {
        const all = await getIncidentsByChannel((event as any).channel);
        if (all.length > 0) incidents = [all[0]]; // most recent
      }

      if (incidents.length === 0) {
        await say({ text: '⚠️ No active incidents found in this channel. Declare one with `@Relay SEV-1: <description>`' });
        return;
      }

      for (const incident of incidents) {
        const blocks = await createDigest(incident);
        await say({ blocks, text: `Status digest for ${incident.title}` });
      }
      return;
    }

    // 3. Request a postmortem: "@Relay postmortem [incident_id]"
    const postmortemMatch = text.match(/^postmortem(?:\s+(inc_[a-zA-Z0-9_]+))?$/i);
    if (postmortemMatch) {
      const specificIncidentId = postmortemMatch[1];

      let incidents: any[] = [];
      if (specificIncidentId) {
        const p = await getIncident(specificIncidentId);
        if (p) incidents.push(p);
      } else {
        const all = await getIncidentsByChannel((event as any).channel);
        if (all.length > 0) incidents = [all[0]]; // most recent
      }

      if (incidents.length === 0) {
        await say({ text: '⚠️ No active incidents found in this channel.' });
        return;
      }

      for (const incident of incidents) {
        await say({ text: `📝 Generating postmortem for ${incident.title}...` });
        const blocks = await generatePostmortem(client, incident, (event as any).channel);
        await say({ blocks, text: `Postmortem for ${incident.title}` });
      }
      return;
    }

    // 4. Update a task: "@Relay status <task_id> <todo|in_progress|done>"
    const statusMatch = text.match(/^status\s+(\d+)\s+(todo|in_progress|done)$/i);
    if (statusMatch) {
      const taskId = parseInt(statusMatch[1], 10);
      const newStatus = statusMatch[2].toLowerCase();

      try {
        const mcpClient = await getMcpClient();
        const result = await mcpClient.callTool({
          name: 'update_task',
          arguments: { task_id: taskId, status: newStatus },
        });
        const updatedTask = JSON.parse((result.content as any)[0].text);
        await say({
          text: `✅ Task #${taskId} updated.`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `✅ *Task #${taskId}* updated to *${newStatus}*\n_"${updatedTask.title}"_`,
              },
            },
          ],
        });
      } catch (e) {
        console.error('Status update failed:', e);
        await say({ text: `❌ Failed to update task #${taskId}: ${(e as any).message}` });
      }
      return;
    }

    // 5. Help fallback
    await say({
      text: 'Need help?',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: [
              '*Hi, I\'m Relay, your AI Incident Commander!* Here\'s what I can do:',
              '',
              '• `@Relay SEV-1: <description>` — Declare a new incident',
              '• `@Relay digest` — Get the latest status digest',
              '• `@Relay status <task_id> <todo|in_progress|done>` — Update a task\'s status',
              '• `@Relay postmortem` — Generate a postmortem from the channel history',
            ].join('\n'),
          },
        },
      ],
    });
  } catch (error) {
    console.error('Error in app_mention handler:', error);
    await say({ text: `❌ An unexpected error occurred: ${(error as any).message}` });
  }
});

(async () => {
  try {
    await initDb();
    console.log('✅ SQLite DB initialized.');

    await initMcpClient();
    console.log('✅ MCP Task Tracker connected.');

    await app.start();
    console.log('⚡️ Relay Incident Commander is running in Socket Mode!');
  } catch (error) {
    console.error('Unable to start Relay:', error);
    process.exit(1);
  }
})();
