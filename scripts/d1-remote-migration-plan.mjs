import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORD = /[A-Za-z0-9_$]/;

function classify(tokens) {
  const first = tokens.slice(0, 3);
  if (first[0] === 'create' && first.includes('trigger')) return 'CREATE TRIGGER';
  if (first[0] === 'create' && first.includes('table')) return 'CREATE TABLE';
  if (first[0] === 'create' && first.includes('index')) return tokens.includes('unique') ? 'CREATE UNIQUE INDEX' : 'CREATE INDEX';
  return (first[0] || 'UNKNOWN').toUpperCase();
}

function triggerName(sql) {
  const match = sql.match(/\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_$]*)/i);
  return match?.[1] || '';
}

export function normalizeSql(sql) {
  return String(sql).replace(/\r\n?/g, '\n').trim();
}

export function checksum(sql) {
  return createHash('sha256').update(normalizeSql(sql), 'utf8').digest('hex');
}

export function parseSqlStatements(source, sourceName = '<inline>') {
  const sql = String(source);
  const statements = [];
  let statementStart = 0;
  let mode = 'normal';
  let token = '';
  let tokens = [];
  let trigger = false;
  let triggerBodyDepth = 0;
  let caseDepth = 0;
  let triggerComplete = false;

  const reset = (index) => {
    statementStart = index;
    tokens = [];
    trigger = false;
    triggerBodyDepth = 0;
    caseDepth = 0;
    triggerComplete = false;
  };
  const pushToken = () => {
    if (!token) return;
    const word = token.toLowerCase();
    tokens.push(word);
    token = '';
    if (!trigger && tokens[0] === 'create' && (tokens[1] === 'trigger' || (tokens[1] === 'temp' && tokens[2] === 'trigger'))) trigger = true;
    if (trigger) {
      if (word === 'begin') triggerBodyDepth += 1;
      else if (word === 'case') caseDepth += 1;
      else if (word === 'end') {
        if (caseDepth > 0) caseDepth -= 1;
        else if (triggerBodyDepth > 0) {
          triggerBodyDepth -= 1;
          if (triggerBodyDepth === 0) triggerComplete = true;
        }
      }
    }
  };
  const finish = (endIndex) => {
    const raw = normalizeSql(sql.slice(statementStart, endIndex + 1));
    if (!raw) {
      reset(endIndex + 1);
      return;
    }
    if (trigger && (!triggerComplete || triggerBodyDepth !== 0 || caseDepth !== 0)) throw new Error(sourceName + ': incomplete CREATE TRIGGER statement');
    statements.push({ source: sourceName, type: classify(tokens), triggerName: trigger ? triggerName(raw) : '', checksum: checksum(raw), sql: raw });
    reset(endIndex + 1);
  };

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1] || '';
    if (mode === 'line-comment') {
      if (ch === '\n') mode = 'normal';
      continue;
    }
    if (mode === 'block-comment') {
      if (ch === '*' && next === '/') { mode = 'normal'; i += 1; }
      continue;
    }
    if (mode === 'single-quote') {
      if (ch === "'" && next === "'") i += 1;
      else if (ch === "'") mode = 'normal';
      continue;
    }
    if (mode === 'double-quote') {
      if (ch === '"' && next === '"') i += 1;
      else if (ch === '"') mode = 'normal';
      continue;
    }
    if (ch === '-' && next === '-') { mode = 'line-comment'; i += 1; continue; }
    if (ch === '/' && next === '*') { mode = 'block-comment'; i += 1; continue; }
    if (ch === "'") { pushToken(); mode = 'single-quote'; continue; }
    if (ch === '"') { pushToken(); mode = 'double-quote'; continue; }
    if (WORD.test(ch)) { token += ch; continue; }
    pushToken();
    if (ch === ';') {
      if (trigger && triggerBodyDepth > 0) continue;
      finish(i);
    }
  }
  pushToken();
  const tail = normalizeSql(sql.slice(statementStart));
  if (tail) {
    if (trigger) throw new Error(sourceName + ': incomplete CREATE TRIGGER statement');
    throw new Error(sourceName + ': incomplete SQL statement');
  }
  return statements;
}

export function migrationPlan(migrationsDir) {
  const files = readdirSync(migrationsDir).filter((file) => /^\d+_.*\.sql$/.test(file)).sort();
  const migrations = [];
  for (const file of files) {
    const source = readFileSync(path.join(migrationsDir, file), 'utf8');
    const statements = parseSqlStatements(source, file);
    migrations.push({
      file,
      checksum: checksum(source),
      statementCount: statements.length,
      statementTypes: statements.map((statement) => statement.type),
      statements: statements.map(({ sql, ...metadata }) => metadata),
    });
  }
  return {
    migrationCount: migrations.length,
    statementCount: migrations.reduce((sum, migration) => sum + migration.statementCount, 0),
    triggerCount: migrations.reduce((sum, migration) => sum + migration.statements.filter((statement) => statement.type === 'CREATE TRIGGER').length, 0),
    migrations,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const migrationsDir = path.resolve(process.cwd(), process.argv[2] || 'migrations');
  try {
    console.log(JSON.stringify(migrationPlan(migrationsDir), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: String(error.message || error) }));
    process.exitCode = 1;
  }
}
