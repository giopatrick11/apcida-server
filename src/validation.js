const ALLOWED_FIELDS = new Set([
  'reportType', 'remarks', 'riskScore', 'gemmaClassification',
  'gemmaRationale', 'detectedKeywords', 'reportedAt', 'appVersion',
  'clientReportId', 'finalVerdict', 'ruleVerdict', 'processingState',
  'aiStatus', 'gemmaConfidence', 'modelVersion', 'smsText', 'messageSharingConsent'
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

function optionalEnum(value, allowed) {
  return value == null || allowed.includes(value);
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
      !optionalText(body.gemmaRationale, 5000)) {
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
        typeof value !== 'string' || !value.trim() || value.length > 500)) {
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

  if (body.clientReportId != null &&
      (typeof body.clientReportId !== 'string' ||
       !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.clientReportId))) {
    return { error: 'Invalid clientReportId' };
  }
  const verdicts = ['SAFE', 'SUSPICIOUS', 'SCAM'];
  if (!optionalEnum(body.finalVerdict, verdicts) ||
      !optionalEnum(body.ruleVerdict, verdicts) ||
      !optionalEnum(body.processingState,
        ['PENDING', 'RULE_ANALYZED', 'AI_QUEUED', 'AI_ANALYZING', 'COMPLETED', 'AI_FAILED']) ||
      !optionalEnum(body.aiStatus, ['NOT_STARTED', 'ANALYZING', 'AVAILABLE', 'UNAVAILABLE']) ||
      !optionalEnum(body.gemmaConfidence, ['HIGH', 'MEDIUM', 'LOW'])) {
    return { error: 'Invalid scan snapshot' };
  }
  if (!optionalText(body.modelVersion, 100) || !optionalText(body.smsText, 4000)) {
    return { error: 'Invalid modelVersion or smsText' };
  }
  if (body.messageSharingConsent != null &&
      typeof body.messageSharingConsent !== 'boolean') {
    return { error: 'Invalid messageSharingConsent' };
  }
  if (body.smsText != null &&
      (!body.smsText.trim() || body.messageSharingConsent !== true)) {
    return { error: 'SMS text requires explicit sharing consent' };
  }
  if (body.messageSharingConsent === true && body.smsText == null) {
    return { error: 'Sharing consent requires SMS text' };
  }
  if (body.clientReportId != null &&
      (!body.finalVerdict || !body.ruleVerdict ||
       !body.processingState || !body.aiStatus ||
       typeof body.messageSharingConsent !== 'boolean')) {
    return { error: 'Incomplete scan snapshot' };
  }

  const value = {
    reportType: body.reportType.trim(),
    remarks: redactFreeText(body.remarks),
    riskScore: body.riskScore ?? null,
    gemmaClassification: body.gemmaClassification ?? null,
    gemmaRationale: redactFreeText(body.gemmaRationale),
    detectedKeywords: body.detectedKeywords.map((item) => item.trim()),
    reportedAt: body.reportedAt,
    appVersion: body.appVersion.trim()
  };
  // Keep the normalized shape of old requests for legacy retry digests.
  if (Object.keys(body).some((key) =>
      ['clientReportId', 'finalVerdict', 'ruleVerdict', 'processingState',
        'aiStatus', 'gemmaConfidence', 'modelVersion', 'smsText',
        'messageSharingConsent'].includes(key))) {
    Object.assign(value, {
      clientReportId: body.clientReportId ?? null,
      finalVerdict: body.finalVerdict ?? null,
      ruleVerdict: body.ruleVerdict ?? null,
      processingState: body.processingState ?? null,
      aiStatus: body.aiStatus ?? null,
      gemmaConfidence: body.gemmaConfidence ?? null,
      modelVersion: body.modelVersion?.trim() ?? null,
      smsText: body.smsText ?? null,
      messageSharingConsent: body.messageSharingConsent ?? false
    });
  }
  return { value };
}
