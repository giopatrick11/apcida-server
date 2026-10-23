import { createHash, randomUUID } from 'node:crypto';
import { contentRejection, normalizedText } from './community-validation.js';

const digest = (value) => createHash('sha256').update(value).digest('hex');

async function counts(client, participantId) {
  const result = await client.query(`
    SELECT count(*) FILTER (WHERE reviewed_category = 'SCAM')::int AS "scamAccepted",
           count(*) FILTER (WHERE reviewed_category = 'SAFE')::int AS "safeAccepted"
    FROM community_messages WHERE participant_id = $1`, [participantId]);
  return result.rows[0];
}

export function createCommunityRepository(pool) {
  return {
    async progress(participantId) {
      return counts(pool, participantId);
    },

    async submit(batch) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`INSERT INTO community_participants (participant_id)
          VALUES ($1) ON CONFLICT DO NOTHING`, [batch.participantId]);
        // Serializes submissions for one participant, including quota checks.
        await client.query(`SELECT participant_id FROM community_participants
          WHERE participant_id = $1 FOR UPDATE`, [batch.participantId]);
        await client.query(`INSERT INTO community_batches (batch_id, participant_id, submitted_at)
          VALUES ($1, $2, to_timestamp($3::double precision / 1000))
          ON CONFLICT DO NOTHING`, [batch.batchId, batch.participantId, batch.submittedAt]);
        const owner = await client.query(`SELECT participant_id FROM community_batches
          WHERE batch_id = $1`, [batch.batchId]);
        if (owner.rows[0]?.participant_id !== batch.participantId) {
          const error = new Error('Batch ID belongs to another participant');
          error.code = 'COMMUNITY_BATCH_CONFLICT';
          throw error;
        }

        const acceptedClientIds = [];
        const rejectedClientIds = [];
        const totals = await counts(client, batch.participantId);
        for (const item of batch.items) {
          const clientId = item.clientId.toLowerCase();
          const previous = await client.query(`SELECT outcome FROM community_decisions
            WHERE participant_id = $1 AND client_id = $2`, [batch.participantId, clientId]);
          if (previous.rows.length) {
            (previous.rows[0].outcome === 'ACCEPTED' ? acceptedClientIds : rejectedClientIds)
              .push(item.clientId);
            continue;
          }

          const category = item.reviewedCategory;
          let reason = contentRejection(item.text);
          if (!reason && (totals.scamAccepted + totals.safeAccepted >= 40 ||
              (category === 'SCAM' ? totals.scamAccepted : totals.safeAccepted) >= 20)) {
            reason = 'QUOTA_REACHED';
          }
          if (!reason) {
            const inserted = await client.query(`
              INSERT INTO community_messages
                (message_id, participant_id, batch_id, client_id, content_digest,
                 message_text, predicted_category, reviewed_category, reviewed_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                to_timestamp($9::double precision / 1000))
              ON CONFLICT (content_digest) DO NOTHING RETURNING message_id`,
            [randomUUID(), batch.participantId, batch.batchId, clientId,
              digest(normalizedText(item.text)), item.text.trim(), item.predictedCategory,
              category, item.reviewedAt]);
            if (!inserted.rows.length) reason = 'DUPLICATE_TEXT';
          }
          await client.query(`INSERT INTO community_decisions
            (participant_id, client_id, batch_id, outcome, reason)
            VALUES ($1, $2, $3, $4, $5)`,
          [batch.participantId, clientId, batch.batchId,
            reason ? 'REJECTED' : 'ACCEPTED', reason]);
          if (reason) rejectedClientIds.push(item.clientId);
          else {
            acceptedClientIds.push(item.clientId);
            if (category === 'SCAM') totals.scamAccepted++;
            else totals.safeAccepted++;
          }
        }
        await client.query('COMMIT');
        return { acceptedClientIds, rejectedClientIds, progress: totals };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  };
}
