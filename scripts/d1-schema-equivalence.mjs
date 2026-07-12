import { readFileSync } from 'node:fs';

function normalizeValue(value) {
  if (Array.isArray(value)) return value.map(normalizeValue).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeValue(value[key])]));
  }
  if (typeof value === 'string') return value.replace(/\r\n?/g, '\n').trim().replace(/[ \t]+/g, ' ');
  return value;
}

export function normalizeSchemaSnapshot(snapshot) {
  const sections = ['tables', 'indexes', 'uniqueConstraints', 'foreignKeys', 'triggers'];
  const normalized = {};
  for (const section of sections) {
    normalized[section] = (snapshot[section] || []).map(normalizeValue).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return normalized;
}

export function compareSchemaSnapshots(left, right) {
  const normalizedLeft = normalizeSchemaSnapshot(left);
  const normalizedRight = normalizeSchemaSnapshot(right);
  const differences = Object.keys(normalizedLeft).filter((section) => JSON.stringify(normalizedLeft[section]) !== JSON.stringify(normalizedRight[section]));
  return { equal: differences.length === 0, differences, left: normalizedLeft, right: normalizedRight };
}

if (process.argv[1]?.endsWith('d1-schema-equivalence.mjs')) {
  const [leftPath, rightPath] = process.argv.slice(2);
  if (!leftPath || !rightPath) {
    console.error('Usage: node scripts/d1-schema-equivalence.mjs <canonical.json> <proposed.json>');
    process.exit(2);
  }
  const result = compareSchemaSnapshots(JSON.parse(readFileSync(leftPath, 'utf8')), JSON.parse(readFileSync(rightPath, 'utf8')));
  console.log(JSON.stringify(result, null, 2));
  if (!result.equal) process.exitCode = 1;
}
