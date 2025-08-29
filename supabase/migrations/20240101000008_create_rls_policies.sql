-- Row Level Security (RLS) policies for multi-tenant isolation
-- This migration sets up security policies to ensure data isolation between brands and users

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_setup_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE normalized_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_key_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_key_rotations ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user role
CREATE OR REPLACE FUNCTION get_current_user_role()
RETURNS user_role AS $$
BEGIN
    RETURN (
        SELECT role 
        FROM users 
        WHERE id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to check if user owns brand
CREATE OR REPLACE FUNCTION user_owns_brand(brand_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM brands 
        WHERE id = brand_id 
        AND owner_id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to check if user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN get_current_user_role() IN ('admin', 'super_admin');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Users table policies
CREATE POLICY "Users can view their own profile"
    ON users FOR SELECT
    USING (id = auth.uid());

CREATE POLICY "Users can update their own profile"
    ON users FOR UPDATE
    USING (id = auth.uid());

CREATE POLICY "Admins can view all users"
    ON users FOR SELECT
    USING (is_admin());

CREATE POLICY "Admins can update user roles"
    ON users FOR UPDATE
    USING (is_admin());

-- Brands table policies
CREATE POLICY "Users can view their own brands"
    ON brands FOR SELECT
    USING (owner_id = auth.uid());

CREATE POLICY "Users can create brands"
    ON brands FOR INSERT
    WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can update their own brands"
    ON brands FOR UPDATE
    USING (owner_id = auth.uid());

CREATE POLICY "Users can delete their own brands"
    ON brands FOR DELETE
    USING (owner_id = auth.uid());

CREATE POLICY "Admins can view all brands"
    ON brands FOR ALL
    USING (is_admin());

-- Brand setup state policies
CREATE POLICY "Users can view setup state for their brands"
    ON brand_setup_state FOR SELECT
    USING (user_owns_brand(brand_id));

CREATE POLICY "Users can manage setup state for their brands"
    ON brand_setup_state FOR ALL
    USING (user_owns_brand(brand_id));

CREATE POLICY "Admins can view all setup states"
    ON brand_setup_state FOR ALL
    USING (is_admin());

-- Brand prompts policies
CREATE POLICY "Users can manage prompts for their brands"
    ON brand_prompts FOR ALL
    USING (user_owns_brand(brand_id));

CREATE POLICY "Admins can view all prompts"
    ON brand_prompts FOR ALL
    USING (is_admin());

-- Jobs table policies
CREATE POLICY "Users can view jobs for their brands"
    ON jobs FOR SELECT
    USING (user_owns_brand(brand_id));

CREATE POLICY "System can manage all jobs"
    ON jobs FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Admins can view all jobs"
    ON jobs FOR SELECT
    USING (is_admin());

CREATE POLICY "Admins can update jobs for troubleshooting"
    ON jobs FOR UPDATE
    USING (is_admin());

-- Job logs policies
CREATE POLICY "Users can view logs for jobs on their brands"
    ON job_logs FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM jobs j 
            WHERE j.id = job_logs.job_id 
            AND user_owns_brand(j.brand_id)
        )
    );

CREATE POLICY "System can manage job logs"
    ON job_logs FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Admins can view all job logs"
    ON job_logs FOR SELECT
    USING (is_admin());

-- Job dependencies policies
CREATE POLICY "System can manage job dependencies"
    ON job_dependencies FOR ALL
    USING (auth.role() = 'service_role');

-- Raw pages policies
CREATE POLICY "Users can view raw pages for their brands"
    ON raw_pages FOR SELECT
    USING (user_owns_brand(brand_id));

CREATE POLICY "System can manage raw pages"
    ON raw_pages FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Admins can view all raw pages"
    ON raw_pages FOR SELECT
    USING (is_admin());

-- Claims policies
CREATE POLICY "Users can view claims for their brands"
    ON claims FOR SELECT
    USING (user_owns_brand(brand_id));

CREATE POLICY "System can manage claims"
    ON claims FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Admins can view all claims"
    ON claims FOR SELECT
    USING (is_admin());

-- Embeddings policies
CREATE POLICY "Users can view embeddings for their brands"
    ON embeddings FOR SELECT
    USING (user_owns_brand(brand_id));

CREATE POLICY "System can manage embeddings"
    ON embeddings FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Admins can view all embeddings"
    ON embeddings FOR SELECT
    USING (is_admin());

-- Normalized content policies
CREATE POLICY "Users can view normalized content through raw pages"
    ON normalized_content FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM raw_pages rp 
            WHERE rp.id = normalized_content.raw_page_id 
            AND user_owns_brand(rp.brand_id)
        )
    );

CREATE POLICY "System can manage normalized content"
    ON normalized_content FOR ALL
    USING (auth.role() = 'service_role');

-- LLM results policies
CREATE POLICY "Users can view LLM results for their brands"
    ON llm_results FOR SELECT
    USING (user_owns_brand(brand_id));

CREATE POLICY "System can manage LLM results"
    ON llm_results FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Admins can view all LLM results"
    ON llm_results FOR SELECT
    USING (is_admin());

-- LLM reports policies
CREATE POLICY "Users can view LLM reports for their brands"
    ON llm_reports FOR SELECT
    USING (user_owns_brand(brand_id));

CREATE POLICY "System can manage LLM reports"
    ON llm_reports FOR ALL
    USING (auth.role() = 'service_role');

-- Prompt tracking policies (global data, admins only for detailed stats)
CREATE POLICY "System can manage prompt tracking"
    ON prompt_tracking FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Admins can view prompt tracking"
    ON prompt_tracking FOR SELECT
    USING (is_admin());

-- Competitor scores policies
CREATE POLICY "Users can view competitor scores for their brands"
    ON competitor_scores FOR SELECT
    USING (user_owns_brand(brand_id));

CREATE POLICY "System can manage competitor scores"
    ON competitor_scores FOR ALL
    USING (auth.role() = 'service_role');

-- Scores policies
CREATE POLICY "Users can view scores for their brands"
    ON scores FOR SELECT
    USING (user_owns_brand(brand_id));

CREATE POLICY "System can manage scores"
    ON scores FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Admins can view all scores"
    ON scores FOR SELECT
    USING (is_admin());

-- Reports policies
CREATE POLICY "Users can view reports for their brands"
    ON reports FOR SELECT
    USING (user_owns_brand(brand_id));

CREATE POLICY "System can manage reports"
    ON reports FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Admins can view all reports"
    ON reports FOR SELECT
    USING (is_admin());

-- Score components policies
CREATE POLICY "Users can view score components through scores"
    ON score_components FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM scores s 
            WHERE s.id = score_components.score_id 
            AND user_owns_brand(s.brand_id)
        )
    );

CREATE POLICY "System can manage score components"
    ON score_components FOR ALL
    USING (auth.role() = 'service_role');

-- Report sections policies
CREATE POLICY "Users can view report sections through reports"
    ON report_sections FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM reports r 
            WHERE r.id = report_sections.report_id 
            AND user_owns_brand(r.brand_id)
        )
    );

CREATE POLICY "System can manage report sections"
    ON report_sections FOR ALL
    USING (auth.role() = 'service_role');

-- Score history policies
CREATE POLICY "Users can view score history for their brands"
    ON score_history FOR SELECT
    USING (user_owns_brand(brand_id));

CREATE POLICY "System can manage score history"
    ON score_history FOR ALL
    USING (auth.role() = 'service_role');

-- API key usage policies
CREATE POLICY "Users can view usage for their brands"
    ON api_key_usage FOR SELECT
    USING (brand_id IS NULL OR user_owns_brand(brand_id));

CREATE POLICY "Admins can view all API key usage"
    ON api_key_usage FOR SELECT
    USING (is_admin());

CREATE POLICY "System can manage API key usage"
    ON api_key_usage FOR ALL
    USING (auth.role() = 'service_role');

-- User plans policies
CREATE POLICY "Users can view their own plans"
    ON user_plans FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can update their own plan preferences"
    ON user_plans FOR UPDATE
    USING (user_id = auth.uid());

CREATE POLICY "Admins can manage all user plans"
    ON user_plans FOR ALL
    USING (is_admin());

CREATE POLICY "System can manage user plans"
    ON user_plans FOR ALL
    USING (auth.role() = 'service_role');

-- Alerts policies (admins only for most operations)
CREATE POLICY "Admins can manage alerts"
    ON alerts FOR ALL
    USING (is_admin());

CREATE POLICY "System can create alerts"
    ON alerts FOR INSERT
    USING (auth.role() = 'service_role');

-- API key rotations policies (admins and system only)
CREATE POLICY "Admins can view API key rotations"
    ON api_key_rotations FOR SELECT
    USING (is_admin());

CREATE POLICY "Admins can manage API key rotations"
    ON api_key_rotations FOR ALL
    USING (is_admin());

CREATE POLICY "System can manage API key rotations"
    ON api_key_rotations FOR ALL
    USING (auth.role() = 'service_role');

-- Admin-only tables (no user access)
ALTER TABLE api_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage API services"
    ON api_services FOR ALL
    USING (is_admin());

CREATE POLICY "System can read API services"
    ON api_services FOR SELECT
    USING (auth.role() = 'service_role');

CREATE POLICY "Admins can manage API keys"
    ON api_keys FOR ALL
    USING (is_admin());

CREATE POLICY "System can read API keys"
    ON api_keys FOR SELECT
    USING (auth.role() = 'service_role');

CREATE POLICY "Anyone can view active plans"
    ON plans FOR SELECT
    USING (is_active = true);

CREATE POLICY "Admins can manage plans"
    ON plans FOR ALL
    USING (is_admin());

CREATE POLICY "Admins can manage model configs"
    ON model_configs FOR ALL
    USING (is_admin());

CREATE POLICY "System can read model configs"
    ON model_configs FOR SELECT
    USING (auth.role() = 'service_role');