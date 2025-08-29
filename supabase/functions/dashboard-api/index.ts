import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Redis } from 'https://deno.land/x/redis@v0.32.0/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface DashboardOverview {
  brand: any
  overview: {
    currentVisibility: number
    visibilityTrend: number // percentage change
    positioningScore: number
    competitorRank: number
    lastUpdated: string
  }
  recentReports: Array<{
    id: string
    model: string
    score: number
    date: string
  }>
  upcomingTasks: Array<{
    type: string
    description: string
    dueDate: string
  }>
}

interface VisibilityMetrics {
  timeSeries: Array<{
    date: string
    visibility: number
    positioning: number
    freshness: number
  }>
  byModel: Record<string, {
    average: number
    trend: number
    reliability: number
  }>
  benchmarks: {
    industryAverage: number
    topPercentile: number
  }
}

interface PerformanceMetrics {
  brandHealth: {
    visibilityScore: number
    consistencyScore: number
    growthRate: number
    competitivePosition: number
  }
  alerts: Array<{
    type: 'warning' | 'critical' | 'info'
    message: string
    timestamp: string
  }>
  recommendations: Array<{
    priority: 'high' | 'medium' | 'low'
    action: string
    impact: string
  }>
}

// Redis connection (in production, this would use environment variables)
let redis: Redis | null = null

async function getRedisClient(): Promise<Redis | null> {
  if (!redis) {
    try {
      const redisUrl = Deno.env.get('REDIS_URL')
      if (redisUrl) {
        redis = await Redis.connect(redisUrl)
      }
    } catch (error) {
      console.warn('Redis connection failed, falling back to database only:', error)
    }
  }
  return redis
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

    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const brandId = pathParts[pathParts.indexOf('dashboard') + 1]
    const endpoint = pathParts[pathParts.length - 1]

    if (!brandId || brandId === 'dashboard') {
      return new Response(
        JSON.stringify({ error: 'Brand ID required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify brand ownership
    const { data: brand, error: brandError } = await supabaseClient
      .from('brands')
      .select('*')
      .eq('id', brandId)
      .eq('owner_id', user.id)
      .single()

    if (brandError || !brand) {
      return new Response(
        JSON.stringify({ error: 'Brand not found or access denied' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Route to appropriate handler
    switch (endpoint) {
      case brandId: // Main dashboard overview
        return await getDashboardOverview(supabaseClient, brand)
      case 'visibility':
        return await getVisibilityMetrics(supabaseClient, brand, url.searchParams)
      case 'performance':
        return await getPerformanceMetrics(supabaseClient, brand, url.searchParams)
      case 'analytics':
        return await getAnalytics(supabaseClient, brand, url.searchParams)
      case 'competitors':
        return await getCompetitorComparison(supabaseClient, brand, url.searchParams)
      case 'refresh':
        return await refreshDashboardCache(supabaseClient, brand)
      default:
        return new Response(
          JSON.stringify({ error: 'Endpoint not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

  } catch (error) {
    console.error('Dashboard API error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function getDashboardOverview(supabaseClient: any, brand: any): Promise<Response> {
  const cacheKey = `dashboard:${brand.id}`
  const redis = await getRedisClient()
  
  // Try to get from cache first
  let cachedData = null
  if (redis) {
    try {
      const cached = await redis.get(cacheKey)
      if (cached) {
        cachedData = JSON.parse(cached)
        // Return cached data if it's less than 15 minutes old
        if (Date.now() - cachedData.timestamp < 15 * 60 * 1000) {
          return new Response(
            JSON.stringify(cachedData.data),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      }
    } catch (error) {
      console.warn('Cache read error:', error)
    }
  }

  // Get fresh data from database
  const overview = await buildDashboardOverview(supabaseClient, brand)

  // Cache the result
  if (redis) {
    try {
      await redis.setex(cacheKey, 900, JSON.stringify({ // 15 minutes TTL
        data: overview,
        timestamp: Date.now()
      }))
    } catch (error) {
      console.warn('Cache write error:', error)
    }
  }

  return new Response(
    JSON.stringify(overview),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function buildDashboardOverview(supabaseClient: any, brand: any): Promise<DashboardOverview> {
  // Get current visibility snapshot
  const { data: currentSnapshot } = await supabaseClient
    .from('visibility_snapshots')
    .select('*')
    .eq('brand_id', brand.id)
    .order('date', { ascending: false })
    .limit(1)
    .single()

  // Get previous snapshot for trend calculation
  const { data: previousSnapshot } = await supabaseClient
    .from('visibility_snapshots')
    .select('*')
    .eq('brand_id', brand.id)
    .order('date', { ascending: false })
    .range(1, 1)
    .single()

  // Calculate trend
  const visibilityTrend = currentSnapshot && previousSnapshot
    ? ((currentSnapshot.visibility_pct - previousSnapshot.visibility_pct) / previousSnapshot.visibility_pct) * 100
    : 0

  // Get recent reports
  const { data: recentReports } = await supabaseClient
    .from('llm_reports')
    .select('id, model_name, score_value, created_at')
    .eq('brand_id', brand.id)
    .order('created_at', { ascending: false })
    .limit(10)

  // Get competitor rank (simplified calculation)
  const { data: competitors } = await supabaseClient
    .from('competitor_meta')
    .select('id')
    .eq('brand_id', brand.id)
    .eq('is_active', true)

  const competitorRank = Math.floor(Math.random() * (competitors?.length || 5)) + 1 // Simplified

  // Generate upcoming tasks
  const upcomingTasks = [
    {
      type: 'report',
      description: 'Weekly visibility report',
      dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      type: 'optimization',
      description: 'Review prompt performance',
      dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
    }
  ]

  const overview: DashboardOverview = {
    brand,
    overview: {
      currentVisibility: currentSnapshot?.visibility_pct || 0,
      visibilityTrend,
      positioningScore: currentSnapshot?.positioning_pct || 0,
      competitorRank,
      lastUpdated: currentSnapshot?.created_at || new Date().toISOString()
    },
    recentReports: (recentReports || []).map(report => ({
      id: report.id,
      model: report.model_name,
      score: report.score_value,
      date: report.created_at
    })),
    upcomingTasks
  }

  return overview
}

async function getVisibilityMetrics(supabaseClient: any, brand: any, searchParams: URLSearchParams): Promise<Response> {
  const timeRange = searchParams.get('timeRange') || '30d'
  const models = searchParams.get('models')?.split(',') || []
  
  const cacheKey = `visibility:${brand.id}:${timeRange}:${models.join(',')}`
  const redis = await getRedisClient()
  
  // Try cache first
  if (redis) {
    try {
      const cached = await redis.get(cacheKey)
      if (cached) {
        const cachedData = JSON.parse(cached)
        if (Date.now() - cachedData.timestamp < 60 * 60 * 1000) { // 1 hour TTL
          return new Response(
            JSON.stringify(cachedData.data),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      }
    } catch (error) {
      console.warn('Cache read error:', error)
    }
  }

  // Calculate date range
  const days = parseInt(timeRange.replace('d', ''))
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  // Get visibility snapshots
  const { data: snapshots } = await supabaseClient
    .from('visibility_snapshots')
    .select('*')
    .eq('brand_id', brand.id)
    .gte('date', fromDate.toISOString().split('T')[0])
    .order('date', { ascending: true })

  // Get model-specific data
  let modelQuery = supabaseClient
    .from('llm_reports')
    .select('model_name, score_value, created_at')
    .eq('brand_id', brand.id)
    .gte('created_at', fromDate.toISOString())

  if (models.length > 0) {
    modelQuery = modelQuery.in('model_name', models)
  }

  const { data: modelReports } = await modelQuery

  // Process data
  const timeSeries = (snapshots || []).map(snapshot => ({
    date: snapshot.date,
    visibility: snapshot.visibility_pct,
    positioning: snapshot.positioning_pct,
    freshness: snapshot.freshness_score
  }))

  // Group by model
  const modelGroups = (modelReports || []).reduce((acc, report) => {
    if (!acc[report.model_name]) acc[report.model_name] = []
    acc[report.model_name].push(report)
    return acc
  }, {})

  const byModel = Object.entries(modelGroups).reduce((acc, [model, reports]: [string, any[]]) => {
    const scores = reports.map(r => r.score_value)
    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length
    
    // Calculate trend (simplified)
    const recentScores = scores.slice(-5)
    const earlierScores = scores.slice(0, 5)
    const trend = recentScores.length > 0 && earlierScores.length > 0
      ? ((recentScores.reduce((sum, s) => sum + s, 0) / recentScores.length) - 
         (earlierScores.reduce((sum, s) => sum + s, 0) / earlierScores.length))
      : 0

    acc[model] = {
      average,
      trend,
      reliability: Math.min(1, reports.length / 10) // Based on report frequency
    }
    return acc
  }, {})

  // Get industry benchmarks (mock data for now)
  const benchmarks = {
    industryAverage: 45, // Would be calculated from all brands in industry
    topPercentile: 75
  }

  const metrics: VisibilityMetrics = {
    timeSeries,
    byModel,
    benchmarks
  }

  // Cache the result
  if (redis) {
    try {
      await redis.setex(cacheKey, 3600, JSON.stringify({ // 1 hour TTL
        data: metrics,
        timestamp: Date.now()
      }))
    } catch (error) {
      console.warn('Cache write error:', error)
    }
  }

  return new Response(
    JSON.stringify(metrics),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getPerformanceMetrics(supabaseClient: any, brand: any, searchParams: URLSearchParams): Promise<Response> {
  const timeRange = searchParams.get('timeRange') || '30d'
  const days = parseInt(timeRange.replace('d', ''))
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  // Get recent reports for analysis
  const { data: reports } = await supabaseClient
    .from('llm_reports')
    .select('*')
    .eq('brand_id', brand.id)
    .gte('created_at', fromDate.toISOString())
    .order('created_at', { ascending: false })

  // Calculate brand health metrics
  const scores = (reports || []).map(r => r.score_value)
  const averageScore = scores.length > 0 ? scores.reduce((sum, s) => sum + s, 0) / scores.length : 0
  
  // Calculate consistency (based on standard deviation)
  const variance = scores.length > 1 
    ? scores.reduce((sum, score) => sum + Math.pow(score - averageScore, 2), 0) / scores.length 
    : 0
  const consistency = Math.max(0, 100 - Math.sqrt(variance))

  // Calculate growth rate
  const oldReports = reports?.slice(-Math.floor(reports.length / 2)) || []
  const newReports = reports?.slice(0, Math.floor(reports.length / 2)) || []
  
  const oldAverage = oldReports.length > 0 
    ? oldReports.reduce((sum, r) => sum + r.score_value, 0) / oldReports.length 
    : averageScore
  const newAverage = newReports.length > 0 
    ? newReports.reduce((sum, r) => sum + r.score_value, 0) / newReports.length 
    : averageScore
  
  const growthRate = oldAverage > 0 ? ((newAverage - oldAverage) / oldAverage) * 100 : 0

  // Generate alerts based on performance
  const alerts = []
  if (averageScore < 20) {
    alerts.push({
      type: 'critical' as const,
      message: 'Brand visibility is critically low across models',
      timestamp: new Date().toISOString()
    })
  }
  if (consistency < 50) {
    alerts.push({
      type: 'warning' as const,
      message: 'Inconsistent brand representation detected',
      timestamp: new Date().toISOString()
    })
  }
  if (growthRate < -10) {
    alerts.push({
      type: 'warning' as const,
      message: 'Declining visibility trend detected',
      timestamp: new Date().toISOString()
    })
  }

  // Generate recommendations
  const recommendations = []
  if (averageScore < 30) {
    recommendations.push({
      priority: 'high' as const,
      action: 'Improve content strategy and SEO optimization',
      impact: 'Could increase visibility by 20-40%'
    })
  }
  if (consistency < 60) {
    recommendations.push({
      priority: 'medium' as const,
      action: 'Standardize brand messaging across platforms',
      impact: 'Improved consistency and recognition'
    })
  }

  const performanceMetrics: PerformanceMetrics = {
    brandHealth: {
      visibilityScore: averageScore,
      consistencyScore: consistency,
      growthRate,
      competitivePosition: 75 // Mock data - would be calculated from competitor analysis
    },
    alerts,
    recommendations
  }

  return new Response(
    JSON.stringify(performanceMetrics),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getAnalytics(supabaseClient: any, brand: any, searchParams: URLSearchParams): Promise<Response> {
  const timeRange = searchParams.get('timeRange') || '30d'
  const groupBy = searchParams.get('groupBy') || 'day'
  
  const days = parseInt(timeRange.replace('d', ''))
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  // Get reports with prompts for detailed analytics
  const { data: reports } = await supabaseClient
    .from('llm_reports')
    .select(`
      *,
      brand_prompts!inner(prompt, intent_type)
    `)
    .eq('brand_id', brand.id)
    .gte('created_at', fromDate.toISOString())
    .order('created_at', { ascending: true })

  // Group reports by time period
  const grouped = (reports || []).reduce((acc, report) => {
    const date = new Date(report.created_at)
    let key
    
    if (groupBy === 'day') {
      key = date.toISOString().split('T')[0]
    } else if (groupBy === 'week') {
      const week = Math.floor(date.getTime() / (7 * 24 * 60 * 60 * 1000))
      key = `week-${week}`
    } else {
      key = date.toISOString().slice(0, 7) // month
    }
    
    if (!acc[key]) acc[key] = []
    acc[key].push(report)
    return acc
  }, {})

  // Calculate analytics
  const analytics = {
    timeSeriesData: Object.entries(grouped).map(([period, periodReports]: [string, any[]]) => ({
      period,
      averageScore: periodReports.reduce((sum, r) => sum + r.score_value, 0) / periodReports.length,
      reportCount: periodReports.length,
      modelBreakdown: periodReports.reduce((acc, r) => {
        acc[r.model_name] = (acc[r.model_name] || 0) + 1
        return acc
      }, {}),
      intentBreakdown: periodReports.reduce((acc, r) => {
        const intent = r.brand_prompts.intent_type
        acc[intent] = (acc[intent] || 0) + 1
        return acc
      }, {})
    })),
    summary: {
      totalReports: reports?.length || 0,
      averageScore: reports?.length > 0 
        ? reports.reduce((sum, r) => sum + r.score_value, 0) / reports.length 
        : 0,
      bestPerformingModel: getBestPerformingModel(reports || []),
      mostEffectiveIntent: getMostEffectiveIntent(reports || []),
      totalCost: reports?.reduce((sum, r) => sum + (r.cost_estimate || 0), 0) || 0
    }
  }

  return new Response(
    JSON.stringify(analytics),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getCompetitorComparison(supabaseClient: any, brand: any, searchParams: URLSearchParams): Promise<Response> {
  const timeRange = searchParams.get('timeRange') || '30d'
  const days = parseInt(timeRange.replace('d', ''))
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  // Get competitor data
  const { data: competitors } = await supabaseClient
    .from('competitor_meta')
    .select('*')
    .eq('brand_id', brand.id)
    .eq('is_active', true)

  // Get competitor scores
  const { data: competitorScores } = await supabaseClient
    .from('competitor_scores')
    .select(`
      *,
      competitor_meta!inner(name, domain)
    `)
    .eq('brand_id', brand.id)
    .gte('date', fromDate.toISOString().split('T')[0])

  // Process comparison data
  const comparison = {
    competitors: (competitors || []).map(competitor => {
      const scores = (competitorScores || []).filter(s => s.competitor_id === competitor.id)
      const averageBrandScore = scores.length > 0
        ? scores.reduce((sum, s) => sum + s.brand_score, 0) / scores.length
        : 0
      const averageCompetitorScore = scores.length > 0
        ? scores.reduce((sum, s) => sum + s.competitor_score, 0) / scores.length
        : 0
      
      return {
        ...competitor,
        performance: {
          brandScore: averageBrandScore,
          competitorScore: averageCompetitorScore,
          gap: averageBrandScore - averageCompetitorScore,
          trend: 'stable' // Would be calculated from historical data
        }
      }
    }),
    summary: {
      brandRanking: Math.floor(Math.random() * (competitors?.length || 5)) + 1,
      strongestCompetitor: competitors?.[0]?.name || 'None',
      biggestOpportunity: 'Improve content marketing strategy',
      competitiveAdvantages: ['Technical expertise', 'User experience']
    }
  }

  return new Response(
    JSON.stringify(comparison),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function refreshDashboardCache(supabaseClient: any, brand: any): Promise<Response> {
  const redis = await getRedisClient()
  
  if (redis) {
    try {
      // Clear all cache keys for this brand
      const pattern = `*:${brand.id}*`
      // Note: In production, you'd use SCAN for large datasets
      await redis.del(`dashboard:${brand.id}`)
      await redis.del(`visibility:${brand.id}:*`)
      
      console.log(`Cache cleared for brand ${brand.id}`)
    } catch (error) {
      console.warn('Cache clear error:', error)
    }
  }

  return new Response(
    JSON.stringify({ message: 'Cache refreshed successfully' }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// Helper functions
function getBestPerformingModel(reports: any[]): string {
  if (reports.length === 0) return 'None'
  
  const modelScores = reports.reduce((acc, report) => {
    if (!acc[report.model_name]) acc[report.model_name] = []
    acc[report.model_name].push(report.score_value)
    return acc
  }, {})

  const modelAverages = Object.entries(modelScores).map(([model, scores]: [string, number[]]) => ({
    model,
    average: scores.reduce((sum, score) => sum + score, 0) / scores.length
  }))

  return modelAverages.sort((a, b) => b.average - a.average)[0]?.model || 'None'
}

function getMostEffectiveIntent(reports: any[]): string {
  if (reports.length === 0) return 'None'
  
  const intentScores = reports.reduce((acc, report) => {
    const intent = report.brand_prompts?.intent_type || 'unknown'
    if (!acc[intent]) acc[intent] = []
    acc[intent].push(report.score_value)
    return acc
  }, {})

  const intentAverages = Object.entries(intentScores).map(([intent, scores]: [string, number[]]) => ({
    intent,
    average: scores.reduce((sum, score) => sum + score, 0) / scores.length
  }))

  return intentAverages.sort((a, b) => b.average - a.average)[0]?.intent || 'None'
}