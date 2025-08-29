import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AdminUserListRequest {
  page?: number
  limit?: number
  search?: string
  status?: string
}

interface ImpersonateRequest {
  targetUserId: string
  duration?: number // in minutes
}

interface UpdateUserRequest {
  userId: string
  role?: string
  status?: 'active' | 'suspended' | 'archived'
  notes?: string
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

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if user is admin
    const { data: adminUser } = await supabaseClient
      .from('admins')
      .select('role, permissions')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (!adminUser) {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const section = pathParts[pathParts.length - 2] || ''
    const action = pathParts[pathParts.length - 1] || ''

    // Log admin activity
    await logAdminActivity(supabaseClient, user.id, `${req.method} ${url.pathname}`, req)

    if (req.method === 'GET') {
      switch (section) {
        case 'users':
          return await getUsers(supabaseClient, adminUser, url.searchParams)
        case 'brands':
          return await getBrands(supabaseClient, adminUser, url.searchParams)
        case 'system':
          return await getSystemHealth(supabaseClient, adminUser)
        case 'analytics':
          return await getSystemAnalytics(supabaseClient, adminUser, url.searchParams)
        default:
          return await getAdminDashboard(supabaseClient, adminUser)
      }
    }

    if (req.method === 'POST') {
      switch (action) {
        case 'impersonate':
          return await impersonateUser(supabaseClient, adminUser, user.id, req)
        case 'update-user':
          return await updateUser(supabaseClient, adminUser, user.id, req)
        case 'update-brand':
          return await updateBrand(supabaseClient, adminUser, user.id, req)
        case 'generate-schema':
          return await adminGenerateSchema(supabaseClient, adminUser, user.id, req)
        case 'create-prompt':
          return await adminCreatePrompt(supabaseClient, adminUser, user.id, req)
        default:
          return new Response(
            JSON.stringify({ error: 'Invalid action' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
      }
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Admin panel error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function logAdminActivity(supabaseClient: any, adminId: string, action: string, req: Request) {
  try {
    await supabaseClient
      .from('admin_logs')
      .insert({
        admin_id: adminId,
        action,
        ip_address: req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For'),
        user_agent: req.headers.get('User-Agent'),
        details: { timestamp: new Date().toISOString() }
      })
  } catch (error) {
    console.warn('Failed to log admin activity:', error)
  }
}

async function getUsers(supabaseClient: any, adminUser: any, searchParams: URLSearchParams): Promise<Response> {
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')
  const search = searchParams.get('search')
  const status = searchParams.get('status')
  
  const offset = (page - 1) * limit

  let query = supabaseClient
    .from('users')
    .select(`
      id, email, created_at, last_sign_in_at, role,
      user_plans!left(status, plans!inner(name)),
      brands(count),
      _count:llm_reports(count)
    `)
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false })

  if (search) {
    query = query.ilike('email', `%${search}%`)
  }

  if (status) {
    query = query.eq('user_plans.status', status)
  }

  const { data: users, error } = await query

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch users' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get total count for pagination
  const { count } = await supabaseClient
    .from('users')
    .select('*', { count: 'exact', head: true })

  const formattedUsers = (users || []).map(user => ({
    id: user.id,
    email: user.email,
    role: user.role || 'user',
    planName: user.user_plans?.[0]?.plans?.name || 'Free',
    brandCount: user.brands?.[0]?.count || 0,
    lastActive: user.last_sign_in_at,
    status: user.user_plans?.[0]?.status || 'inactive',
    reportCount: user._count || 0
  }))

  return new Response(
    JSON.stringify({
      users: formattedUsers,
      pagination: {
        page,
        total: count || 0,
        pageSize: limit
      }
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getBrands(supabaseClient: any, adminUser: any, searchParams: URLSearchParams): Promise<Response> {
  const { data: brands, error } = await supabaseClient
    .from('brands')
    .select(`
      id, name, domain, created_at, industry,
      users!inner(email),
      brand_setup_state(is_complete),
      _count:llm_reports(count)
    `)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch brands' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const formattedBrands = (brands || []).map(brand => ({
    id: brand.id,
    name: brand.name,
    domain: brand.domain,
    owner: {
      id: brand.users.id,
      email: brand.users.email
    },
    setupComplete: brand.brand_setup_state?.[0]?.is_complete || false,
    lastReportDate: new Date().toISOString(), // Would get from actual data
    totalReports: brand._count || 0,
    industry: brand.industry
  }))

  return new Response(
    JSON.stringify({ brands: formattedBrands }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getSystemHealth(supabaseClient: any, adminUser: any): Promise<Response> {
  // Check various system components
  const healthChecks = await Promise.allSettled([
    checkDatabaseHealth(supabaseClient),
    checkLLMServices(),
    checkExternalAPIs(),
    checkStorageHealth()
  ])

  const services = [
    { name: 'Database', status: healthChecks[0].status === 'fulfilled' ? 'healthy' : 'down', responseTime: 50 },
    { name: 'LLM Services', status: healthChecks[1].status === 'fulfilled' ? 'healthy' : 'degraded', responseTime: 200 },
    { name: 'External APIs', status: healthChecks[2].status === 'fulfilled' ? 'healthy' : 'degraded', responseTime: 150 },
    { name: 'Storage', status: healthChecks[3].status === 'fulfilled' ? 'healthy' : 'down', responseTime: 30 }
  ]

  const overallStatus = services.every(s => s.status === 'healthy') ? 'healthy' :
    services.some(s => s.status === 'down') ? 'down' : 'degraded'

  // Get system metrics
  const { data: recentReports } = await supabaseClient
    .from('llm_reports')
    .select('created_at')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

  const { data: activeUsers } = await supabaseClient
    .from('users')
    .select('id')
    .gte('last_sign_in_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

  const healthData = {
    status: overallStatus,
    services,
    metrics: {
      activeUsers: activeUsers?.length || 0,
      reportsGenerated24h: recentReports?.length || 0,
      errorRate: 0.1, // Would calculate from logs
      avgResponseTime: services.reduce((sum, s) => sum + s.responseTime, 0) / services.length
    }
  }

  return new Response(
    JSON.stringify(healthData),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function checkDatabaseHealth(supabaseClient: any): Promise<boolean> {
  try {
    await supabaseClient.from('users').select('id').limit(1)
    return true
  } catch {
    return false
  }
}

async function checkLLMServices(): Promise<boolean> {
  // Would check LLM service availability
  return true
}

async function checkExternalAPIs(): Promise<boolean> {
  // Would check external API status
  return true
}

async function checkStorageHealth(): Promise<boolean> {
  // Would check storage system
  return true
}

async function getSystemAnalytics(supabaseClient: any, adminUser: any, searchParams: URLSearchParams): Promise<Response> {
  const timeRange = searchParams.get('timeRange') || '7d'
  const days = parseInt(timeRange.replace('d', ''))
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  // Get user growth
  const { data: newUsers } = await supabaseClient
    .from('users')
    .select('created_at')
    .gte('created_at', fromDate.toISOString())

  // Get report generation trends
  const { data: reports } = await supabaseClient
    .from('llm_reports')
    .select('created_at, cost_estimate, model_name')
    .gte('created_at', fromDate.toISOString())

  // Process analytics data
  const userGrowth = processTimeSeries(newUsers || [], 'created_at', days)
  const reportTrends = processTimeSeries(reports || [], 'created_at', days)
  const totalCost = (reports || []).reduce((sum, r) => sum + (r.cost_estimate || 0), 0)

  const analytics = {
    userGrowth,
    reportTrends,
    cost: {
      total: totalCost,
      byModel: processModelCosts(reports || [])
    },
    summary: {
      newUsers: newUsers?.length || 0,
      totalReports: reports?.length || 0,
      averageCost: reports?.length > 0 ? totalCost / reports.length : 0
    }
  }

  return new Response(
    JSON.stringify(analytics),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

function processTimeSeries(data: any[], dateField: string, days: number) {
  const result = []
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const count = data.filter(item => item[dateField].startsWith(date)).length
    result.unshift({ date, count })
  }
  return result
}

function processModelCosts(reports: any[]) {
  return reports.reduce((acc, report) => {
    const model = report.model_name || 'unknown'
    acc[model] = (acc[model] || 0) + (report.cost_estimate || 0)
    return acc
  }, {})
}

async function getAdminDashboard(supabaseClient: any, adminUser: any): Promise<Response> {
  // Get overview statistics
  const [usersResult, brandsResult, reportsResult, alertsResult] = await Promise.allSettled([
    supabaseClient.from('users').select('*', { count: 'exact', head: true }),
    supabaseClient.from('brands').select('*', { count: 'exact', head: true }),
    supabaseClient.from('llm_reports').select('*', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    supabaseClient.from('live_alerts').select('*', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  ])

  const dashboard = {
    overview: {
      totalUsers: usersResult.status === 'fulfilled' ? usersResult.value.count : 0,
      totalBrands: brandsResult.status === 'fulfilled' ? brandsResult.value.count : 0,
      reportsToday: reportsResult.status === 'fulfilled' ? reportsResult.value.count : 0,
      alertsToday: alertsResult.status === 'fulfilled' ? alertsResult.value.count : 0
    },
    adminInfo: {
      role: adminUser.role,
      permissions: adminUser.permissions || {},
      lastLogin: new Date().toISOString()
    },
    quickActions: [
      'View System Health',
      'Manage Users',
      'Monitor Reports',
      'Review Alerts'
    ]
  }

  return new Response(
    JSON.stringify(dashboard),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function impersonateUser(supabaseClient: any, adminUser: any, adminId: string, req: Request): Promise<Response> {
  const { targetUserId, duration = 60 }: ImpersonateRequest = await req.json()

  if (adminUser.role !== 'super_admin') {
    return new Response(
      JSON.stringify({ error: 'Insufficient permissions' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get target user
  const { data: targetUser, error } = await supabaseClient
    .from('users')
    .select('*')
    .eq('id', targetUserId)
    .single()

  if (error || !targetUser) {
    return new Response(
      JSON.stringify({ error: 'User not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Generate impersonation token (simplified - in production would use proper JWT)
  const impersonationToken = `imp_${targetUserId}_${Date.now()}_${adminId}`
  const expiresAt = new Date(Date.now() + duration * 60 * 1000)

  // Log impersonation
  await supabaseClient
    .from('admin_logs')
    .insert({
      admin_id: adminId,
      action: 'impersonate_user',
      resource_type: 'user',
      resource_id: targetUserId,
      details: {
        targetEmail: targetUser.email,
        duration,
        impersonationToken
      }
    })

  return new Response(
    JSON.stringify({
      token: impersonationToken,
      expiresAt: expiresAt.toISOString(),
      targetUser: {
        id: targetUser.id,
        email: targetUser.email,
        role: targetUser.role
      }
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function updateUser(supabaseClient: any, adminUser: any, adminId: string, req: Request): Promise<Response> {
  const { userId, role, status, notes }: UpdateUserRequest = await req.json()

  const updates: any = {}
  if (role) updates.role = role
  if (status) updates.status = status
  if (notes) updates.admin_notes = notes

  const { data: updatedUser, error } = await supabaseClient
    .from('users')
    .update(updates)
    .eq('id', userId)
    .select()
    .single()

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to update user' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Log the update
  await supabaseClient
    .from('admin_logs')
    .insert({
      admin_id: adminId,
      action: 'update_user',
      resource_type: 'user',
      resource_id: userId,
      details: { updates, previousData: updatedUser }
    })

  return new Response(
    JSON.stringify({
      user: updatedUser,
      message: 'User updated successfully'
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function updateBrand(supabaseClient: any, adminUser: any, adminId: string, req: Request): Promise<Response> {
  const { brandId, name, status, notes } = await req.json()

  const updates: any = {}
  if (name) updates.name = name
  if (status) updates.status = status
  if (notes) updates.admin_notes = notes

  const { data: updatedBrand, error } = await supabaseClient
    .from('brands')
    .update(updates)
    .eq('id', brandId)
    .select()
    .single()

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to update brand' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({
      brand: updatedBrand,
      message: 'Brand updated successfully'
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function adminGenerateSchema(supabaseClient: any, adminUser: any, adminId: string, req: Request): Promise<Response> {
  const { brandId, schemaType, overrideData, model = 'gpt-4', forceRegenerate = false } = await req.json()

  // Generate schema using the schema builder function
  const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/schema-builder/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
    },
    body: JSON.stringify({
      brandId,
      schemaType,
      includeFields: ['name', 'url', 'description', 'logo', 'address'],
      customData: overrideData,
      model
    })
  })

  const result = await response.json()

  // Log admin schema generation
  await supabaseClient
    .from('admin_logs')
    .insert({
      admin_id: adminId,
      action: 'generate_schema',
      resource_type: 'schema',
      resource_id: brandId,
      details: { schemaType, model, forceRegenerate }
    })

  return new Response(
    JSON.stringify(result),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function adminCreatePrompt(supabaseClient: any, adminUser: any, adminId: string, req: Request): Promise<Response> {
  const { brandId, prompt, intentType, tags = [], isTemplate = false } = await req.json()

  const { data: newPrompt, error } = await supabaseClient
    .from('brand_prompts')
    .insert({
      brand_id: brandId,
      prompt,
      intent_type: intentType,
      generated_by: 'admin',
      is_active: true,
      performance_score: isTemplate ? 1.0 : null
    })
    .select()
    .single()

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to create prompt' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({
      prompt: newPrompt,
      message: 'Prompt created successfully'
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}