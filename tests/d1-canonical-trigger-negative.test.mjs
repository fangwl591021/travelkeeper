import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseSqlStatements } from '../scripts/d1-remote-migration-plan.mjs';

function canonicalDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const migrationsDir = path.resolve('migrations');
  for (const file of readdirSync(migrationsDir).filter((name) => /^\d+_.*\.sql$/.test(name)).sort()) {
    for (const statement of parseSqlStatements(readFileSync(path.join(migrationsDir, file), 'utf8'), file)) db.exec(statement.sql);
  }
  return db;
}

function seed(db) {
  db.exec("INSERT INTO tenants (slug, name) VALUES ('tenant-b', 'Tenant B')");
  db.exec("INSERT INTO distributors (uid, agency_slug) VALUES ('U-DEMO', 'demo'), ('U-B', 'tenant-b')");
  db.exec("INSERT INTO customers (customer_phone, owner_uid, tenant_slug, customer_id, contact_phone) VALUES ('0900', 'U-DEMO', 'demo', 'C1', '0900')");
  db.exec("INSERT INTO itineraries (id, owner_uid, tenant_slug, title) VALUES ('I-DEMO', 'U-DEMO', 'demo', 'Demo'), ('I-B', 'U-B', 'tenant-b', 'Tenant B')");
  db.exec("INSERT INTO tenant_crm_profiles (id, tenant_slug, customer_id) VALUES ('P-DEMO', 'demo', 'C1')");
  db.exec("INSERT INTO tenant_crm_threads (id, tenant_slug, profile_id) VALUES ('T-DEMO', 'demo', 'P-DEMO')");
  db.exec("INSERT INTO platform_collection_batches (id, tenant_slug) VALUES ('B-DEMO', 'demo')");
}

test('canonical schema contains every original tenant-integrity trigger', () => {
  const db = canonicalDatabase();
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all();
  assert.equal(rows.length, 26);
  assert.ok(rows.some((row) => row.name === 'trg_tenant_crm_message_thread_insert'));
  assert.ok(rows.some((row) => row.name === 'trg_orders_tenant_customer_insert'));
  assert.ok(rows.some((row) => row.name === 'trg_settlement_proof_tenant_insert'));
});

test('canonical schema rejects representative cross-tenant writes', () => {
  const db = canonicalDatabase();
  seed(db);

  assert.throws(() => db.exec("INSERT INTO tenant_crm_threads (id, tenant_slug, profile_id) VALUES ('T-BAD', 'tenant-b', 'P-DEMO')"), /TENANT_MISMATCH:crm_thread_profile/);
  assert.throws(() => db.exec("INSERT INTO tenant_crm_messages (id, tenant_slug, profile_id, thread_id, event_fingerprint) VALUES ('M-BAD', 'tenant-b', 'P-DEMO', 'T-DEMO', 'bad-message')"), /TENANT_MISMATCH:crm_message_(profile|thread)/);
  assert.throws(() => db.exec("INSERT INTO orders (order_id, itinerary_id, distributor_uid, customer_name, customer_phone, travelers, travel_date, status, tenant_slug, customer_id, contact_phone) VALUES ('O-BAD', 'I-B', 'U-B', 'Bad', '0900', 1, '2026-08-01', 'pending', 'tenant-b', 'C1', '0900')"), /TENANT_MISMATCH:order_customer/);
  assert.throws(() => db.exec("INSERT INTO platform_collection_batch_proofs (id, tenant_slug, batch_id, storage_key) VALUES ('PROOF-BAD', 'tenant-b', 'B-DEMO', 'proof-bad')"), /TENANT_MISMATCH/);
});
