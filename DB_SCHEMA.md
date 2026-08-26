# 数据库设计（建议）

## brands
- id
- name
- company_name
- description
- main_business
- service_regions_json
- advantages_json
- contact_json
- ai_forbidden_claims_json
- created_at
- updated_at

## brand_assets
- id
- brand_id
- type
- title
- file_path
- metadata_json
- created_at

## keyword_templates
- id
- brand_id
- template
- category
- enabled

## keyword_items
- id
- brand_id
- city
- keyword
- source_template_id
- status
- created_at

## articles
- id
- brand_id
- topic
- city
- title
- body
- summary
- tags_json
- seo_keywords_json
- cover_asset_id
- content_hash
- ai_provider
- ai_model
- status
- reuse_policy
- generated_at
- created_at
- updated_at

## article_variants
- id
- article_id
- platform_key
- title
- body
- summary
- cover_asset_id
- content_hash
- created_at

## platforms
- id
- platform_key
- display_name
- adapter_version
- enabled
- capabilities_json
- research_status
- health_status
- last_verified_at

## accounts
- id
- platform_key
- name
- group_id
- encrypted_session_path
- login_status
- enabled
- paused_reason
- last_login_check_at
- last_publish_at
- created_at
- updated_at
- allow_auto_publish
- minimum_interval_seconds
- failed_count

## account_groups
- id
- name
- description

## publish_plans
- id
- name
- brand_id
- enabled
- strategy
- articles_per_day
- time_rules_json
- account_scope_json
- reuse_policy
- min_interval_seconds
- start_date
- end_date

## publish_jobs
- id
- plan_id
- account_id
- platform_key
- article_id
- article_variant_id
- scheduled_at
- status
- attempt_count
- max_attempts
- next_retry_at
- last_error_code
- last_error_message
- started_at
- finished_at
- created_at
- dry_run
- manual_confirmation_required
- confirmed_at

## publish_records
- id
- job_id
- account_id
- platform_key
- article_id
- published_url
- published_external_id
- success
- response_json
- published_at
- dry_run

## ai_tasks
- id
- brand_id
- type
- input_json
- output_json
- provider
- model
- status
- cost_json
- created_at
- finished_at
- usage_json
- duration_ms

## platform_profiles / platform_health

平台能力 profile、官方来源、最后核验时间和运行健康状态，与平台 Adapter 解耦保存。

## account_sessions

只保存安全存储引用，不保存明文 Cookie 或 StorageState。

## image_tasks / notifications

分别记录图片生成耗时/状态和需要人工处理的登录、发布、AI 失败通知。

## app_logs
- id
- level
- module
- code
- message
- context_json
- created_at

## migrations
必须使用正式 migration 工具，不允许在生产中用“启动时自动重建数据库”。V0.2 变更位于 `packages/db/migrations/0001_v02_ai_platform.sql`。
