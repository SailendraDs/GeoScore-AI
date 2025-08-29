-- LLM orchestration and results tables
-- This migration creates tables for managing LLM calls, responses, and analysis

-- LLM results table - Individual model responses with metadata
CREATE TABLE IF NOT EXISTS llm_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    model_name TEXT NOT NULL, -- e.g., 'gpt-5', 'claude-4.1-opus'
    prompt_key TEXT NOT NULL, -- e.g., 'def_01', 'local_01'
    prompt_text TEXT NOT NULL,
    response_text TEXT,
    tokens_input INTEGER,
    tokens_output INTEGER,
    cost_cents INTEGER, -- Cost in cents for billing
    call_id UUID DEFAULT uuid_generate_v4(), -- For tracing
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed'
    metadata JSONB DEFAULT '{}', -- Model-specific params, temperature, etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    CHECK (tokens_input >= 0),
    CHECK (tokens_output >= 0),
    CHECK (cost_cents >= 0)
);

-- LLM reports table - Per-model visibility scores and analysis
CREATE TABLE IF NOT EXISTS llm_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    model_name TEXT NOT NULL,
    report_type TEXT NOT NULL DEFAULT 'visibility', -- 'visibility', 'competitive', 'sentiment'
    analysis_text TEXT,
    raw_score FLOAT CHECK (raw_score >= 0 AND raw_score <= 100),
    normalized_score FLOAT CHECK (normalized_score >= 0 AND normalized_score <= 100),
    confidence FLOAT CHECK (confidence >= 0 AND confidence <= 1),
    methodology JSONB DEFAULT '{}', -- How the score was calculated
    evidence_refs JSONB DEFAULT '[]', -- References to supporting claims/content
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE, -- When this report becomes stale
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(brand_id, model_name, report_type, generated_at)
);

-- Prompt tracking table - Monitor prompt performance across models
CREATE TABLE IF NOT EXISTS prompt_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prompt_key TEXT NOT NULL,
    model_name TEXT NOT NULL,
    brand_id UUID REFERENCES brands(id) ON DELETE SET NULL, -- NULL for global tracking
    usage_count INTEGER DEFAULT 0,
    avg_tokens_input FLOAT,
    avg_tokens_output FLOAT,
    avg_cost_cents FLOAT,
    avg_response_time_ms FLOAT,
    success_rate FLOAT, -- Percentage of successful calls
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(prompt_key, model_name, brand_id),
    CHECK (usage_count >= 0),
    CHECK (success_rate >= 0 AND success_rate <= 1)
);

-- Competitor scores table - Competitive positioning data
CREATE TABLE IF NOT EXISTS competitor_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    competitor_domain TEXT NOT NULL,
    brand_score FLOAT CHECK (brand_score >= 0 AND brand_score <= 100),
    competitor_score FLOAT CHECK (competitor_score >= 0 AND competitor_score <= 100),
    score_difference FLOAT, -- brand_score - competitor_score
    analysis_summary TEXT,
    methodology JSONB DEFAULT '{}',
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(brand_id, competitor_domain, calculated_at)
);

-- Model configurations table
CREATE TABLE IF NOT EXISTS model_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_name TEXT UNIQUE NOT NULL,
    provider TEXT NOT NULL, -- 'openai', 'anthropic', 'google', etc.
    is_active BOOLEAN DEFAULT true,
    max_tokens INTEGER,
    cost_per_input_token FLOAT, -- Cost in cents per 1000 tokens
    cost_per_output_token FLOAT,
    rate_limit_rpm INTEGER, -- Requests per minute
    rate_limit_tpm INTEGER, -- Tokens per minute
    default_temperature FLOAT DEFAULT 0.7,
    supported_features TEXT[] DEFAULT ARRAY[]::TEXT[], -- 'function_calling', 'vision', etc.
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_llm_results_brand_id ON llm_results(brand_id);
CREATE INDEX idx_llm_results_job_id ON llm_results(job_id);
CREATE INDEX idx_llm_results_model_name ON llm_results(model_name);
CREATE INDEX idx_llm_results_prompt_key ON llm_results(prompt_key);
CREATE INDEX idx_llm_results_status ON llm_results(status);
CREATE INDEX idx_llm_results_call_id ON llm_results(call_id);
CREATE INDEX idx_llm_results_started_at ON llm_results(started_at DESC);
CREATE INDEX idx_llm_results_cost_cents ON llm_results(cost_cents);

CREATE INDEX idx_llm_reports_brand_id ON llm_reports(brand_id);
CREATE INDEX idx_llm_reports_model_name ON llm_reports(model_name);
CREATE INDEX idx_llm_reports_report_type ON llm_reports(report_type);
CREATE INDEX idx_llm_reports_generated_at ON llm_reports(generated_at DESC);
CREATE INDEX idx_llm_reports_raw_score ON llm_reports(raw_score DESC);

CREATE INDEX idx_prompt_tracking_prompt_key ON prompt_tracking(prompt_key);
CREATE INDEX idx_prompt_tracking_model_name ON prompt_tracking(model_name);
CREATE INDEX idx_prompt_tracking_brand_id ON prompt_tracking(brand_id);
CREATE INDEX idx_prompt_tracking_success_rate ON prompt_tracking(success_rate DESC);

CREATE INDEX idx_competitor_scores_brand_id ON competitor_scores(brand_id);
CREATE INDEX idx_competitor_scores_competitor_domain ON competitor_scores(competitor_domain);
CREATE INDEX idx_competitor_scores_calculated_at ON competitor_scores(calculated_at DESC);
CREATE INDEX idx_competitor_scores_score_difference ON competitor_scores(score_difference DESC);

CREATE INDEX idx_model_configs_model_name ON model_configs(model_name);
CREATE INDEX idx_model_configs_provider ON model_configs(provider);
CREATE INDEX idx_model_configs_is_active ON model_configs(is_active);

-- Add updated_at triggers
CREATE TRIGGER update_llm_results_updated_at BEFORE UPDATE ON llm_results
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_llm_reports_updated_at BEFORE UPDATE ON llm_reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_prompt_tracking_updated_at BEFORE UPDATE ON prompt_tracking
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_competitor_scores_updated_at BEFORE UPDATE ON competitor_scores
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_model_configs_updated_at BEFORE UPDATE ON model_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate cost for LLM call
CREATE OR REPLACE FUNCTION calculate_llm_cost(
    p_model_name TEXT,
    p_tokens_input INTEGER,
    p_tokens_output INTEGER
)
RETURNS INTEGER AS $$ -- Returns cost in cents
DECLARE
    input_rate FLOAT;
    output_rate FLOAT;
    total_cost FLOAT;
BEGIN
    SELECT 
        cost_per_input_token,
        cost_per_output_token
    INTO input_rate, output_rate
    FROM model_configs
    WHERE model_name = p_model_name AND is_active = true;
    
    IF input_rate IS NULL THEN
        RAISE EXCEPTION 'Model configuration not found for: %', p_model_name;
    END IF;
    
    total_cost := (p_tokens_input * input_rate / 1000.0) + (p_tokens_output * output_rate / 1000.0);
    
    RETURN ROUND(total_cost * 100)::INTEGER; -- Convert to cents
END;
$$ LANGUAGE plpgsql;

-- Function to update prompt tracking statistics
CREATE OR REPLACE FUNCTION update_prompt_stats(
    p_prompt_key TEXT,
    p_model_name TEXT,
    p_brand_id UUID,
    p_tokens_input INTEGER,
    p_tokens_output INTEGER,
    p_cost_cents INTEGER,
    p_response_time_ms INTEGER,
    p_success BOOLEAN
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO prompt_tracking (
        prompt_key, 
        model_name, 
        brand_id,
        usage_count,
        avg_tokens_input,
        avg_tokens_output,
        avg_cost_cents,
        avg_response_time_ms,
        success_rate,
        last_used_at
    )
    VALUES (
        p_prompt_key,
        p_model_name,
        p_brand_id,
        1,
        p_tokens_input,
        p_tokens_output,
        p_cost_cents,
        p_response_time_ms,
        CASE WHEN p_success THEN 1.0 ELSE 0.0 END,
        NOW()
    )
    ON CONFLICT (prompt_key, model_name, brand_id)
    DO UPDATE SET
        usage_count = prompt_tracking.usage_count + 1,
        avg_tokens_input = (prompt_tracking.avg_tokens_input * prompt_tracking.usage_count + p_tokens_input) / (prompt_tracking.usage_count + 1),
        avg_tokens_output = (prompt_tracking.avg_tokens_output * prompt_tracking.usage_count + p_tokens_output) / (prompt_tracking.usage_count + 1),
        avg_cost_cents = (prompt_tracking.avg_cost_cents * prompt_tracking.usage_count + p_cost_cents) / (prompt_tracking.usage_count + 1),
        avg_response_time_ms = (prompt_tracking.avg_response_time_ms * prompt_tracking.usage_count + p_response_time_ms) / (prompt_tracking.usage_count + 1),
        success_rate = (prompt_tracking.success_rate * prompt_tracking.usage_count + CASE WHEN p_success THEN 1.0 ELSE 0.0 END) / (prompt_tracking.usage_count + 1),
        last_used_at = NOW(),
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;