/**
 * infer.ts
 * Infers a Zod schema definition (as a TypeScript code string)
 * from one or more example JSON values.
 *
 * Supports: string, number, boolean, null, array, object, union types.
 * No runtime Zod dependency — this is a pure code-generation module.
 */

// ── Internal schema AST ──────────────────────────────────────────────────────

type SchemaNode =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'null' }
  | { kind: 'undefined' }
  | { kind: 'unknown' }
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'array'; items: SchemaNode }
  | { kind: 'object'; fields: Record<string, { node: SchemaNode; optional: boolean }> }
  | { kind: 'union'; members: SchemaNode[] };

// ── Type inference from a single JSON value ──────────────────────────────────

function inferNode(value: unknown): SchemaNode {
  if (value === null)            return { kind: 'null' };
  if (value === undefined)       return { kind: 'undefined' };

  switch (typeof value) {
    case 'string':  return { kind: 'string' };
    case 'number':  return { kind: 'number' };
    case 'boolean': return { kind: 'boolean' };
    case 'object': {
      if (Array.isArray(value)) {
        if (value.length === 0) return { kind: 'array', items: { kind: 'unknown' } };
        const itemNodes = value.map(inferNode);
        return { kind: 'array', items: mergeNodes(itemNodes) };
      }
      // Plain object
      const fields: Record<string, { node: SchemaNode; optional: boolean }> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        fields[key] = { node: inferNode(val), optional: false };
      }
      return { kind: 'object', fields };
    }
    default:
      return { kind: 'unknown' };
  }
}

// ── Merging multiple examples into one schema ─────────────────────────────────

function nodesAreEqual(a: SchemaNode, b: SchemaNode): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function flattenUnion(node: SchemaNode): SchemaNode[] {
  if (node.kind === 'union') return node.members.flatMap(flattenUnion);
  return [node];
}

function deduplicateNodes(nodes: SchemaNode[]): SchemaNode[] {
  const result: SchemaNode[] = [];
  for (const n of nodes) {
    if (!result.some(r => nodesAreEqual(r, n))) result.push(n);
  }
  return result;
}

function mergeNodes(nodes: SchemaNode[]): SchemaNode {
  if (nodes.length === 0) return { kind: 'unknown' };
  if (nodes.length === 1) return nodes[0];

  // All the same → return one
  const deduped = deduplicateNodes(nodes);
  if (deduped.length === 1) return deduped[0];

  // Both objects → merge fields, mark missing keys as optional
  const objects = deduped.filter((n): n is Extract<SchemaNode, { kind: 'object' }> => n.kind === 'object');
  if (objects.length === deduped.length) {
    const allKeys = new Set(objects.flatMap(o => Object.keys(o.fields)));
    const merged: Record<string, { node: SchemaNode; optional: boolean }> = {};
    for (const key of allKeys) {
      const presentIn = objects.filter(o => key in o.fields);
      const optional = presentIn.length < objects.length;
      const fieldNodes = presentIn.map(o => o.fields[key].node);
      merged[key] = { node: mergeNodes(fieldNodes), optional };
    }
    return { kind: 'object', fields: merged };
  }

  // Both arrays → merge item types
  const arrays = deduped.filter((n): n is Extract<SchemaNode, { kind: 'array' }> => n.kind === 'array');
  if (arrays.length === deduped.length) {
    return { kind: 'array', items: mergeNodes(arrays.map(a => a.items)) };
  }

  // Mixed → union, flattened
  const flat = deduped.flatMap(flattenUnion);
  const unique = deduplicateNodes(flat);
  if (unique.length === 1) return unique[0];
  return { kind: 'union', members: unique };
}

// ── Code generation ───────────────────────────────────────────────────────────

function nodeToZod(node: SchemaNode, indent = 0): string {
  const pad = '  '.repeat(indent);

  switch (node.kind) {
    case 'string':    return 'z.string()';
    case 'number':    return 'z.number()';
    case 'boolean':   return 'z.boolean()';
    case 'null':      return 'z.null()';
    case 'undefined': return 'z.undefined()';
    case 'unknown':   return 'z.unknown()';

    case 'literal':
      return typeof node.value === 'string'
        ? `z.literal(${JSON.stringify(node.value)})`
        : `z.literal(${node.value})`;

    case 'array':
      return `z.array(${nodeToZod(node.items, indent)})`;

    case 'object': {
      if (Object.keys(node.fields).length === 0) return 'z.object({})';
      const innerPad = '  '.repeat(indent + 1);
      const fieldLines = Object.entries(node.fields).map(([key, { node: fieldNode, optional }]) => {
        const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
        const zodExpr = nodeToZod(fieldNode, indent + 1);
        const withOptional = optional ? `${zodExpr}.optional()` : zodExpr;
        return `${innerPad}${safeKey}: ${withOptional},`;
      });
      return `z.object({\n${fieldLines.join('\n')}\n${pad}})`;
    }

    case 'union': {
      // Pull out null/undefined for .nullable() / .optional() sugar
      const nullIdx      = node.members.findIndex(m => m.kind === 'null');
      const undefinedIdx = node.members.findIndex(m => m.kind === 'undefined');
      const rest = node.members.filter(m => m.kind !== 'null' && m.kind !== 'undefined');

      let base: string;
      if (rest.length === 0) {
        base = 'z.unknown()';
      } else if (rest.length === 1) {
        base = nodeToZod(rest[0], indent);
      } else {
        const variants = rest.map(m => nodeToZod(m, indent)).join(', ');
        base = `z.union([${variants}])`;
      }

      if (nullIdx !== -1)      base = `${base}.nullable()`;
      if (undefinedIdx !== -1) base = `${base}.optional()`;
      return base;
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface InferOptions {
  exportName?: string;   // variable name for the generated schema (default: 'schema')
  addImport?: boolean;   // prepend `import { z } from 'zod'` (default: true)
  inferLiterals?: boolean; // use z.literal() for specific string values (default: false)
}

/**
 * Infer a Zod schema from one or more example JSON objects.
 *
 * @param examples  One or more representative JSON values
 * @param options   Generation options
 * @returns         TypeScript source string with the Zod schema
 */
export function inferSchema(examples: unknown[], options: InferOptions = {}): string {
  const {
    exportName = 'schema',
    addImport = true,
    inferLiterals = false,
  } = options;

  if (examples.length === 0) throw new Error('At least one example is required');

  const nodes = examples.map(inferNode);
  let root = mergeNodes(nodes);

  // Optionally convert single-occurrence strings to literals
  if (inferLiterals && root.kind === 'string' && examples.length === 1 && typeof examples[0] === 'string') {
    root = { kind: 'literal', value: examples[0] as string };
  }

  const zodCode = nodeToZod(root, 0);
  const lines: string[] = [];

  if (addImport) lines.push("import { z } from 'zod';", '');
  lines.push(`export const ${exportName} = ${zodCode};`, '');
  lines.push(`export type ${capitalize(exportName)} = z.infer<typeof ${exportName}>;`);

  return lines.join('\n');
}

/**
 * Infer a Zod schema from a raw JSON string.
 */
export function inferSchemaFromString(jsonString: string, options?: InferOptions): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`);
  }
  return inferSchema(Array.isArray(parsed) ? parsed : [parsed], options);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
