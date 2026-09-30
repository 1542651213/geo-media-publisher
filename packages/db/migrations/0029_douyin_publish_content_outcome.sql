-- Independent interpretation/quality layer. Never rewrite an existing intent or submit record.
CREATE TABLE douyin_publish_outcomes (
  job_id TEXT PRIMARY KEY REFERENCES publish_jobs(id),
  record_id TEXT NOT NULL UNIQUE REFERENCES publish_records(id),
  remote_work_id TEXT NOT NULL,
  publish_result TEXT NOT NULL CHECK (publish_result = 'PUBLISHED_CONFIRMED'),
  management_page_verified TEXT NOT NULL CHECK (management_page_verified = 'PASS'),
  public_content_verified TEXT NOT NULL CHECK (public_content_verified IN ('PASS','FAIL','LIMITED')),
  content_fidelity_warning TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Owner accepted this exact B01 work, while retaining its known literal-asterisk quality failure.
-- Existing Job/Intent/PublishRecord rows, IDs, counters and evidence remain byte-for-byte unchanged.
INSERT INTO douyin_publish_outcomes
SELECT j.id,r.id,r.published_external_id,'PUBLISHED_CONFIRMED','PASS','FAIL',
  'BODY_LINEBREAK_RENDERED_AS_LITERAL_ASTERISK',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM publish_jobs j JOIN publish_records r ON r.job_id=j.id JOIN submission_intents i ON i.job_id=j.id
WHERE j.id='ee500df1-8dd7-4cae-b047-dece77884874' AND j.platform_key='douyin' AND j.status='Success'
  AND r.id='f79087cb-b574-4c46-b22e-f6311106f54d' AND r.status='Published' AND r.success=1
  AND i.id='5f2f0c33-0f8b-4c2b-b068-78eaa88cbbcc' AND i.final_submit_count=1
  AND r.published_external_id='7691247987888016655' AND i.external_id=r.published_external_id
  AND json_extract(r.response_json,'$.finalActionCount')=1
  AND json_extract(r.response_json,'$.reconciliation.readOnly')=1
  AND json_extract(r.response_json,'$.reconciliation.matchedBy')='REMOTE_ID'
  AND json_extract(r.response_json,'$.reconciliation.remoteState')='PUBLISHED'
  AND json_extract(r.response_json,'$.reconciliation.exactRemoteIdMatch')=1
  AND json_extract(r.response_json,'$.reconciliation.managementCardCount')=1;
