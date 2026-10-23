CREATE TABLE IF NOT EXISTS community_participants (
    participant_id uuid PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS community_batches (
    batch_id uuid PRIMARY KEY,
    participant_id uuid NOT NULL REFERENCES community_participants(participant_id),
    submitted_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS community_messages (
    message_id uuid PRIMARY KEY,
    participant_id uuid NOT NULL REFERENCES community_participants(participant_id),
    batch_id uuid NOT NULL REFERENCES community_batches(batch_id),
    client_id char(64) NOT NULL,
    content_digest char(64) NOT NULL UNIQUE,
    message_text text NOT NULL,
    predicted_category varchar(4) NOT NULL CHECK (predicted_category IN ('SCAM', 'SAFE')),
    reviewed_category varchar(4) NOT NULL CHECK (reviewed_category IN ('SCAM', 'SAFE')),
    reviewed_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (participant_id, client_id),
    CHECK (length(message_text) BETWEEN 1 AND 4000)
);

CREATE INDEX IF NOT EXISTS community_messages_received_idx ON community_messages (received_at DESC);
CREATE INDEX IF NOT EXISTS community_messages_participant_category_idx
    ON community_messages (participant_id, reviewed_category);

CREATE TABLE IF NOT EXISTS community_decisions (
    participant_id uuid NOT NULL REFERENCES community_participants(participant_id),
    client_id char(64) NOT NULL,
    batch_id uuid NOT NULL REFERENCES community_batches(batch_id),
    outcome varchar(8) NOT NULL CHECK (outcome IN ('ACCEPTED', 'REJECTED')),
    reason varchar(32),
    decided_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (participant_id, client_id)
);

CREATE TABLE IF NOT EXISTS community_reviews (
    review_id uuid PRIMARY KEY,
    message_id uuid NOT NULL REFERENCES community_messages(message_id) ON DELETE CASCADE,
    verification_status varchar(8) NOT NULL CHECK (verification_status IN ('VERIFIED', 'EXCLUDED')),
    verified_label varchar(4) CHECK (verified_label IN ('SCAM', 'SAFE')),
    notes text,
    reviewed_by varchar(100) NOT NULL,
    reviewed_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((verification_status = 'VERIFIED' AND verified_label IS NOT NULL) OR
           (verification_status = 'EXCLUDED' AND verified_label IS NULL))
);

CREATE INDEX IF NOT EXISTS community_reviews_latest_idx
    ON community_reviews (message_id, reviewed_at DESC, review_id DESC);
