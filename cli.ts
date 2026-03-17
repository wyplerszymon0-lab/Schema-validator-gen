#!/usr/bin/env ts-node
/**
 * cli.ts — schema-validator-gen CLI
 *
 * Commands:
 *   infer     Infer schema from example JSON file(s) or stdin
 *   describe  Generate schema from natural language (uses OpenAI)
 *
 * Examples:
 *   ts-node src/cli.ts infer examples/user.json
 *   ts-node src/cli.ts infer examples/user.json examples/user2.json --name userSchema
 *   echo '{"id":1,"name":"Alice"}' | ts-node src/cli.ts infer --stdin
 *   ts-node src/cli.ts describe "A product with id, name, price, optional discount, and tags array"
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { inferSchema, inferSchemaFromString } from './infer';
import { generateFromDescription } from './ai-gen';

// ── Helpers ──────────────────────────────────────────────────────────────────

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    const lines: string[] = [];
    rl.on('line', (l) => lines.push(l));
    rl.on('close', () => resolve(lines.join('\n')));
  });
}

function parseArgs(argv: string[]): { command: string; flags: Record<string, string | boolean>; positional: string[] } {
  const args = argv.slice(2);
  const command = args[0] ?? '';
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, flags, positional };
}

function printHelp(): void {
  console.log(`
schema-validator-gen — Generate Zod schemas from JSON examples or natural language.

USAGE
  ts-node src/cli.ts <command> [options]

COMMANDS
  infer <file.json> [file2.json ...]   Infer schema from example JSON file(s)
  describe "<text>"                    Generate schema from natural language (requires OPENAI_API_KEY)

OPTIONS
  --name <identifier>   Export name for the schema (default: schema)
  --no-import           Omit the import { z } from 'zod' line
  --stdin               Read JSON from stdin instead of a file
  --out <file.ts>       Write output to file instead of stdout
  --model <model>       OpenAI model for 'describe' (default: gpt-4o-mini)

EXAMPLES
  ts-node src/cli.ts infer examples/user.json
  ts-node src/cli.ts infer examples/user.json examples/user-admin.json --name userSchema
  echo '{"id":1}' | ts-node src/cli.ts infer --stdin --name idObject
  ts-node src/cli.ts describe "A blog post with title, content, authorId, tags, and optional publishedAt date"
`);
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdInfer(
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<void> {
  const exportName = (flags['name'] as string) ?? 'schema';
  const addImport = flags['no-import'] !== true;
  const outFile = flags['out'] as string | undefined;

  let examples: unknown[] = [];

  if (flags['stdin']) {
    const raw = await readStdin();
    const parsed = JSON.parse(raw);
    examples = Array.isArray(parsed) ? parsed : [parsed];
  } else {
    if (positional.length === 0) {
      console.error('Error: provide at least one JSON file, or use --stdin');
      process.exit(1);
    }
    for (const file of positional) {
      const abs = path.resolve(file);
      if (!fs.existsSync(abs)) {
        console.error(`Error: file not found: ${abs}`);
        process.exit(1);
      }
      const raw = fs.readFileSync(abs, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        examples.push(...parsed);
      } else {
        examples.push(parsed);
      }
    }
  }

  const output = inferSchema(examples, { exportName, addImport });

  if (outFile) {
    fs.writeFileSync(path.resolve(outFile), output, 'utf-8');
    console.log(`✓ Schema written to ${outFile}`);
  } else {
    console.log(output);
  }
}

async function cmdDescribe(
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<void> {
  const description = positional.join(' ');
  if (!description.trim()) {
    console.error('Error: provide a description after the command.');
    process.exit(1);
  }

  const exportName = (flags['name'] as string) ?? 'schema';
  const model = (flags['model'] as string) ?? 'gpt-4o-mini';
  const outFile = flags['out'] as string | undefined;

  console.error('[*] Generating schema with OpenAI...');
  const output = await generateFromDescription(description, { exportName, model });

  if (outFile) {
    fs.writeFileSync(path.resolve(outFile), output, 'utf-8');
    console.log(`✓ Schema written to ${outFile}`);
  } else {
    console.log(output);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { command, flags, positional } = parseArgs(process.argv);

  if (!command || flags['help'] || flags['h']) {
    printHelp();
    return;
  }

  switch (command) {
    case 'infer':
      await cmdInfer(positional, flags);
      break;
    case 'describe':
      await cmdDescribe(positional, flags);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
