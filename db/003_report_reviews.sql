CREATE TABLE IF NOT EXISTS report_reviews (
    review_id uuid PRIMARY KEY,
    report_id uuid NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
    review_status varchar(16) NOT NULL CHECK (review_status IN ('IN_REVIEW', 'RESOLVED')),
    confirmed_label varchar(16) CHECK (confirmed_label IN ('SCAM', 'LEGITIMATE', 'UNCERTAIN')),
    finding varchar(32) CHECK (finding IN ('MISSED_SCAM', 'FALSE_ALERT', 'ANALYSIS_FAILURE', 'INCONCLUSIVE', 'OTHER')),
    notes text,
    reviewed_by varchar(100) NOT NULL,
    reviewed_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT review_fields_match_status CHECK (
      (review_status = 'IN_REVIEW' AND confirmed_label IS NULL AND finding IS NULL) OR
      (review_status = 'RESOLVED' AND confirmed_label IS NOT NULL AND finding IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS report_reviews_latest_idx ON report_reviews (report_id, reviewed_at DESC, review_id DESC);
CREATE INDEX IF NOT EXISTS reports_reported_at_idx ON reports (reported_at DESC);
CREATE INDEX IF NOT EXISTS reports_report_type_idx ON reports (report_type);
CREATE INDEX IF NOT EXISTS reports_final_verdict_idx ON reports (final_verdict);
CREATE INDEX IF NOT EXISTS reports_ai_status_idx ON reports (ai_status);
