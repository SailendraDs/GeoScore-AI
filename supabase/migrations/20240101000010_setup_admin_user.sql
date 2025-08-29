-- Setup admin user with initial credentials
-- This migration creates the admin user and sets up proper permissions

-- Create admin user profile (will be linked to auth.users after first login)
INSERT INTO public.users (id, email, role, created_at, updated_at) 
VALUES (
  'admin-user-uuid-placeholder',
  'admin@geoscore.in',
  'admin',
  NOW(),
  NOW()
) ON CONFLICT (email) DO UPDATE SET
  role = 'admin',
  updated_at = NOW();

-- Create admin profile information
INSERT INTO public.user_profiles (
  user_id,
  full_name,
  company_name,
  industry,
  role_title,
  created_at,
  updated_at
)
VALUES (
  'admin-user-uuid-placeholder',
  'System Administrator',
  'GeoScore AI',
  'AI/Technology',
  'System Administrator',
  NOW(),
  NOW()
) ON CONFLICT (user_id) DO UPDATE SET
  full_name = 'System Administrator',
  company_name = 'GeoScore AI',
  industry = 'AI/Technology',
  role_title = 'System Administrator',
  updated_at = NOW();

-- Create default API service configurations
INSERT INTO public.api_services (name, type, adapter_key, is_active, metadata, created_at, updated_at)
VALUES 
  ('OpenAI GPT-4', 'llm', 'openai_gpt4', true, '{"model_name": "gpt-4o", "max_tokens": 4000}', NOW(), NOW()),
  ('Claude Opus', 'llm', 'claude_opus', true, '{"model_name": "claude-3-opus-20240229", "max_tokens": 4000}', NOW(), NOW()),
  ('Gemini Pro', 'llm', 'gemini_pro', true, '{"model_name": "gemini-pro", "max_tokens": 4000}', NOW(), NOW()),
  ('SerpAPI', 'connector', 'serpapi', true, '{"endpoint": "https://serpapi.com/search"}', NOW(), NOW()),
  ('Perplexity Online', 'llm', 'perplexity_online', true, '{"model_name": "pplx-7b-online", "max_tokens": 4000}', NOW(), NOW())
ON CONFLICT (name) DO UPDATE SET
  is_active = true,
  updated_at = NOW();

-- Create default model configurations
INSERT INTO public.model_configs (
  model_name,
  provider,
  is_active,
  max_tokens,
  cost_per_input_token,
  cost_per_output_token,
  rate_limit_rpm,
  rate_limit_tpm,
  default_temperature,
  supported_features,
  created_at,
  updated_at
)
VALUES 
  ('gpt-4o', 'openai', true, 4000, 5.0, 15.0, 500, 10000, 0.7, ARRAY['function_calling', 'json_mode'], NOW(), NOW()),
  ('claude-3-opus-20240229', 'anthropic', true, 4000, 15.0, 75.0, 50, 5000, 0.7, ARRAY['function_calling', 'vision'], NOW(), NOW()),
  ('gemini-pro', 'google', true, 4000, 0.5, 1.5, 300, 8000, 0.7, ARRAY['function_calling'], NOW(), NOW()),
  ('pplx-7b-online', 'perplexity', true, 4000, 1.0, 1.0, 100, 3000, 0.7, ARRAY['web_search'], NOW(), NOW()),
  ('grok-beta', 'x', true, 4000, 5.0, 15.0, 100, 2000, 0.7, ARRAY[], NOW(), NOW())
ON CONFLICT (model_name) DO UPDATE SET
  is_active = true,
  updated_at = NOW();

-- Create system alerts for admin monitoring
INSERT INTO public.alerts (
  type,
  severity,
  title,
  message,
  metadata,
  is_resolved,
  created_at,
  updated_at
)
VALUES 
  ('system', 'info', 'Admin User Setup Complete', 'System administrator account has been configured successfully.', '{"setup_version": "1.0"}', true, NOW(), NOW()),
  ('system', 'info', 'API Services Configured', 'Default API services and model configurations have been set up.', '{"services_count": 5, "models_count": 5}', true, NOW(), NOW())
ON CONFLICT DO NOTHING;

-- Function to setup admin user after auth.users record is created
CREATE OR REPLACE FUNCTION handle_admin_user_setup()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if this is the admin email
  IF NEW.email = 'admin@geoscore.in' THEN
    -- Update our placeholder user record with the real auth UUID
    UPDATE public.users 
    SET id = NEW.id, updated_at = NOW()
    WHERE email = 'admin@geoscore.in' AND id = 'admin-user-uuid-placeholder';
    
    -- Update profile record as well
    UPDATE public.user_profiles
    SET user_id = NEW.id, updated_at = NOW()
    WHERE user_id = 'admin-user-uuid-placeholder';
    
    -- Create alert for admin login
    INSERT INTO public.alerts (
      type, severity, title, message, metadata, is_resolved, created_at, updated_at
    ) VALUES (
      'security', 'info', 'Admin Login Detected', 
      'Administrator account logged in for the first time.', 
      jsonb_build_object('user_id', NEW.id, 'email', NEW.email, 'timestamp', NOW()),
      true, NOW(), NOW()
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to handle admin setup
DROP TRIGGER IF EXISTS on_auth_user_created_admin_setup ON auth.users;
CREATE TRIGGER on_auth_user_created_admin_setup
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE handle_admin_user_setup();

-- Create function to validate admin credentials
CREATE OR REPLACE FUNCTION validate_admin_access(user_email text)
RETURNS boolean AS $$
DECLARE
  user_role text;
BEGIN
  SELECT role INTO user_role 
  FROM public.users 
  WHERE email = user_email;
  
  RETURN user_role IN ('admin', 'super_admin');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- RLS Policies for admin access
CREATE POLICY "Admins can manage all users" ON public.users
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users admin_user 
      WHERE admin_user.id = auth.uid() 
      AND admin_user.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Admins can manage all profiles" ON public.user_profiles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users admin_user 
      WHERE admin_user.id = auth.uid() 
      AND admin_user.role IN ('admin', 'super_admin')
    )
  );

-- Comment on admin setup
COMMENT ON FUNCTION handle_admin_user_setup() IS 'Automatically configures admin user account when admin@geoscore.in signs up';
COMMENT ON FUNCTION validate_admin_access(text) IS 'Validates if a user email has admin access privileges';