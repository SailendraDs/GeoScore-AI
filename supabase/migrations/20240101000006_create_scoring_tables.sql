-- Scoring engine and reports tables
-- This migration creates tables for storing computed scores and generated reports

-- Scores table - Scoring engine results with breakdown
CREATE TABLE IF NOT EXISTS scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    score_type TEXT NOT NULL DEFAULT 'geoscore', -- 'geoscore', 'presence', 'accuracy', etc.
    overall_score FLOAT NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
    breakdown JSONB NOT NULL DEFAULT '{}', -- Component scores breakdown
    evidence_pointers JSONB DEFAULT '[]', -- References to supporting data
    methodology_version TEXT DEFAULT 'v1.0',
    confidence FLOAT CHECK (confidence >= 0 AND confidence <= 1),
    computed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE, -- When score becomes stale
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(brand_id, score_type, computed_at)
);

-- Reports table - Assembled report metadata
CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    report_type TEXT NOT NULL DEFAULT 'visibility', -- 'visibility', 'competitive', 'monthly'
    title TEXT NOT NULL,
    summary TEXT,
    status TEXT NOT NULL DEFAULT 'generating', -- 'generating', 'ready', 'failed', 'expired'
    pdf_s3_path TEXT, -- S3 URL for PDF report
    json_data JSONB DEFAULT '{}', -- Full report data
    score_id UUID REFERENCES scores(id), -- Primary score for this report
    generated_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    download_count INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CHECK (status IN ('generating', 'ready', 'failed', 'expired')),
    CHECK (download_count >= 0)
);

-- Score components table - Individual component scores for detailed analysis
CREATE TABLE IF NOT EXISTS score_components (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    score_id UUID NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
    component_name TEXT NOT NULL, -- 'presence', 'accuracy', 'salience', etc.
    component_score FLOAT NOT NULL CHECK (component_score >= 0 AND component_score <= 100),
    weight FLOAT NOT NULL DEFAULT 1.0 CHECK (weight >= 0 AND weight <= 1),
    evidence_count INTEGER DEFAULT 0,
    evidence_refs JSONB DEFAULT '[]',
    calculation_details JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(score_id, component_name)
);

-- Report sections table - For modular report building
CREATE TABLE IF NOT EXISTS report_sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    section_name TEXT NOT NULL,
    section_type TEXT NOT NULL, -- 'summary', 'chart', 'table', 'analysis'
    content JSONB NOT NULL DEFAULT '{}',
    order_index INTEGER NOT NULL DEFAULT 0,
    is_visible BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(report_id, section_name),
    CHECK (order_index >= 0)
);

-- Historical scores table - Track score changes over time
CREATE TABLE IF NOT EXISTS score_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    score_type TEXT NOT NULL,
    score_value FLOAT NOT NULL CHECK (score_value >= 0 AND score_value <= 100),
    change_from_previous FLOAT, -- Difference from last score
    breakdown JSONB DEFAULT '{}',
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints for efficient time-series queries
    CHECK (recorded_at IS NOT NULL)
);

-- Indexes for performance
CREATE INDEX idx_scores_brand_id ON scores(brand_id);
CREATE INDEX idx_scores_job_id ON scores(job_id);
CREATE INDEX idx_scores_score_type ON scores(score_type);
CREATE INDEX idx_scores_overall_score ON scores(overall_score DESC);
CREATE INDEX idx_scores_computed_at ON scores(computed_at DESC);
CREATE INDEX idx_scores_expires_at ON scores(expires_at);

CREATE INDEX idx_reports_brand_id ON reports(brand_id);
CREATE INDEX idx_reports_job_id ON reports(job_id);
CREATE INDEX idx_reports_report_type ON reports(report_type);
CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_generated_at ON reports(generated_at DESC);
CREATE INDEX idx_reports_expires_at ON reports(expires_at);
CREATE INDEX idx_reports_download_count ON reports(download_count DESC);

CREATE INDEX idx_score_components_score_id ON score_components(score_id);
CREATE INDEX idx_score_components_component_name ON score_components(component_name);
CREATE INDEX idx_score_components_component_score ON score_components(component_score DESC);

CREATE INDEX idx_report_sections_report_id ON report_sections(report_id);
CREATE INDEX idx_report_sections_order_index ON report_sections(order_index);
CREATE INDEX idx_report_sections_section_type ON report_sections(section_type);

-- Time-series indexes for score history
CREATE INDEX idx_score_history_brand_id_recorded_at ON score_history(brand_id, recorded_at DESC);
CREATE INDEX idx_score_history_score_type_recorded_at ON score_history(score_type, recorded_at DESC);
CREATE INDEX idx_score_history_recorded_at ON score_history(recorded_at DESC);

-- Add updated_at triggers
CREATE TRIGGER update_scores_updated_at BEFORE UPDATE ON scores
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reports_updated_at BEFORE UPDATE ON reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to record score in history
CREATE OR REPLACE FUNCTION record_score_history()
RETURNS TRIGGER AS $$
DECLARE
    last_score FLOAT;
    score_change FLOAT := NULL;
BEGIN
    -- Get the last score of the same type for this brand
    SELECT score_value INTO last_score
    FROM score_history
    WHERE brand_id = NEW.brand_id 
      AND score_type = NEW.score_type
    ORDER BY recorded_at DESC
    LIMIT 1;
    
    -- Calculate change if we have a previous score
    IF last_score IS NOT NULL THEN
        score_change := NEW.overall_score - last_score;
    END IF;
    
    -- Insert into history
    INSERT INTO score_history (
        brand_id,
        score_type,
        score_value,
        change_from_previous,
        breakdown,
        recorded_at
    ) VALUES (
        NEW.brand_id,
        NEW.score_type,
        NEW.overall_score,
        score_change,
        NEW.breakdown,
        NEW.computed_at
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically record score history
CREATE TRIGGER record_score_history_trigger
    AFTER INSERT ON scores
    FOR EACH ROW EXECUTE FUNCTION record_score_history();

-- Function to get brand score trend
CREATE OR REPLACE FUNCTION get_score_trend(
    p_brand_id UUID,
    p_score_type TEXT DEFAULT 'geoscore',
    p_days_back INTEGER DEFAULT 30
)
RETURNS TABLE (
    recorded_at TIMESTAMP WITH TIME ZONE,
    score_value FLOAT,
    change_from_previous FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sh.recorded_at,
        sh.score_value,
        sh.change_from_previous
    FROM score_history sh
    WHERE sh.brand_id = p_brand_id
      AND sh.score_type = p_score_type
      AND sh.recorded_at >= NOW() - INTERVAL '1 day' * p_days_back
    ORDER BY sh.recorded_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate score percentile ranking
CREATE OR REPLACE FUNCTION get_score_percentile(
    p_brand_id UUID,
    p_score_type TEXT DEFAULT 'geoscore'
)
RETURNS FLOAT AS $$
DECLARE
    brand_score FLOAT;
    percentile_rank FLOAT;
BEGIN
    -- Get the latest score for the brand
    SELECT overall_score INTO brand_score
    FROM scores
    WHERE brand_id = p_brand_id 
      AND score_type = p_score_type
    ORDER BY computed_at DESC
    LIMIT 1;
    
    IF brand_score IS NULL THEN
        RETURN NULL;
    END IF;
    
    -- Calculate percentile rank
    SELECT percent_rank() OVER (ORDER BY overall_score) INTO percentile_rank
    FROM (
        SELECT DISTINCT ON (brand_id) brand_id, overall_score
        FROM scores
        WHERE score_type = p_score_type
        ORDER BY brand_id, computed_at DESC
    ) latest_scores
    WHERE overall_score = brand_score;
    
    RETURN percentile_rank * 100;
END;
$$ LANGUAGE plpgsql;