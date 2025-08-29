-- Add AI Visibility Score tracking table
CREATE TABLE IF NOT EXISTS ai_visibility_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    engine TEXT NOT NULL DEFAULT 'aggregate',
    
    -- AI Visibility Score™ components (0-100 each)
    prompt_sov DECIMAL(5,2) NOT NULL DEFAULT 0,           -- 30% weight
    generative_appearance DECIMAL(5,2) NOT NULL DEFAULT 0, -- 20% weight  
    citation_authority DECIMAL(5,2) NOT NULL DEFAULT 0,   -- 15% weight
    answer_quality DECIMAL(5,2) NOT NULL DEFAULT 0,       -- 10% weight
    voice_presence DECIMAL(5,2) NOT NULL DEFAULT 0,       -- 5% weight
    ai_traffic DECIMAL(5,2) NOT NULL DEFAULT 0,           -- 10% weight
    ai_conversions DECIMAL(5,2) NOT NULL DEFAULT 0,       -- 10% weight
    
    -- Final weighted score (0-100)
    total_score DECIMAL(5,2) NOT NULL,
    
    -- Calculation metadata
    calculation_metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_ai_visibility_scores_brand_engine ON ai_visibility_scores(brand_id, engine);
CREATE INDEX idx_ai_visibility_scores_created_at ON ai_visibility_scores(created_at);
CREATE INDEX idx_ai_visibility_scores_total_score ON ai_visibility_scores(total_score);

-- RLS policies for ai_visibility_scores
ALTER TABLE ai_visibility_scores ENABLE ROW LEVEL SECURITY;

-- Brand users can view their own brand scores
CREATE POLICY "Users can view their own brand AI visibility scores"
    ON ai_visibility_scores FOR SELECT
    USING (
        brand_id IN (
            SELECT id FROM brands WHERE owner_id = auth.uid()
        )
    );

-- Brand users can insert scores for their brands (via Edge Functions)
CREATE POLICY "System can insert AI visibility scores"
    ON ai_visibility_scores FOR INSERT
    WITH CHECK (auth.role() = 'service_role');

-- Admins can view all scores
CREATE POLICY "Admins can view all AI visibility scores"
    ON ai_visibility_scores FOR ALL
    USING (is_admin());

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_ai_visibility_scores_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_ai_visibility_scores_updated_at
    BEFORE UPDATE ON ai_visibility_scores
    FOR EACH ROW
    EXECUTE FUNCTION update_ai_visibility_scores_updated_at();

-- Enhanced analytics views for AI Visibility Scores

-- Brand score summary view
CREATE OR REPLACE VIEW brand_visibility_summary AS
SELECT 
    b.id AS brand_id,
    b.name AS brand_name,
    b.domain,
    avs.engine,
    avs.total_score,
    avs.prompt_sov,
    avs.generative_appearance,
    avs.citation_authority,
    avs.answer_quality,
    avs.created_at AS score_date,
    ROW_NUMBER() OVER (PARTITION BY b.id, avs.engine ORDER BY avs.created_at DESC) AS score_rank
FROM brands b
LEFT JOIN ai_visibility_scores avs ON b.id = avs.brand_id
WHERE b.deleted_at IS NULL;

-- Latest scores per brand per engine
CREATE OR REPLACE VIEW latest_visibility_scores AS
SELECT *
FROM brand_visibility_summary
WHERE score_rank = 1;

-- Brand score trends (last 30 days)
CREATE OR REPLACE VIEW brand_score_trends AS
SELECT 
    brand_id,
    brand_name,
    engine,
    AVG(total_score) as avg_score,
    MIN(total_score) as min_score,
    MAX(total_score) as max_score,
    COUNT(*) as score_count,
    STDDEV(total_score) as score_stddev
FROM brand_visibility_summary
WHERE score_date >= NOW() - INTERVAL '30 days'
GROUP BY brand_id, brand_name, engine;

-- Function to calculate AI Visibility Score trend
CREATE OR REPLACE FUNCTION get_ai_visibility_trend(
    p_brand_id UUID,
    p_engine TEXT DEFAULT 'aggregate',
    p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
    date DATE,
    score DECIMAL(5,2),
    trend_direction TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        avs.created_at::DATE as date,
        avs.total_score as score,
        CASE 
            WHEN LAG(avs.total_score) OVER (ORDER BY avs.created_at) IS NULL THEN 'neutral'
            WHEN avs.total_score > LAG(avs.total_score) OVER (ORDER BY avs.created_at) THEN 'up'
            WHEN avs.total_score < LAG(avs.total_score) OVER (ORDER BY avs.created_at) THEN 'down'
            ELSE 'neutral'
        END as trend_direction
    FROM ai_visibility_scores avs
    WHERE avs.brand_id = p_brand_id
        AND avs.engine = p_engine
        AND avs.created_at >= NOW() - (p_days || ' days')::INTERVAL
    ORDER BY avs.created_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get competitive benchmark data
CREATE OR REPLACE FUNCTION get_competitive_benchmark(p_brand_id UUID)
RETURNS TABLE (
    brand_name TEXT,
    latest_score DECIMAL(5,2),
    industry_percentile INTEGER,
    competitor_count INTEGER,
    score_improvement_30d DECIMAL(5,2)
) AS $$
DECLARE
    brand_domain TEXT;
    industry_avg DECIMAL(5,2);
BEGIN
    -- Get brand domain for industry classification (simplified)
    SELECT domain INTO brand_domain FROM brands WHERE id = p_brand_id;
    
    -- Calculate industry average (placeholder - would need proper industry classification)
    SELECT AVG(total_score) INTO industry_avg
    FROM ai_visibility_scores avs
    JOIN brands b ON avs.brand_id = b.id
    WHERE avs.created_at >= NOW() - INTERVAL '30 days'
        AND avs.engine = 'aggregate';
    
    RETURN QUERY
    SELECT 
        b.name as brand_name,
        latest.total_score as latest_score,
        CASE 
            WHEN industry_avg = 0 THEN 50
            ELSE ROUND(((latest.total_score / industry_avg) * 100)::DECIMAL, 0)::INTEGER
        END as industry_percentile,
        (SELECT COUNT(*) FROM competitors WHERE brand_id = p_brand_id)::INTEGER as competitor_count,
        COALESCE(
            latest.total_score - prev.total_score, 
            0
        ) as score_improvement_30d
    FROM brands b
    LEFT JOIN (
        SELECT * FROM latest_visibility_scores WHERE brand_id = p_brand_id AND engine = 'aggregate'
    ) latest ON b.id = latest.brand_id
    LEFT JOIN (
        SELECT brand_id, total_score
        FROM ai_visibility_scores
        WHERE brand_id = p_brand_id 
            AND engine = 'aggregate'
            AND created_at <= NOW() - INTERVAL '30 days'
        ORDER BY created_at DESC
        LIMIT 1
    ) prev ON b.id = prev.brand_id
    WHERE b.id = p_brand_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Sample data for testing (optional - remove in production)
-- INSERT INTO ai_visibility_scores (brand_id, engine, prompt_sov, generative_appearance, citation_authority, answer_quality, voice_presence, ai_traffic, ai_conversions, total_score, calculation_metadata)
-- SELECT 
--     b.id,
--     'gpt-4o',
--     50 + (RANDOM() * 30)::DECIMAL(5,2),
--     40 + (RANDOM() * 40)::DECIMAL(5,2),
--     60 + (RANDOM() * 25)::DECIMAL(5,2),
--     55 + (RANDOM() * 30)::DECIMAL(5,2),
--     45 + (RANDOM() * 20)::DECIMAL(5,2),
--     50 + (RANDOM() * 25)::DECIMAL(5,2),
--     48 + (RANDOM() * 25)::DECIMAL(5,2),
--     50 + (RANDOM() * 35)::DECIMAL(5,2),
--     '{"sample": true, "engine": "gpt-4o"}'::JSONB
-- FROM brands b
-- WHERE b.deleted_at IS NULL
-- LIMIT 5;

-- Add comment explaining the AI Visibility Score™ algorithm
COMMENT ON TABLE ai_visibility_scores IS 'AI Visibility Score™ algorithm with 7-component weighting: prompt_sov (30%), generative_appearance (20%), citation_authority (15%), answer_quality (10%), voice_presence (5%), ai_traffic (10%), ai_conversions (10%)';

COMMENT ON COLUMN ai_visibility_scores.prompt_sov IS 'Prompt Share of Voice - brand mentions compared to competitors (30% weight)';
COMMENT ON COLUMN ai_visibility_scores.generative_appearance IS 'Generative appearance rate across AI responses (20% weight)';  
COMMENT ON COLUMN ai_visibility_scores.citation_authority IS 'Citation authority mix from high-authority domains (15% weight)';
COMMENT ON COLUMN ai_visibility_scores.answer_quality IS 'Answer quality proxy based on length, structure, citations (10% weight)';
COMMENT ON COLUMN ai_visibility_scores.voice_presence IS 'Voice assistant presence (5% weight)';
COMMENT ON COLUMN ai_visibility_scores.ai_traffic IS 'AI traffic attribution (10% weight)';
COMMENT ON COLUMN ai_visibility_scores.ai_conversions IS 'AI conversion attribution (10% weight)';
COMMENT ON COLUMN ai_visibility_scores.total_score IS 'Final weighted AI Visibility Score (0-100)';