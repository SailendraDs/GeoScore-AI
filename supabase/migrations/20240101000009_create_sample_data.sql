-- Sample data for testing and development
-- This migration inserts sample data to test the complete pipeline

-- Sample API services
INSERT INTO api_services (name, type, adapter_key, provider, base_url, rate_limit_rpm, supported_regions) VALUES
('OpenAI GPT', 'llm', 'openai_adapter_v1', 'openai', 'https://api.openai.com/v1', 500, ARRAY['us-east-1', 'us-west-1']),
('Anthropic Claude', 'llm', 'anthropic_adapter_v1', 'anthropic', 'https://api.anthropic.com/v1', 300, ARRAY['us-east-1']),
('SerpAPI', 'serp', 'serp_adapter_v1', 'serpapi', 'https://serpapi.com/search', 100, ARRAY['global']),
('OpenAI Embeddings', 'embedding', 'openai_embedding_adapter_v1', 'openai', 'https://api.openai.com/v1', 1000, ARRAY['us-east-1', 'us-west-1']);

-- Sample model configurations
INSERT INTO model_configs (model_name, provider, max_tokens, cost_per_input_token, cost_per_output_token, rate_limit_rpm, default_temperature, supported_features) VALUES
('gpt-4o', 'openai', 128000, 0.005, 0.015, 500, 0.7, ARRAY['function_calling', 'vision']),
('gpt-4o-mini', 'openai', 128000, 0.00015, 0.0006, 1000, 0.7, ARRAY['function_calling']),
('claude-3-opus-20240229', 'anthropic', 200000, 0.015, 0.075, 100, 0.7, ARRAY['vision']),
('claude-3-sonnet-20240229', 'anthropic', 200000, 0.003, 0.015, 300, 0.7, ARRAY['vision']),
('text-embedding-ada-002', 'openai', 8192, 0.0001, 0, 3000, 0, ARRAY['embedding']);

-- Sample plans
INSERT INTO plans (name, display_name, description, price_cents, features, limits) VALUES
('free', 'Free Tier', 'Basic brand visibility analysis', 0, 
 '{"reports_per_month": 1, "competitors_tracking": 3, "llm_models": ["gpt-4o-mini"]}',
 '{"monthly_requests": 100, "storage_mb": 50}'),
('standard', 'Standard Plan', 'Enhanced visibility tracking with multiple models', 2999,
 '{"reports_per_month": 10, "competitors_tracking": 10, "llm_models": ["gpt-4o-mini", "claude-3-sonnet-20240229"]}',
 '{"monthly_requests": 1000, "storage_mb": 500}'),
('premium', 'Premium Plan', 'Advanced analytics with all models', 9999,
 '{"reports_per_month": 50, "competitors_tracking": 25, "llm_models": ["gpt-4o", "claude-3-opus-20240229", "claude-3-sonnet-20240229"]}',
 '{"monthly_requests": 5000, "storage_mb": 2000}');

-- Sample admin user (for testing - in production this would be created differently)
INSERT INTO users (id, email, full_name, role, clerk_id) VALUES
('550e8400-e29b-41d4-a716-446655440001', 'admin@geoscore.ai', 'System Administrator', 'admin', 'admin_test_001')
ON CONFLICT DO NOTHING;

-- Sample brand user
INSERT INTO users (id, email, full_name, role, clerk_id) VALUES
('550e8400-e29b-41d4-a716-446655440002', 'user@example.com', 'Test Brand Owner', 'brand_user', 'user_test_001')
ON CONFLICT DO NOTHING;

-- Sample brand
INSERT INTO brands (id, owner_id, domain, name, description, location, competitors) VALUES
('550e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440002', 'example.com', 'Example Corp', 'A sample company for testing', 'San Francisco, CA', ARRAY['competitor1.com', 'competitor2.com'])
ON CONFLICT DO NOTHING;

-- Sample brand prompts
INSERT INTO brand_prompts (brand_id, prompt_key, prompt_text, metadata) VALUES
('550e8400-e29b-41d4-a716-446655440003', 'def_01', 'Analyze the brand visibility and online presence for this company. Focus on their digital footprint, search engine presence, and competitive positioning.', '{"category": "general", "version": "1.0"}'),
('550e8400-e29b-41d4-a716-446655440003', 'local_01', 'Evaluate the local search presence and geographic visibility for this business. Consider local SEO factors, Google My Business presence, and location-based search results.', '{"category": "local", "version": "1.0"}')
ON CONFLICT DO NOTHING;

-- Sample user plan (assign free plan to test user)
INSERT INTO user_plans (user_id, plan_id, status, billing_cycle, starts_at, expires_at) VALUES
('550e8400-e29b-41d4-a716-446655440002', 
 (SELECT id FROM plans WHERE name = 'free'), 
 'active', 'monthly', NOW(), NOW() + INTERVAL '1 month')
ON CONFLICT DO NOTHING;

-- Sample API keys (for testing - using placeholder secret pointers)
INSERT INTO api_keys (service_id, label, secret_pointer, region, status) VALUES
((SELECT id FROM api_services WHERE name = 'OpenAI GPT'), 'openai-primary', 'arn:aws:secretsmanager:us-east-1:123456789:secret:openai-key-1', 'us-east-1', 'active'),
((SELECT id FROM api_services WHERE name = 'Anthropic Claude'), 'claude-primary', 'arn:aws:secretsmanager:us-east-1:123456789:secret:claude-key-1', 'us-east-1', 'active'),
((SELECT id FROM api_services WHERE name = 'SerpAPI'), 'serp-primary', 'arn:aws:secretsmanager:us-east-1:123456789:secret:serp-key-1', 'global', 'active');

-- Sample job (brand onboarding)
INSERT INTO jobs (id, brand_id, type, status, payload) VALUES
('550e8400-e29b-41d4-a716-446655440004', '550e8400-e29b-41d4-a716-446655440003', 'brand_onboard', 'complete',
 '{"seedUrls": ["https://example.com", "https://example.com/sitemap.xml"], "depth": 2}')
ON CONFLICT DO NOTHING;

-- Sample raw pages
INSERT INTO raw_pages (id, brand_id, job_id, url, canonical_url, content_hash, html_s3_path, status_code, fetch_time) VALUES
('550e8400-e29b-41d4-a716-446655440005', '550e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440004',
 'https://example.com', 'https://example.com', 'hash_123456', 's3://geoscore-snapshots/example.com/2024-01-01/hash_123456.html', 200, NOW() - INTERVAL '1 hour'),
('550e8400-e29b-41d4-a716-446655440006', '550e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440004',
 'https://example.com/about', 'https://example.com/about', 'hash_123457', 's3://geoscore-snapshots/example.com/2024-01-01/hash_123457.html', 200, NOW() - INTERVAL '1 hour')
ON CONFLICT DO NOTHING;

-- Sample claims
INSERT INTO claims (brand_id, raw_page_id, text, source_url, confidence, evidence, claim_type, extracted_by) VALUES
('550e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440005',
 'Example Corp provides innovative software solutions', 'https://example.com', 0.9,
 '[{"type": "title", "text": "Example Corp - Innovative Software Solutions"}, {"type": "meta", "property": "description", "content": "Leading provider of software solutions"}]',
 'service', 'heuristic'),
('550e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440006',
 'Founded in 2020, Example Corp is headquartered in San Francisco', 'https://example.com/about', 0.85,
 '[{"type": "text", "context": "About us section", "text": "Founded in 2020 in San Francisco"}]',
 'company_info', 'heuristic')
ON CONFLICT DO NOTHING;

-- Sample LLM results
INSERT INTO llm_results (brand_id, model_name, prompt_key, prompt_text, response_text, tokens_input, tokens_output, cost_cents, status, started_at, completed_at) VALUES
('550e8400-e29b-41d4-a716-446655440003', 'gpt-4o-mini', 'def_01',
 'Analyze the brand visibility and online presence for this company...',
 'Based on the analysis of Example Corp, their brand visibility shows strong fundamentals with a professional website presence. The company demonstrates clear value propositions in innovative software solutions. However, there are opportunities for improvement in local SEO optimization and social media presence.',
 150, 85, 12, 'completed', NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '29 minutes'),
('550e8400-e29b-41d4-a716-446655440003', 'claude-3-sonnet-20240229', 'def_01',
 'Analyze the brand visibility and online presence for this company...',
 'Example Corp exhibits a moderate digital footprint with room for enhancement. Their website provides adequate information about services, but lacks comprehensive SEO optimization. The brand messaging is clear but could benefit from stronger competitive differentiation and enhanced content marketing strategies.',
 155, 92, 28, 'completed', NOW() - INTERVAL '25 minutes', NOW() - INTERVAL '24 minutes')
ON CONFLICT DO NOTHING;

-- Sample score
INSERT INTO scores (id, brand_id, score_type, overall_score, breakdown, evidence_pointers, computed_at) VALUES
('550e8400-e29b-41d4-a716-446655440007', '550e8400-e29b-41d4-a716-446655440003', 'geoscore', 72.5,
 '{"presence": 75, "accuracy": 85, "salience": 70, "authority": 65, "freshness": 80, "robustness": 70}',
 '[{"type": "claim", "id": "550e8400-e29b-41d4-a716-446655440005", "weight": 0.3}, {"type": "llm_result", "id": "550e8400-e29b-41d4-a716-446655440001", "weight": 0.4}]',
 NOW() - INTERVAL '15 minutes')
ON CONFLICT DO NOTHING;

-- Sample score components
INSERT INTO score_components (score_id, component_name, component_score, weight, evidence_count, evidence_refs) VALUES
('550e8400-e29b-41d4-a716-446655440007', 'presence', 75.0, 0.2, 2, '[{"type": "raw_page", "count": 2}]'),
('550e8400-e29b-41d4-a716-446655440007', 'accuracy', 85.0, 0.15, 2, '[{"type": "claim", "verified": 2}]'),
('550e8400-e29b-41d4-a716-446655440007', 'salience', 70.0, 0.2, 3, '[{"type": "keyword_match", "score": 0.7}]'),
('550e8400-e29b-41d4-a716-446655440007', 'authority', 65.0, 0.15, 1, '[{"type": "domain_authority", "score": 65}]'),
('550e8400-e29b-41d4-a716-446655440007', 'freshness', 80.0, 0.15, 2, '[{"type": "content_age", "avg_days": 30}]'),
('550e8400-e29b-41d4-a716-446655440007', 'robustness', 70.0, 0.15, 2, '[{"type": "model_consensus", "agreement": 0.7}]')
ON CONFLICT DO NOTHING;

-- Sample report
INSERT INTO reports (id, brand_id, report_type, title, summary, status, json_data, score_id, generated_at) VALUES
('550e8400-e29b-41d4-a716-446655440008', '550e8400-e29b-41d4-a716-446655440003', 'visibility',
 'Brand Visibility Report - Example Corp', 
 'Comprehensive analysis of Example Corp digital presence and competitive positioning.',
 'ready',
 '{"executive_summary": "Example Corp shows strong fundamentals with 72.5 GeoScore", "key_findings": ["Strong website presence", "Good content quality", "Room for SEO improvement"], "recommendations": ["Enhance local SEO", "Expand social media presence", "Optimize for mobile"]}',
 '550e8400-e29b-41d4-a716-446655440007',
 NOW() - INTERVAL '10 minutes')
ON CONFLICT DO NOTHING;

-- Sample report sections
INSERT INTO report_sections (report_id, section_name, section_type, content, order_index) VALUES
('550e8400-e29b-41d4-a716-446655440008', 'executive_summary', 'summary', 
 '{"title": "Executive Summary", "content": "Example Corp demonstrates a solid digital foundation with a GeoScore of 72.5, indicating above-average brand visibility."}', 1),
('550e8400-e29b-41d4-a716-446655440008', 'score_breakdown', 'chart',
 '{"chart_type": "radar", "data": {"presence": 75, "accuracy": 85, "salience": 70, "authority": 65, "freshness": 80, "robustness": 70}}', 2),
('550e8400-e29b-41d4-a716-446655440008', 'recommendations', 'table',
 '{"headers": ["Priority", "Recommendation", "Impact"], "rows": [["High", "Improve local SEO presence", "15-20% visibility increase"], ["Medium", "Enhance social media activity", "10-15% engagement boost"]]}', 3)
ON CONFLICT DO NOTHING;

-- Sample competitor scores
INSERT INTO competitor_scores (brand_id, competitor_domain, brand_score, competitor_score, score_difference, analysis_summary) VALUES
('550e8400-e29b-41d4-a716-446655440003', 'competitor1.com', 72.5, 68.2, 4.3, 'Example Corp leads with stronger content quality and website optimization'),
('550e8400-e29b-41d4-a716-446655440003', 'competitor2.com', 72.5, 75.8, -3.3, 'Competitor2.com shows superior social media presence and local SEO optimization')
ON CONFLICT DO NOTHING;

-- Sample job logs
INSERT INTO job_logs (job_id, level, message, metadata) VALUES
('550e8400-e29b-41d4-a716-446655440004', 'INFO', 'Brand onboarding job started', '{"brand_domain": "example.com", "seed_urls_count": 2}'),
('550e8400-e29b-41d4-a716-446655440004', 'INFO', 'Fetched homepage successfully', '{"url": "https://example.com", "status_code": 200, "content_length": 12456}'),
('550e8400-e29b-41d4-a716-446655440004', 'INFO', 'Extracted 2 claims from content', '{"claims_count": 2, "high_confidence": 1, "medium_confidence": 1}'),
('550e8400-e29b-41d4-a716-446655440004', 'INFO', 'Brand onboarding completed successfully', '{"duration_seconds": 45, "pages_processed": 2, "claims_extracted": 2}')
ON CONFLICT DO NOTHING;

-- Sample API key usage (for billing tracking)
INSERT INTO api_key_usage (api_key_id, brand_id, service_name, request_count, token_count, cost_cents, success_count, error_count, recorded_date) VALUES
((SELECT id FROM api_keys WHERE label = 'openai-primary'), '550e8400-e29b-41d4-a716-446655440003', 'OpenAI GPT', 5, 235, 40, 5, 0, CURRENT_DATE),
((SELECT id FROM api_keys WHERE label = 'claude-primary'), '550e8400-e29b-41d4-a716-446655440003', 'Anthropic Claude', 3, 247, 85, 3, 0, CURRENT_DATE),
((SELECT id FROM api_keys WHERE label = 'serp-primary'), '550e8400-e29b-41d4-a716-446655440003', 'SerpAPI', 10, 0, 25, 9, 1, CURRENT_DATE)
ON CONFLICT DO NOTHING;

-- Sample embedding (with mock vector - in practice this would be a real 1536-dimension vector)
INSERT INTO embeddings (brand_id, source_type, source_id, content, embedding, model_name) VALUES
('550e8400-e29b-41d4-a716-446655440003', 'claim', '550e8400-e29b-41d4-a716-446655440005',
 'Example Corp provides innovative software solutions',
 -- This is a mock vector - in practice would be generated by embedding model
 (SELECT array_agg(random())::vector FROM generate_series(1, 1536)),
 'text-embedding-ada-002')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE users IS 'Extended user profiles with roles and authentication data';
COMMENT ON TABLE brands IS 'Brand entities with domain information and competitor tracking';
COMMENT ON TABLE jobs IS 'Core job queue system for pipeline workflow management';
COMMENT ON TABLE raw_pages IS 'Stored web content with S3 pointers and metadata';
COMMENT ON TABLE claims IS 'Extracted brand claims with evidence and confidence scores';
COMMENT ON TABLE embeddings IS 'Vector embeddings for semantic search using pgvector';
COMMENT ON TABLE llm_results IS 'Individual LLM model responses with cost tracking';
COMMENT ON TABLE scores IS 'Computed brand visibility scores with component breakdown';
COMMENT ON TABLE reports IS 'Assembled reports with PDF generation and status tracking';
COMMENT ON TABLE api_services IS 'External API service configurations';
COMMENT ON TABLE api_keys IS 'Multi-key management with rotation and health monitoring';
COMMENT ON TABLE plans IS 'Billing plans with feature limits and pricing';
COMMENT ON TABLE alerts IS 'System alerts for admin monitoring and acknowledgment';