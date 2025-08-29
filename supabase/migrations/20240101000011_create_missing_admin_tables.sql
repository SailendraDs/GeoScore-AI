-- Additional admin tables that are referenced in Edge Functions
-- This migration creates tables that are needed but were missing

-- Admin logs table - Activity logging for admin actions
CREATE TABLE IF NOT EXISTS admin_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    resource_type TEXT, -- 'api_key', 'job', 'user', 'alert', etc.
    resource_id UUID,
    ip_address INET,
    user_agent TEXT,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CHECK (admin_id IS NOT NULL)
);

-- Payment transactions table - Referenced in payment webhooks
CREATE TABLE IF NOT EXISTS payment_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    razorpay_payment_id TEXT UNIQUE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
    amount INTEGER NOT NULL, -- Amount in smallest currency unit (cents/paise)
    currency TEXT DEFAULT 'USD',
    status TEXT NOT NULL, -- 'success', 'failed', 'processing_error'
    payment_method TEXT,
    error_message TEXT,
    razorpay_data JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CHECK (amount >= 0),
    CHECK (status IN ('success', 'failed', 'processing_error'))
);

-- Payment reconciliation log - For manual payment review
CREATE TABLE IF NOT EXISTS payment_reconciliation_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    razorpay_payment_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT DEFAULT 'USD',
    status TEXT NOT NULL,
    reason TEXT NOT NULL,
    payment_data JSONB DEFAULT '{}',
    requires_manual_review BOOLEAN DEFAULT true,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    reviewed_by UUID REFERENCES users(id),
    resolution TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CHECK (amount >= 0)
);

-- Notification queue table - For email/SMS notifications
CREATE TABLE IF NOT EXISTS notification_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type TEXT NOT NULL, -- 'email', 'sms', 'push'
    recipient TEXT NOT NULL,
    subject TEXT,
    template TEXT,
    data JSONB DEFAULT '{}',
    status TEXT DEFAULT 'queued', -- 'queued', 'sent', 'failed', 'cancelled'
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    error_message TEXT,
    scheduled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CHECK (type IN ('email', 'sms', 'push')),
    CHECK (status IN ('queued', 'sent', 'failed', 'cancelled')),
    CHECK (attempts >= 0),
    CHECK (max_attempts > 0)
);

-- Alert logs table - Activity tracking for alerts
CREATE TABLE IF NOT EXISTS alert_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL, -- 'created', 'acknowledged', 'resolved', 'escalated'
    message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CHECK (action IN ('created', 'acknowledged', 'resolved', 'escalated', 'snoozed', 'assigned'))
);

-- System alerts table - Used in admin-alerts (alias to existing alerts table)
-- This creates a view that maps to the existing alerts table with consistent naming
CREATE OR REPLACE VIEW system_alerts AS
SELECT 
    id,
    type,
    severity,
    title AS title,
    message AS description,
    CASE 
        WHEN is_acknowledged THEN 'acknowledged'
        WHEN auto_resolve_at IS NOT NULL AND auto_resolve_at < NOW() THEN 'resolved'
        ELSE 'active'
    END as status,
    source_type as source,
    source_id,
    created_at,
    updated_at,
    CASE WHEN is_acknowledged THEN acknowledged_at ELSE NULL END as acknowledged_at,
    CASE WHEN auto_resolve_at IS NOT NULL AND auto_resolve_at < NOW() THEN auto_resolve_at ELSE NULL END as resolved_at,
    acknowledged_by as assignee_id,
    NULL as created_by, -- Would need to track this in alerts table if needed
    metadata,
    0 as escalation_level -- Would need to add this field to alerts table if needed
FROM alerts;

-- API usage logs table - For tracking API usage and costs
CREATE TABLE IF NOT EXISTS api_usage_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_name TEXT NOT NULL,
    model_name TEXT,
    endpoint TEXT,
    request_count INTEGER DEFAULT 1,
    tokens_used INTEGER DEFAULT 0,
    cost_cents INTEGER DEFAULT 0,
    response_time_ms INTEGER,
    status_code INTEGER,
    error_message TEXT,
    brand_id UUID REFERENCES brands(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CHECK (request_count >= 0),
    CHECK (tokens_used >= 0),
    CHECK (cost_cents >= 0),
    CHECK (response_time_ms >= 0)
);

-- Indexes for performance
CREATE INDEX idx_admin_logs_admin_id ON admin_logs(admin_id);
CREATE INDEX idx_admin_logs_action ON admin_logs(action);
CREATE INDEX idx_admin_logs_resource ON admin_logs(resource_type, resource_id);
CREATE INDEX idx_admin_logs_created_at ON admin_logs(created_at DESC);

CREATE INDEX idx_payment_transactions_razorpay_id ON payment_transactions(razorpay_payment_id);
CREATE INDEX idx_payment_transactions_user_id ON payment_transactions(user_id);
CREATE INDEX idx_payment_transactions_status ON payment_transactions(status);
CREATE INDEX idx_payment_transactions_created_at ON payment_transactions(created_at DESC);

CREATE INDEX idx_payment_reconciliation_status ON payment_reconciliation_log(status);
CREATE INDEX idx_payment_reconciliation_review ON payment_reconciliation_log(requires_manual_review);
CREATE INDEX idx_payment_reconciliation_created_at ON payment_reconciliation_log(created_at DESC);

CREATE INDEX idx_notification_queue_status ON notification_queue(status);
CREATE INDEX idx_notification_queue_type ON notification_queue(type);
CREATE INDEX idx_notification_queue_scheduled_at ON notification_queue(scheduled_at ASC) WHERE status = 'queued';

CREATE INDEX idx_alert_logs_alert_id ON alert_logs(alert_id);
CREATE INDEX idx_alert_logs_admin_id ON alert_logs(admin_id);
CREATE INDEX idx_alert_logs_action ON alert_logs(action);
CREATE INDEX idx_alert_logs_created_at ON alert_logs(created_at DESC);

CREATE INDEX idx_api_usage_logs_service ON api_usage_logs(service_name);
CREATE INDEX idx_api_usage_logs_brand ON api_usage_logs(brand_id);
CREATE INDEX idx_api_usage_logs_user ON api_usage_logs(user_id);
CREATE INDEX idx_api_usage_logs_created_at ON api_usage_logs(created_at DESC);
CREATE INDEX idx_api_usage_logs_cost ON api_usage_logs(cost_cents DESC);

-- Add updated_at triggers where needed
CREATE TRIGGER update_payment_reconciliation_log_updated_at BEFORE UPDATE ON payment_reconciliation_log
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_notification_queue_updated_at BEFORE UPDATE ON notification_queue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE admin_logs IS 'Activity logging for administrative actions';
COMMENT ON TABLE payment_transactions IS 'Record of all payment transactions from Razorpay';
COMMENT ON TABLE payment_reconciliation_log IS 'Payments requiring manual reconciliation';
COMMENT ON TABLE notification_queue IS 'Queue for email/SMS/push notifications';
COMMENT ON TABLE alert_logs IS 'Activity tracking for system alerts';
COMMENT ON TABLE api_usage_logs IS 'API usage tracking for billing and monitoring';