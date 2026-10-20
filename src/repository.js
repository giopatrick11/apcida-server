import { createHash, randomUUID } from 'node:crypto';

export function createReportRepository(pool) {
  return {
    async save(report) {
      // The digest supports legacy clients; new clients also send a stable ID.
      const digest = createHash('sha256')
        .update(JSON.stringify(report))
        .digest('hex');
      const id = randomUUID();
      const inserted = await pool.query(
        `INSERT INTO reports (
           report_id, payload_digest, client_report_id, report_type, remarks,
           risk_score, gemma_classification, gemma_rationale, gemma_confidence,
           detected_keywords, final_verdict, rule_verdict, processing_state,
           ai_status, model_version, sms_text, message_sharing_consent,
           reported_at, app_version
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT DO NOTHING
         RETURNING report_id`,
        [id, digest, report.clientReportId ?? null, report.reportType,
          report.remarks, report.riskScore, report.gemmaClassification,
          report.gemmaRationale, report.gemmaConfidence ?? null,
          JSON.stringify(report.detectedKeywords), report.finalVerdict ?? null,
          report.ruleVerdict ?? null, report.processingState ?? null,
          report.aiStatus ?? null, report.modelVersion ?? null,
          report.smsText ?? null, report.messageSharingConsent ?? false,
          new Date(report.reportedAt), report.appVersion]
      );

      if (inserted.rows.length) {
        return { reportId: inserted.rows[0].report_id, created: true };
      }
      const existing = await pool.query(
        `SELECT report_id, payload_digest FROM reports
         WHERE payload_digest = $1 OR ($2::uuid IS NOT NULL AND client_report_id = $2::uuid)`,
        [digest, report.clientReportId ?? null]
      );
      if (!existing.rows.length) {
        throw new Error('Conflicting report was not found');
      }
      if (existing.rows[0].payload_digest !== digest) {
        const error = new Error('Client report ID was reused with different content');
        error.code = 'REPORT_ID_CONFLICT';
        throw error;
      }
      return { reportId: existing.rows[0].report_id, created: false };
    }
  };
}
