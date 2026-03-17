# schema-validator-gen 

Generate Zod validation schemas automatically — either by inferring them from example JSON objects, or by describing the shape in plain English (via OpenAI).

## Why it exists

Writing Zod schemas by hand is tedious for large or evolving data structures. This tool does the mechanical work: paste in an example API response or describe what you want, and get production-ready TypeScript validation code instantly.

## Two modes

### 1. Infer from JSON (no API key)
Feed it real data — it figures out types, nullable fields, optional keys, unions, nested objects, and arrays automatically.

### 2. Describe in natural language (uses OpenAI)
Describe the shape in English and GPT writes the schema for you, including semantic refinements like `.email()`, `.url()`, `.min()`.

---

## Install

```bash
npm install schema-validator-gen
npm install zod          # peer dependency
```

## CLI

```bash
# Infer from a single JSON file
npx schema-gen infer examples/user.json

# Merge two examples (marks fields missing in either as .optional())
npx schema-gen infer examples/user.json examples/user2.json --name userSchema

# From stdin
curl https://api.example.com/users/1 | npx schema-gen infer --stdin --name User

# Write to file
npx schema-gen infer examples/user.json --out src/schemas/user.schema.ts

# Describe in natural language (requires OPENAI_API_KEY)
export OPENAI_API_KEY=sk-...
npx schema-gen describe "A product with an id, name, price in USD, optional discount percent, and a string array of tags"
```

## Example output

Input:
```json
{
  "id": 1,
  "email": "alice@example.com",
  "active": true,
  "bio": null,
  "tags": ["admin"]
}
```

Output:
```ts
import { z } from 'zod';

export const schema = z.object({
  id: z.number(),
  email: z.string(),
  active: z.boolean(),
  bio: z.string().nullable(),
  tags: z.array(z.string()),
});

export type Schema = z.infer<typeof schema>;
```

## Merging multiple examples

When you pass two examples, fields present in only one are automatically marked `.optional()`:

```bash
npx schema-gen infer user1.json user2.json
```
```ts
// user1 has `address`, user2 doesn't → .optional()
address: z.object({
  street: z.string(),
  city: z.string(),
}).optional(),
```

## Library API

```ts
import { inferSchema, inferSchemaFromString, generateFromDescription } from 'schema-validator-gen';

// From JS object
const code = inferSchema([{ id: 1, name: 'Alice' }], { exportName: 'userSchema' });

// From raw JSON string
const code = inferSchemaFromString('{"id":1,"role":"admin"}');

// From natural language (async, requires OPENAI_API_KEY)
const code = await generateFromDescription(
  'A blog post with title, body, authorId, optional publishedAt, and a tags array',
  { exportName: 'postSchema' }
);

console.log(code); // → full TypeScript Zod schema
```

## Type inference rules

| JSON value | Zod output |
|---|---|
| `"hello"` | `z.string()` |
| `42` | `z.number()` |
| `true` | `z.boolean()` |
| `null` | `z.null()` |
| `[]` | `z.array(z.unknown())` |
| `["a","b"]` | `z.array(z.string())` |
| `{…}` | `z.object({…})` |
| sometimes `null` | `.nullable()` |
| missing in some examples | `.optional()` |
| mixed types | `z.union([…])` |

## Running tests

```bash
npx ts-node tests/infer.test.ts
```

## Architecture

```
src/
  infer.ts      ← JSON → Zod AST → code string (zero deps, ~200 lines)
  ai-gen.ts     ← natural language → Zod via OpenAI (optional)
  cli.ts        ← CLI with infer / describe commands
  index.ts      ← public library API
examples/
  user.json     ← sample JSON for testing
  user2.json    ← second example to demo merging
tests/
  infer.test.ts ← 18 unit tests, no API key needed
```
