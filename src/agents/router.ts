import { GoogleGenAI, Type } from '@google/genai';
import { getMcpClient } from '../mcp-client';
import type { ThreadSummary } from './context';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface IncidentTask {
  task_id: string;
  title: string;
  assignee_slack_id: string | null;
  external_ref_id: string;
  status: 'todo' | 'in_progress' | 'done';
  due_date: string | null;
}

/**
 * Router Agent
 *
 * Takes the incident description + context summaries, decomposes
 * it into 3–8 concrete, actionable response tasks using Gemini 2.5 Flash with structured
 * JSON output, then calls the MCP server's `create_task` tool once per task.
 */
export async function routeTasks(
  incident_id: string,
  description: string,
  contextSummaries: ThreadSummary[]
): Promise<IncidentTask[]> {
  console.log(`[Router Agent] Decomposing tasks for incident: ${incident_id}`);

  const contextText =
    contextSummaries.length > 0
      ? contextSummaries.map((c) => `  - ${c.summary}`).join('\n')
      : '  (none — no related discussions found)';

  const prompt = `You are the Router Agent. Given an incident description and context summaries from past Slack discussions, decompose it into an actionable incident response task list.

Rules:
- 3–8 tasks. Do not over-fragment.
- Titles must be concrete and actionable (e.g. "Investigate Payment API logs", "Draft customer communication", "Rollback deploy").
- suggested_assignee should be null unless explicitly mentioned in the description.
- due_date should be a realistic ISO 8601 date relative to today if a timeline is implied, otherwise null.

Incident Description:
${description}

Context Summaries from Past Discussions:
${contextText}`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: 'Concrete, actionable task title',
            },
            suggested_assignee: {
              type: Type.STRING,
              description: 'Slack user ID of suggested assignee, or null',
              nullable: true,
            },
            due_date: {
              type: Type.STRING,
              description: 'ISO 8601 due date, or null',
              nullable: true,
            },
          },
          required: ['title'],
        },
      },
    },
  });

  let generatedTasks: Array<{
    title: string;
    suggested_assignee?: string | null;
    due_date?: string | null;
  }> = [];

  try {
    generatedTasks = JSON.parse(response.text ?? '[]');
  } catch (e) {
    throw new Error(`[Router Agent] Failed to parse Gemini JSON output: ${(e as any).message}`);
  }

  if (generatedTasks.length === 0) {
    throw new Error('[Router Agent] Gemini returned an empty task list.');
  }

  const mcpClient = await getMcpClient();
  const createdTasks: IncidentTask[] = [];

  for (const t of generatedTasks) {
    console.log(`[Router Agent] → MCP create_task: "${t.title}"`);

    const result = await mcpClient.callTool({
      name: 'create_task',
      arguments: {
        title: t.title,
        incident_id: incident_id,
        assignee_slack_id: t.suggested_assignee ?? null,
        due_date: t.due_date ?? null,
      },
    });

    const dbTask = JSON.parse((result.content as any)[0].text);
    if (!dbTask?.id) {
      throw new Error(`[Router Agent] MCP create_task did not return a valid ID for "${t.title}"`);
    }

    createdTasks.push({
      task_id: String(dbTask.id),
      title: dbTask.title,
      assignee_slack_id: dbTask.assignee_slack_id ?? null,
      external_ref_id: String(dbTask.id),
      status: dbTask.status as IncidentTask['status'],
      due_date: dbTask.due_date ?? null,
    });
  }

  console.log(`[Router Agent] Created ${createdTasks.length} tasks in MCP server.`);
  return createdTasks;
}
