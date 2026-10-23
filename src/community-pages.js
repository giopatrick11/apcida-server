import { escapeHtml, page } from './admin-pages.js';

const show = (value) => value === null || value === undefined || value === ''
  ? '<span class="muted">—</span>' : escapeHtml(value);
const date = (value) => value ? escapeHtml(new Date(value).toLocaleString('en-PH', {
  timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short'
})) + ' PHT' : 'Unknown';
const qs = (value) => new URLSearchParams(value).toString();
const stat = (label, value, goal = '') => `<div class="card"><div class="muted">${escapeHtml(label)}</div><div class="number">${escapeHtml(value)}${goal ? `<span class="small muted"> / ${escapeHtml(goal)}</span>` : ''}</div></div>`;

function table(headers, rows, empty) {
  return `<div class="scroll"><table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="muted">${escapeHtml(empty)}</td></tr>`}</tbody></table></div>`;
}

export function communityOverviewPage(summary, listed, filters, session) {
  const t = summary.totals;
  const options = (name, values) => `<select name="${name}"><option value="">All</option>${values.map((value) => `<option value="${value}"${filters[name] === value ? ' selected' : ''}>${value}</option>`).join('')}</select>`;
  const rows = listed.rows.map((r) => `<tr><td><a href="/admin/community/messages/${escapeHtml(r.message_id)}">${date(r.received_at)}</a></td><td>${show(r.reviewed_category)}</td><td>${show(r.predicted_category)}</td><td>${show(r.verification_status || 'PENDING')}</td><td>${show(r.verified_label)}</td></tr>`).join('');
  const base = Object.fromEntries(Object.entries(filters).filter(([key, value]) => key !== 'page' && value));
  const nav = `<div class="row"><span>Page ${listed.page} · ${listed.total} messages</span><span>${listed.page > 1 ? `<a href="/admin/community?${qs({ ...base, page: listed.page - 1 })}">Previous</a>` : ''} ${listed.page * listed.limit < listed.total ? `<a href="/admin/community?${qs({ ...base, page: listed.page + 1 })}">Next</a>` : ''}</span></div>`;
  const matrix = summary.matrix.map((r) => `<tr><td>${show(r.predicted_category)}</td><td>${show(r.reviewed_category)}</td><td>${show(r.verified_label)}</td><td>${escapeHtml(r.count)}</td></tr>`).join('');
  const days = summary.byDay.map((r) => `<tr><td>${escapeHtml(r.day)}</td><td>${show(r.category)}</td><td>${escapeHtml(r.count)}</td></tr>`).join('');
  const rejections = summary.rejections.map((r) => `<tr><td>${show(r.reason)}</td><td>${escapeHtml(r.count)}</td></tr>`).join('');
  return page('Community analysis', `<h1>Community messages</h1><p class="muted">Participant reviewed labels and model predictions are separate from independently verified labels. The study target is 100 verified Scam and 100 verified Safe messages.</p>
    <div class="grid">${stat('Accepted Scam', t.reviewed_scam)}${stat('Accepted Safe', t.reviewed_safe)}${stat('Verified Scam', t.verified_scam, 100)}${stat('Verified Safe', t.verified_safe, 100)}${stat('Pending verification', t.pending)}${stat('Excluded after review', t.excluded)}${stat('Participants', t.participants)}${stat('Total accepted', t.accepted)}</div>
    <h2>Accumulated messages</h2><section class="panel"><form method="get" action="/admin/community"><div class="fields"><div><label>Participant reviewed category</label>${options('category', ['SCAM', 'SAFE'])}</div><div><label>Verification status</label>${options('verification', ['PENDING', 'VERIFIED', 'EXCLUDED'])}</div></div><p><button>Apply filters</button> <a href="/admin/community">Clear</a></p></form><p><a href="/admin/community/export.csv">Download label data as CSV</a> <span class="small muted">(no SMS text or participant IDs)</span></p>${nav}${table(['Received (PHT)', 'Participant reviewed', 'Model predicted', 'Researcher status', 'Verified label'], rows, 'No community messages match these filters.')}${nav}</section>
    <h2>Quantitative analysis</h2><p class="muted">Only researcher verified records appear in the label comparison. Acceptance and predictions do not establish detector accuracy.</p><div class="grid"><section class="panel"><h2>Verified label comparison</h2>${table(['Predicted', 'Participant reviewed', 'Verified', 'Messages'], matrix, 'No verified messages yet.')}</section><section class="panel"><h2>Received by day (last 30 days, PHT)</h2>${table(['Day', 'Reviewed category', 'Messages'], days, 'No recent messages.')}</section><section class="panel"><h2>Excluded at submission</h2>${table(['Reason', 'Messages'], rejections, 'No exclusions yet.')}</section></div>`, session);
}

export function communityDetailPage(message, history, session) {
  const fact = (label, value) => `<div><strong>${escapeHtml(label)}</strong>${show(value)}</div>`;
  const reviewHistory = history.map((h) => `<tr><td>${date(h.reviewed_at)}</td><td>${show(h.verification_status)}</td><td>${show(h.verified_label)}</td><td>${show(h.reviewed_by)}</td><td>${show(h.notes)}</td></tr>`).join('');
  return page('Community message', `<p><a href="/admin/community">← Community messages</a></p><h1>Community message</h1><p class="small muted">Message ID: ${escapeHtml(message.message_id)}</p>
    <section class="panel"><h2>Submitted labels</h2><div class="facts">${fact('Model predicted', message.predicted_category)}${fact('Participant reviewed', message.reviewed_category)}${fact('Received', date(message.received_at))}${fact('Participant reviewed at', date(message.reviewed_at))}${fact('Verification status', message.verification_status || 'PENDING')}${fact('Verified label', message.verified_label)}</div></section>
    <section class="panel"><h2>Shared SMS text</h2><p class="warn">The participant reviewed this text before sharing. Check it for personal details before using it in research materials.</p><details><summary>Reveal message text</summary><pre>${escapeHtml(message.message_text)}</pre></details></section>
    <section class="panel"><h2>Researcher verification</h2><p>Choose a verified category after independent review, or exclude the message from the verified set.</p><form method="post" action="/admin/community/messages/${escapeHtml(message.message_id)}/review"><input type="hidden" name="_csrf" value="${escapeHtml(session.csrf)}"><div class="fields"><div><label>Status</label><select name="status"><option value="VERIFIED">Verified</option><option value="EXCLUDED">Excluded</option></select></div><div><label>Verified label</label><select name="label"><option value="">No label</option><option value="SCAM">Scam</option><option value="SAFE">Safe</option></select></div></div><p><label for="notes">Review notes</label><textarea id="notes" name="notes" maxlength="4000"></textarea></p><button>Save review</button></form></section>
    <section class="panel"><h2>Review history</h2>${table(['When (PHT)', 'Status', 'Label', 'Reviewer', 'Notes'], reviewHistory, 'No review decisions yet.')}</section>`, session);
}
