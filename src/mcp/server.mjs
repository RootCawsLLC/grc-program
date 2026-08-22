#!/usr/bin/env node
/**
 * MCP server exposing this repo read-only.
 *
 * WHY IT EXISTS. It lets an auditor's or a customer's question be answered from a Claude
 * conversation without opening the repo, while every answer still comes from the system of record
 * rather than from somebody's memory. That is the difference between "I think we're covered there"
 * and "412 of 412, measured Tuesday, and here is the file."
 *
 * READ-ONLY, ENFORCED RATHER THAN PROMISED. Writes go through pull requests — guardrail 2, and the
 * merge IS the control. Three things hold that line here:
 *   1. every tool declares `effect: 'read'`;
 *   2. this server REFUSES TO START if any registered tool declares anything else;
 *   3. tests/mcp.test.mjs exercises every tool and then asserts the working tree is unchanged.
 * The third is the one that would actually catch a regression, because it tests behaviour rather
 * than a label.
 *
 * Run it:      npm run mcp
 * Wire it in:  claude mcp add reco-grc -- node C:/absolute/path/to/reco-grc/src/mcp/server.mjs
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { TOOLS, findTool, loadContext } from './tools.mjs';

const NAME = 'reco-grc';
const VERSION = '0.1.0';

/**
 * stdout is the JSON-RPC channel. Anything written there that is not protocol corrupts the stream
 * and the failure looks like the server being broken rather than like a stray console.log.
 */
const log = (message) => process.stderr.write(`${message}\n`);

export function assertReadOnly(tools = TOOLS) {
  const writers = tools.filter((t) => t.effect !== 'read');
  if (writers.length) {
    throw new Error(
      `refusing to start: ${writers.map((t) => t.name).join(', ')} declare a non-read effect.\n` +
      '  This server is read-only. Writes go through pull requests — a human merge is the control.',
    );
  }
  return tools;
}

export function buildServer(context) {
  assertReadOnly();

  const server = new Server({ name: NAME, version: VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      // The effect tag is in the description on purpose: a model choosing a tool should be able to
      // see that nothing here can change anything, without having to infer it from the names.
      description: `[${t.effect}] ${t.description}`,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = findTool(request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `no such tool: ${request.params.name}. Available: ${TOOLS.map((t) => t.name).join(', ')}` }],
      };
    }
    try {
      const result = await tool.handler(request.params.arguments ?? {}, context);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      // Surfaced, not swallowed. A tool that fails quietly and returns nothing is indistinguishable
      // from a control with nothing to report, which is the confusion this whole repo exists to end.
      const message = error instanceof Error ? error.message : String(error);
      return { isError: true, content: [{ type: 'text', text: `${request.params.name} failed: ${message}` }] };
    }
  });

  return server;
}

async function main() {
  const root = process.env.RECO_GRC_ROOT ?? process.cwd();
  const context = await loadContext(root);
  const server = buildServer(context);

  await server.connect(new StdioServerTransport());

  log(
    `${NAME} ${VERSION} on stdio — ${TOOLS.length} tools, all read-only\n` +
    `  root:      ${context.root}\n` +
    `  inventory: ${context.controls.length} controls, ${context.scenarios.length} scenarios, ` +
    `${context.assertions.length} assertion record(s), ${context.findings.length} finding(s)`,
  );
}

// Only run when executed directly; importing this module for tests must not open a transport.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((error) => {
    log(`fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
