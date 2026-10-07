#!/usr/bin/env node
// Local MCP server over stdio (Claude Desktop / Claude Code), no token or time limit needed.
// Claude Code: claude mcp add seo-audit -- node "<path>/seo-audit/mcp-stdio.mjs"
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './lib/mcp.mjs';

console.log = (...a) => console.error(...a);   // stdout is reserved for the MCP protocol

await createServer({ remote: false }).connect(new StdioServerTransport());
