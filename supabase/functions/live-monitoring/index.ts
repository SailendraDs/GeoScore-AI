import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TrackEventRequest {
  brandId: string
  event: {
    type: 'query' | 'mention' | 'interaction' | 'sentiment'
    data: Record<string, any>
    source: string
    timestamp?: string
  }
  sessionId?: string
}

interface MonitoringConfig {
  brandId: string
  configName: string
  keywords: string[]
  sources: string[]
  alertThresholds: {
    mentionSpike: number
    negativeSentiment: number
    competitorActivity: number
  }
  notificationSettings: {
    email: boolean
    slack: boolean
    webhook?: string
  }
}

interface AlertTrigger {
  type: 'mention_spike' | 'negative_sentiment' | 'competitor_activity' | 'opportunity'
  threshold: number
  timeWindow: string
  action: 'email' | 'slack' | 'webhook' | 'all'
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
      switch (action) {
        case 'track':
          return await trackEvent(supabaseClient, user.id, req)
        case 'configure':
          return await configureMonitoring(supabaseClient, user.id, req)
        case 'trigger-alerts':
          return await triggerAlerts(supabaseClient, user.id, req)
        default:
          return new Response(
            JSON.stringify({ error: 'Invalid action' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
      }
    }

    if (req.method === 'GET') {
      switch (action) {
        case 'alerts':
          return await getAlerts(supabaseClient, user.id, url.searchParams)
        case 'trends':
          return await getTrends(supabaseClient, user.id, url.searchParams)
        case 'config':
          return await getMonitoringConfig(supabaseClient, user.id, url.searchParams)
        case 'realtime':
          return await getRealtimeData(supabaseClient, user.id, url.searchParams)
        default:
          return await getMonitoringDashboard(supabaseClient, user.id, url.searchParams)
      }
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Live monitoring error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function trackEvent(supabaseClient: any, userId: string, req: Request): Promise<Response> {
  const { brandId, event, sessionId }: TrackEventRequest = await req.json()

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

  // Process the event data
  const processedEvent = await processEvent(event, brand)

  // Store visitor query/interaction
  const { data: queryRecord, error: queryError } = await supabaseClient
    .from('visitor_queries')
    .insert({
      brand_id: brandId,
      query_text: event.data.query || event.data.text || '',
      source: event.source,
      source_url: event.data.url,
      user_session_id: sessionId,
      ip_address: event.data.ip || req.headers.get('CF-Connecting-IP'),
      user_agent: event.data.userAgent || req.headers.get('User-Agent'),
      inferred_intent: processedEvent.intent,
      sentiment_score: processedEvent.sentiment,
      confidence_score: processedEvent.confidence,
      timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
      metadata: {
        originalEvent: event,
        processed: processedEvent
      }
    })
    .select()
    .single()

  if (queryError) {
    console.error('Failed to store visitor query:', queryError)
  }

  // Check for alert triggers
  const alertsTriggered = await checkAlertTriggers(supabaseClient, brandId, processedEvent)

  // Generate insights
  const insights = await generateEventInsights(supabaseClient, brandId, processedEvent)

  const response = {
    tracked: !queryError,
    alertsTriggered: alertsTriggered.map(a => a.id),
    insights: {
      intent: processedEvent.intent,
      sentiment: processedEvent.sentiment,
      recommendations: insights.recommendations
    },
    queryId: queryRecord?.id
  }

  return new Response(
    JSON.stringify(response),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function processEvent(event: any, brand: any) {
  const text = event.data.query || event.data.text || ''
  
  // Simple sentiment analysis (in production, would use LLM)
  const sentimentScore = analyzeSentiment(text)
  
  // Intent classification
  const intent = classifyIntent(text, event.type)
  
  // Confidence calculation
  const confidence = calculateConfidence(text, event)

  // Brand mention detection
  const brandMentioned = detectBrandMention(text, brand)

  return {
    sentiment: sentimentScore,
    intent,
    confidence,
    brandMentioned,
    processedAt: new Date().toISOString()
  }
}

function analyzeSentiment(text: string): number {
  const positiveWords = ['good', 'great', 'excellent', 'love', 'amazing', 'perfect', 'best', 'wonderful']
  const negativeWords = ['bad', 'terrible', 'awful', 'hate', 'worst', 'horrible', 'disappointing', 'poor']
  
  const words = text.toLowerCase().split(/\s+/)
  let score = 0.5 // neutral baseline
  
  for (const word of words) {
    if (positiveWords.includes(word)) score += 0.1
    if (negativeWords.includes(word)) score -= 0.15
  }
  
  return Math.max(0, Math.min(1, score))
}

function classifyIntent(text: string, eventType: string): string {
  const textLower = text.toLowerCase()
  
  if (eventType === 'query') {
    if (textLower.includes('buy') || textLower.includes('purchase') || textLower.includes('price')) {
      return 'purchase'
    }
    if (textLower.includes('vs') || textLower.includes('compare') || textLower.includes('better')) {
      return 'comparison'
    }
    if (textLower.includes('help') || textLower.includes('support') || textLower.includes('problem')) {
      return 'support'
    }
    if (textLower.includes('what is') || textLower.includes('about')) {
      return 'research'
    }
  }
  
  return 'research' // default
}

function calculateConfidence(text: string, event: any): number {
  let confidence = 0.5
  
  // Length factor
  if (text.length > 10) confidence += 0.2
  if (text.length > 50) confidence += 0.2
  
  // Source factor
  if (event.source === 'website') confidence += 0.2
  if (event.source === 'chatbot') confidence += 0.1
  
  return Math.min(1, confidence)
}

function detectBrandMention(text: string, brand: any): boolean {
  const textLower = text.toLowerCase()
  const brandName = brand.name.toLowerCase()
  const domain = brand.domain.toLowerCase()
  
  return textLower.includes(brandName) || textLower.includes(domain)
}

async function checkAlertTriggers(supabaseClient: any, brandId: string, processedEvent: any): Promise<any[]> {
  const alerts = []
  
  // Get monitoring configuration
  const { data: configs } = await supabaseClient
    .from('monitoring_configs')
    .select('*')
    .eq('brand_id', brandId)
    .eq('is_active', true)

  if (!configs || configs.length === 0) return alerts

  const config = configs[0] // Use first active config
  const thresholds = config.alert_thresholds || {}

  // Check negative sentiment alert
  if (processedEvent.sentiment < (thresholds.negativeSentiment || 0.3)) {
    const alert = await createAlert(supabaseClient, brandId, {
      alert_type: 'negative_sentiment',
      message: `Negative sentiment detected: ${(processedEvent.sentiment * 100).toFixed(1)}%`,
      urgency: 'medium',
      trigger_data: processedEvent,
      channels: config.notification_settings?.channels || ['email']
    })
    if (alert) alerts.push(alert)
  }

  // Check mention spike (would require historical analysis)
  const recentMentions = await getRecentMentions(supabaseClient, brandId, '1h')
  if (recentMentions > (thresholds.mentionSpike || 10)) {
    const alert = await createAlert(supabaseClient, brandId, {
      alert_type: 'mention_spike',
      message: `Unusual mention activity: ${recentMentions} mentions in last hour`,
      urgency: 'high',
      trigger_data: { mentionCount: recentMentions },
      channels: config.notification_settings?.channels || ['email']
    })
    if (alert) alerts.push(alert)
  }

  return alerts
}

async function createAlert(supabaseClient: any, brandId: string, alertData: any) {
  try {
    const { data: alert, error } = await supabaseClient
      .from('live_alerts')
      .insert({
        brand_id: brandId,
        ...alertData
      })
      .select()
      .single()

    if (!error) {
      // Send notifications based on channels
      await sendAlertNotifications(alert, alertData.channels)
    }

    return alert
  } catch (error) {
    console.error('Failed to create alert:', error)
    return null
  }
}

async function sendAlertNotifications(alert: any, channels: string[]) {
  // In production, this would integrate with email/Slack APIs
  console.log(`Alert notification sent via ${channels.join(', ')}:`, alert.message)
  
  // TODO: Implement actual notification sending
  // - Email via SendGrid/SES
  // - Slack via webhook
  // - Custom webhook
}

async function getRecentMentions(supabaseClient: any, brandId: string, timeWindow: string): Promise<number> {
  const hours = timeWindow === '1h' ? 1 : timeWindow === '24h' ? 24 : 1
  const fromTime = new Date(Date.now() - hours * 60 * 60 * 1000)

  const { data, error } = await supabaseClient
    .from('visitor_queries')
    .select('id')
    .eq('brand_id', brandId)
    .gte('timestamp', fromTime.toISOString())

  return data?.length || 0
}

async function generateEventInsights(supabaseClient: any, brandId: string, processedEvent: any) {
  const recommendations = []

  if (processedEvent.sentiment < 0.4) {
    recommendations.push('Consider reaching out to address negative feedback')
    recommendations.push('Review customer service processes')
  }

  if (processedEvent.intent === 'comparison') {
    recommendations.push('Highlight competitive advantages')
    recommendations.push('Provide detailed comparison resources')
  }

  if (processedEvent.intent === 'purchase') {
    recommendations.push('Ensure pricing and purchase options are clear')
    recommendations.push('Consider follow-up marketing campaigns')
  }

  return { recommendations }
}

async function configureMonitoring(supabaseClient: any, userId: string, req: Request): Promise<Response> {
  const config: MonitoringConfig = await req.json()

  // Verify brand ownership
  const { data: brand, error: brandError } = await supabaseClient
    .from('brands')
    .select('*')
    .eq('id', config.brandId)
    .eq('owner_id', userId)
    .single()

  if (brandError || !brand) {
    return new Response(
      JSON.stringify({ error: 'Brand not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Save monitoring configuration
  const { data: savedConfig, error: configError } = await supabaseClient
    .from('monitoring_configs')
    .upsert({
      brand_id: config.brandId,
      config_name: config.configName,
      keywords: config.keywords,
      sources: config.sources,
      alert_thresholds: config.alertThresholds,
      notification_settings: config.notificationSettings,
      is_active: true
    })
    .select()
    .single()

  if (configError) {
    return new Response(
      JSON.stringify({ error: 'Failed to save configuration' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({
      config: savedConfig,
      message: 'Monitoring configuration saved successfully'
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getAlerts(supabaseClient: any, userId: string, searchParams: URLSearchParams): Promise<Response> {
  const brandId = searchParams.get('brandId')
  const limit = parseInt(searchParams.get('limit') || '50')
  const unreadOnly = searchParams.get('unreadOnly') === 'true'

  let query = supabaseClient
    .from('live_alerts')
    .select(`
      *,
      brands!inner(name, owner_id)
    `)
    .eq('brands.owner_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (brandId) {
    query = query.eq('brand_id', brandId)
  }

  if (unreadOnly) {
    query = query.is('acknowledged_at', null)
  }

  const { data: alerts, error } = await query

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch alerts' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get summary statistics
  const { data: summary } = await supabaseClient
    .from('live_alerts')
    .select('urgency, acknowledged_at, brands!inner(owner_id)')
    .eq('brands.owner_id', userId)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

  const summaryStats = {
    total: summary?.length || 0,
    critical: summary?.filter(a => a.urgency === 'critical').length || 0,
    unacknowledged: summary?.filter(a => !a.acknowledged_at).length || 0
  }

  const response = {
    active: alerts || [],
    summary: summaryStats,
    trends: [] // Would calculate from historical data
  }

  return new Response(
    JSON.stringify(response),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getTrends(supabaseClient: any, userId: string, searchParams: URLSearchParams): Promise<Response> {
  const brandId = searchParams.get('brandId')
  const timeRange = searchParams.get('timeRange') || '7d'

  if (!brandId) {
    return new Response(
      JSON.stringify({ error: 'Brand ID required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const days = parseInt(timeRange.replace('d', ''))
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  // Get visitor queries for trend analysis
  const { data: queries } = await supabaseClient
    .from('visitor_queries')
    .select('timestamp, sentiment_score, inferred_intent, source')
    .eq('brand_id', brandId)
    .gte('timestamp', fromDate.toISOString())
    .order('timestamp', { ascending: true })

  // Process trends
  const trends = processTrendData(queries || [], days)

  return new Response(
    JSON.stringify(trends),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

function processTrendData(queries: any[], days: number) {
  // Group by day
  const dailyData = queries.reduce((acc, query) => {
    const date = query.timestamp.split('T')[0]
    if (!acc[date]) {
      acc[date] = {
        date,
        mentionCount: 0,
        sentimentAverage: 0,
        sentimentSum: 0,
        intentBreakdown: {}
      }
    }
    
    acc[date].mentionCount++
    acc[date].sentimentSum += query.sentiment_score || 0.5
    
    const intent = query.inferred_intent || 'unknown'
    acc[date].intentBreakdown[intent] = (acc[date].intentBreakdown[intent] || 0) + 1
    
    return acc
  }, {})

  // Calculate averages and format
  const trends = Object.values(dailyData).map((day: any) => ({
    date: day.date,
    mentionCount: day.mentionCount,
    sentimentAverage: day.mentionCount > 0 ? day.sentimentSum / day.mentionCount : 0.5,
    intentBreakdown: day.intentBreakdown
  }))

  return {
    daily: trends,
    summary: {
      totalMentions: queries.length,
      averageSentiment: queries.length > 0 
        ? queries.reduce((sum, q) => sum + (q.sentiment_score || 0.5), 0) / queries.length 
        : 0.5,
      topIntent: 'research' // Would calculate from data
    }
  }
}

async function getMonitoringConfig(supabaseClient: any, userId: string, searchParams: URLSearchParams): Promise<Response> {
  const brandId = searchParams.get('brandId')

  if (!brandId) {
    return new Response(
      JSON.stringify({ error: 'Brand ID required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { data: configs, error } = await supabaseClient
    .from('monitoring_configs')
    .select(`
      *,
      brands!inner(name, owner_id)
    `)
    .eq('brands.owner_id', userId)
    .eq('brand_id', brandId)
    .eq('is_active', true)

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch monitoring config' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ configs: configs || [] }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getRealtimeData(supabaseClient: any, userId: string, searchParams: URLSearchParams): Promise<Response> {
  const brandId = searchParams.get('brandId')

  if (!brandId) {
    return new Response(
      JSON.stringify({ error: 'Brand ID required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get last 15 minutes of data
  const fromTime = new Date(Date.now() - 15 * 60 * 1000)

  const { data: recentQueries } = await supabaseClient
    .from('visitor_queries')
    .select('*')
    .eq('brand_id', brandId)
    .gte('timestamp', fromTime.toISOString())
    .order('timestamp', { ascending: false })
    .limit(10)

  const { data: recentAlerts } = await supabaseClient
    .from('live_alerts')
    .select('*')
    .eq('brand_id', brandId)
    .gte('created_at', fromTime.toISOString())
    .order('created_at', { ascending: false })

  const realtimeData = {
    recentActivity: recentQueries || [],
    activeAlerts: recentAlerts || [],
    stats: {
      queriesLast15Min: recentQueries?.length || 0,
      alertsLast15Min: recentAlerts?.length || 0,
      averageSentiment: recentQueries?.length > 0
        ? recentQueries.reduce((sum, q) => sum + (q.sentiment_score || 0.5), 0) / recentQueries.length
        : 0.5
    },
    timestamp: new Date().toISOString()
  }

  return new Response(
    JSON.stringify(realtimeData),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getMonitoringDashboard(supabaseClient: any, userId: string, searchParams: URLSearchParams): Promise<Response> {
  const brandId = searchParams.get('brandId')

  if (!brandId) {
    return new Response(
      JSON.stringify({ error: 'Brand ID required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get dashboard overview data
  const [alertsResult, queriesResult, configResult] = await Promise.all([
    supabaseClient
      .from('live_alerts')
      .select('*')
      .eq('brand_id', brandId)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    
    supabaseClient
      .from('visitor_queries')
      .select('*')
      .eq('brand_id', brandId)
      .gte('timestamp', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    
    supabaseClient
      .from('monitoring_configs')
      .select('*')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .single()
  ])

  const dashboard = {
    isActive: !!configResult.data,
    last24Hours: {
      alerts: alertsResult.data?.length || 0,
      queries: queriesResult.data?.length || 0,
      averageSentiment: queriesResult.data?.length > 0
        ? queriesResult.data.reduce((sum, q) => sum + (q.sentiment_score || 0.5), 0) / queriesResult.data.length
        : 0.5
    },
    configuration: configResult.data,
    status: 'active' // would check actual monitoring status
  }

  return new Response(
    JSON.stringify(dashboard),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function triggerAlerts(supabaseClient: any, userId: string, req: Request): Promise<Response> {
  // This would be used for manual alert testing
  const { brandId, alertType, testData } = await req.json()

  const testAlert = await createAlert(supabaseClient, brandId, {
    alert_type: alertType || 'test',
    message: 'Test alert triggered manually',
    urgency: 'low',
    trigger_data: testData || {},
    channels: ['email']
  })

  return new Response(
    JSON.stringify({
      alert: testAlert,
      message: 'Test alert triggered successfully'
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}