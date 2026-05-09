import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq === -1) {
      args[raw.slice(2)] = 'true';
    } else {
      args[raw.slice(2, eq)] = raw.slice(eq + 1);
    }
  }
  return args;
}

function required(name, value) {
  if (!value) {
    throw new Error(`Missing required argument: --${name}=...`);
  }
  return value;
}

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

function sqlText(value) {
  return `'${escapeSqlString(value ?? '')}'`;
}

function sqlInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n)) : String(fallback);
}

function sqlReal(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : String(fallback);
}

function sqlBool(value) {
  return value ? '1' : '0';
}

function normalizeResponse(json, fallbackKey = 'data') {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json[fallbackKey])) return json[fallbackKey];
  if (json && json.success && Array.isArray(json.data)) return json.data;
  if (json && json.success && json.data && typeof json.data === 'object') return json.data;
  return json;
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('886') && digits.length >= 11) return `0${digits.slice(3)}`;
  if (digits.length === 9 && digits.startsWith('9')) return `0${digits}`;
  if (digits.length === 8 && /^[2-8]/.test(digits)) return `0${digits}`;
  return digits;
}

function isIsoLikeDate(value) {
  const s = String(value || '').trim();
  return !!s && !Number.isNaN(Date.parse(s));
}

function normalizeDistributorStatus(rawStatus, rawJoinDate) {
  const status = String(rawStatus || '').trim().toLowerCase();
  const joinDate = String(rawJoinDate || '').trim().toLowerCase();
  const known = new Set(['pending', 'approved', 'active', 'suspended', 'rejected']);

  if (known.has(status)) {
    if (status === 'approved') return 'active';
    return status;
  }
  if (known.has(joinDate)) {
    if (joinDate === 'approved') return 'active';
    return joinDate;
  }
  return 'pending';
}

async function fetchGas(gasUrl, params) {
  const url = new URL(gasUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const res = await fetch(url, { redirect: 'follow' });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`GAS returned non-JSON for action=${params.action}: ${text.slice(0, 200)}`);
  }
  if (json && json.success === false) {
    throw new Error(`GAS action=${params.action} failed: ${json.error || 'unknown error'}`);
  }
  return json;
}

function deriveCustomers(orders, distributorsByUid) {
  const grouped = new Map();

  const sorted = [...orders].sort((a, b) => {
    const aa = String(a.createdat || '');
    const bb = String(b.createdat || '');
    return aa.localeCompare(bb);
  });

  for (const order of sorted) {
    const phone = normalizePhone(order.customer_phone);
    if (!phone) continue;

    const totalAmount = Number(order.total_amount || order.price || 0) || 0;
    const ownerUid = String(order.distributor_uid || '').trim();
    const ownerName = distributorsByUid.get(ownerUid)?.name || '';
    const createdAt = String(order.created_at || '');

    if (!grouped.has(phone)) {
      grouped.set(phone, {
        customer_phone: phone,
        customer_name: String(order.customer_name || ''),
        customer_line_uid: String(order.customer_line_uid || ''),
        owner_uid: ownerUid,
        owner_name: ownerName,
        first_order_at: createdAt,
        last_order_at: createdAt,
        total_orders: 1,
        total_amount: totalAmount,
        source: String(order.source || 'referral'),
        note: '',
      });
      continue;
    }

    const row = grouped.get(phone);
    row.total_orders += 1;
    row.total_amount += totalAmount;
    row.last_order_at = createdAt || row.last_order_at;
    if (!row.customer_name && order.customer_name) row.customer_name = String(order.customer_name);
    if (!row.customer_line_uid && order.customer_line_uid) row.customer_line_uid = String(order.customer_line_uid);
  }

  return [...grouped.values()];
}

function buildSql(dataset, { truncate = true } = {}) {
  const lines = ['PRAGMA foreign_keys = OFF;'];

  if (truncate) {
    lines.push(
      'DELETE FROM payout_batch_orders;',
      'DELETE FROM payout_batches;',
      'DELETE FROM payment_attempts;',
      'DELETE FROM audit_logs;',
      'DELETE FROM orders;',
      'DELETE FROM customers;',
      'DELETE FROM itineraries;',
      'DELETE FROM distributors;',
      'DELETE FROM tenants;'
    );
  }

  for (const tenant of dataset.tenants) {
    lines.push(
      `INSERT OR REPLACE INTO tenants (slug, name, liff_id, created_at, updated_at) VALUES (` +
      `${sqlText(tenant.slug)}, ${sqlText(tenant.name)}, ${sqlText(tenant.liff_id)}, ` +
      `${sqlText(tenant.created_at)}, ${sqlText(tenant.updated_at)});`
    );
  }

  for (const d of dataset.distributors) {
    lines.push(
      `INSERT OR REPLACE INTO distributors (` +
      `uid, name, phone, email, company_name, tax_id, line_link, line_at_link, line_at_id, fb_link, ig_link, web_link, map_link, tg_token, tg_chat_id, avatar, bio, oa_intro, bank_account, bank_name, bank_branch, bank_holder, status, commission_pct, note, sales_revenue, joined_at, ref_uid, agency_slug, can_upload, invite_code, created_at, updated_at` +
      `) VALUES (` +
      `${sqlText(d.uid)}, ${sqlText(d.name)}, ${sqlText(d.phone)}, ${sqlText(d.email)}, ${sqlText(d.company_name)}, ${sqlText(d.tax_id)}, ${sqlText(d.line_link)}, ${sqlText(d.line_at_link)}, ${sqlText(d.line_at_id)}, ${sqlText(d.fb_link)}, ${sqlText(d.ig_link)}, ${sqlText(d.web_link)}, ${sqlText(d.map_link)}, ${sqlText(d.tg_token)}, ${sqlText(d.tg_chat_id)}, ${sqlText(d.avatar)}, ${sqlText(d.bio)}, ${sqlText(d.oa_intro)}, ${sqlText(d.bank_account)}, ${sqlText(d.bank_name)}, ${sqlText(d.bank_branch)}, ${sqlText(d.bank_holder)}, ${sqlText(d.status)}, ${sqlReal(d.commission_pct)}, ${sqlText(d.note)}, ${sqlInt(d.sales_revenue)}, ${sqlText(d.joined_at)}, ${sqlText(d.ref_uid)}, ${sqlText(d.agency_slug)}, ${sqlBool(d.can_upload)}, ${sqlText(d.invite_code)}, ${sqlText(d.created_at)}, ${sqlText(d.updated_at)}` +
      `);`
    );
  }

  for (const it of dataset.itineraries) {
    lines.push(
      `INSERT OR REPLACE INTO itineraries (` +
      `id, title, region, price, days, image, description, notes, owner_uid, owner_name, review_status, review_note, commission_amount, payment_mode, deposit_ratio, balance_collect, created_at, updated_at, deleted_at` +
      `) VALUES (` +
      `${sqlText(it.id)}, ${sqlText(it.title)}, ${sqlText(it.region)}, ${sqlInt(it.price)}, ${sqlInt(it.days)}, ${sqlText(it.image)}, ${sqlText(it.description)}, ${sqlText(it.notes)}, ${sqlText(it.owner_uid)}, ${sqlText(it.owner_name)}, ${sqlText(it.review_status)}, ${sqlText(it.review_note)}, ${sqlInt(it.commission_amount)}, ${sqlText(it.payment_mode)}, ${sqlInt(it.deposit_ratio, 20)}, ${sqlText(it.balance_collect)}, ${sqlText(it.created_at)}, ${sqlText(it.updated_at)}, ${sqlText(it.deleted_at)}` +
      `);`
    );
  }

  for (const c of dataset.customers) {
    lines.push(
      `INSERT OR REPLACE INTO customers (` +
      `customer_phone, customer_name, customer_line_uid, owner_uid, owner_name, first_order_at, last_order_at, total_orders, total_amount, source, note, created_at, updated_at` +
      `) VALUES (` +
      `${sqlText(c.customer_phone)}, ${sqlText(c.customer_name)}, ${sqlText(c.customer_line_uid)}, ${sqlText(c.owner_uid)}, ${sqlText(c.owner_name)}, ${sqlText(c.first_order_at)}, ${sqlText(c.last_order_at)}, ${sqlInt(c.total_orders, 1)}, ${sqlInt(c.total_amount)}, ${sqlText(c.source)}, ${sqlText(c.note)}, ${sqlText(c.created_at)}, ${sqlText(c.updated_at)}` +
      `);`
    );
  }

  for (const o of dataset.orders) {
    lines.push(
      `INSERT OR REPLACE INTO orders (` +
      `order_id, itinerary_id, itinerary_title, price, distributor_uid, customer_name, customer_phone, customer_line_uid, travelers, travel_date, note, status, commission_amount, total_amount, deposit_amount, balance_amount, payment_mode, balance_collect, deposit_status, deposit_paid_at, deposit_method, deposit_trade_no, balance_status, balance_paid_at, balance_method, balance_trade_no, commission_status, commission_settled_at, commission_paid_out_at, source, created_at, updated_at` +
      `) VALUES (` +
      `${sqlText(o.order_id)}, ${sqlText(o.itinerary_id)}, ${sqlText(o.itinerary_title)}, ${sqlInt(o.price)}, ${sqlText(o.distributor_uid)}, ${sqlText(o.customer_name)}, ${sqlText(o.customer_phone)}, ${sqlText(o.customer_line_uid)}, ${sqlInt(o.travelers, 1)}, ${sqlText(o.travel_date)}, ${sqlText(o.note)}, ${sqlText(o.status)}, ${sqlInt(o.commission_amount)}, ${sqlInt(o.total_amount)}, ${sqlInt(o.deposit_amount)}, ${sqlInt(o.balance_amount)}, ${sqlText(o.payment_mode)}, ${sqlText(o.balance_collect)}, ${sqlText(o.deposit_status)}, ${sqlText(o.deposit_paid_at)}, ${sqlText(o.deposit_method)}, ${sqlText(o.deposit_trade_no)}, ${sqlText(o.balance_status)}, ${sqlText(o.balance_paid_at)}, ${sqlText(o.balance_method)}, ${sqlText(o.balance_trade_no)}, ${sqlText(o.commission_status)}, ${sqlText(o.commission_settled_at)}, ${sqlText(o.commission_paid_out_at)}, ${sqlText(o.source)}, ${sqlText(o.created_at)}, ${sqlText(o.updated_at)}` +
      `);`
    );
  }

  lines.push('PRAGMA foreign_keys = ON;');
  return lines.join('\n');
}

function runWranglerExecute({ dbName, sqlFile, remote }) {
  const parts = [
    `"D:\\Program Files\\nodejs\\npx.cmd"`,
    'wrangler',
    'd1',
    'execute',
    dbName,
  ];
  if (remote) parts.push('--remote');
  parts.push('--file', `"${sqlFile}"`);
  const command = parts.join(' ');

  return new Promise((resolve, reject) => {
    const child = spawn(command, [], {
      stdio: 'inherit',
      shell: true,
      env: process.env,
    });

    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`wrangler d1 execute exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === 'true') {
    console.log(`Usage:
  node scripts/import-sheets-to-d1.mjs --gas-url=GAS_URL [--db=travelkeeper] [--agency=demo] [--out=.tmp/d1-import.sql] [--dry-run=true] [--truncate=false]

Environment:
  CLOUDFLARE_API_TOKEN must be available for remote D1 execution.
`);
    return;
  }

  const gasUrl = required('gas-url', args['gas-url']);
  const dbName = args.db || 'travelkeeper';
  const agency = args.agency || 'demo';
  const outFile = resolve(args.out || '.tmp/d1-import.sql');
  const dumpJson = args['dump-json'] === 'true';
  const dryRun = args['dry-run'] === 'true';
  const truncate = args.truncate !== 'false';
  const remote = args.remote !== 'false';

  console.log('[import] fetching GAS data...');
  const [configRaw, distributorsRaw, itinerariesRaw, ordersRaw] = await Promise.all([
    fetchGas(gasUrl, { action: 'getConfig', a: agency }),
    fetchGas(gasUrl, { action: 'getDistributors' }),
    fetchGas(gasUrl, { action: 'getItineraries', all: '1' }),
    fetchGas(gasUrl, { action: 'getAllOrders' }),
  ]);

  const config = normalizeResponse(configRaw);
  const distributors = normalizeResponse(distributorsRaw);
  const itineraries = normalizeResponse(itinerariesRaw);
  const orders = normalizeResponse(ordersRaw);

  if (dumpJson) {
    const rawDir = resolve('.tmp/raw');
    await mkdir(rawDir, { recursive: true });
    await writeFile(resolve(rawDir, 'config.json'), JSON.stringify(configRaw, null, 2), 'utf8');
    await writeFile(resolve(rawDir, 'distributors.json'), JSON.stringify(distributorsRaw, null, 2), 'utf8');
    await writeFile(resolve(rawDir, 'itineraries.json'), JSON.stringify(itinerariesRaw, null, 2), 'utf8');
    await writeFile(resolve(rawDir, 'orders.json'), JSON.stringify(ordersRaw, null, 2), 'utf8');
  }

  if (!Array.isArray(distributors)) throw new Error('getDistributors did not return an array');
  if (!Array.isArray(itineraries)) throw new Error('getItineraries did not return an array');
  if (!orders || !Array.isArray(orders.data || orders)) throw new Error('getAllOrders did not return an array');

  const orderList = Array.isArray(orders) ? orders : orders.data;

  const normalizedTenants = [{
    slug: String(config.data?.slug || config.slug || agency),
    name: String(config.data?.name || config.name || ''),
    liff_id: String(config.data?.liff_id || config.liff_id || ''),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }];

  const normalizedDistributors = distributors.map((d) => {
    const rawJoinDate = String(d.joindate || d.joinDate || '');
    const normalizedStatus = normalizeDistributorStatus(d.status, rawJoinDate);
    const joinedAt = isIsoLikeDate(rawJoinDate) ? rawJoinDate : '';

    return {
      uid: String(d.uid || ''),
      name: String(d.name || ''),
      phone: normalizePhone(d.phone),
      email: String(d.email || ''),
      company_name: String(d.companyname || d.companyName || ''),
      tax_id: String(d.taxid || d.taxId || ''),
      line_link: String(d.linelink || d.lineLink || ''),
      line_at_link: String(d.lineatlink || d.lineAtLink || ''),
      line_at_id: String(d.lineatid || d.lineAtId || ''),
      fb_link: String(d.fblink || d.fbLink || ''),
      ig_link: String(d.iglink || d.igLink || ''),
      web_link: String(d.weblink || d.webLink || ''),
      map_link: String(d.maplink || d.mapLink || ''),
      tg_token: ['0', 'null', 'undefined'].includes(String(d.tgtoken || d.tgToken || '').trim()) ? '' : String(d.tgtoken || d.tgToken || ''),
      tg_chat_id: ['0', 'null', 'undefined'].includes(String(d.tgchatid || d.tgChatId || '').trim()) ? '' : String(d.tgchatid || d.tgChatId || ''),
      avatar: String(d.avatar || ''),
      bio: String(d.bio || ''),
      oa_intro: String(d.oaintro || d.oaIntro || ''),
      bank_account: String(d.bankaccount || d.bankAccount || ''),
      bank_name: String(d.bankname || d.bankName || ''),
      bank_branch: String(d.bankbranch || d.bankBranch || ''),
      bank_holder: String(d.bankholder || d.bankHolder || ''),
      status: normalizedStatus,
      commission_pct: Number(d.commission || d.commissionPct || 0),
      note: String(d.note || ''),
      sales_revenue: Number(d.salesrevenue || d.salesRevenue || 0),
      joined_at: joinedAt,
      ref_uid: String(d.ref_uid || ''),
      agency_slug: String(d.agencyslug || d.agencySlug || agency || 'demo') || 'demo',
      can_upload: String(d.canupload || d.canUpload || '').toUpperCase() === 'Y',
      invite_code: String(d.invitecode || d.inviteCode || '').toUpperCase(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });

  const distributorsByUid = new Map(normalizedDistributors.map((d) => [d.uid, d]));

  const normalizedItineraries = itineraries.map((it) => ({
    id: String(it.id || it.timestamp || ''),
    title: String(it.title || ''),
    region: String(it.region || ''),
    price: Number(it.price || 0),
    days: Number(it.days || 0),
    image: String(it.image || ''),
    description: String(it.description || ''),
    notes: String(it.notes || ''),
    owner_uid: String(it.owneruid || ''),
    owner_name: String(it.ownername || ''),
    review_status: String(it.reviewstatus || 'published'),
    review_note: String(it.reviewnote || ''),
    commission_amount: Number(it.commissionamount || it.commissionAmount || 0),
    payment_mode: String(it.paymentmode || 'deposit'),
    deposit_ratio: Number(it.depositratio || 20),
    balance_collect: String(it.balancecollect || 'online'),
    created_at: String(it.created || it.createdat || ''),
    updated_at: String(it.updatedat || it.created || ''),
    deleted_at: '',
  }));

  const normalizedOrders = orderList.map((o) => ({
    order_id: String(o.orderid || ''),
    itinerary_id: String(o.itineraryid || ''),
    itinerary_title: String(o.itinerarytitle || ''),
    price: Number(o.price || 0),
    distributor_uid: String(o.distributoruid || ''),
    customer_name: String(o.customername || ''),
    customer_phone: normalizePhone(o.customerphone),
    customer_line_uid: String(o.customerlineuid || ''),
    travelers: Number(o.travelers || 1),
    travel_date: String(o.traveldate || ''),
    note: String(o.note || ''),
    status: String(o.status || 'pending'),
    commission_amount: Number(o.commissionamount || 0),
    total_amount: Number(o.totalamount || o.price || 0),
    deposit_amount: Number(o.depositamount || 0),
    balance_amount: Number(o.balanceamount || 0),
    payment_mode: String(o.paymentmode || 'deposit'),
    balance_collect: String(o.balancecollect || 'online'),
    deposit_status: String(o.depositstatus || 'unpaid'),
    deposit_paid_at: String(o.depositpaidat || ''),
    deposit_method: String(o.depositmethod || ''),
    deposit_trade_no: String(o.deposittradeno || ''),
    balance_status: String(o.balancestatus || 'unpaid'),
    balance_paid_at: String(o.balancepaidat || ''),
    balance_method: String(o.balancemethod || ''),
    balance_trade_no: String(o.balancetradeno || ''),
    commission_status: String(o.commissionstatus || 'pending'),
    commission_settled_at: String(o.commissionsettledat || ''),
    commission_paid_out_at: String(o.commissionpaidoutat || ''),
    source: String(o.source || 'referral'),
    created_at: String(o.createdat || ''),
    updated_at: String(o.updatedat || o.createdat || ''),
  }));

  const derivedCustomers = deriveCustomers(normalizedOrders, distributorsByUid).map((c) => ({
    ...c,
    created_at: c.first_order_at || new Date().toISOString(),
    updated_at: c.last_order_at || new Date().toISOString(),
  }));

  const dataset = {
    tenants: normalizedTenants,
    distributors: normalizedDistributors,
    itineraries: normalizedItineraries,
    customers: derivedCustomers,
    orders: normalizedOrders,
  };

  const sql = buildSql(dataset, { truncate });
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, sql, 'utf8');

  console.log(`[import] wrote SQL file: ${outFile}`);
  console.log(`[import] tenants=${dataset.tenants.length}, distributors=${dataset.distributors.length}, itineraries=${dataset.itineraries.length}, customers=${dataset.customers.length}, orders=${dataset.orders.length}`);

  if (dryRun) {
    console.log('[import] dry-run mode, skipped D1 execution');
    return;
  }

  await runWranglerExecute({ dbName, sqlFile: outFile, remote });
  console.log('[import] D1 import completed');
}

main().catch((err) => {
  console.error('[import] failed:', err.message);
  process.exitCode = 1;
});
