const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const CATEGORY = new Set(['SCAM', 'SAFE']);
const forbiddenWords = /\b(?:otp|one.time|verification|verify|authentication|2fa|password|passcode|pin|cvv|security code|login code)\b/iu;
const shortCode = /(?<!\d)\d{4,8}(?!\d)/u;
const longNumber = /(?<!\d)\d{9,}(?!\d)/u;
const separatedNumber = /(?<!\d)(?:\d[\s().-]?){8,}\d(?!\d)/u;
const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u;
const url = /(?:https?:\/\/|www\.)\S+/iu;
const phone = /(?<!\d)(?:\+?63|0)9\d{9}(?!\d)/u;

const exactKeys = (value, required) => Object.keys(value).length === required.length &&
  required.every((key) => Object.hasOwn(value, key));
const object = (value) => value !== null && typeof value === 'object' &&
  !Array.isArray(value);
const validTime = (value, now) => Number.isSafeInteger(value) && value >= 0 &&
  value <= now + 24 * 60 * 60 * 1000;

export function normalizedText(text) {
  return text.trim().toLowerCase().replace(/\s+/gu, ' ');
}

export function contentRejection(text) {
  if (!text.trim() || text.length > 4000 || text.includes('\0')) return 'INVALID_TEXT';
  if (forbiddenWords.test(text) || shortCode.test(text) || longNumber.test(text) ||
      separatedNumber.test(text) || email.test(text) || url.test(text) || phone.test(text)) {
    return 'SENSITIVE_TEXT';
  }
  return null;
}

export function validateCommunityBatch(body, now = Date.now()) {
  if (!object(body) || !exactKeys(body, ['batchId', 'participantId', 'submittedAt', 'items']) ||
      !UUID.test(body.batchId) || !UUID.test(body.participantId) ||
      !validTime(body.submittedAt, now) || !Array.isArray(body.items) ||
      body.items.length < 1 || body.items.length > 40) return null;
  const seen = new Set();
  for (const item of body.items) {
    if (!object(item) || !exactKeys(item,
      ['clientId', 'text', 'predictedCategory', 'reviewedCategory', 'reviewedAt']) ||
      !SHA256.test(item.clientId) || typeof item.text !== 'string' ||
      item.text.length > 4000 || !CATEGORY.has(item.predictedCategory) ||
      !CATEGORY.has(item.reviewedCategory) || !validTime(item.reviewedAt, now) ||
      seen.has(item.clientId.toLowerCase())) return null;
    seen.add(item.clientId.toLowerCase());
  }
  return { ...body, batchId: body.batchId.toLowerCase(),
    participantId: body.participantId.toLowerCase(),
    items: body.items.map((item) => ({ ...item, clientId: item.clientId.toLowerCase() })) };
}

export function validParticipantId(value) {
  return typeof value === 'string' && UUID.test(value);
}
