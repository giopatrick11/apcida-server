export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

const show = (value) => value === null || value === undefined || value === ''
  ? '<span class="muted">Unknown</span>' : escapeHtml(value);
const date = (value) => value ? escapeHtml(new Date(value).toLocaleString('en-PH', {
  timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short'
})) + ' PHT' : 'Unknown';
const qs = (value) => new URLSearchParams(value).toString();

export function page(title, content, session) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} · ApCiDa</title><style>
  :root{font-family:system-ui,sans-serif;color:#17243b;background:#f3f6fa}*{box-sizing:border-box}body{margin:0}
  header{background:#102a43;color:white;padding:18px max(20px,calc((100vw - 1200px)/2))}header a{color:white;text-decoration:none;font-weight:700}
  main{max-width:1200px;margin:28px auto;padding:0 20px}h1{margin:0 0 18px}h2{font-size:1.15rem;margin:26px 0 10px}
  .panel,.card{background:white;border:1px solid #d9e1ea;border-radius:10px;padding:20px;margin-bottom:18px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:12px}.card{margin:0}.number{font-size:2rem;font-weight:700}
  label{display:block;font-weight:600;margin-bottom:6px}input,select,textarea{font:inherit;width:100%;padding:9px;border:1px solid #98aabc;border-radius:6px;background:white}
  textarea{min-height:100px}.fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
  button,.button{font:inherit;background:#135b92;color:white;border:0;border-radius:6px;padding:10px 16px;cursor:pointer;text-decoration:none;display:inline-block}
  button:hover,.button:hover{background:#0c416d}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #e2e8ef}
  .scroll{overflow-x:auto}.muted{color:#607285}.small{font-size:.87rem}.error{color:#9d1c1c}.row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
  .facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}.facts div{border-bottom:1px solid #e2e8ef;padding:8px 0}
  .facts strong{display:block;font-size:.82rem;color:#607285;text-transform:uppercase;letter-spacing:.03em}
  pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f6fa;padding:12px;border-radius:6px}details{margin-top:12px}
  .warn{border-left:4px solid #ba5b12;padding:12px;background:#fff6e8}a{color:#135b92}
  </style></head><body><header><div class="row"><a href="/admin">ApCiDa · Research admin</a>${session ? `<nav class="row"><a href="/admin">Reports</a><a href="/admin/community">Community messages</a></nav><form method="post" action="/admin/logout"><input type="hidden" name="_csrf" value="${escapeHtml(session.csrf)}"><button>Sign out</button></form>` : ''}</div></header><main>${content}</main></body></html>`;
}

export function loginPage(error = '') {
  return page('Admin sign in', `<div class="panel" style="max-width:420px;margin:55px auto"><h1>Admin sign in</h1>${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}<form method="post" action="/admin/login"><p><label for="username">Username</label><input id="username" name="username" autocomplete="username" required></p><p><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></p><button>Sign in</button></form></div>`, null);
}

function breakdown(title, rows) {
  return `<section class="panel"><h2>${escapeHtml(title)}</h2><div class="scroll"><table><thead><tr><th>Value</th><th>Reports</th></tr></thead><tbody>${rows.length ? rows.map((row) => `<tr><td>${show(row.label)}</td><td>${escapeHtml(row.count)}</td></tr>`).join('') : '<tr><td colspan="2" class="muted">No data yet</td></tr>'}</tbody></table></div></section>`;
}

function confirmedBreakdown(title, rows) {
  return `<section class="panel"><h2>${escapeHtml(title)}</h2><div class="scroll"><table><thead><tr><th>Group</th><th>Confirmed finding</th><th>Reports</th></tr></thead><tbody>${rows.length ? rows.map((row) => `<tr><td>${show(row.group_label)}</td><td>${show(row.finding)}</td><td>${escapeHtml(row.count)}</td></tr>`).join('') : '<tr><td colspan="3" class="muted">No resolved reports yet</td></tr>'}</tbody></table></div></section>`;
}

export function overviewPage(summary, listed, query, session) {
  const t = summary.totals;
  const stat = (label, value) => `<div class="card"><div class="muted">${label}</div><div class="number">${escapeHtml(value)}</div></div>`;
  const fields = [
    ['reason', 'User reason', summary.reason.map((r) => r.label)],
    ['verdict', 'Final verdict', summary.verdict.map((r) => r.label).filter((v) => v !== 'Legacy / unknown')],
    ['ai', 'AI status', summary.ai.map((r) => r.label).filter((v) => v !== 'Legacy / unknown')],
    ['status', 'Review status', ['NEW', 'IN_REVIEW', 'RESOLVED']]
  ];
  const select = (name, label, options) => `<div><label for="${name}">${label}</label><select id="${name}" name="${name}"><option value="">All</option>${options.map((option) => `<option value="${escapeHtml(option)}"${query[name] === option ? ' selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></div>`;
  const rows = listed.rows.map((r) => `<tr><td><a href="/admin/reports/${escapeHtml(r.report_id)}">${date(r.received_at)}</a><br><span class="small muted">${escapeHtml(r.report_id)}</span></td><td>${show(r.report_type)}</td><td>${show(r.final_verdict)}<br><span class="small muted">Rule: ${show(r.rule_verdict)}</span></td><td>${show(r.ai_status)}<br><span class="small muted">Gemma: ${show(r.gemma_classification)}</span></td><td>${show(r.review_status)}${r.finding ? `<br><span class="small">${show(r.finding)}</span>` : ''}</td></tr>`).join('');
  const base = Object.fromEntries(Object.entries(query).filter(([key, value]) => key !== 'page' && value));
  const nav = `<div class="row"><span>Page ${listed.page} · ${listed.total} matching reports</span><span>${listed.page > 1 ? `<a href="/admin?${qs({ ...base, page: listed.page - 1 })}">Previous</a>` : ''} ${listed.page * listed.limit < listed.total ? `<a href="/admin?${qs({ ...base, page: listed.page + 1 })}">Next</a>` : ''}</span></div>`;
  return page('Reports', `<h1>Reports</h1><p class="muted">User reports are feedback. Confirmed findings come from reviewer decisions; these counts are not detector accuracy rates.</p>
    <div class="grid">${stat('Reports received', t.reports)}${stat('In review', t.in_review)}${stat('Resolved', t.resolved)}${stat('SMS texts shared', t.shared_sms)}</div>
    <h2>Find reports</h2><div class="panel"><form method="get" action="/admin"><div class="fields">${fields.map(([name, label, options]) => select(name, label, options)).join('')}<div><label for="from">Received from (PHT)</label><input id="from" name="from" type="date" value="${escapeHtml(query.from ?? '')}"></div><div><label for="to">Received through (PHT)</label><input id="to" name="to" type="date" value="${escapeHtml(query.to ?? '')}"></div></div><p><button>Apply filters</button> <a href="/admin">Clear</a></p></form></div>
    <div class="panel"><div class="row"><h2>Report list</h2>${nav}</div><div class="scroll"><table><thead><tr><th>Received (PHT)</th><th>User reason</th><th>Scan verdicts</th><th>AI</th><th>Review</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">No reports match these filters.</td></tr>'}</tbody></table></div>${nav}</div>
    <h2>Patterns in received reports</h2><div class="grid">${breakdown('User reasons', summary.reason)}${breakdown('Final verdicts', summary.verdict)}${breakdown('AI status', summary.ai)}${breakdown('Gemma classification', summary.gemma)}${breakdown('Confirmed findings', summary.finding)}${breakdown('Matched indicators', summary.keyword)}${breakdown('App and model versions', summary.version)}${breakdown('Received by day (last 30 days, PHT)', summary.day)}</div>
    <h2>Confirmed findings by scan context</h2><p class="muted">Only resolved reviewer decisions appear here. Multiple indicators can belong to one report.</p><div class="grid">${confirmedBreakdown('Gemma classification', summary.findingByGemma)}${confirmedBreakdown('Matched indicator', summary.findingByKeyword)}${confirmedBreakdown('App and model version', summary.findingByVersion)}</div>`, session);
}

export function detailPage(report, history, session, error = '') {
  const fact = (label, value) => `<div><strong>${escapeHtml(label)}</strong>${show(value)}</div>`;
  const keywords = Array.isArray(report.detected_keywords) ? report.detected_keywords.join(', ') : '';
  const radio = (name, values, current) => `<select name="${name}">${values.map(([value, label]) => `<option value="${value}"${current === value ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
  return page('Report detail', `<p><a href="/admin">← All reports</a></p><h1>Report detail</h1><p class="small muted">Report ID: ${escapeHtml(report.report_id)} · Client ID: ${show(report.client_report_id)}</p>
    <section class="panel"><h2>User feedback</h2><div class="facts">${fact('Reason', report.report_type)}${fact('Reported', date(report.reported_at))}${fact('Received', date(report.received_at))}${fact('App version', report.app_version)}${fact('Model version', report.model_version)}</div><h3>Remarks</h3><pre>${show(report.remarks)}</pre></section>
    <section class="panel"><h2>Saved scan snapshot</h2><div class="facts">${fact('Final verdict', report.final_verdict)}${fact('Rule verdict', report.rule_verdict)}${fact('Risk score', report.risk_score)}${fact('Processing state', report.processing_state)}${fact('AI status', report.ai_status)}${fact('Gemma classification', report.gemma_classification)}${fact('Gemma confidence', report.gemma_confidence)}${fact('Matched indicators', keywords)}</div><h3>Gemma rationale</h3><pre>${show(report.gemma_rationale)}</pre></section>
    <section class="panel"><h2>Shared SMS text</h2>${report.sms_text !== null && report.message_sharing_consent ? `<p class="warn">This text may contain personal details. The user explicitly chose to share it for review.</p><details><summary>Reveal SMS text</summary><pre>${escapeHtml(report.sms_text)}</pre></details>` : '<p class="muted">The user did not share SMS text.</p>'}</section>
    <section class="panel"><h2>Reviewer decision</h2><p>Current status: <strong>${show(report.review_status)}</strong>${report.confirmed_label ? ` · Confirmed label: <strong>${show(report.confirmed_label)}</strong>` : ''}${report.finding ? ` · Finding: <strong>${show(report.finding)}</strong>` : ''}</p><p class="small muted">For In review, leave label and finding blank. For Resolved, choose both.</p>${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      <form method="post" action="/admin/reports/${escapeHtml(report.report_id)}/review"><input type="hidden" name="_csrf" value="${escapeHtml(session.csrf)}"><div class="fields"><div><label>Status</label>${radio('status', [['IN_REVIEW','In review'],['RESOLVED','Resolved']], report.review_status)}</div><div><label>Confirmed label</label>${radio('label', [['','Choose a label'],['SCAM','Scam'],['LEGITIMATE','Legitimate'],['UNCERTAIN','Uncertain']], report.confirmed_label)}</div><div><label>Finding</label>${radio('finding', [['','Choose a finding'],['MISSED_SCAM','Missed scam'],['FALSE_ALERT','False alert'],['ANALYSIS_FAILURE','Analysis failure'],['INCONCLUSIVE','Inconclusive'],['OTHER','Other']], report.finding)}</div></div><p><label for="notes">Reviewer notes</label><textarea id="notes" name="notes" maxlength="4000">${escapeHtml(report.review_notes ?? '')}</textarea></p><button>Save decision</button></form></section>
    <section class="panel"><h2>Review history</h2>${history.length ? `<div class="scroll"><table><thead><tr><th>When</th><th>Status</th><th>Label</th><th>Finding</th><th>Notes</th></tr></thead><tbody>${history.map((h) => `<tr><td>${date(h.reviewed_at)}</td><td>${show(h.review_status)}</td><td>${show(h.confirmed_label)}</td><td>${show(h.finding)}</td><td>${show(h.notes)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No review decisions yet.</p>'}</section>`, session);
}
