-- Core job queue system
-- This migration creates the job management tables for the pipeline workflow

-- Jobs table - Core job queue system
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    type job_type NOT NULL,
    status job_status DEFAULT 'queued',
    payload JSONB DEFAULT '{}',
    result JSONB DEFAULT '{}',
    priority INTEGER DEFAULT 5, -- Lower numbers = higher priority
    max_retries INTEGER DEFAULT 3,
    retry_count INTEGER DEFAULT 0,
    retries_from UUID REFERENCES jobs(id), -- Reference to original job if this is a retry
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Add idempotency support
    idempotency_key TEXT UNIQUE,
    
    -- Constraints
    CHECK (retry_count <= max_retries),
    CHECK (priority >= 1 AND priority <= 10)
);

-- Job logs table - Structured logging for job lifecycle events
CREATE TABLE IF NOT EXISTS job_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    level TEXT NOT NULL DEFAULT 'INFO', -- DEBUG, INFO, WARN, ERROR
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CHECK (level IN ('DEBUG', 'INFO', 'WARN', 'ERROR'))
);

-- Job dependencies table (for complex workflows)
CREATE TABLE IF NOT EXISTS job_dependencies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    depends_on_job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(job_id, depends_on_job_id),
    CHECK (job_id != depends_on_job_id) -- Job can't depend on itself
);

-- Indexes for job management and querying
CREATE INDEX idx_jobs_brand_id ON jobs(brand_id);
CREATE INDEX idx_jobs_type ON jobs(type);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX idx_jobs_priority_status ON jobs(priority ASC, status) WHERE status = 'queued';
CREATE INDEX idx_jobs_status_type ON jobs(status, type);
CREATE INDEX idx_jobs_retries_from ON jobs(retries_from) WHERE retries_from IS NOT NULL;

CREATE INDEX idx_job_logs_job_id ON job_logs(job_id);
CREATE INDEX idx_job_logs_level ON job_logs(level);
CREATE INDEX idx_job_logs_created_at ON job_logs(created_at DESC);

CREATE INDEX idx_job_dependencies_job_id ON job_dependencies(job_id);
CREATE INDEX idx_job_dependencies_depends_on_job_id ON job_dependencies(depends_on_job_id);

-- Add updated_at trigger
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to get next job from queue (with priority and dependencies)
CREATE OR REPLACE FUNCTION get_next_job(job_types job_type[] DEFAULT NULL)
RETURNS jobs AS $$
DECLARE
    next_job jobs%ROWTYPE;
BEGIN
    SELECT j.* INTO next_job
    FROM jobs j
    WHERE j.status = 'queued'
      AND (job_types IS NULL OR j.type = ANY(job_types))
      AND NOT EXISTS (
          SELECT 1 FROM job_dependencies jd
          JOIN jobs dep_job ON jd.depends_on_job_id = dep_job.id
          WHERE jd.job_id = j.id AND dep_job.status != 'complete'
      )
    ORDER BY j.priority ASC, j.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
    
    RETURN next_job;
END;
$$ LANGUAGE plpgsql;

-- Function to log job events
CREATE OR REPLACE FUNCTION log_job_event(
    p_job_id UUID,
    p_level TEXT DEFAULT 'INFO',
    p_message TEXT,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
    log_id UUID;
BEGIN
    INSERT INTO job_logs (job_id, level, message, metadata)
    VALUES (p_job_id, p_level, p_message, p_metadata)
    RETURNING id INTO log_id;
    
    RETURN log_id;
END;
$$ LANGUAGE plpgsql;

-- Function to create job with dependencies
CREATE OR REPLACE FUNCTION create_job_with_deps(
    p_brand_id UUID,
    p_type job_type,
    p_payload JSONB DEFAULT '{}',
    p_depends_on UUID[] DEFAULT NULL,
    p_priority INTEGER DEFAULT 5,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    job_id UUID;
    dep_job_id UUID;
BEGIN
    -- Insert the job
    INSERT INTO jobs (brand_id, type, payload, priority, idempotency_key)
    VALUES (p_brand_id, p_type, p_payload, p_priority, p_idempotency_key)
    RETURNING id INTO job_id;
    
    -- Add dependencies if provided
    IF p_depends_on IS NOT NULL THEN
        FOREACH dep_job_id IN ARRAY p_depends_on
        LOOP
            INSERT INTO job_dependencies (job_id, depends_on_job_id)
            VALUES (job_id, dep_job_id);
        END LOOP;
    END IF;
    
    -- Log job creation
    PERFORM log_job_event(job_id, 'INFO', 'Job created', jsonb_build_object(
        'type', p_type,
        'brand_id', p_brand_id,
        'priority', p_priority,
        'dependencies_count', COALESCE(array_length(p_depends_on, 1), 0)
    ));
    
    RETURN job_id;
END;
$$ LANGUAGE plpgsql;