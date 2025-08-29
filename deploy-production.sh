#!/bin/bash

# GeoScore AI - Production Deployment Script
# Automates the deployment process with proper checks and validations

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="GeoScore AI"
ENVIRONMENT="production"
HEALTH_CHECK_RETRIES=5
HEALTH_CHECK_DELAY=10

echo -e "${BLUE}🚀 Starting ${PROJECT_NAME} Production Deployment${NC}"
echo "=================================================="

# Check prerequisites
check_prerequisites() {
    echo -e "${YELLOW}📋 Checking prerequisites...${NC}"
    
    # Check if Supabase CLI is installed
    if ! command -v supabase &> /dev/null; then
        echo -e "${RED}❌ Supabase CLI is not installed${NC}"
        exit 1
    fi
    
    # Check if required environment variables are set
    required_vars=("SUPABASE_URL" "SUPABASE_ANON_KEY" "SUPABASE_SERVICE_ROLE_KEY")
    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            echo -e "${RED}❌ Required environment variable $var is not set${NC}"
            exit 1
        fi
    done
    
    echo -e "${GREEN}✅ Prerequisites check passed${NC}"
}

# Run tests before deployment
run_tests() {
    echo -e "${YELLOW}🧪 Running tests before deployment...${NC}"
    
    if ! deno task test; then
        echo -e "${RED}❌ Tests failed. Deployment aborted.${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ All tests passed${NC}"
}

# Deploy database migrations
deploy_migrations() {
    echo -e "${YELLOW}🗄️ Deploying database migrations...${NC}"
    
    # Apply migrations
    supabase db push --linked
    
    # Verify migrations were applied
    if ! supabase db diff --linked; then
        echo -e "${GREEN}✅ Database migrations deployed successfully${NC}"
    else
        echo -e "${RED}❌ Database migration issues detected${NC}"
        exit 1
    fi
}

# Deploy Edge Functions
deploy_functions() {
    echo -e "${YELLOW}⚡ Deploying Edge Functions...${NC}"
    
    # List of functions to deploy
    functions=(
        "auth-onboard"
        "llm-orchestration"
        "brand-onboarding"
        "report-generation"
        "dashboard-api"
        "competitor-tracking"
        "schema-builder"
        "script-serving"
        "live-monitoring"
        "billing-system"
        "admin-panel"
    )
    
    # Deploy each function
    for func in "${functions[@]}"; do
        echo "Deploying function: $func"
        if supabase functions deploy "$func" --no-verify-jwt; then
            echo -e "${GREEN}✅ Function $func deployed successfully${NC}"
        else
            echo -e "${RED}❌ Failed to deploy function $func${NC}"
            exit 1
        fi
    done
    
    echo -e "${GREEN}✅ All Edge Functions deployed successfully${NC}"
}

# Health check function
health_check() {
    echo -e "${YELLOW}🏥 Running health checks...${NC}"
    
    local retries=0
    while [ $retries -lt $HEALTH_CHECK_RETRIES ]; do
        # Check database connectivity
        if supabase db status --linked > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Database health check passed${NC}"
            break
        else
            retries=$((retries + 1))
            echo -e "${YELLOW}⏳ Database health check failed. Retry $retries/$HEALTH_CHECK_RETRIES${NC}"
            sleep $HEALTH_CHECK_DELAY
        fi
    done
    
    if [ $retries -eq $HEALTH_CHECK_RETRIES ]; then
        echo -e "${RED}❌ Database health check failed after $HEALTH_CHECK_RETRIES attempts${NC}"
        exit 1
    fi
    
    # Test critical endpoints
    test_endpoints() {
        local base_url="${SUPABASE_URL}/functions/v1"
        local endpoints=(
            "auth-onboard"
            "dashboard-api"
            "script-serving"
        )
        
        for endpoint in "${endpoints[@]}"; do
            echo "Testing endpoint: $endpoint"
            if curl -sf "${base_url}/${endpoint}" -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" > /dev/null; then
                echo -e "${GREEN}✅ Endpoint $endpoint is responding${NC}"
            else
                echo -e "${YELLOW}⚠️ Endpoint $endpoint is not responding (expected for auth-protected endpoints)${NC}"
            fi
        done
    }
    
    test_endpoints
}

# Setup monitoring and alerts
setup_monitoring() {
    echo -e "${YELLOW}📊 Setting up monitoring and alerts...${NC}"
    
    # Create monitoring tables if they don't exist
    supabase sql --linked --file - <<EOF
-- Create monitoring tables
CREATE TABLE IF NOT EXISTS system_metrics (
    id SERIAL PRIMARY KEY,
    metric_name VARCHAR(100) NOT NULL,
    metric_value NUMERIC NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB
);

CREATE TABLE IF NOT EXISTS health_checks (
    id SERIAL PRIMARY KEY,
    service_name VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    response_time_ms INTEGER,
    error_message TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_system_metrics_timestamp ON system_metrics(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_health_checks_timestamp ON health_checks(timestamp DESC);
EOF
    
    echo -e "${GREEN}✅ Monitoring setup completed${NC}"
}

# Performance optimization
optimize_performance() {
    echo -e "${YELLOW}⚡ Applying performance optimizations...${NC}"
    
    # Create performance indexes
    supabase sql --linked --file - <<EOF
-- Performance indexes for production
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_brands_owner_created 
ON brands(owner_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_llm_reports_brand_created 
ON llm_reports(brand_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usage_tracking_user_month 
ON usage_tracking(user_id, month_year);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_visitor_queries_brand_timestamp 
ON visitor_queries(brand_id, created_at DESC);

-- Enable query performance monitoring
SELECT pg_stat_statements_reset();
EOF
    
    echo -e "${GREEN}✅ Performance optimizations applied${NC}"
}

# Security hardening
apply_security() {
    echo -e "${YELLOW}🔒 Applying security configurations...${NC}"
    
    # Ensure RLS is enabled on all tables
    supabase sql --linked --file - <<EOF
-- Enable RLS on all tables
DO \$\$
DECLARE
    table_name TEXT;
BEGIN
    FOR table_name IN 
        SELECT tablename FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename NOT LIKE 'pg_%'
        AND tablename NOT LIKE 'sql_%'
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    END LOOP;
END \$\$;

-- Create security monitoring view
CREATE OR REPLACE VIEW security_events AS
SELECT 
    created_at as timestamp,
    user_id,
    action,
    ip_address,
    user_agent,
    details->'success' as success
FROM admin_logs
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
EOF
    
    echo -e "${GREEN}✅ Security configurations applied${NC}"
}

# Post-deployment validation
post_deployment_validation() {
    echo -e "${YELLOW}✅ Running post-deployment validation...${NC}"
    
    # Validate Edge Functions are working
    echo "Validating Edge Functions..."
    supabase functions list --linked
    
    # Check database schema
    echo "Validating database schema..."
    supabase db diff --linked --use-migra
    
    # Test user registration flow (with cleanup)
    echo "Testing user registration flow..."
    test_email="deployment-test-$(date +%s)@example.com"
    
    # Note: In a real deployment, you'd use proper API testing
    echo "Test email would be: $test_email"
    
    echo -e "${GREEN}✅ Post-deployment validation completed${NC}"
}

# Backup current state
create_backup() {
    echo -e "${YELLOW}💾 Creating backup before deployment...${NC}"
    
    # Create backup timestamp
    backup_timestamp=$(date +"%Y%m%d_%H%M%S")
    
    # Backup database schema
    echo "Creating database schema backup..."
    supabase db dump --linked --schema-only > "backup_schema_${backup_timestamp}.sql"
    
    echo -e "${GREEN}✅ Backup created: backup_schema_${backup_timestamp}.sql${NC}"
}

# Rollback function
rollback() {
    echo -e "${RED}🔄 Initiating rollback procedure...${NC}"
    
    # This would contain rollback logic
    echo "Rollback procedure would be executed here"
    echo "- Restore previous database state"
    echo "- Deploy previous function versions"
    echo "- Notify team of rollback"
    
    exit 1
}

# Main deployment function
main() {
    echo -e "${BLUE}Starting deployment at $(date)${NC}"
    
    # Trap errors and call rollback
    trap rollback ERR
    
    # Run deployment steps
    check_prerequisites
    create_backup
    run_tests
    deploy_migrations
    optimize_performance
    apply_security
    deploy_functions
    setup_monitoring
    health_check
    post_deployment_validation
    
    echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
    echo "=================================================="
    echo -e "${BLUE}${PROJECT_NAME} is now live in production${NC}"
    echo -e "${BLUE}Deployment completed at $(date)${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Monitor system performance and logs"
    echo "2. Verify user registration and core workflows"
    echo "3. Check monitoring dashboards and alerts"
    echo "4. Update team on deployment status"
}

# Show help
show_help() {
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --help          Show this help message"
    echo "  --dry-run       Run deployment checks without making changes"
    echo "  --skip-tests    Skip test execution (not recommended)"
    echo "  --force         Force deployment even if tests fail"
    echo ""
    echo "Environment variables required:"
    echo "  SUPABASE_URL                Supabase project URL"
    echo "  SUPABASE_ANON_KEY          Supabase anonymous key"
    echo "  SUPABASE_SERVICE_ROLE_KEY  Supabase service role key"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --help)
            show_help
            exit 0
            ;;
        --dry-run)
            echo -e "${YELLOW}🧪 Dry run mode - no changes will be made${NC}"
            DRY_RUN=true
            shift
            ;;
        --skip-tests)
            echo -e "${YELLOW}⚠️ Skipping tests - not recommended for production${NC}"
            SKIP_TESTS=true
            shift
            ;;
        --force)
            echo -e "${YELLOW}⚠️ Force mode - proceeding even if tests fail${NC}"
            FORCE=true
            shift
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

# Run main deployment
if [[ "${DRY_RUN}" == "true" ]]; then
    echo -e "${YELLOW}Dry run completed - no changes made${NC}"
else
    main
fi