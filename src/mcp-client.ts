import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';

let _client: Client | null = null;

export async function initMcpClient(): Promise<Client> {
  if (_client) return _client;

  // Resolve paths relative to this file's location at src/mcp-client.ts
  // __dirname = /Users/saksham56/Desktop/Slack AI/src
  // mcp server index is at ../mcp-server/src/index.ts
  const mcpServerScript = path.resolve(__dirname, '..', 'mcp-server', 'src', 'index.ts');
  const mcpTsconfig = path.resolve(__dirname, '..', 'mcp-server', 'tsconfig.json');

  const transport = new StdioClientTransport({
    command: 'npx',
    args: [
      'ts-node',
      '--project', mcpTsconfig,
      mcpServerScript,
    ],
    env: {
      ...process.env,
      PATH: process.env.PATH ?? '',
      TS_NODE_TRANSPILE_ONLY: 'true',
    },
  });

  const client = new Client(
    { name: 'relay-slack-app', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  _client = client;
  console.log('✅ Connected to Relay MCP Task Tracker Server');
  return client;
}

export async function getMcpClient(): Promise<Client> {
  return _client ?? initMcpClient();
}
