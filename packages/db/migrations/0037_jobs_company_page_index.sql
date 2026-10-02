-- Company-scoped Job history joins through article_id. Historical rows are untouched.
CREATE INDEX IF NOT EXISTS idx_publish_jobs_article_page
  ON publish_jobs(article_id, scheduled_at DESC, id DESC);
