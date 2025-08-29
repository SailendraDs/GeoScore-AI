# GeoScore AI Database Migrations

This directory contains the complete database schema for the GeoScore AI backend system. The migrations are numbered sequentially and should be run in order.

## Migration Files Overview

### 20240101000001_create_extensions.sql
**Purpose**: Foundation setup with PostgreSQL extensions and custom types
**Contents**:
- Enables required extensions: uuid-ossp, pgvector, pgcrypto, pg_stat_statements
- Creates custom ENUM types: job_status, job_type, user_role, api_key_status, service_type
- Sets up the foundational data types used throughout the system

### 20240101000002_create_users_and_brands.sql
**Purpose**: Core user management and brand entities
**Contents**:
- `users` table: Extended user profiles with roles (brand_user, admin)
- `brands` table: Brand entities with domain, competitors, metadata
- `brand_setup_state` table: Onboarding completion tracking
- `brand_prompts` table: Custom prompts for AI analysis
- Includes RLS-ready structure and audit triggers

### 20240101000003_create_jobs_system.sql
**Purpose**: Job queue system for pipeline workflow management
**Contents**:
- `jobs` table: Core job queue with status, payload, retry logic
- `job_logs` table: Structured logging for job lifecycle events
- `job_dependencies` table: Job dependency management
- Helper functions: get_next_job(), log_job_event(), create_job_with_deps()
- Supports the complete pipeline: brand_onboard → crawl → normalize → embed → sample → score → assemble_report

### 20240101000004_create_content_tables.sql
**Purpose**: Content storage and processing tables
**Contents**:
- `raw_pages` table: S3 pointers, content_hash, fetch_time, status_code, canonical, html_s3
- `claims` table: Extracted claims with text, evidence[], sourceUrl, confidence
- `embeddings` table: pgvector integration with 1536-dimension vectors for semantic search
- `normalized_content` table: Processed content with JSON-LD and metadata
- Vector similarity search functions

### 20240101000005_create_llm_tables.sql
**Purpose**: LLM orchestration and results management
**Contents**:
- `llm_results` table: Individual model responses with tokens/cost metadata
- `llm_reports` table: Per-model visibility scores and analysis
- `prompt_tracking` table: Prompt performance across models
- `competitor_scores` table: Competitive positioning data
- `model_configs` table: LLM model configuration and pricing
- Cost calculation and performance tracking functions

### 20240101000006_create_scoring_tables.sql
**Purpose**: Scoring engine and report generation
**Contents**:
- `scores` table: Scoring engine results with breakdown JSON
- `reports` table: Assembled JSON metadata + pdf_s3_path, status
- `score_components` table: Individual component scores (presence, accuracy, salience, etc.)
- `report_sections` table: Modular report building
- `score_history` table: Time-series score tracking
- Score trend analysis and percentile ranking functions

### 20240101000007_create_admin_tables.sql
**Purpose**: Admin and API management system
**Contents**:
- `api_services` table: LLM and connector service configurations
- `api_keys` table: Multi-key management with rotation
- `api_key_usage` table: Billing attribution per brand/service
- `plans` table: Billing tiers and feature limits
- `user_plans` table: User subscription states
- `alerts` table: Admin alerts and acknowledgements
- `api_key_rotations` table: Audit trail for key management
- Alert management and API key rotation functions

### 20240101000008_create_rls_policies.sql
**Purpose**: Row Level Security for multi-tenant isolation
**Contents**:
- Comprehensive RLS policies for all tables
- Helper functions: get_current_user_role(), user_owns_brand(), is_admin()
- Proper data isolation between brands and users
- Admin access controls for system management
- Service role permissions for backend operations

### 20240101000009_create_sample_data.sql
**Purpose**: Sample data for testing and development
**Contents**:
- Sample API services (OpenAI, Anthropic, SerpAPI)
- Model configurations with pricing
- Billing plans (free, standard, premium)
- Test users (admin and brand user)
- Complete sample dataset demonstrating the full pipeline
- Realistic test data for all table relationships

### 20240101000010_create_indexes_and_performance.sql
**Purpose**: Performance optimization and monitoring
**Contents**:
- Composite indexes for common query patterns
- Vector similarity indexes with different distance metrics
- Covering indexes to avoid table lookups
- Statistics targets for query planner optimization
- Materialized views for dashboard performance
- Performance monitoring functions and views

## Key Features Implemented

### Job Pipeline Support
- Complete workflow: brand_onboard → crawl → normalize → embed → sample → score → assemble_report
- Job dependencies and priority queuing
- Retry logic with exponential backoff
- Comprehensive logging and error tracking

### Multi-Tenant Security
- Row Level Security (RLS) policies on all tables
- Proper data isolation between brands
- Role-based access control (brand_user, admin, super_admin)
- Audit trails for sensitive operations

### LLM Integration
- Multi-model support (GPT, Claude, Gemini, etc.)
- Cost tracking per request and token usage
- Performance metrics and prompt optimization
- Automatic failover and error handling

### Semantic Search
- pgvector integration with optimized indexes
- Multiple distance metrics (cosine, L2, inner product)
- Efficient similarity search across content types
- Embedding model management

### Billing & Usage Tracking
- Per-brand API usage attribution
- Multi-tier plans with feature limits
- Razorpay integration ready
- Real-time cost monitoring and alerts

### Admin Management
- API key rotation and health monitoring
- System alerts with severity levels
- Usage analytics and reporting
- Multi-service connector management

## Database Size Estimates

Based on typical usage patterns:

- **Small installation** (< 100 brands): ~1GB
- **Medium installation** (100-1000 brands): ~10GB  
- **Large installation** (1000+ brands): ~100GB+

The largest tables will be:
1. `embeddings` (vector data)
2. `raw_pages` (content references)
3. `llm_results` (AI responses)
4. `job_logs` (operational data)

## Performance Considerations

- All tables have appropriate indexes for common query patterns
- Materialized views for dashboard performance
- Vector indexes optimized for similarity search
- Partitioning preparation for time-series data
- Connection pooling optimization hints

## Migration Execution

Run migrations in order using Supabase CLI:

```bash
supabase db reset  # Reset to clean state
# Or apply migrations individually:
psql -f 20240101000001_create_extensions.sql
psql -f 20240101000002_create_users_and_brands.sql
# ... and so on
```

## Testing

The sample data migration includes:
- Complete test dataset with realistic relationships
- Sample job pipeline execution
- Test users with different roles
- Example reports and scores

Use the sample data to verify all functionality works end-to-end before deploying to production.