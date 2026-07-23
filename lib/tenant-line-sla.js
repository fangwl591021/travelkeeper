export const DEFAULT_SLA_SETTINGS = Object.freeze({
  first_response_sla_minutes: 30,
  followup_response_sla_minutes: 60,
  due_soon_percentage: 20,
  pause_sla_on_pending: 1,
});

export function utcNowIso(clock = Date) {
  if (clock instanceof Date) return clock.toISOString();
  if (typeof clock === 'function') return new clock().toISOString();
  if (typeof clock?.now === 'function') return new Date(clock.now()).toISOString();
  return new Date().toISOString();
}

function clampInteger(value, fallback, min, max) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function normalizeSlaSettings(row = {}) {
  return {
    first_response_sla_minutes: clampInteger(row.first_response_sla_minutes, 30, 1, 10080),
    followup_response_sla_minutes: clampInteger(row.followup_response_sla_minutes, 60, 1, 10080),
    due_soon_percentage: clampInteger(row.due_soon_percentage, 20, 1, 99),
    pause_sla_on_pending: Number(row.pause_sla_on_pending ?? 1) ? 1 : 0,
  };
}

export function secondsBetween(startIso, endIso) {
  const start = Date.parse(startIso || '');
  const end = Date.parse(endIso || '');
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 1000));
}

function addSecondsIso(startIso, seconds) {
  return new Date(Date.parse(startIso) + Number(seconds) * 1000).toISOString();
}

function addMinutesIso(startIso, minutes) {
  return addSecondsIso(startIso, Number(minutes) * 60);
}

function queueState(thread = {}) {
  return String(thread.queue_status || thread.status || 'open');
}

export function responseSlaMinutes(thread = {}, settings = DEFAULT_SLA_SETTINGS) {
  const cfg = normalizeSlaSettings(settings);
  return thread.first_response_at ? cfg.followup_response_sla_minutes : cfg.first_response_sla_minutes;
}

export function calculateSla(thread = {}, settings = DEFAULT_SLA_SETTINGS, clock = Date) {
  const cfg = normalizeSlaSettings(settings);
  const nowIso = utcNowIso(clock);
  const state = queueState(thread);
  if (state === 'closed' || !thread.waiting_since) {
    return {
      sla_status: 'not_applicable',
      waiting_seconds: 0,
      remaining_seconds: 0,
      overdue_seconds: 0,
      is_breached: false,
      is_due_soon: false,
      sla_breached_at: thread.sla_breached_at || '',
    };
  }

  if (state === 'pending' && cfg.pause_sla_on_pending) {
    const pausedAt = thread.sla_paused_at || nowIso;
    return {
      sla_status: 'paused',
      waiting_seconds: secondsBetween(thread.waiting_since, pausedAt),
      remaining_seconds: Math.max(0, Number(thread.sla_remaining_seconds || 0)),
      overdue_seconds: 0,
      is_breached: false,
      is_due_soon: false,
      sla_breached_at: thread.sla_breached_at || '',
    };
  }

  const dueMs = Date.parse(thread.sla_due_at || '');
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(dueMs) || !Number.isFinite(nowMs)) {
    return {
      sla_status: 'not_applicable',
      waiting_seconds: 0,
      remaining_seconds: 0,
      overdue_seconds: 0,
      is_breached: false,
      is_due_soon: false,
      sla_breached_at: thread.sla_breached_at || '',
    };
  }
  const startedMs = Date.parse(thread.sla_started_at || thread.waiting_since || '');
  const totalSeconds = Math.max(1, Math.floor((dueMs - (Number.isFinite(startedMs) ? startedMs : nowMs)) / 1000));
  const remainingSeconds = Math.max(0, Math.floor((dueMs - nowMs) / 1000));
  const overdueSeconds = Math.max(0, Math.floor((nowMs - dueMs) / 1000));
  const breached = dueMs < nowMs;
  const dueSoon = !breached && remainingSeconds <= Math.ceil(totalSeconds * cfg.due_soon_percentage / 100);
  return {
    sla_status: breached ? 'breached' : dueSoon ? 'due_soon' : 'waiting',
    waiting_seconds: secondsBetween(thread.waiting_since, nowIso),
    remaining_seconds: remainingSeconds,
    overdue_seconds: overdueSeconds,
    is_breached: breached,
    is_due_soon: dueSoon,
    sla_breached_at: breached ? (thread.sla_breached_at || nowIso) : (thread.sla_breached_at || ''),
  };
}

export function startWaitingCycle(thread = {}, settings = DEFAULT_SLA_SETTINGS, clock = Date) {
  if (thread.waiting_since && queueState(thread) !== 'closed') return null;
  const nowIso = utcNowIso(clock);
  const dueAt = addMinutesIso(nowIso, responseSlaMinutes(thread, settings));
  const next = {
    waiting_since: nowIso,
    sla_started_at: nowIso,
    sla_due_at: dueAt,
    sla_paused_at: '',
    sla_remaining_seconds: secondsBetween(nowIso, dueAt),
    sla_breached_at: '',
  };
  return {
    ...next,
    ...calculateSla({ ...thread, ...next, queue_status: queueState(thread) === 'closed' ? 'open' : queueState(thread) }, settings, clock),
  };
}

export function pauseWaitingCycle(thread = {}, settings = DEFAULT_SLA_SETTINGS, clock = Date) {
  if (!thread.waiting_since) return null;
  const nowIso = utcNowIso(clock);
  return {
    sla_paused_at: thread.sla_paused_at || nowIso,
    sla_remaining_seconds: Math.max(0, secondsBetween(nowIso, thread.sla_due_at)),
    sla_status: normalizeSlaSettings(settings).pause_sla_on_pending ? 'paused' : calculateSla(thread, settings, clock).sla_status,
  };
}

export function resumeWaitingCycle(thread = {}, settings = DEFAULT_SLA_SETTINGS, clock = Date) {
  if (!thread.waiting_since || !thread.sla_paused_at) return null;
  const nowIso = utcNowIso(clock);
  const remaining = Math.max(0, Number(thread.sla_remaining_seconds || 0));
  const next = {
    sla_due_at: addSecondsIso(nowIso, remaining),
    sla_paused_at: '',
    sla_remaining_seconds: remaining,
  };
  return { ...next, ...calculateSla({ ...thread, ...next, queue_status: 'open' }, settings, clock) };
}

export function closeWaitingCycle(thread = {}, clock = Date) {
  const nowIso = utcNowIso(clock);
  const waited = thread.waiting_since ? secondsBetween(thread.waiting_since, nowIso) : 0;
  return {
    waiting_since: '',
    sla_started_at: '',
    sla_due_at: '',
    sla_paused_at: '',
    sla_remaining_seconds: 0,
    sla_status: 'not_applicable',
    last_customer_wait_seconds: waited,
    total_customer_wait_seconds: Math.max(0, Number(thread.total_customer_wait_seconds || 0)) + waited,
  };
}

export function acknowledgeBreach(thread = {}, settings = DEFAULT_SLA_SETTINGS, clock = Date) {
  const sla = calculateSla(thread, settings, clock);
  if (sla.sla_status !== 'breached' || thread.sla_breached_at) return null;
  return { sla_status: 'breached', sla_breached_at: sla.sla_breached_at };
}
