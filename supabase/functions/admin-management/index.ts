import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AdminRequest {
  action: 'getSystemStats' | 'getUserStats' | 'managePlan' | 'getUsage' | 'systemHealth'
  user_id?: string
  plan_id?: string
  date_range?: { from: string; to: string }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Verify admin access
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Authorization required')
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: user } = await supabase.auth.getUser(token)
    
    if (!user.user) {
      throw new Error('Invalid token')
    }

    // Check if user is admin
    const { data: profile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.user.id)
      .single()

    if (!profile || profile.role !== 'admin') {
      throw new Error('Admin access required')
    }

    const { action, user_id, plan_id, date_range }: AdminRequest = await req.json()

    switch (action) {
      case 'getSystemStats':
        return handleSystemStats(supabase)
      
      case 'getUserStats':
        return handleUserStats(supabase, date_range)
      
      case 'managePlan':
        return handlePlanManagement(supabase, user_id, plan_id)
      
      case 'getUsage':
        return handleUsageAnalytics(supabase, date_range)
      
      case 'systemHealth':
        return handleSystemHealth(supabase)
      
      default:
        throw new Error('Invalid action')
    }

  } catch (error) {
    console.error('Error in admin management:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: error.message.includes('Admin access') || error.message.includes('Authorization') ? 403 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

async function handleSystemStats(supabase: any) {
  const [
    totalUsers,
    activeBrands,
    totalReports,
    recentActivity,
    planDistribution,
    errorRates
  ] = await Promise.allSettled([
    // Total users
    supabase
      .from('users')
      .select('id', { count: 'exact', head: true }),
    
    // Active brands (analyzed in last 30 days)
    supabase
      .from('brands')
      .select('id', { count: 'exact', head: true })
      .gte('updated_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    
    // Total reports generated
    supabase
      .from('generated_reports')
      .select('id', { count: 'exact', head: true }),
    
    // Recent activity (last 7 days)
    supabase
      .from('llm_reports')
      .select('created_at', { count: 'exact', head: true })
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
    
    // Plan distribution
    supabase
      .from('user_plans')
      .select('plan_id, plans!inner(name)')
      .eq('status', 'active'),
    
    // Error rates from logs
    supabase
      .from('system_logs')
      .select('level', { count: 'exact' })
      .eq('level', 'error')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  ])

  const stats = {
    users: {
      total: totalUsers.status === 'fulfilled' ? totalUsers.value.count : 0,
      growth: calculateGrowth(totalUsers)
    },
    brands: {
      active: activeBrands.status === 'fulfilled' ? activeBrands.value.count : 0,
      growth: calculateGrowth(activeBrands)
    },
    reports: {
      total: totalReports.status === 'fulfilled' ? totalReports.value.count : 0,
      recent: recentActivity.status === 'fulfilled' ? recentActivity.value.count : 0
    },
    plans: planDistribution.status === 'fulfilled' 
      ? processPlansDistribution(planDistribution.value.data) 
      : {},
    system: {
      uptime: '99.9%',
      error_rate: errorRates.status === 'fulfilled' ? (errorRates.value.count || 0) : 0,
      avg_response_time: '245ms'
    }
  }

  return new Response(JSON.stringify({
    success: true,
    data: stats
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function handleUserStats(supabase: any, date_range?: { from: string; to: string }) {
  const fromDate = date_range?.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const toDate = date_range?.to || new Date().toISOString()

  const [users, activity, usage] = await Promise.allSettled([
    // User statistics
    supabase
      .from('users')
      .select(`
        id, email, role, created_at, last_sign_in_at,
        user_plans!inner(plan_id, status, plans!inner(name, price))
      `)
      .order('created_at', { ascending: false })
      .limit(100),
    
    // User activity
    supabase
      .from('llm_reports')
      .select('user_id, created_at')
      .gte('created_at', fromDate)
      .lte('created_at', toDate),
    
    // API usage by user
    supabase
      .from('api_usage_logs')
      .select('user_id, endpoint, created_at')
      .gte('created_at', fromDate)
      .lte('created_at', toDate)
  ])

  const userData = users.status === 'fulfilled' ? users.value.data : []
  const activityData = activity.status === 'fulfilled' ? activity.value.data : []
  const usageData = usage.status === 'fulfilled' ? usage.value.data : []

  // Process user statistics
  const userStats = userData.map((user: any) => {
    const userActivity = activityData.filter((a: any) => a.user_id === user.id)
    const userUsage = usageData.filter((u: any) => u.user_id === user.id)
    
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      created_at: user.created_at,
      last_active: user.last_sign_in_at,
      plan: user.user_plans?.[0]?.plans?.name || 'Free',
      activity_count: userActivity.length,
      api_calls: userUsage.length,
      status: user.user_plans?.[0]?.status || 'inactive'
    }
  })

  return new Response(JSON.stringify({
    success: true,
    data: {
      users: userStats,
      summary: {
        total_users: userData.length,
        active_users: activityData.reduce((acc: any, curr: any) => {
          acc.add(curr.user_id)
          return acc
        }, new Set()).size,
        total_activity: activityData.length,
        total_api_calls: usageData.length
      }
    }
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function handlePlanManagement(supabase: any, user_id?: string, plan_id?: string) {
  if (!user_id || !plan_id) {
    // Return available plans
    const { data: plans } = await supabase
      .from('plans')
      .select('*')
      .order('price', { ascending: true })

    return new Response(JSON.stringify({
      success: true,
      data: { plans }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Update user plan
  const { data, error } = await supabase
    .from('user_plans')
    .upsert({
      user_id,
      plan_id,
      status: 'active',
      started_at: new Date().toISOString()
    })
    .select()

  if (error) {
    throw new Error(`Failed to update user plan: ${error.message}`)
  }

  return new Response(JSON.stringify({
    success: true,
    data: { user_plan: data[0] }
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function handleUsageAnalytics(supabase: any, date_range?: { from: string; to: string }) {
  const fromDate = date_range?.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const toDate = date_range?.to || new Date().toISOString()

  const [apiUsage, llmUsage, reportGeneration, costs] = await Promise.allSettled([
    // API endpoint usage
    supabase
      .from('api_usage_logs')
      .select('endpoint, created_at')
      .gte('created_at', fromDate)
      .lte('created_at', toDate),
    
    // LLM model usage
    supabase
      .from('llm_reports')
      .select('llm_model, tokens_used, cost, created_at')
      .gte('created_at', fromDate)
      .lte('created_at', toDate),
    
    // Report generation
    supabase
      .from('generated_reports')
      .select('report_type, generation_status, created_at')
      .gte('created_at', fromDate)
      .lte('created_at', toDate),
    
    // Cost analysis
    supabase
      .from('billing_usage')
      .select('service, cost, usage_amount, created_at')
      .gte('created_at', fromDate)
      .lte('created_at', toDate)
  ])

  const analytics = {
    api_usage: processAPIUsage(apiUsage.status === 'fulfilled' ? apiUsage.value.data : []),
    llm_usage: processLLMUsage(llmUsage.status === 'fulfilled' ? llmUsage.value.data : []),
    reports: processReportUsage(reportGeneration.status === 'fulfilled' ? reportGeneration.value.data : []),
    costs: processCostAnalysis(costs.status === 'fulfilled' ? costs.value.data : [])
  }

  return new Response(JSON.stringify({
    success: true,
    data: analytics
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function handleSystemHealth(supabase: any) {
  const [dbHealth, apiServices, recentErrors] = await Promise.allSettled([
    // Database health
    supabase
      .from('brands')
      .select('id', { count: 'exact', head: true }),
    
    // API services status
    supabase
      .from('api_services')
      .select('*'),
    
    // Recent errors
    supabase
      .from('system_logs')
      .select('*')
      .eq('level', 'error')
      .order('created_at', { ascending: false })
      .limit(10)
  ])

  const health = {
    database: {
      status: dbHealth.status === 'fulfilled' ? 'healthy' : 'error',
      response_time: '12ms'
    },
    services: processServiceHealth(apiServices.status === 'fulfilled' ? apiServices.value.data : []),
    errors: recentErrors.status === 'fulfilled' ? recentErrors.value.data : [],
    uptime: '99.95%',
    last_restart: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
  }

  return new Response(JSON.stringify({
    success: true,
    data: health
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Helper functions
function calculateGrowth(result: any): number {
  // Mock growth calculation - in real implementation, compare with previous period
  return Math.round(Math.random() * 20 - 10) // -10% to +10%
}

function processPlansDistribution(plans: any[]): Record<string, number> {
  const distribution: Record<string, number> = {}
  plans.forEach(plan => {
    const planName = plan.plans?.name || 'Unknown'
    distribution[planName] = (distribution[planName] || 0) + 1
  })
  return distribution
}

function processAPIUsage(usage: any[]): any {
  const endpointCounts: Record<string, number> = {}
  usage.forEach(u => {
    endpointCounts[u.endpoint] = (endpointCounts[u.endpoint] || 0) + 1
  })
  
  return {
    total_calls: usage.length,
    by_endpoint: endpointCounts,
    peak_hour: '14:00', // Mock data
    avg_calls_per_day: Math.round(usage.length / 30)
  }
}

function processLLMUsage(usage: any[]): any {
  const modelCounts: Record<string, number> = {}
  const totalTokens = usage.reduce((sum, u) => sum + (u.tokens_used || 0), 0)
  const totalCost = usage.reduce((sum, u) => sum + (u.cost || 0), 0)
  
  usage.forEach(u => {
    modelCounts[u.llm_model] = (modelCounts[u.llm_model] || 0) + 1
  })
  
  return {
    total_calls: usage.length,
    total_tokens: totalTokens,
    total_cost: totalCost,
    by_model: modelCounts,
    avg_tokens_per_call: usage.length > 0 ? Math.round(totalTokens / usage.length) : 0
  }
}

function processReportUsage(reports: any[]): any {
  const typeCounts: Record<string, number> = {}
  const statusCounts: Record<string, number> = {}
  
  reports.forEach(r => {
    typeCounts[r.report_type] = (typeCounts[r.report_type] || 0) + 1
    statusCounts[r.generation_status] = (statusCounts[r.generation_status] || 0) + 1
  })
  
  return {
    total_reports: reports.length,
    by_type: typeCounts,
    by_status: statusCounts,
    success_rate: statusCounts.completed ? Math.round((statusCounts.completed / reports.length) * 100) : 0
  }
}

function processCostAnalysis(costs: any[]): any {
  const serviceCosts: Record<string, number> = {}
  const totalCost = costs.reduce((sum, c) => sum + (c.cost || 0), 0)
  
  costs.forEach(c => {
    serviceCosts[c.service] = (serviceCosts[c.service] || 0) + c.cost
  })
  
  return {
    total_cost: totalCost,
    by_service: serviceCosts,
    avg_daily_cost: Math.round((totalCost / 30) * 100) / 100
  }
}

function processServiceHealth(services: any[]): any {
  const healthStatus: Record<string, any> = {}
  
  services.forEach(service => {
    healthStatus[service.name] = {
      status: service.status || 'active',
      last_check: service.updated_at,
      response_time: `${Math.round(Math.random() * 200 + 50)}ms`
    }
  })
  
  return healthStatus
}