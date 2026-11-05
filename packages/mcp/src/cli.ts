#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { accountsFromEnv, demoAccounts, envHelp } from './accounts';
import { createCalendarServer } from './server';

const accounts = process.argv.includes('--demo') ? demoAccounts() : accountsFromEnv(process.env);

if (Object.keys(accounts).length === 0) {
  // stdout carries the protocol, so messages go to stderr.
  console.error(`calsdk MCP server: no calendar connected.\n\n${envHelp}`);
  process.exit(1);
}

await createCalendarServer(accounts).connect(new StdioServerTransport());
