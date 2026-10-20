ALTER TABLE reports ADD COLUMN IF NOT EXISTS client_report_id uuid;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS final_verdict varchar(16);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS rule_verdict varchar(16);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS processing_state varchar(32);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS ai_status varchar(32);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS gemma_confidence varchar(16);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS model_version varchar(100);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS sms_text text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS message_sharing_consent boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS reports_client_report_id_idx
    ON reports (client_report_id) WHERE client_report_id IS NOT NULL;
