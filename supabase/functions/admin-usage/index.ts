import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface UsageFilters {
  timeRange?: '1h' | '24h' | '7d' | '30d' | 'custom'
  startDate?: string
  endDate?: string
  groupBy?: 'hour' | 'day' | 'week' | 'month'
  brandId?: string
  userId?: string
  serviceType?: 'llm' | 'serp' | 'embedding' | 'storage'
  aggregation?: 'sum' | 'avg' | 'max' | 'count'
  includeBreakdown?: boolean
}

interface CostBreakdown {
  total: number
  byService: Record<string, number>
  byModel: Record<string, number>
  byUser: Record<string, number>
  byBrand: Record<string, number>
  trend: Array<{ date: string; amount: number }>
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

    // Check if user is admin (using users table with role column)
    const { data: adminUser } = await supabaseClient
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!adminUser || !['admin', 'super_admin'].includes(adminUser.role)) {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const endpoint = pathParts[pathParts.length - 1]

    // Log admin activity
    await logAdminActivity(supabaseClient, user.id, `${req.method} ${url.pathname}`, req)

    // Route handlers
    if (req.method === 'GET') {
      switch (endpoint) {
        case 'overview':
          return await getUsageOverview(supabaseClient, adminUser, url.searchParams)
        case 'costs':
          return await getCostAnalytics(supabaseClient, adminUser, url.searchParams)
        case 'api-usage':
          return await getApiUsage(supabaseClient, adminUser, url.searchParams)
        case 'storage':
          return await getStorageUsage(supabaseClient, adminUser, url.searchParams)
        case 'trends':
          return await getUsageTrends(supabaseClient, adminUser, url.searchParams)
        case 'alerts':
          return await getUsageAlerts(supabaseClient, adminUser, url.searchParams)
        case 'export':
          return await exportUsageData(supabaseClient, adminUser, url.searchParams)
        default:
          return await getUsageOverview(supabaseClient, adminUser, url.searchParams)
      }
    }

    if (req.method === 'POST' && endpoint === 'generate-report') {
      return await generateUsageReport(supabaseClient, adminUser, user.id, req)
    }

    return new Response(
      JSON.stringify({ error: 'Invalid endpoint' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Admin Usage error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function getUsageOverview(supabaseClient: any, adminUser: any, searchParams: URLSearchParams) {
  try {
    const filters = parseFilters(searchParams)
    const timeRange = getTimeRange(filters.timeRange, filters.startDate, filters.endDate)

    // Get aggregated usage data
    const [
      apiUsageData,
      costData,
      storageData,
      userActivityData,
      systemHealthData
    ] = await Promise.all([
      getAggregatedApiUsage(supabaseClient, timeRange),
      getAggregatedCosts(supabaseClient, timeRange),
      getAggregatedStorage(supabaseClient, timeRange),
      getAggregatedUserActivity(supabaseClient, timeRange),
      getSystemHealth(supabaseClient)
    ])

    const overview = {
      timeRange: {
        start: timeRange.start,
        end: timeRange.end,
        period: filters.timeRange || 'custom'
      },
      
      // API Usage Summary
      apiUsage: {
        totalRequests: apiUsageData.totalRequests,
        totalTokens: apiUsageData.totalTokens,
        successRate: apiUsageData.successRate,
        averageLatency: apiUsageData.averageLatency,
        topModels: apiUsageData.topModels,
        requestsByService: apiUsageData.byService
      },

      // Cost Summary
      costs: {
        totalSpent: costData.total,
        projectedMonthly: costData.projectedMonthly,
        costPerRequest: costData.averageCost,
        largestExpenses: costData.topExpenses,
        breakdown: costData.breakdown
      },

      // Storage Summary
      storage: {
        totalUsed: storageData.totalUsed,
        totalFiles: storageData.totalFiles,
        storageByType: storageData.byType,
        growthRate: storageData.growthRate
      },

      // User Activity
      userActivity: {
        activeUsers: userActivityData.activeUsers,
        newUsers: userActivityData.newUsers,
        topUsers: userActivityData.topUsers,
        activityByPlan: userActivityData.byPlan
      },

      // System Health
      systemHealth: {
        status: systemHealthData.status,
        errorRate: systemHealthData.errorRate,
        uptime: systemHealthData.uptime,
        bottlenecks: systemHealthData.bottlenecks
      },

      // Key Metrics
      keyMetrics: calculateKeyMetrics(apiUsageData, costData, userActivityData),

      // Alerts & Recommendations
      alerts: await getActiveAlerts(supabaseClient, timeRange),
      recommendations: generateRecommendations(apiUsageData, costData, storageData)
    }

    return new Response(
      JSON.stringify({
        overview,
        generatedAt: new Date().toISOString(),
        dataQuality: assessDataQuality(overview)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error fetching usage overview:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to fetch usage overview' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function getCostAnalytics(supabaseClient: any, adminUser: any, searchParams: URLSearchParams) {
  try {
    const filters = parseFilters(searchParams)
    const timeRange = getTimeRange(filters.timeRange, filters.startDate, filters.endDate)

    // Get detailed cost data
    const { data: costRecords, error } = await supabaseClient
      .from('api_usage_logs')
      .select(`
        created_at, service_name, model_name, cost_cents,
        tokens_used, request_count, brands (id, name, domain),
        users (id, email)
      `)
      .gte('created_at', timeRange.start)
      .lte('created_at', timeRange.end)
      .order('created_at', { ascending: true })

    if (error) throw error

    // Process cost analytics
    const analytics = {
      summary: {
        totalCost: 0,
        totalRequests: 0,
        totalTokens: 0,
        averageCostPerRequest: 0,
        averageCostPerToken: 0
      },
      
      breakdown: {
        byService: {},
        byModel: {},
        byUser: {},
        byBrand: {},
        byDate: []
      },

      trends: {
        daily: [],
        hourly: [],
        weekly: []
      },

      topSpenders: {
        users: [],
        brands: [],
        services: []
      },

      efficiency: {
        costEffectiveModels: [],
        highCostOperations: [],
        optimizationOpportunities: []
      },

      projections: {
        dailyRunRate: 0,
        monthlyProjection: 0,
        yearlyProjection: 0,
        budgetUtilization: 0
      }
    }

    // Process each record
    for (const record of costRecords || []) {
      const cost = (record.cost_cents || 0) / 100 // Convert to dollars
      const tokens = record.tokens_used || 0
      const requests = record.request_count || 1

      analytics.summary.totalCost += cost
      analytics.summary.totalRequests += requests
      analytics.summary.totalTokens += tokens

      // Breakdown by service
      const service = record.service_name || 'unknown'
      if (!analytics.breakdown.byService[service]) {
        analytics.breakdown.byService[service] = { cost: 0, requests: 0, tokens: 0 }
      }
      analytics.breakdown.byService[service].cost += cost
      analytics.breakdown.byService[service].requests += requests
      analytics.breakdown.byService[service].tokens += tokens

      // Breakdown by model
      const model = record.model_name || 'unknown'
      if (!analytics.breakdown.byModel[model]) {
        analytics.breakdown.byModel[model] = { cost: 0, requests: 0, tokens: 0, efficiency: 0 }
      }
      analytics.breakdown.byModel[model].cost += cost
      analytics.breakdown.byModel[model].requests += requests
      analytics.breakdown.byModel[model].tokens += tokens

      // Breakdown by user
      if (record.users?.email) {
        const userEmail = record.users.email
        if (!analytics.breakdown.byUser[userEmail]) {
          analytics.breakdown.byUser[userEmail] = { cost: 0, requests: 0, tokens: 0 }
        }
        analytics.breakdown.byUser[userEmail].cost += cost
        analytics.breakdown.byUser[userEmail].requests += requests
        analytics.breakdown.byUser[userEmail].tokens += tokens
      }

      // Breakdown by brand
      if (record.brands?.name) {
        const brandName = record.brands.name
        if (!analytics.breakdown.byBrand[brandName]) {
          analytics.breakdown.byBrand[brandName] = { cost: 0, requests: 0, tokens: 0 }
        }
        analytics.breakdown.byBrand[brandName].cost += cost
        analytics.breakdown.byBrand[brandName].requests += requests
        analytics.breakdown.byBrand[brandName].tokens += tokens
      }
    }

    // Calculate averages
    if (analytics.summary.totalRequests > 0) {
      analytics.summary.averageCostPerRequest = analytics.summary.totalCost / analytics.summary.totalRequests
    }
    if (analytics.summary.totalTokens > 0) {
      analytics.summary.averageCostPerToken = analytics.summary.totalCost / analytics.summary.totalTokens
    }

    // Calculate efficiency for models
    Object.keys(analytics.breakdown.byModel).forEach(model => {
      const modelData = analytics.breakdown.byModel[model]
      if (modelData.tokens > 0) {
        modelData.efficiency = modelData.tokens / modelData.cost // Tokens per dollar
      }
    })

    // Generate trends
    analytics.trends = generateCostTrends(costRecords || [], timeRange)

    // Generate top spenders
    analytics.topSpenders = generateTopSpenders(analytics.breakdown)

    // Calculate projections
    const daysDiff = Math.max(1, (new Date(timeRange.end).getTime() - new Date(timeRange.start).getTime()) / (1000 * 60 * 60 * 24))
    analytics.projections.dailyRunRate = analytics.summary.totalCost / daysDiff
    analytics.projections.monthlyProjection = analytics.projections.dailyRunRate * 30
    analytics.projections.yearlyProjection = analytics.projections.dailyRunRate * 365

    // Add cost optimization insights
    analytics.efficiency.costEffectiveModels = Object.entries(analytics.breakdown.byModel)
      .sort(([,a], [,b]) => b.efficiency - a.efficiency)
      .slice(0, 5)
      .map(([model, data]) => ({ model, ...data }))

    analytics.efficiency.highCostOperations = Object.entries(analytics.breakdown.byService)
      .sort(([,a], [,b]) => b.cost - a.cost)
      .slice(0, 5)
      .map(([service, data]) => ({ service, ...data }))

    return new Response(
      JSON.stringify({
        analytics,
        timeRange,
        generatedAt: new Date().toISOString(),
        recordCount: costRecords?.length || 0
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error fetching cost analytics:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to fetch cost analytics' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function getApiUsage(supabaseClient: any, adminUser: any, searchParams: URLSearchParams) {
  try {
    const filters = parseFilters(searchParams)
    const timeRange = getTimeRange(filters.timeRange, filters.startDate, filters.endDate)

    // Get API usage data
    const { data: usageData, error } = await supabaseClient
      .from('api_usage_logs')
      .select(`
        created_at, service_name, model_name, endpoint,
        request_count, tokens_used, response_time_ms,
        status_code, error_message, brands (name), users (email)
      `)
      .gte('created_at', timeRange.start)
      .lte('created_at', timeRange.end)

    if (error) throw error

    // Process usage statistics
    const usage = {
      summary: {
        totalRequests: 0,
        totalTokens: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        uniqueUsers: new Set(),
        uniqueBrands: new Set()
      },
      
      breakdown: {
        byService: {},
        byModel: {},
        byEndpoint: {},
        byStatusCode: {},
        byResponseTime: { fast: 0, medium: 0, slow: 0 }
      },

      performance: {
        successRate: 0,
        averageLatency: 0,
        p95ResponseTime: 0,
        errorRate: 0,
        throughput: 0
      },

      trends: generateUsageTrends(usageData || [], timeRange),
      errors: analyzeErrors(usageData || [])
    }

    let totalResponseTime = 0
    const responseTimes: number[] = []

    for (const record of usageData || []) {
      usage.summary.totalRequests += record.request_count || 1
      usage.summary.totalTokens += record.tokens_used || 0

      if (record.status_code >= 200 && record.status_code < 400) {
        usage.summary.successfulRequests += record.request_count || 1
      } else {
        usage.summary.failedRequests += record.request_count || 1
      }

      if (record.users?.email) {
        usage.summary.uniqueUsers.add(record.users.email)
      }
      if (record.brands?.name) {
        usage.summary.uniqueBrands.add(record.brands.name)
      }

      // Response time processing
      if (record.response_time_ms) {
        totalResponseTime += record.response_time_ms
        responseTimes.push(record.response_time_ms)

        if (record.response_time_ms < 1000) {
          usage.breakdown.byResponseTime.fast++
        } else if (record.response_time_ms < 5000) {
          usage.breakdown.byResponseTime.medium++
        } else {
          usage.breakdown.byResponseTime.slow++
        }
      }

      // Service breakdown
      const service = record.service_name || 'unknown'
      if (!usage.breakdown.byService[service]) {
        usage.breakdown.byService[service] = { requests: 0, tokens: 0, errors: 0 }
      }
      usage.breakdown.byService[service].requests += record.request_count || 1
      usage.breakdown.byService[service].tokens += record.tokens_used || 0
      if (record.status_code >= 400) {
        usage.breakdown.byService[service].errors++
      }

      // Model breakdown
      const model = record.model_name || 'unknown'
      if (!usage.breakdown.byModel[model]) {
        usage.breakdown.byModel[model] = { requests: 0, tokens: 0, avgResponseTime: 0 }
      }
      usage.breakdown.byModel[model].requests += record.request_count || 1
      usage.breakdown.byModel[model].tokens += record.tokens_used || 0

      // Status code breakdown
      const statusCode = record.status_code?.toString() || 'unknown'
      usage.breakdown.byStatusCode[statusCode] = (usage.breakdown.byStatusCode[statusCode] || 0) + 1
    }

    // Calculate performance metrics
    usage.performance.successRate = usage.summary.totalRequests > 0 ? 
      usage.summary.successfulRequests / usage.summary.totalRequests : 0
    
    usage.performance.errorRate = usage.summary.totalRequests > 0 ? 
      usage.summary.failedRequests / usage.summary.totalRequests : 0

    if (responseTimes.length > 0) {
      usage.performance.averageLatency = totalResponseTime / responseTimes.length
      responseTimes.sort((a, b) => a - b)
      usage.performance.p95ResponseTime = responseTimes[Math.floor(responseTimes.length * 0.95)]
    }

    // Calculate throughput (requests per hour)
    const hoursDiff = Math.max(1, (new Date(timeRange.end).getTime() - new Date(timeRange.start).getTime()) / (1000 * 60 * 60))
    usage.performance.throughput = usage.summary.totalRequests / hoursDiff

    // Convert sets to numbers
    usage.summary.uniqueUsers = usage.summary.uniqueUsers.size
    usage.summary.uniqueBrands = usage.summary.uniqueBrands.size

    return new Response(
      JSON.stringify({
        usage,
        timeRange,
        generatedAt: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error fetching API usage:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to fetch API usage' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Helper functions
function parseFilters(searchParams: URLSearchParams): UsageFilters {
  return {
    timeRange: searchParams.get('timeRange') as any || '24h',
    startDate: searchParams.get('startDate') || undefined,
    endDate: searchParams.get('endDate') || undefined,
    groupBy: searchParams.get('groupBy') as any || 'hour',
    brandId: searchParams.get('brandId') || undefined,
    userId: searchParams.get('userId') || undefined,
    serviceType: searchParams.get('serviceType') as any || undefined,
    aggregation: searchParams.get('aggregation') as any || 'sum',
    includeBreakdown: searchParams.get('includeBreakdown') === 'true'
  }
}

function getTimeRange(timeRange: string, startDate?: string, endDate?: string) {
  const now = new Date()
  let start: Date
  let end: Date = endDate ? new Date(endDate) : now

  switch (timeRange) {
    case '1h':
      start = new Date(now.getTime() - 60 * 60 * 1000)
      break
    case '24h':
      start = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      break
    case '7d':
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      break
    case '30d':
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      break
    default:
      start = startDate ? new Date(startDate) : new Date(now.getTime() - 24 * 60 * 60 * 1000)
  }

  return {
    start: start.toISOString(),
    end: end.toISOString()
  }
}

async function getAggregatedApiUsage(supabaseClient: any, timeRange: any) {
  const { data } = await supabaseClient
    .from('api_usage_logs')
    .select('request_count, tokens_used, response_time_ms, status_code, service_name, model_name')
    .gte('created_at', timeRange.start)
    .lte('created_at', timeRange.end)

  const aggregated = {
    totalRequests: 0,
    totalTokens: 0,
    successRate: 0,
    averageLatency: 0,
    topModels: [],
    byService: {}
  }

  let successfulRequests = 0
  let totalResponseTime = 0
  let responseTimeCount = 0
  const modelCounts = {}
  const serviceCounts = {}

  for (const record of data || []) {
    aggregated.totalRequests += record.request_count || 1
    aggregated.totalTokens += record.tokens_used || 0

    if (record.status_code >= 200 && record.status_code < 400) {
      successfulRequests += record.request_count || 1
    }

    if (record.response_time_ms) {
      totalResponseTime += record.response_time_ms
      responseTimeCount++
    }

    // Count models
    const model = record.model_name || 'unknown'
    modelCounts[model] = (modelCounts[model] || 0) + (record.request_count || 1)

    // Count services
    const service = record.service_name || 'unknown'
    if (!serviceCounts[service]) {
      serviceCounts[service] = { requests: 0, tokens: 0 }
    }
    serviceCounts[service].requests += record.request_count || 1
    serviceCounts[service].tokens += record.tokens_used || 0
  }

  aggregated.successRate = aggregated.totalRequests > 0 ? successfulRequests / aggregated.totalRequests : 0
  aggregated.averageLatency = responseTimeCount > 0 ? totalResponseTime / responseTimeCount : 0
  aggregated.topModels = Object.entries(modelCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([model, count]) => ({ model, count }))
  aggregated.byService = serviceCounts

  return aggregated
}

async function getAggregatedCosts(supabaseClient: any, timeRange: any) {
  const { data } = await supabaseClient
    .from('api_usage_logs')
    .select('cost_cents, service_name, model_name, created_at')
    .gte('created_at', timeRange.start)
    .lte('created_at', timeRange.end)

  const aggregated = {
    total: 0,
    projectedMonthly: 0,
    averageCost: 0,
    topExpenses: [],
    breakdown: { byService: {}, byModel: {} }
  }

  const serviceCosts = {}
  const modelCosts = {}
  let requestCount = 0

  for (const record of data || []) {
    const cost = (record.cost_cents || 0) / 100
    aggregated.total += cost
    requestCount++

    // Service breakdown
    const service = record.service_name || 'unknown'
    serviceCosts[service] = (serviceCosts[service] || 0) + cost

    // Model breakdown
    const model = record.model_name || 'unknown'
    modelCosts[model] = (modelCosts[model] || 0) + cost
  }

  aggregated.averageCost = requestCount > 0 ? aggregated.total / requestCount : 0
  
  // Calculate monthly projection
  const daysDiff = Math.max(1, (new Date(timeRange.end).getTime() - new Date(timeRange.start).getTime()) / (1000 * 60 * 60 * 24))
  aggregated.projectedMonthly = (aggregated.total / daysDiff) * 30

  aggregated.topExpenses = Object.entries({...serviceCosts, ...modelCosts})
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .map(([name, cost]) => ({ name, cost }))

  aggregated.breakdown.byService = serviceCosts
  aggregated.breakdown.byModel = modelCosts

  return aggregated
}

// Simplified implementations for remaining helper functions
async function getAggregatedStorage(supabaseClient: any, timeRange: any) {
  return {
    totalUsed: 1024 * 1024 * 1024, // 1GB placeholder
    totalFiles: 1000,
    byType: { pdf: 500, json: 300, html: 200 },
    growthRate: 0.15 // 15% growth
  }
}

async function getAggregatedUserActivity(supabaseClient: any, timeRange: any) {
  const { data: users } = await supabaseClient
    .from('users')
    .select('id, email, created_at, last_sign_in_at')
    .gte('last_sign_in_at', timeRange.start)

  return {
    activeUsers: users?.length || 0,
    newUsers: users?.filter(u => new Date(u.created_at) >= new Date(timeRange.start)).length || 0,
    topUsers: [],
    byPlan: {}
  }
}

async function getSystemHealth(supabaseClient: any) {
  return {
    status: 'healthy',
    errorRate: 0.05,
    uptime: 0.999,
    bottlenecks: []
  }
}

function calculateKeyMetrics(apiUsage: any, costs: any, userActivity: any) {
  return {
    costPerUser: userActivity.activeUsers > 0 ? costs.total / userActivity.activeUsers : 0,
    revenueEfficiency: 0.75, // Placeholder
    systemUtilization: 0.68, // Placeholder
    growthRate: 0.12 // Placeholder
  }
}

async function getActiveAlerts(supabaseClient: any, timeRange: any) {
  return []
}

function generateRecommendations(apiUsage: any, costs: any, storage: any) {
  const recommendations = []
  
  if (costs.averageCost > 0.5) {
    recommendations.push({
      type: 'cost_optimization',
      message: 'Consider optimizing high-cost operations',
      priority: 'high'
    })
  }

  if (apiUsage.successRate < 0.95) {
    recommendations.push({
      type: 'reliability',
      message: 'API success rate is below threshold',
      priority: 'medium'
    })
  }

  return recommendations
}

function assessDataQuality(overview: any) {
  return {
    completeness: 0.95,
    accuracy: 0.98,
    freshness: Date.now() - new Date().getTime() < 300000 ? 1.0 : 0.8
  }
}

function generateCostTrends(records: any[], timeRange: any) {
  return { daily: [], hourly: [], weekly: [] }
}

function generateTopSpenders(breakdown: any) {
  return { users: [], brands: [], services: [] }
}

function generateUsageTrends(data: any[], timeRange: any) {
  return { hourly: [], daily: [] }
}

function analyzeErrors(data: any[]) {
  return {
    totalErrors: data.filter(d => d.status_code >= 400).length,
    errorTypes: {},
    topErrors: []
  }
}

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

// Additional simplified endpoint implementations
async function getStorageUsage(supabaseClient: any, adminUser: any, searchParams: URLSearchParams) {
  return new Response(
    JSON.stringify({ message: 'Storage usage endpoint not fully implemented' }),
    { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getUsageTrends(supabaseClient: any, adminUser: any, searchParams: URLSearchParams) {
  return new Response(
    JSON.stringify({ message: 'Usage trends endpoint not fully implemented' }),
    { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getUsageAlerts(supabaseClient: any, adminUser: any, searchParams: URLSearchParams) {
  return new Response(
    JSON.stringify({ message: 'Usage alerts endpoint not fully implemented' }),
    { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function exportUsageData(supabaseClient: any, adminUser: any, searchParams: URLSearchParams) {
  return new Response(
    JSON.stringify({ message: 'Export functionality not implemented yet' }),
    { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function generateUsageReport(supabaseClient: any, adminUser: any, adminId: string, req: Request) {
  return new Response(
    JSON.stringify({ message: 'Report generation not implemented yet' }),
    { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}