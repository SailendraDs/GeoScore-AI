-- Additional indexes and performance optimizations
-- This migration adds specialized indexes for common query patterns and performance tuning

-- Composite indexes for common query patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_brand_status_type 
    ON jobs(brand_id, status, type) 
    WHERE status IN ('queued', 'running');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_priority_queue 
    ON jobs(priority ASC, created_at ASC) 
    WHERE status = 'queued';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_pages_brand_fetch_time 
    ON raw_pages(brand_id, fetch_time DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_claims_brand_confidence 
    ON claims(brand_id, confidence DESC) 
    WHERE is_verified = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_llm_results_brand_model_status 
    ON llm_results(brand_id, model_name, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scores_brand_type_computed 
    ON scores(brand_id, score_type, computed_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_brand_status_generated 
    ON reports(brand_id, status, generated_at DESC) 
    WHERE status = 'ready';

-- Partial indexes for performance on filtered queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_active 
    ON api_keys(service_id, last_used_at DESC) 
    WHERE status = 'active';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_plans_active 
    ON user_plans(user_id, expires_at DESC) 
    WHERE status = 'active';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_unacknowledged 
    ON alerts(severity DESC, created_at DESC) 
    WHERE is_acknowledged = false;

-- Functional indexes for text search and domain extraction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_brands_domain_extracted 
    ON brands(extract_domain(domain));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_pages_domain_extracted 
    ON raw_pages(extract_domain(url));

-- JSON indexes for metadata queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_payload_type 
    ON jobs USING GIN ((payload->>'type'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scores_breakdown 
    ON scores USING GIN (breakdown);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_json_data 
    ON reports USING GIN (json_data);

-- Time-series partitioning preparation (for future high-volume tables)
-- Note: This creates the structure but doesn't implement partitioning yet
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_logs_time_series 
    ON job_logs(created_at DESC, job_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_key_usage_time_series 
    ON api_key_usage(recorded_date DESC, api_key_id, brand_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_score_history_time_series 
    ON score_history(brand_id, recorded_at DESC);

-- Vector similarity indexes (additional configurations)
-- Create multiple HNSW indexes with different parameters for optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_embeddings_vector_l2 
    ON embeddings USING hnsw (embedding vector_l2_ops) 
    WITH (m = 16, ef_construction = 64);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_embeddings_vector_ip 
    ON embeddings USING hnsw (embedding vector_ip_ops) 
    WITH (m = 16, ef_construction = 64);

-- Covering indexes to avoid table lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_queue_covering 
    ON jobs(priority ASC, created_at ASC) 
    INCLUDE (id, brand_id, type, payload) 
    WHERE status = 'queued';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scores_latest_covering 
    ON scores(brand_id, computed_at DESC) 
    INCLUDE (id, score_type, overall_score, breakdown) 
    WHERE computed_at >= NOW() - INTERVAL '7 days';

-- Statistics targets for query planner optimization
ALTER TABLE jobs ALTER COLUMN status SET STATISTICS 1000;
ALTER TABLE jobs ALTER COLUMN type SET STATISTICS 1000;
ALTER TABLE raw_pages ALTER COLUMN status_code SET STATISTICS 500;
ALTER TABLE llm_results ALTER COLUMN model_name SET STATISTICS 500;
ALTER TABLE scores ALTER COLUMN score_type SET STATISTICS 100;

-- Custom operator classes for better text search (if needed)
-- These can be created based on specific search patterns

-- Function to analyze slow queries and suggest indexes
CREATE OR REPLACE FUNCTION analyze_query_performance()
RETURNS TABLE (
    query TEXT,
    calls BIGINT,
    total_time NUMERIC,
    avg_time NUMERIC,
    suggestion TEXT
) AS $$
BEGIN
    -- This function would analyze pg_stat_statements for optimization opportunities
    -- Implementation would be environment-specific
    RETURN QUERY
    SELECT 
        'Sample query analysis' as query,
        100::BIGINT as calls,
        1000::NUMERIC as total_time,
        10::NUMERIC as avg_time,
        'Consider adding index on frequently filtered columns' as suggestion;
END;
$$ LANGUAGE plpgsql;

-- View for monitoring index usage
CREATE OR REPLACE VIEW index_usage_stats AS
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_tup_read,
    idx_tup_fetch,
    idx_scan,
    CASE 
        WHEN idx_scan = 0 THEN 'Never used'
        WHEN idx_scan < 10 THEN 'Rarely used'
        WHEN idx_scan < 100 THEN 'Moderately used'
        ELSE 'Frequently used'
    END as usage_category
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;

-- View for monitoring table sizes and growth
CREATE OR REPLACE VIEW table_size_stats AS
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as index_size,
    n_tup_ins as inserts,
    n_tup_upd as updates,
    n_tup_del as deletes
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Function to vacuum and analyze tables based on activity
CREATE OR REPLACE FUNCTION smart_maintenance()
RETURNS VOID AS $$
DECLARE
    table_record RECORD;
BEGIN
    -- Auto-vacuum tables with high activity
    FOR table_record IN 
        SELECT tablename 
        FROM pg_stat_user_tables 
        WHERE n_tup_ins + n_tup_upd + n_tup_del > 10000
          AND schemaname = 'public'
    LOOP
        EXECUTE 'ANALYZE ' || table_record.tablename;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Materialized view for dashboard performance
CREATE MATERIALIZED VIEW IF NOT EXISTS brand_summary_stats AS
SELECT 
    b.id as brand_id,
    b.domain,
    b.name,
    b.created_at,
    COUNT(DISTINCT j.id) as total_jobs,
    COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'complete') as completed_jobs,
    COUNT(DISTINCT rp.id) as total_pages,
    COUNT(DISTINCT c.id) as total_claims,
    COUNT(DISTINCT lr.id) as total_llm_results,
    COUNT(DISTINCT r.id) as total_reports,
    MAX(s.overall_score) as latest_score,
    MAX(s.computed_at) as latest_score_date,
    COUNT(DISTINCT cs.competitor_domain) as competitors_tracked
FROM brands b
LEFT JOIN jobs j ON b.id = j.brand_id
LEFT JOIN raw_pages rp ON b.id = rp.brand_id
LEFT JOIN claims c ON b.id = c.brand_id
LEFT JOIN llm_results lr ON b.id = lr.brand_id
LEFT JOIN reports r ON b.id = r.brand_id
LEFT JOIN scores s ON b.id = s.brand_id AND s.score_type = 'geoscore'
LEFT JOIN competitor_scores cs ON b.id = cs.brand_id
WHERE b.is_active = true
GROUP BY b.id, b.domain, b.name, b.created_at;

-- Index for materialized view
CREATE INDEX IF NOT EXISTS idx_brand_summary_stats_brand_id ON brand_summary_stats(brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_summary_stats_latest_score ON brand_summary_stats(latest_score DESC);

-- Function to refresh materialized view
CREATE OR REPLACE FUNCTION refresh_brand_stats()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY brand_summary_stats;
END;
$$ LANGUAGE plpgsql;

-- Set up periodic refresh (would be handled by a scheduler in production)
COMMENT ON FUNCTION refresh_brand_stats() IS 'Refresh brand summary statistics - call periodically via cron or scheduler';

-- Connection pooling optimization hints
-- These would be applied at the connection pool level
COMMENT ON DATABASE postgres IS 'Recommended connection pool settings: max_connections=200, shared_buffers=256MB, effective_cache_size=1GB, work_mem=4MB';

-- Query hints for common patterns
COMMENT ON TABLE jobs IS 'Query hint: Use idx_jobs_priority_queue for job queue operations, idx_jobs_brand_status_type for brand filtering';
COMMENT ON TABLE embeddings IS 'Query hint: Use vector indexes with appropriate distance metrics (cosine for similarity, l2 for clustering)';
COMMENT ON TABLE scores IS 'Query hint: Use idx_scores_latest_covering for dashboard queries, partition by time for historical analysis';