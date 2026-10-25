import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { migrate } from '../src/migrate.js';
import { createCommunityRepository } from '../src/community-repository.js';
import { createCommunityAdminRepository } from '../src/community-admin-repository.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');

test('community submissions are idempotent and verification counts are independent',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const participantId = randomUUID();
    const otherId = randomUUID();
    const batchId = randomUUID();
    const now = Date.now();
    const item = { clientId: hash(randomUUID()),
      text: `Account notice ${randomUUID().replace(/[0-9-]/g, 'x')}`,
      predictedCategory: 'SAFE', reviewedCategory: 'SCAM', reviewedAt: now };
    const batch = { batchId, participantId, submittedAt: now, items: [item] };
    try {
      await migrate(pool);
      const repository = createCommunityRepository(pool);
      const admin = createCommunityAdminRepository(pool);
      const first = await repository.submit(batch);
      assert.deepEqual(first, { acceptedClientIds: [item.clientId], rejectedClientIds: [],
        progress: { scamAccepted: 1, safeAccepted: 0 } });
      assert.deepEqual(await repository.submit(batch), first);
      assert.deepEqual(await repository.progress(participantId), first.progress);
      const uniqueWord = randomUUID().replace(/[0-9-]/g, 'x');
      const additional = (category, count) => Array.from({ length: count }, (_, index) => ({
        clientId: hash(randomUUID()), text: `Account notice ${uniqueWord} item ${index} ${category}`,
        predictedCategory: category, reviewedCategory: category, reviewedAt: now
      }));
      const scamLimit = await repository.submit({ batchId: randomUUID(), participantId,
        submittedAt: now, items: additional('SCAM', 20) });
      assert.equal(scamLimit.acceptedClientIds.length, 19);
      assert.equal(scamLimit.rejectedClientIds.length, 1);
      assert.equal(scamLimit.progress.scamAccepted, 20);
      const safeLimit = await repository.submit({ batchId: randomUUID(), participantId,
        submittedAt: now, items: additional('SAFE', 21) });
      assert.equal(safeLimit.acceptedClientIds.length, 20);
      assert.equal(safeLimit.rejectedClientIds.length, 1);
      assert.deepEqual(safeLimit.progress, { scamAccepted: 20, safeAccepted: 20 });
      const duplicate = await repository.submit({ batchId: randomUUID(),
        participantId: otherId, submittedAt: now,
        items: [{ ...item, clientId: hash(randomUUID()) }] });
      assert.equal(duplicate.rejectedClientIds.length, 1);
      assert.deepEqual(duplicate.progress, { scamAccepted: 0, safeAccepted: 0 });
      const saved = await pool.query(`SELECT message_id FROM community_messages
        WHERE participant_id = $1 AND client_id = $2`, [participantId, item.clientId]);
      const listed = await admin.list({ category: 'SCAM' });
      assert.ok(listed.rows.length > 0);
      assert.ok(listed.rows.every((entry) => !Object.hasOwn(entry, 'message_text')));
      const detail = await admin.get(saved.rows[0].message_id);
      assert.equal(detail.message_text, item.text);
      const exported = await admin.exportRows();
      assert.equal(exported.find((entry) => entry.message_id === saved.rows[0].message_id)
        ?.message_text, item.text);
      assert.equal(await admin.review(saved.rows[0].message_id, { status: 'VERIFIED',
        label: 'SAFE', notes: 'Independent review' }, 'tester'), true);
      const reviewed = await admin.get(saved.rows[0].message_id);
      assert.equal(reviewed.verified_label, 'SAFE');
      const summary = await admin.summary();
      assert.ok(summary.totals.verified_safe >= 1);
      assert.ok(summary.matrix.some((entry) => entry.predicted_category === 'SAFE' &&
        entry.reviewed_category === 'SCAM' && entry.verified_label === 'SAFE'));
    } finally {
      await pool.query(`DELETE FROM community_reviews WHERE message_id IN
        (SELECT message_id FROM community_messages WHERE participant_id IN ($1, $2))`,
      [participantId, otherId]);
      await pool.query('DELETE FROM community_messages WHERE participant_id IN ($1, $2)',
        [participantId, otherId]);
      await pool.query('DELETE FROM community_decisions WHERE participant_id IN ($1, $2)',
        [participantId, otherId]);
      await pool.query('DELETE FROM community_batches WHERE participant_id IN ($1, $2)',
        [participantId, otherId]);
      await pool.query('DELETE FROM community_participants WHERE participant_id IN ($1, $2)',
        [participantId, otherId]);
      await pool.end();
    }
  });
