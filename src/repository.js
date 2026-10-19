import { createHash, randomUUID } from 'node:crypto';

export function createReportRepository(pool) {
  return {
    async save(report) {
      // The app currently has no stable client report ID. Hashing the
      // normalized payload makes a retry after a lost response idempotent.
      const digest = createHash('sha256')
        .update(JSON.stringify(report))
        .digest('hex');
      const id = randomUUID();
      const inserted = await pool.query(
        `INSERT INTO reports (
           report_id, payload_digest, report_type, remarks, risk_score,
           gemma_classification, gemma_rationale, detected_keywords,
           reported_at, app_version
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (payload_digest) DO NOTHING
         RETURNING report_id`,
        [id, digest, report.reportType, report.remarks, report.riskScore,
          report.gemmaClassification, report.gemmaRationale,
          JSON.stringify(report.detectedKeywords), new Date(report.reportedAt),
          report.appVersion]
      );

      if (inserted.rows.length) {
        return { reportId: inserted.rows[0].report_id, created: true };
      }
      const existing = await pool.query(
        'SELECT report_id FROM reports WHERE payload_digest = $1',
        [digest]
      );
      if (!existing.rows.length) {
        throw new Error('Conflicting report was not found');
      }
      return { reportId: existing.rows[0].report_id, created: false };
    }
  };
}
