/**
 * ai-gen.ts
 * Uses OpenAI to generate a Zod schema from a natural language description.
 * Falls back gracefully if the API is unavailable.
 */

import * as https from 'https';

export interface AiGenOptions {
  model?: string;
  exportName?: string;
  apiKey?: string;   // falls back to OPENAI_API_KEY env var
}

const SYSTEM_PROMPT = `You are an expert TypeScript developer specialising in Zod schema generation.
When given a description of a data structure, respond ONLY with valid TypeScript code that defines a Zod schema.

Rules:
- Start with: import { z } from 'zod';
- Define the schema as: export const <name> = z.object({ ... });
- Export the inferred type as: export type <Name> = z.infer<typeof <name>>;
- Use appropriate Zod validators: z.string(), z.number(), z.boolean(), z.array(), z.object(), z.union(), z.enum(), z.optional(), z.nullable()
- Add .email(), .url(), .min(), .max(), .regex() refinements when semantically obvious (e.g. "email field" → z.string().email())
- Do NOT include any explanation, markdown fences, or comments — only raw TypeScript code.`;

function postJson(url: string, body: object, apiKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const urlObj = new URL(url);

    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`OpenAI API error ${res.statusCode}: ${raw}`));
          } else {
            resolve(raw);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Generate a Zod schema from a natural language description using GPT.
 *
 * @param description  e.g. "A user with an id (number), email, optional bio, and a list of role strings"
 * @param options      Model, export name, API key
 * @returns            TypeScript source string
 */
export async function generateFromDescription(
  description: string,
  options: AiGenOptions = {},
): Promise<string> {
  const apiKey = options.apiKey ?? process.env['OPENAI_API_KEY'];
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');

  const exportName = options.exportName ?? 'schema';
  const model = options.model ?? 'gpt-4o-mini';

  const userPrompt = `Generate a Zod schema named "${exportName}" for the following data structure:\n\n${description}`;

  const rawResponse = await postJson(
    'https://api.openai.com/v1/chat/completions',
    {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 800,
    },
    apiKey,
  );

  const parsed = JSON.parse(rawResponse) as {
    choices: Array<{ message: { content: string } }>;
  };

  let code = parsed.choices[0]?.message?.content?.trim() ?? '';

  // Strip accidental markdown fences if the model adds them
  code = code.replace(/^```(?:typescript|ts)?\n?/i, '').replace(/\n?```$/, '');

  return code;
}
