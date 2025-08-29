-- Admin and API management tables
-- This migration creates tables for API key management, billing, and system administration

-- API services table - LLM and connector service configurations
CREATE TABLE IF NOT EXISTS api_services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT UNIQUE NOT NULL,
    type service_type NOT NULL,
    adapter_key TEXT NOT NULL, -- Reference to the adapter implementation
    provider TEXT NOT NULL, -- 'openai', 'anthropic', 'semrush', etc.
    base_url TEXT,
    is_active BOOLEAN DEFAULT true,
    rate_limit_rpm INTEGER DEFAULT 60, -- Requests per minute
    rate_limit_tpm INTEGER, -- Tokens per minute (for LLM services)
    default_region TEXT DEFAULT 'us-east-1',
    supported_regions TEXT[] DEFAULT ARRAY[]::TEXT[],
    health_check_url TEXT,
    last_health_check TIMESTAMP WITH TIME ZONE,
    health_status TEXT DEFAULT 'unknown', -- 'healthy', 'unhealthy', 'unknown'
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CHECK (health_status IN ('healthy', 'unhealthy', 'unknown'))
);

-- API keys table - Multi-key management with rotation
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES api_services(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    secret_pointer TEXT NOT NULL, -- AWS Secrets Manager ARN or similar
    region TEXT,
    status api_key_status DEFAULT 'active',
    error_count INTEGER DEFAULT 0,
    error_rate FLOAT DEFAULT 0.0, -- Percentage of failed requests
    last_used_at TIMESTAMP WITH TIME ZONE,
    last_error_at TIMESTAMP WITH TIME ZONE,
    last_error_message TEXT,
    rotation_scheduled_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(service_id, label),
    CHECK (error_count >= 0),
    CHECK (error_rate >= 0 AND error_rate <= 1)
);

-- API key usage table - Billing attribution per brand/service
CREATE TABLE IF NOT EXISTS api_key_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    brand_id UUID REFERENCES brands(id) ON DELETE SET NULL,
    service_name TEXT NOT NULL,
    request_count INTEGER DEFAULT 0,
    token_count INTEGER DEFAULT 0, -- For LLM services
    cost_cents INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    recorded_date DATE NOT NULL DEFAULT CURRENT_DATE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(api_key_id, brand_id, service_name, recorded_date),
    CHECK (request_count >= 0),
    CHECK (token_count >= 0),
    CHECK (cost_cents >= 0),
    CHECK (success_count >= 0),
    CHECK (error_count >= 0),
    CHECK (success_count + error_count <= request_count)
);

-- Plans table - Billing tiers and feature limits
CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    price_cents INTEGER NOT NULL DEFAULT 0, -- Monthly price in cents
    currency TEXT DEFAULT 'USD',
    is_active BOOLEAN DEFAULT true,
    features JSONB DEFAULT '{}', -- Feature flags and limits
    limits JSONB DEFAULT '{}', -- Usage limits (requests, tokens, etc.)
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CHECK (price_cents >= 0)
);

-- User plans table - User subscription states
CREATE TABLE IF NOT EXISTS user_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'active', -- 'active', 'cancelled', 'expired', 'suspended'
    billing_cycle TEXT DEFAULT 'monthly', -- 'monthly', 'yearly'
    starts_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    razorpay_subscription_id TEXT, -- Razorpay subscription reference
    current_usage JSONB DEFAULT '{}', -- Current period usage tracking
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(user_id, plan_id, starts_at), -- Allow plan changes over time
    CHECK (status IN ('active', 'cancelled', 'expired', 'suspended')),
    CHECK (billing_cycle IN ('monthly', 'yearly'))
);

-- Alerts table - Admin alerts and acknowledgements
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type TEXT NOT NULL, -- 'api_key_error', 'job_queue_overload', 'budget_exceeded'
    severity TEXT NOT NULL DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    source_type TEXT, -- 'api_key', 'job', 'billing', 'system'
    source_id UUID, -- Reference to the source entity
    is_acknowledged BOOLEAN DEFAULT false,
    acknowledged_by UUID REFERENCES users(id),
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    auto_resolve_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CHECK (severity IN ('low', 'medium', 'high', 'critical'))
);

-- API key rotations table - Audit trail for key management
CREATE TABLE IF NOT EXISTS api_key_rotations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    old_secret_pointer TEXT,
    new_secret_pointer TEXT,
    reason TEXT, -- 'scheduled', 'error_threshold', 'manual', 'security'
    initiated_by UUID REFERENCES users(id),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    status TEXT DEFAULT 'in_progress', -- 'in_progress', 'completed', 'failed'
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CHECK (status IN ('in_progress', 'completed', 'failed'))
);

-- Indexes for performance
CREATE INDEX idx_api_services_type ON api_services(type);
CREATE INDEX idx_api_services_provider ON api_services(provider);
CREATE INDEX idx_api_services_is_active ON api_services(is_active);
CREATE INDEX idx_api_services_health_status ON api_services(health_status);

CREATE INDEX idx_api_keys_service_id ON api_keys(service_id);
CREATE INDEX idx_api_keys_status ON api_keys(status);
CREATE INDEX idx_api_keys_error_rate ON api_keys(error_rate DESC);
CREATE INDEX idx_api_keys_last_used_at ON api_keys(last_used_at DESC);

CREATE INDEX idx_api_key_usage_api_key_id ON api_key_usage(api_key_id);
CREATE INDEX idx_api_key_usage_brand_id ON api_key_usage(brand_id);
CREATE INDEX idx_api_key_usage_recorded_date ON api_key_usage(recorded_date DESC);
CREATE INDEX idx_api_key_usage_service_name ON api_key_usage(service_name);

CREATE INDEX idx_plans_name ON plans(name);
CREATE INDEX idx_plans_is_active ON plans(is_active);
CREATE INDEX idx_plans_price_cents ON plans(price_cents);

CREATE INDEX idx_user_plans_user_id ON user_plans(user_id);
CREATE INDEX idx_user_plans_plan_id ON user_plans(plan_id);
CREATE INDEX idx_user_plans_status ON user_plans(status);
CREATE INDEX idx_user_plans_expires_at ON user_plans(expires_at);

CREATE INDEX idx_alerts_type ON alerts(type);
CREATE INDEX idx_alerts_severity ON alerts(severity);
CREATE INDEX idx_alerts_is_acknowledged ON alerts(is_acknowledged);
CREATE INDEX idx_alerts_source ON alerts(source_type, source_id);
CREATE INDEX idx_alerts_created_at ON alerts(created_at DESC);

CREATE INDEX idx_api_key_rotations_api_key_id ON api_key_rotations(api_key_id);
CREATE INDEX idx_api_key_rotations_status ON api_key_rotations(status);
CREATE INDEX idx_api_key_rotations_started_at ON api_key_rotations(started_at DESC);

-- Add updated_at triggers
CREATE TRIGGER update_api_services_updated_at BEFORE UPDATE ON api_services
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_api_keys_updated_at BEFORE UPDATE ON api_keys
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_api_key_usage_updated_at BEFORE UPDATE ON api_key_usage
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_plans_updated_at BEFORE UPDATE ON plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_plans_updated_at BEFORE UPDATE ON user_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_alerts_updated_at BEFORE UPDATE ON alerts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to create alert
CREATE OR REPLACE FUNCTION create_alert(
    p_type TEXT,
    p_title TEXT,
    p_message TEXT,
    p_severity TEXT DEFAULT 'medium',
    p_source_type TEXT DEFAULT NULL,
    p_source_id UUID DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
    alert_id UUID;
BEGIN
    INSERT INTO alerts (type, title, message, severity, source_type, source_id, metadata)
    VALUES (p_type, p_title, p_message, p_severity, p_source_type, p_source_id, p_metadata)
    RETURNING id INTO alert_id;
    
    RETURN alert_id;
END;
$$ LANGUAGE plpgsql;

-- Function to acknowledge alert
CREATE OR REPLACE FUNCTION acknowledge_alert(
    p_alert_id UUID,
    p_user_id UUID
)
RETURNS VOID AS $$
BEGIN
    UPDATE alerts
    SET 
        is_acknowledged = true,
        acknowledged_by = p_user_id,
        acknowledged_at = NOW(),
        updated_at = NOW()
    WHERE id = p_alert_id;
END;
$$ LANGUAGE plpgsql;

-- Function to update API key error rate
CREATE OR REPLACE FUNCTION update_api_key_error_rate(
    p_api_key_id UUID,
    p_success BOOLEAN
)
RETURNS VOID AS $$
DECLARE
    current_error_count INTEGER;
    total_requests INTEGER;
    new_error_rate FLOAT;
BEGIN
    -- Get current stats
    SELECT error_count INTO current_error_count
    FROM api_keys
    WHERE id = p_api_key_id;
    
    -- Calculate total requests from usage table (approximate)
    SELECT COALESCE(SUM(request_count), 0) INTO total_requests
    FROM api_key_usage
    WHERE api_key_id = p_api_key_id;
    
    -- Update error count
    IF NOT p_success THEN
        current_error_count := current_error_count + 1;
    END IF;
    
    -- Calculate new error rate (use recent window for better accuracy)
    IF total_requests > 0 THEN
        new_error_rate := current_error_count::FLOAT / total_requests;
    ELSE
        new_error_rate := CASE WHEN p_success THEN 0.0 ELSE 1.0 END;
    END IF;
    
    -- Update the key
    UPDATE api_keys
    SET 
        error_count = current_error_count,
        error_rate = new_error_rate,
        last_used_at = NOW(),
        last_error_at = CASE WHEN NOT p_success THEN NOW() ELSE last_error_at END,
        updated_at = NOW()
    WHERE id = p_api_key_id;
    
    -- Create alert if error rate is too high
    IF new_error_rate > 0.1 THEN -- 10% error rate threshold
        PERFORM create_alert(
            'api_key_high_error_rate',
            'High API Key Error Rate',
            format('API key %s has error rate of %.1f%%', p_api_key_id, new_error_rate * 100),
            CASE WHEN new_error_rate > 0.5 THEN 'critical' ELSE 'high' END,
            'api_key',
            p_api_key_id
        );
    END IF;
END;
$$ LANGUAGE plpgsql;