import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checksum, normalizeSql, parseSqlStatements } from './d1-remote-migration-plan.mjs';
import { schemaChecksum, snapshotSqliteDatabase } from './d1-schema-equivalence.mjs';

export const BASELINE_VERSION = '0001-0114';
export const BASELINE_END = 114;
export const DEFAULT_SOURCE_COMMIT = '2aedbcde8829d6dedd5b836ddf87cbc4627d2e9b';

function jsonChecksum(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function canonicalFiles(migrationsDir) {
  const files = readdirSync(migrationsDir)
    .filter((file) => /^\d+_.*\.sql$/.test(file))
    .sort();
  const selected = files.filter((file) => Number(file.slice(0, 4)) <= BASELINE_END);
  if (selected.length !== 35 || selected.at(-1) !== '0114_d1_tenant_integrity_compat.sql') {
    throw new Error('canonical migration range must contain exactly 35 migrations ending at 0114');
  }
  return selected;
}

function installStatements(db, statements) {
  db.exec('PRAGMA foreign_keys = ON');
  for (const statement of statements) db.exec(statement.sql);
}

export function generateBootstrap({ migrationsDir, sourceCommit = DEFAULT_SOURCE_COMMIT }) {
  const files = canonicalFiles(migrationsDir);
  const migrations = [];
  const allStatements = [];
  const bootstrapParts = [];

  for (const file of files) {
    const source = readFileSync(path.join(migrationsDir, file), 'utf8');
    const statements = parseSqlStatements(source, file);
    const migration = {
      file,
      checksum: checksum(source),
      statementCount: statements.length,
      statements: [],
    };
    statements.forEach((statement, index) => {
      const metadata = {
        index,
        type: statement.type,
        triggerName: statement.triggerName,
        checksum: statement.checksum,
      };
      migration.statements.push(metadata);
      allStatements.push(statement);
      bootstrapParts.push(statement.sql);
      bootstrapParts.push('');
    });
    migrations.push(migration);
  }

  const bootstrapSql = bootstrapParts.join('\n').replace(/\n+$/, '\n');
  const db = new DatabaseSync(':memory:');
  installStatements(db, allStatements);
  const schema = snapshotSqliteDatabase(db);
  const manifestWithoutChecksum = {
    format_version: 1,
    baseline_version: BASELINE_VERSION,
    source_commit: sourceCommit,
    migration_start: files[0],
    migration_end: files.at(-1),
    migration_count: migrations.length,
    statement_count: allStatements.length,
    bootstrap_checksum: checksum(bootstrapSql),
    schema_checksum: schemaChecksum(schema),
    migrations,
  };
  const manifest = {
    ...manifestWithoutChecksum,
    manifest_checksum: jsonChecksum(manifestWithoutChecksum),
  };
  return { bootstrapSql, manifest, schema };
}

export function artifactPaths(outputDir) {
  return {
    bootstrap: path.join(outputDir, 'bootstrap.sql'),
    manifest: path.join(outputDir, 'manifest.json'),
    schema: path.join(outputDir, 'schema.json'),
  };
}

export function writeBootstrapArtifacts(outputDir, generated) {
  mkdirSync(outputDir, { recursive: true });
  const paths = artifactPaths(outputDir);
  writeFileSync(paths.bootstrap, generated.bootstrapSql, 'utf8');
  writeFileSync(paths.manifest, JSON.stringify(generated.manifest, null, 2) + '\n', 'utf8');
  writeFileSync(paths.schema, JSON.stringify(generated.schema, null, 2) + '\n', 'utf8');
  return paths;
}

export function checkBootstrapArtifacts(outputDir, generated) {
  const paths = artifactPaths(outputDir);
  if (!Object.values(paths).every(existsSync)) throw new Error('bootstrap artifact is missing');
  const actualBootstrap = readFileSync(paths.bootstrap, 'utf8');
  const actualManifest = JSON.parse(readFileSync(paths.manifest, 'utf8'));
  const actualSchema = JSON.parse(readFileSync(paths.schema, 'utf8'));
  if (actualBootstrap !== generated.bootstrapSql) throw new Error('bootstrap.sql drift detected');
  if (JSON.stringify(actualManifest) !== JSON.stringify(generated.manifest)) throw new Error('manifest drift detected');
  if (JSON.stringify(actualSchema) !== JSON.stringify(generated.schema)) throw new Error('schema.json drift detected');
  if (actualManifest.bootstrap_checksum !== checksum(actualBootstrap)) throw new Error('bootstrap checksum mismatch');
  if (actualManifest.manifest_checksum !== jsonChecksum({ ...actualManifest, manifest_checksum: undefined })) throw new Error('manifest checksum mismatch');
  return true;
}

function cli() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const check = args.includes('--check');
  const outputArg = args.find((arg) => arg.startsWith('--output='));
  const sourceArg = args.find((arg) => arg.startsWith('--source-commit='));
  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  const outputDir = path.resolve(process.cwd(), outputArg ? outputArg.slice('--output='.length) : 'artifacts/d1-bootstrap');
  const sourceCommit = sourceArg ? sourceArg.slice('--source-commit='.length) : DEFAULT_SOURCE_COMMIT;
  const generated = generateBootstrap({ migrationsDir, sourceCommit });
  if (write) writeBootstrapArtifacts(outputDir, generated);
  if (check) checkBootstrapArtifacts(outputDir, generated);
  console.log(JSON.stringify({
    baseline_version: generated.manifest.baseline_version,
    migration_count: generated.manifest.migration_count,
    statement_count: generated.manifest.statement_count,
    bootstrap_checksum: generated.manifest.bootstrap_checksum,
    manifest_checksum: generated.manifest.manifest_checksum,
    schema_checksum: generated.manifest.schema_checksum,
    output: outputDir,
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    cli();
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: String(error.message || error) }));
    process.exitCode = 1;
  }
}
