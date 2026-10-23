import { randomUUID } from 'node:crypto';

const latestReview = `LEFT JOIN LATERAL (
  SELECT review_status, confirmed_label, finding, notes, reviewed_by, reviewed_at
  FROM report_reviews WHERE report_id = r.report_id
  ORDER BY reviewed_at DESC, review_id DESC LIMIT 1
) v ON true`;

function filters(query) {
  const values = [];
  const parts = [];
  const columns = {
    reason: 'r.report_type', verdict: 'r.final_verdict', ai: 'r.ai_status',
    status: "COALESCE(v.review_status, 'NEW')"
  };
  for (const [key, column] of Object.entries(columns)) {
    if (query[key]) {
      values.push(query[key]);
      parts.push(`${column} = $${values.length}`);
    }
  }
  if (query.from) {
    values.push(query.from);
    parts.push(`r.received_at >= ($${values.length}::date::timestamp AT TIME ZONE 'Asia/Manila')`);
  }
  if (query.to) {
    values.push(query.to);
    parts.push(`r.received_at < (($${values.length}::date + interval '1 day') AT TIME ZONE 'Asia/Manila')`);
  }
  return { values, where: parts.length ? `WHERE ${parts.join(' AND ')}` : '' };
}

export function createAdminRepository(pool) {
  return {
    async list(query) {
      const { values, where } = filters(query);
      const count = await pool.query(`SELECT count(*)::int AS total FROM reports r ${latestReview} ${where}`, values);
      const limit = 25;
      const offset = (query.page - 1) * limit;
      const rows = await pool.query(`
        SELECT r.report_id, r.client_report_id, r.report_type, r.risk_score,
          r.final_verdict, r.rule_verdict, r.ai_status, r.gemma_classification,
          r.app_version, r.model_version, r.received_at,
          COALESCE(v.review_status, 'NEW') AS review_status, v.confirmed_label, v.finding
        FROM reports r ${latestReview} ${where}
        ORDER BY r.received_at DESC, r.report_id DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]);
      return { rows: rows.rows, total: count.rows[0].total, page: query.page, limit };
    },

    async get(id) {
      const result = await pool.query(`
        SELECT r.*, COALESCE(v.review_status, 'NEW') AS review_status,
          v.confirmed_label, v.finding, v.notes AS review_notes,
          v.reviewed_by, v.reviewed_at
        FROM reports r ${latestReview} WHERE r.report_id = $1`, [id]);
      return result.rows[0] ?? null;
    },

    async history(id) {
      const result = await pool.query(`
        SELECT review_status, confirmed_label, finding, notes, reviewed_by, reviewed_at
        FROM report_reviews WHERE report_id = $1
        ORDER BY reviewed_at DESC, review_id DESC`, [id]);
      return result.rows;
    },

    async review(id, decision, reviewer) {
      const result = await pool.query(`
        INSERT INTO report_reviews
          (review_id, report_id, review_status, confirmed_label, finding, notes, reviewed_by)
        SELECT $1, report_id, $3, $4, $5, $6, $7 FROM reports WHERE report_id = $2
        RETURNING review_id`,
      [randomUUID(), id, decision.status, decision.label, decision.finding,
        decision.notes, reviewer]);
      return result.rows.length > 0;
    },

    async summary() {
      const [totals, byReason, byVerdict, byAi, byGemma, byFinding, byDay, byKeyword, byVersion,
        findingByGemma, findingByKeyword, findingByVersion] =
        await Promise.all([
          pool.query(`SELECT count(*)::int AS reports,
            count(*) FILTER (WHERE sms_text IS NOT NULL)::int AS shared_sms,
            count(*) FILTER (WHERE v.review_status = 'RESOLVED')::int AS resolved,
            count(*) FILTER (WHERE v.review_status = 'IN_REVIEW')::int AS in_review
            FROM reports r ${latestReview}`),
          pool.query('SELECT report_type AS label, count(*)::int AS count FROM reports GROUP BY report_type ORDER BY count DESC, label LIMIT 12'),
          pool.query("SELECT COALESCE(final_verdict, 'Legacy / unknown') AS label, count(*)::int AS count FROM reports GROUP BY 1 ORDER BY count DESC, label"),
          pool.query("SELECT COALESCE(ai_status, 'Legacy / unknown') AS label, count(*)::int AS count FROM reports GROUP BY 1 ORDER BY count DESC, label"),
          pool.query("SELECT COALESCE(gemma_classification, 'Unknown') AS label, count(*)::int AS count FROM reports GROUP BY 1 ORDER BY count DESC, label"),
          pool.query(`SELECT v.finding AS label, count(*)::int AS count FROM reports r ${latestReview}
            WHERE v.review_status = 'RESOLVED' GROUP BY v.finding ORDER BY count DESC, label`),
          pool.query(`SELECT (received_at AT TIME ZONE 'Asia/Manila')::date::text AS label,
            count(*)::int AS count FROM reports
            WHERE received_at >= (((now() AT TIME ZONE 'Asia/Manila')::date - 29)::timestamp AT TIME ZONE 'Asia/Manila')
            GROUP BY 1 ORDER BY 1 DESC`),
          pool.query("SELECT k.keyword AS label, count(*)::int AS count FROM reports r CROSS JOIN LATERAL jsonb_array_elements_text(r.detected_keywords) AS k(keyword) GROUP BY k.keyword ORDER BY count DESC, label LIMIT 15"),
          pool.query("SELECT concat('App ', app_version, ' / Model ', COALESCE(model_version, 'unknown')) AS label, count(*)::int AS count FROM reports GROUP BY app_version, model_version ORDER BY count DESC, label LIMIT 15"),
          pool.query(`SELECT COALESCE(r.gemma_classification, 'Unknown') AS group_label,
            v.finding AS finding, count(*)::int AS count FROM reports r ${latestReview}
            WHERE v.review_status = 'RESOLVED' GROUP BY 1, 2 ORDER BY count DESC, 1, 2 LIMIT 30`),
          pool.query(`SELECT k.keyword AS group_label, v.finding AS finding, count(*)::int AS count
            FROM reports r ${latestReview}
            CROSS JOIN LATERAL jsonb_array_elements_text(r.detected_keywords) AS k(keyword)
            WHERE v.review_status = 'RESOLVED' GROUP BY 1, 2 ORDER BY count DESC, 1, 2 LIMIT 30`),
          pool.query(`SELECT concat('App ', r.app_version, ' / Model ', COALESCE(r.model_version, 'unknown')) AS group_label,
            v.finding AS finding, count(*)::int AS count FROM reports r ${latestReview}
            WHERE v.review_status = 'RESOLVED' GROUP BY 1, 2 ORDER BY count DESC, 1, 2 LIMIT 30`)
        ]);
      return {
        totals: totals.rows[0], reason: byReason.rows, verdict: byVerdict.rows,
        ai: byAi.rows, gemma: byGemma.rows, finding: byFinding.rows,
        day: byDay.rows, keyword: byKeyword.rows, version: byVersion.rows,
        findingByGemma: findingByGemma.rows, findingByKeyword: findingByKeyword.rows,
        findingByVersion: findingByVersion.rows
      };
    }
  };
}
