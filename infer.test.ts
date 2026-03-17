/**
 * tests/infer.test.ts
 * Unit tests for the inference engine — zero external dependencies.
 */

import assert from 'assert';
import { inferSchema, inferSchemaFromString } from '../src/infer';

// ── Primitives ────────────────────────────────────────────────────────────────

function testString() {
  const code = inferSchema(['hello'], { addImport: false, exportName: 's' });
  assert.ok(code.includes('z.string()'), `Expected z.string(), got: ${code}`);
  console.log('✓ string example → z.string()');
}

function testNumber() {
  const code = inferSchema([42], { addImport: false, exportName: 's' });
  assert.ok(code.includes('z.number()'));
  console.log('✓ number example → z.number()');
}

function testBoolean() {
  const code = inferSchema([true], { addImport: false, exportName: 's' });
  assert.ok(code.includes('z.boolean()'));
  console.log('✓ boolean example → z.boolean()');
}

function testNull() {
  const code = inferSchema([null], { addImport: false, exportName: 's' });
  assert.ok(code.includes('z.null()'));
  console.log('✓ null example → z.null()');
}

// ── Objects ───────────────────────────────────────────────────────────────────

function testFlatObject() {
  const code = inferSchema([{ id: 1, name: 'Alice' }], { addImport: false, exportName: 's' });
  assert.ok(code.includes('z.object('));
  assert.ok(code.includes('id: z.number()'));
  assert.ok(code.includes('name: z.string()'));
  console.log('✓ flat object inferred correctly');
}

function testNestedObject() {
  const code = inferSchema(
    [{ user: { id: 1, role: 'admin' } }],
    { addImport: false, exportName: 's' },
  );
  assert.ok(code.includes('user: z.object('));
  assert.ok(code.includes('id: z.number()'));
  assert.ok(code.includes('role: z.string()'));
  console.log('✓ nested object inferred correctly');
}

// ── Arrays ────────────────────────────────────────────────────────────────────

function testArrayOfStrings() {
  const code = inferSchema([['a', 'b', 'c']], { addImport: false, exportName: 's' });
  assert.ok(code.includes('z.array(z.string())'));
  console.log('✓ string array → z.array(z.string())');
}

function testArrayOfObjects() {
  const code = inferSchema(
    [[{ id: 1 }, { id: 2 }]],
    { addImport: false, exportName: 's' },
  );
  assert.ok(code.includes('z.array('));
  assert.ok(code.includes('id: z.number()'));
  console.log('✓ object array inferred correctly');
}

function testEmptyArray() {
  const code = inferSchema([[]], { addImport: false, exportName: 's' });
  assert.ok(code.includes('z.array(z.unknown())'));
  console.log('✓ empty array → z.array(z.unknown())');
}

// ── Nullable / optional ───────────────────────────────────────────────────────

function testNullableField() {
  const code = inferSchema(
    [{ bio: 'hello' }, { bio: null }],
    { addImport: false, exportName: 's' },
  );
  // bio appears as string in one example and null in another → nullable
  assert.ok(code.includes('z.string().nullable()'), `Expected nullable, got: ${code}`);
  console.log('✓ field that is sometimes null → z.string().nullable()');
}

function testOptionalField() {
  // address only present in first example → optional
  const code = inferSchema(
    [{ name: 'Alice', address: { city: 'Warsaw' } }, { name: 'Bob' }],
    { addImport: false, exportName: 's' },
  );
  assert.ok(code.includes('address:'), `Expected address field, got: ${code}`);
  assert.ok(code.includes('.optional()'), `Expected .optional(), got: ${code}`);
  console.log('✓ field missing in some examples → .optional()');
}

// ── Union ─────────────────────────────────────────────────────────────────────

function testUnionStringNumber() {
  const code = inferSchema(['hello', 42], { addImport: false, exportName: 's' });
  assert.ok(code.includes('z.union('), `Expected z.union, got: ${code}`);
  assert.ok(code.includes('z.string()'));
  assert.ok(code.includes('z.number()'));
  console.log('✓ mixed types → z.union([z.string(), z.number()])');
}

// ── Merging examples ──────────────────────────────────────────────────────────

function testMergeTwoObjects() {
  const examples = [
    { id: 1, role: 'admin' },
    { id: 2, role: 'user', score: 99 },
  ];
  const code = inferSchema(examples, { addImport: false, exportName: 's' });
  assert.ok(code.includes('id: z.number()'));
  assert.ok(code.includes('role: z.string()'));
  // score only present in second example → optional
  assert.ok(code.includes('score:'), `Expected score field`);
  assert.ok(code.includes('z.number().optional()'), `Expected score to be optional, got: ${code}`);
  console.log('✓ merging two objects marks partial fields optional');
}

// ── Import + type export ──────────────────────────────────────────────────────

function testImportIncluded() {
  const code = inferSchema([{ x: 1 }], { addImport: true, exportName: 'mySchema' });
  assert.ok(code.includes("import { z } from 'zod'"));
  assert.ok(code.includes('export const mySchema'));
  assert.ok(code.includes('export type MySchema = z.infer<typeof mySchema>'));
  console.log('✓ addImport=true generates import and type export');
}

function testNoImport() {
  const code = inferSchema([{ x: 1 }], { addImport: false, exportName: 's' });
  assert.ok(!code.includes('import'));
  console.log('✓ addImport=false omits import statement');
}

// ── From JSON string ──────────────────────────────────────────────────────────

function testInferFromJsonString() {
  const code = inferSchemaFromString('{"id": 1, "active": true}', { addImport: false, exportName: 's' });
  assert.ok(code.includes('id: z.number()'));
  assert.ok(code.includes('active: z.boolean()'));
  console.log('✓ inferSchemaFromString works');
}

function testInvalidJsonThrows() {
  assert.throws(() => inferSchemaFromString('not json'), /Invalid JSON/);
  console.log('✓ invalid JSON throws descriptive error');
}

// ── Special keys ─────────────────────────────────────────────────────────────

function testSpecialKeyQuoted() {
  const code = inferSchema([{ 'content-type': 'application/json' }], { addImport: false, exportName: 's' });
  assert.ok(code.includes('"content-type"'), `Expected quoted key, got: ${code}`);
  console.log('✓ keys with hyphens are quoted in output');
}

// ── Runner ────────────────────────────────────────────────────────────────────

const tests = [
  testString,
  testNumber,
  testBoolean,
  testNull,
  testFlatObject,
  testNestedObject,
  testArrayOfStrings,
  testArrayOfObjects,
  testEmptyArray,
  testNullableField,
  testOptionalField,
  testUnionStringNumber,
  testMergeTwoObjects,
  testImportIncluded,
  testNoImport,
  testInferFromJsonString,
  testInvalidJsonThrows,
  testSpecialKeyQuoted,
];

let failed = 0;
for (const test of tests) {
  try {
    test();
  } catch (err: any) {
    console.error(`\n❌ ${test.name}: ${err.message}`);
    failed++;
  }
}

if (failed === 0) {
  console.log(`\n✅ All ${tests.length} tests passed`);
} else {
  console.error(`\n❌ ${failed} test(s) failed`);
  process.exit(1);
}
