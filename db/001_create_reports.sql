CREATE TABLE IF NOT EXISTS reports (
    report_id uuid PRIMARY KEY,
    payload_digest char(64) NOT NULL UNIQUE,
    report_type varchar(100) NOT NULL,
    remarks text,
    risk_score real,
    gemma_classification varchar(32),
    gemma_rationale text,
    detected_keywords jsonb NOT NULL,
    reported_at timestamptz NOT NULL,
    app_version varchar(32) NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT detected_keywords_is_array CHECK (jsonb_typeof(detected_keywords) = 'array')
);

CREATE INDEX IF NOT EXISTS reports_received_at_idx ON reports (received_at DESC);
