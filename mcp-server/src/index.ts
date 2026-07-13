import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { dbRun, dbGet, dbAll, initDb } from './db';

const server = new Server(
  { name: 'relay-task-tracker', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// ─── List available tools ─────────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'create_task',
      description: 'Create a new task for an incident in the Relay task tracker.',
      inputSchema: {
        type: 'object',
        properties: {
          title:             { type: 'string',  description: 'Task title (concrete, actionable)' },
          incident_id:       { type: 'string',  description: 'Incident this task belongs to' },
          assignee_slack_id: { type: 'string',  description: 'Slack user ID of assignee (optional)' },
          due_date:          { type: 'string',  description: 'ISO 8601 due date (optional)' },
        },
        required: ['title', 'incident_id'],
      },
    },
    {
      name: 'list_tasks',
      description: 'Return all tasks for a given incident_id.',
      inputSchema: {
        type: 'object',
        properties: {
          incident_id: { type: 'string', description: 'Incident ID to list tasks for' },
        },
        required: ['incident_id'],
      },
    },
    {
      name: 'update_task',
      description: 'Update the status of a task by its numeric ID.',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'number', description: 'Numeric task ID returned by create_task' },
          status: {
            type: 'string',
            enum: ['todo', 'in_progress', 'done'],
            description: 'New status',
          },
        },
        required: ['task_id', 'status'],
      },
    },
  ],
}));

// ─── Tool handlers ────────────────────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // --- create_task ---
  if (name === 'create_task') {
    const { title, incident_id, assignee_slack_id, due_date } = args as any;

    const result = await dbRun(
      'INSERT INTO tasks (title, incident_id, assignee_slack_id, due_date) VALUES (?, ?, ?, ?)',
      [title, incident_id, assignee_slack_id ?? null, due_date ?? null]
    );

    // sqlite3 RunResult has lastID
    const task = await dbGet<any>('SELECT * FROM tasks WHERE id = ?', [(result as any).lastID]);
    if (!task) throw new McpError(ErrorCode.InternalError, 'Task created but could not be retrieved');

    return { content: [{ type: 'text', text: JSON.stringify(task) }] };
  }

  // --- list_tasks ---
  if (name === 'list_tasks') {
    const { incident_id } = args as any;
    const tasks = await dbAll<any>('SELECT * FROM tasks WHERE incident_id = ? ORDER BY id ASC', [incident_id]);
    return { content: [{ type: 'text', text: JSON.stringify(tasks) }] };
  }

  // --- update_task ---
  if (name === 'update_task') {
    const { task_id, status } = args as any;

    const existing = await dbGet<any>('SELECT * FROM tasks WHERE id = ?', [task_id]);
    if (!existing) throw new McpError(ErrorCode.InvalidParams, `Task #${task_id} not found`);

    await dbRun('UPDATE tasks SET status = ? WHERE id = ?', [status, task_id]);
    const updated = await dbGet<any>('SELECT * FROM tasks WHERE id = ?', [task_id]);

    return { content: [{ type: 'text', text: JSON.stringify(updated) }] };
  }

  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function main() {
  await initDb();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] Relay Task Tracker server running on stdio');
}

main().catch((err) => {
  console.error('[MCP] Fatal error:', err);
  process.exit(1);
});
