import { randomUUID } from 'node:crypto';

const latestReview = `LEFT JOIN LATERAL (
  SELECT verification_status, verified_label, notes, reviewed_by, reviewed_at
  FROM community_reviews WHERE message_id = m.message_id
  ORDER BY reviewed_at DESC, review_id DESC LIMIT 1
) v ON true`;

export function createCommunityAdminRepository(pool) {
  return {
    async summary() {
      const [totals, byDay, matrix, rejections] = await Promise.all([
        pool.query(`SELECT
          count(*)::int AS accepted,
          count(*) FILTER (WHERE m.reviewed_category = 'SCAM')::int AS reviewed_scam,
          count(*) FILTER (WHERE m.reviewed_category = 'SAFE')::int AS reviewed_safe,
          count(*) FILTER (WHERE v.verification_status IS NULL)::int AS pending,
          count(*) FILTER (WHERE v.verification_status = 'EXCLUDED')::int AS excluded,
          count(*) FILTER (WHERE v.verified_label = 'SCAM')::int AS verified_scam,
          count(*) FILTER (WHERE v.verified_label = 'SAFE')::int AS verified_safe,
          count(DISTINCT m.participant_id)::int AS participants
          FROM community_messages m ${latestReview}`),
        pool.query(`SELECT to_char(received_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS day,
          reviewed_category AS category, count(*)::int AS count
          FROM community_messages WHERE received_at >= now() - interval '30 days'
          GROUP BY 1, 2 ORDER BY 1 DESC, 2`),
        pool.query(`SELECT m.predicted_category, m.reviewed_category, v.verified_label,
          count(*)::int AS count FROM community_messages m ${latestReview}
          WHERE v.verification_status = 'VERIFIED'
          GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`),
        pool.query(`SELECT reason, count(*)::int AS count FROM community_decisions
          WHERE outcome = 'REJECTED' GROUP BY reason ORDER BY count DESC`)
      ]);
      return { totals: totals.rows[0], byDay: byDay.rows,
        matrix: matrix.rows, rejections: rejections.rows };
    },

    async list({ category = '', verification = '', page = 1 } = {}) {
      const where = [];
      const values = [];
      if (category) { values.push(category); where.push(`m.reviewed_category = $${values.length}`); }
      if (verification) {
        where.push(verification === 'PENDING' ? 'v.verification_status IS NULL' :
          `v.verification_status = $${values.push(verification)}`);
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = await pool.query(`SELECT count(*)::int AS total FROM community_messages m
        ${latestReview} ${clause}`, values);
      const limit = 25;
      const rows = await pool.query(`SELECT m.message_id, m.received_at, m.predicted_category,
        m.reviewed_category, v.verification_status, v.verified_label
        FROM community_messages m ${latestReview} ${clause}
        ORDER BY m.received_at DESC, m.message_id DESC
        LIMIT ${limit} OFFSET $${values.length + 1}`, [...values, (page - 1) * limit]);
      return { rows: rows.rows, total: total.rows[0].total, page, limit };
    },

    async get(id) {
      const result = await pool.query(`SELECT m.*, v.verification_status,
        v.verified_label, v.notes, v.reviewed_by, v.reviewed_at AS verified_at
        FROM community_messages m ${latestReview} WHERE m.message_id = $1`, [id]);
      return result.rows[0] ?? null;
    },

    async history(id) {
      const result = await pool.query(`SELECT verification_status, verified_label,
        notes, reviewed_by, reviewed_at FROM community_reviews
        WHERE message_id = $1 ORDER BY reviewed_at DESC, review_id DESC`, [id]);
      return result.rows;
    },

    async review(id, decision, reviewer) {
      const result = await pool.query(`INSERT INTO community_reviews
        (review_id, message_id, verification_status, verified_label, notes, reviewed_by)
        SELECT $1, message_id, $3, $4, $5, $6 FROM community_messages
        WHERE message_id = $2 RETURNING review_id`,
      [randomUUID(), id, decision.status, decision.label, decision.notes, reviewer]);
      return result.rows.length > 0;
    },

    async exportRows() {
      const result = await pool.query(`SELECT m.message_id, m.received_at,
        m.predicted_category, m.reviewed_category, v.verification_status,
        v.verified_label FROM community_messages m ${latestReview}
        ORDER BY m.received_at, m.message_id`);
      return result.rows;
    }
  };
}
