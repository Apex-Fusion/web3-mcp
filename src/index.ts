import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';

// Get directory name for ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Check for .env file
const envPath = resolve(__dirname, '../.env');
console.error('Looking for .env file at:', envPath);
console.error('.env file exists:', existsSync(envPath));

// Load environment variables (non-fatal if missing — env vars can be passed directly)
if (existsSync(envPath)) {
  const result = config({ path: envPath });
  if (result.error) {
    console.error('Warning: Error loading .env file:', result.error);
  }
} else {
  console.error('No .env file found — using environment variables directly');
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerVectorTools } from "./vector/index.js";

// Create server instance
const server = new McpServer({
  name: "vector-mcp-server",
  version: "1.0.0",
});

// Register Vector tools
console.error('Registering Vector tools...');
registerVectorTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  const error = err as Error;
  console.error("Fatal error in main():", error.message);
  process.exit(1);
});
