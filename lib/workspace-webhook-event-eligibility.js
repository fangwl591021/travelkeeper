const ALLOWED_INPUT_KEYS = new Set(['events']);
const MAX_TEXT_LENGTH = 500;

function safeText(value, max = MAX_TEXT_LENGTH) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function validInput(input) {
  return input
    && typeof input === 'object'
    && !Array.isArray(input)
    && Object.keys(input).every((key) => ALLOWED_INPUT_KEYS.has(key))
    && Array.isArray(input.events);
}

function eligibleEvent(event, eventIndex) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  if (event.type !== 'message' || event.message?.type !== 'text') return null;
  if (event.source?.type !== 'user') return null;
  if (event.deliveryContext?.isRedelivery === true) return null;

  const verifiedUserUid = safeText(event.source.userId, 120);
  const text = safeText(event.message.text);
  if (!verifiedUserUid || !text) return null;

  return { eligible: true, eventIndex, verifiedUserUid, text };
}

function selectEligibleWorkspaceWebhookEvent(input = {}) {
  if (!validInput(input)) return { eligible: false, event: null };

  for (let eventIndex = 0; eventIndex < input.events.length; eventIndex += 1) {
    const selected = eligibleEvent(input.events[eventIndex], eventIndex);
    if (selected) return { eligible: true, event: selected };
  }

  return { eligible: false, event: null };
}

export { selectEligibleWorkspaceWebhookEvent };
export default selectEligibleWorkspaceWebhookEvent;
