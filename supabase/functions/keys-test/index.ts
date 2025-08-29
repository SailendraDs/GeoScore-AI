import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TestResult {
  service: string
  success: boolean
  responseTime: number
  statusCode?: number
  errorMessage?: string
  testType: 'connectivity' | 'authentication' | 'rate_limit'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Verify admin permissions
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: adminData, error: adminError } = await supabaseClient
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (adminError || !adminData?.is_admin) {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { serviceId, testType = 'connectivity' } = await req.json()

    if (!serviceId) {
      return new Response(
        JSON.stringify({ error: 'Missing serviceId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get service and key info
    const { data: keyData, error: keyError } = await supabaseClient
      .from('api_keys')
      .select(`
        *,
        api_services (
          name,
          type,
          base_url,
          rate_limits,
          status
        )
      `)
      .eq('service_id', serviceId)
      .eq('is_active', true)
      .limit(1)
      .single()

    if (keyError || !keyData) {
      return new Response(
        JSON.stringify({ error: 'Active key not found for service' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const service = keyData.api_services
    const results: TestResult[] = []

    // Test based on service type
    if (service.type === 'llm') {
      const llmResults = await testLLMService(service.name, service.base_url, keyData.vault_key_id)
      results.push(...llmResults)
    } else if (service.type === 'connector') {
      const connectorResults = await testConnectorService(service.name, service.base_url, keyData.vault_key_id)
      results.push(...connectorResults)
    }

    // Update usage count
    await supabaseClient
      .from('api_keys')
      .update({
        usage_count: (keyData.usage_count || 0) + 1,
        last_used: new Date().toISOString(),
      })
      .eq('id', keyData.id)

    return new Response(
      JSON.stringify({
        service: service.name,
        serviceType: service.type,
        testResults: results,
        overall: {
          success: results.every(r => r.success),
          averageResponseTime: results.reduce((sum, r) => sum + r.responseTime, 0) / results.length,
        },
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Key test error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function testLLMService(serviceName: string, baseUrl: string, keyId: string): Promise<TestResult[]> {
  const results: TestResult[] = []
  
  // Basic connectivity test
  const connectivityStart = Date.now()
  try {
    const response = await fetch(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${keyId}`, // In production, retrieve from vault
        'Content-Type': 'application/json',
      },
    })
    
    results.push({
      service: serviceName,
      success: response.ok,
      responseTime: Date.now() - connectivityStart,
      statusCode: response.status,
      testType: 'connectivity',
      errorMessage: response.ok ? undefined : `HTTP ${response.status}`,
    })
  } catch (error) {
    results.push({
      service: serviceName,
      success: false,
      responseTime: Date.now() - connectivityStart,
      testType: 'connectivity',
      errorMessage: error.message,
    })
  }

  return results
}

async function testConnectorService(serviceName: string, baseUrl: string, keyId: string): Promise<TestResult[]> {
  const results: TestResult[] = []
  
  const connectivityStart = Date.now()
  try {
    let testEndpoint = ''
    
    // Service-specific test endpoints
    if (serviceName === 'semrush') {
      testEndpoint = '/analytics/v1/?type=domain_organic&key=' + keyId + '&display_limit=1&domain=example.com'
    } else if (serviceName === 'similarweb') {
      testEndpoint = '/v1/website/example.com/total-traffic-and-engagement/visits?api_key=' + keyId + '&start_date=2023-01&end_date=2023-01'
    } else if (serviceName === 'serpapi') {
      testEndpoint = '/search?q=test&api_key=' + keyId + '&num=1'
    } else {
      // Generic test
      testEndpoint = '/health'
    }
    
    const response = await fetch(`${baseUrl}${testEndpoint}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'GeoScore-Health-Check/1.0',
      },
    })
    
    results.push({
      service: serviceName,
      success: response.ok,
      responseTime: Date.now() - connectivityStart,
      statusCode: response.status,
      testType: 'connectivity',
      errorMessage: response.ok ? undefined : `HTTP ${response.status}`,
    })
    
  } catch (error) {
    results.push({
      service: serviceName,
      success: false,
      responseTime: Date.now() - connectivityStart,
      testType: 'connectivity',
      errorMessage: error.message,
    })
  }

  return results
}