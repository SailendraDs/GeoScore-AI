import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CompetitorAnalysisRequest {
  brandId: string
  competitors?: string[]
  timeRange: '7d' | '30d' | '90d' | '1y'
  models?: string[]
  includeAlerts?: boolean
}

interface CompetitorTrackingRequest {
  brandId: string
  competitorDomain: string
  relationshipType: 'direct' | 'indirect' | 'aspirational'
  priorityLevel: number
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
    const action = pathParts[pathParts.length - 1]

    if (req.method === 'POST') {
      if (action === 'analyze') {
        return await analyzeCompetitors(supabaseClient, user.id, req)
      } else if (action === 'track') {
        return await trackCompetitor(supabaseClient, user.id, req)
      } else if (action === 'score') {
        return await scoreCompetitors(supabaseClient, user.id, req)
      }
    }

    if (req.method === 'GET') {
      if (action === 'alerts') {
        return await getCompetitiveAlerts(supabaseClient, user.id, url.searchParams)
      } else {
        return await listCompetitors(supabaseClient, user.id, url.searchParams)
      }
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Competitor tracking error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function analyzeCompetitors(supabaseClient: any, userId: string, req: Request): Promise<Response> {
  const { brandId, competitors, timeRange, models, includeAlerts }: CompetitorAnalysisRequest = await req.json()

  // Verify brand ownership
  const { data: brand, error: brandError } = await supabaseClient
    .from('brands')
    .select('*')
    .eq('id', brandId)
    .eq('owner_id', userId)
    .single()

  if (brandError || !brand) {
    return new Response(
      JSON.stringify({ error: 'Brand not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get competitor metadata
  const { data: competitorMeta } = await supabaseClient
    .from('competitor_meta')
    .select('*')
    .eq('brand_id', brandId)
    .eq('is_active', true)

  // Calculate date range
  const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : 365
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  // Get competitor scores
  const { data: scores } = await supabaseClient
    .from('competitor_scores')
    .select('*, competitor_meta!inner(name, domain)')
    .eq('brand_id', brandId)
    .gte('date', fromDate.toISOString().split('T')[0])

  // Process analysis
  const analysis = processCompetitorAnalysis(brand, competitorMeta || [], scores || [])

  if (includeAlerts) {
    await generateCompetitiveAlerts(supabaseClient, brandId, analysis)
  }

  return new Response(
    JSON.stringify(analysis),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function trackCompetitor(supabaseClient: any, userId: string, req: Request): Promise<Response> {
  const { brandId, competitorDomain, relationshipType, priorityLevel }: CompetitorTrackingRequest = await req.json()

  // Verify brand ownership
  const { data: brand, error: brandError } = await supabaseClient
    .from('brands')
    .select('*')
    .eq('id', brandId)
    .eq('owner_id', userId)
    .single()

  if (brandError || !brand) {
    return new Response(
      JSON.stringify({ error: 'Brand not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Extract competitor name from domain
  const competitorName = competitorDomain.replace(/^www\./, '').split('.')[0]

  // Add competitor
  const { data: competitor, error: competitorError } = await supabaseClient
    .from('competitor_meta')
    .insert({
      brand_id: brandId,
      domain: competitorDomain,
      name: competitorName,
      relationship_type: relationshipType,
      priority_level: priorityLevel,
      added_by: 'user'
    })
    .select()
    .single()

  if (competitorError) {
    return new Response(
      JSON.stringify({ error: 'Failed to add competitor' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Run initial scoring
  await runInitialCompetitorScoring(supabaseClient, brandId, competitor.id)

  return new Response(
    JSON.stringify({ 
      competitor,
      message: 'Competitor tracking started',
      trackingSchedule: 'weekly'
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function scoreCompetitors(supabaseClient: any, userId: string, req: Request): Promise<Response> {
  const { brandId } = await req.json()

  // Get brand and competitors
  const { data: brand } = await supabaseClient
    .from('brands')
    .select('*')
    .eq('id', brandId)
    .eq('owner_id', userId)
    .single()

  const { data: competitors } = await supabaseClient
    .from('competitor_meta')
    .select('*')
    .eq('brand_id', brandId)
    .eq('is_active', true)

  if (!competitors || competitors.length === 0) {
    return new Response(
      JSON.stringify({ message: 'No active competitors to score' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const results = []
  for (const competitor of competitors) {
    const result = await scoreIndividualCompetitor(supabaseClient, brand, competitor)
    results.push(result)
  }

  return new Response(
    JSON.stringify({ 
      scoringResults: results,
      message: 'Competitor scoring completed'
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

function processCompetitorAnalysis(brand: any, competitors: any[], scores: any[]) {
  const competitorMap = new Map(competitors.map(c => [c.id, c]))
  
  // Group scores by competitor
  const competitorScores = scores.reduce((acc, score) => {
    if (!acc[score.competitor_id]) acc[score.competitor_id] = []
    acc[score.competitor_id].push(score)
    return acc
  }, {})

  const competitorAnalysis = competitors.map(competitor => {
    const competitorScoresData = competitorScores[competitor.id] || []
    const avgBrandScore = competitorScoresData.length > 0
      ? competitorScoresData.reduce((sum, s) => sum + s.brand_score, 0) / competitorScoresData.length
      : 0
    const avgCompetitorScore = competitorScoresData.length > 0
      ? competitorScoresData.reduce((sum, s) => sum + s.competitor_score, 0) / competitorScoresData.length
      : 0

    return {
      domain: competitor.domain,
      name: competitor.name,
      currentScore: avgCompetitorScore,
      scoreChange: 0, // Would calculate from historical data
      gapToBrand: avgBrandScore - avgCompetitorScore,
      threatLevel: avgCompetitorScore > avgBrandScore ? 'high' : 'low'
    }
  })

  const brandRank = competitorAnalysis.filter(c => c.currentScore > 
    (competitorAnalysis.find(c2 => c2.domain === brand.domain)?.currentScore || 0)).length + 1

  return {
    summary: {
      brandRank,
      totalCompetitors: competitors.length,
      averageGap: competitorAnalysis.reduce((sum, c) => sum + c.gapToBrand, 0) / competitorAnalysis.length,
      trendDirection: 'stable' as const
    },
    competitors: competitorAnalysis,
    modelBreakdown: {},
    alerts: []
  }
}

async function generateCompetitiveAlerts(supabaseClient: any, brandId: string, analysis: any) {
  const alerts = []

  // Check for concerning patterns
  for (const competitor of analysis.competitors) {
    if (competitor.threatLevel === 'high' && competitor.gapToBrand < -10) {
      alerts.push({
        brand_id: brandId,
        alert_type: 'competitor_surge',
        competitor_domain: competitor.domain,
        message: `${competitor.name} is significantly outperforming your brand`,
        severity: 'high'
      })
    }
  }

  if (analysis.summary.brandRank > analysis.summary.totalCompetitors * 0.7) {
    alerts.push({
      brand_id: brandId,
      alert_type: 'ranking_change',
      message: 'Brand ranking has declined significantly',
      severity: 'medium'
    })
  }

  // Insert alerts
  if (alerts.length > 0) {
    await supabaseClient
      .from('competitive_alerts')
      .insert(alerts)
  }
}

async function runInitialCompetitorScoring(supabaseClient: any, brandId: string, competitorId: string) {
  // This would integrate with the LLM orchestration to score the competitor
  // For now, insert a placeholder score
  await supabaseClient
    .from('competitor_scores')
    .insert({
      brand_id: brandId,
      competitor_id: competitorId,
      model_name: 'initial_assessment',
      score_type: 'visibility',
      brand_score: 50,
      competitor_score: 45,
      score_difference: 5
    })
}

async function scoreIndividualCompetitor(supabaseClient: any, brand: any, competitor: any) {
  // Mock scoring logic - in production this would use LLM orchestration
  const brandScore = Math.random() * 100
  const competitorScore = Math.random() * 100
  
  await supabaseClient
    .from('competitor_scores')
    .insert({
      brand_id: brand.id,
      competitor_id: competitor.id,
      model_name: 'automated_scoring',
      score_type: 'visibility',
      brand_score: brandScore,
      competitor_score: competitorScore,
      score_difference: brandScore - competitorScore
    })

  return {
    competitorId: competitor.id,
    brandScore,
    competitorScore,
    gap: brandScore - competitorScore
  }
}

async function getCompetitiveAlerts(supabaseClient: any, userId: string, searchParams: URLSearchParams): Promise<Response> {
  const brandId = searchParams.get('brandId')
  const unreadOnly = searchParams.get('unreadOnly') === 'true'

  let query = supabaseClient
    .from('competitive_alerts')
    .select('*, brands!inner(owner_id)')
    .eq('brands.owner_id', userId)
    .order('triggered_at', { ascending: false })

  if (brandId) {
    query = query.eq('brand_id', brandId)
  }

  if (unreadOnly) {
    query = query.eq('is_read', false)
  }

  const { data: alerts, error } = await query

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch alerts' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ alerts }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function listCompetitors(supabaseClient: any, userId: string, searchParams: URLSearchParams): Promise<Response> {
  const brandId = searchParams.get('brandId')

  if (!brandId) {
    return new Response(
      JSON.stringify({ error: 'Brand ID required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { data: competitors, error } = await supabaseClient
    .from('competitor_meta')
    .select(`
      *,
      brands!inner(owner_id)
    `)
    .eq('brands.owner_id', userId)
    .eq('brand_id', brandId)
    .eq('is_active', true)
    .order('priority_level', { ascending: false })

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch competitors' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ competitors }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}