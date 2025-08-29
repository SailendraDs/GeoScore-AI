-- Add generated reports storage table
CREATE TABLE IF NOT EXISTS generated_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Report metadata
    report_type TEXT NOT NULL DEFAULT 'complete',
    report_title TEXT,
    report_data JSONB NOT NULL DEFAULT '{}',
    
    -- Status and tracking
    generation_status TEXT DEFAULT 'completed', -- queued, generating, completed, failed
    generation_metadata JSONB DEFAULT '{}',
    
    -- Access control
    shared_publicly BOOLEAN DEFAULT false,
    shared_with_users UUID[] DEFAULT '{}',
    download_count INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE -- Optional expiry for reports
);

-- Create indexes for performance
CREATE INDEX idx_generated_reports_brand_id ON generated_reports(brand_id);
CREATE INDEX idx_generated_reports_user_id ON generated_reports(user_id);
CREATE INDEX idx_generated_reports_created_at ON generated_reports(created_at);
CREATE INDEX idx_generated_reports_report_type ON generated_reports(report_type);

-- RLS policies for generated_reports
ALTER TABLE generated_reports ENABLE ROW LEVEL SECURITY;

-- Users can view their own generated reports
CREATE POLICY "Users can view their own generated reports"
    ON generated_reports FOR SELECT
    USING (user_id = auth.uid());

-- Users can create reports for their own brands
CREATE POLICY "Users can create reports for their brands"
    ON generated_reports FOR INSERT
    WITH CHECK (
        user_id = auth.uid() AND
        brand_id IN (
            SELECT id FROM brands WHERE owner_id = auth.uid()
        )
    );

-- Users can update their own reports
CREATE POLICY "Users can update their own generated reports"
    ON generated_reports FOR UPDATE
    USING (user_id = auth.uid());

-- Users can delete their own reports
CREATE POLICY "Users can delete their own generated reports"
    ON generated_reports FOR DELETE
    USING (user_id = auth.uid());

-- Service role can manage all reports (for Edge Functions)
CREATE POLICY "System can manage generated reports"
    ON generated_reports FOR ALL
    USING (auth.role() = 'service_role');

-- Admins can view all reports
CREATE POLICY "Admins can view all generated reports"
    ON generated_reports FOR ALL
    USING (is_admin());

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_generated_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_generated_reports_updated_at
    BEFORE UPDATE ON generated_reports
    FOR EACH ROW
    EXECUTE FUNCTION update_generated_reports_updated_at();

-- Report analytics view
CREATE OR REPLACE VIEW report_analytics AS
SELECT 
    r.brand_id,
    b.name AS brand_name,
    r.report_type,
    COUNT(*) AS report_count,
    SUM(r.download_count) AS total_downloads,
    AVG(r.download_count) AS avg_downloads_per_report,
    MAX(r.created_at) AS last_generated,
    MIN(r.created_at) AS first_generated
FROM generated_reports r
JOIN brands b ON r.brand_id = b.id
WHERE r.generation_status = 'completed'
GROUP BY r.brand_id, b.name, r.report_type;

-- Function to cleanup expired reports
CREATE OR REPLACE FUNCTION cleanup_expired_reports()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM generated_reports
    WHERE expires_at IS NOT NULL 
        AND expires_at < NOW()
        AND generation_status = 'completed';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get report summary stats
CREATE OR REPLACE FUNCTION get_report_summary_stats(p_brand_id UUID)
RETURNS TABLE (
    total_reports INTEGER,
    recent_reports INTEGER,
    total_downloads INTEGER,
    most_popular_type TEXT,
    last_generated TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::INTEGER as total_reports,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END)::INTEGER as recent_reports,
        COALESCE(SUM(download_count), 0)::INTEGER as total_downloads,
        COALESCE(
            (SELECT report_type FROM generated_reports 
             WHERE brand_id = p_brand_id AND generation_status = 'completed'
             GROUP BY report_type 
             ORDER BY COUNT(*) DESC 
             LIMIT 1), 
            'complete'
        ) as most_popular_type,
        MAX(created_at) as last_generated
    FROM generated_reports
    WHERE brand_id = p_brand_id 
        AND generation_status = 'completed';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update download count
CREATE OR REPLACE FUNCTION increment_report_download_count(p_report_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE generated_reports
    SET download_count = download_count + 1,
        updated_at = NOW()
    WHERE id = p_report_id;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comments for documentation
COMMENT ON TABLE generated_reports IS 'Stores generated AI visibility and competitive analysis reports';
COMMENT ON COLUMN generated_reports.report_data IS 'Complete report data in JSON format including all sections, charts, and recommendations';
COMMENT ON COLUMN generated_reports.generation_metadata IS 'Metadata about report generation process, data sources, and confidence scores';
COMMENT ON COLUMN generated_reports.shared_publicly IS 'Whether this report can be accessed via public link';
COMMENT ON COLUMN generated_reports.expires_at IS 'Optional expiry date for report - useful for demo/trial reports';