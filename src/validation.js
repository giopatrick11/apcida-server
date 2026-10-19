const ALLOWED_FIELDS = new Set([
  'reportType', 'remarks', 'riskScore', 'gemmaClassification',
  'gemmaRationale', 'detectedKeywords', 'reportedAt', 'appVersion'
]);

// Free text can quote an SMS. This removes common identifiers, but cannot
// guarantee anonymization; see the privacy note in README.md.
function redactFreeText(value) {
  if (value == null) return null;
  return value
    .replace(/https?:\/\/[^\s]+/gi, '[URL]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]')
    .replace(/(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)/g, '[PHONE]')
    .replace(/\b\d{4,}\b/g, '[NUMBER]');
}

function optionalText(value, maxLength) {
  return value == null ||
    (typeof value === 'string' && value.length <= maxLength);
}

export function validateReport(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Body must be a JSON object' };
  }
  if (Object.keys(body).some((key) => !ALLOWED_FIELDS.has(key))) {
    return { error: 'Body contains unsupported fields' };
  }
  if (typeof body.reportType !== 'string' ||
      body.reportType.trim().length < 1 || body.reportType.length > 100) {
    return { error: 'Invalid reportType' };
  }
  if (!optionalText(body.remarks, 1000) ||
      !optionalText(body.gemmaRationale, 2000)) {
    return { error: 'Invalid free-text field' };
  }
  if (body.riskScore != null &&
      (typeof body.riskScore !== 'number' || !Number.isFinite(body.riskScore) ||
       body.riskScore < 0 || body.riskScore > 140)) {
    return { error: 'Invalid riskScore' };
  }
  if (body.gemmaClassification != null &&
      !['SCAM', 'LEGITIMATE', 'UNCERTAIN'].includes(body.gemmaClassification)) {
    return { error: 'Invalid gemmaClassification' };
  }
  if (!Array.isArray(body.detectedKeywords) || body.detectedKeywords.length > 30 ||
      body.detectedKeywords.some((value) =>
        typeof value !== 'string' || !value.trim() || value.length > 100)) {
    return { error: 'Invalid detectedKeywords' };
  }
  if (!Number.isSafeInteger(body.reportedAt) || body.reportedAt < 0 ||
      body.reportedAt > now + 24 * 60 * 60 * 1000) {
    return { error: 'Invalid reportedAt' };
  }
  if (typeof body.appVersion !== 'string' ||
      !body.appVersion.trim() || body.appVersion.length > 32) {
    return { error: 'Invalid appVersion' };
  }

  return {
    value: {
      reportType: body.reportType.trim(),
      remarks: redactFreeText(body.remarks),
      riskScore: body.riskScore ?? null,
      gemmaClassification: body.gemmaClassification ?? null,
      gemmaRationale: redactFreeText(body.gemmaRationale),
      detectedKeywords: body.detectedKeywords.map((value) => value.trim()),
      reportedAt: body.reportedAt,
      appVersion: body.appVersion.trim()
    }
  };
}
