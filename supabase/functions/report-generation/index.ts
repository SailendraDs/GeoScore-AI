import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface GenerateReportRequest {
  brandId: string
  promptIds?: string[]
  models?: string[]
  reportType: 'single' | 'comparative' | 'monthly' | 'baseline'
  options?: {
    includeAnalytics?: boolean
    compareWithCompetitors?: boolean
    generateRecommendations?: boolean
    scheduleFollowUp?: boolean
  }
}

interface ReportExecutionStep {
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  startTime?: string
  endTime?: string
  data?: any
  error?: string
}

interface GenerateReportResponse {
  reportId: string
  brandId: string
  reportType: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  progress: number
  steps: ReportExecutionStep[]
  results?: {
    totalPrompts: number
    totalModels: number
    averageScore: number
    topPerformingModel: string
    concerningPatterns: string[]
    recommendations: string[]
  }
  estimatedCompletion?: string
  error?: string
}

const LLM_MODELS = [
  'claude-opus',
  'gpt-4',
  'gemini-pro',
  'grok-2',
  'mistral-large',
  'llama-3.1-70b'
]

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
      if (action === 'generate') {
        return await generateReport(supabaseClient, user.id, req)
      } else if (action === 'analyze') {
        return await analyzeReports(supabaseClient, user.id, req)
      } else if (action === 'compare') {
        return await compareModels(supabaseClient, user.id, req)
      }
    }

    if (req.method === 'GET') {
      const reportId = pathParts[pathParts.length - 1]
      if (reportId && reportId !== 'reports') {
        return await getReportStatus(supabaseClient, user.id, reportId)
      } else {
        return await listReports(supabaseClient, user.id, url.searchParams)
      }
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Report generation error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function generateReport(supabaseClient: any, userId: string, req: Request): Promise<Response> {
  const { brandId, promptIds, models, reportType, options = {} }: GenerateReportRequest = await req.json()

  if (!brandId) {
    return new Response(
      JSON.stringify({ error: 'Missing brandId' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Verify brand ownership
  const { data: brand, error: brandError } = await supabaseClient
    .from('brands')
    .select('*')
    .eq('id', brandId)
    .eq('owner_id', userId)
    .single()

  if (brandError || !brand) {
    return new Response(
      JSON.stringify({ error: 'Brand not found or access denied' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Create report execution record
  const reportId = crypto.randomUUID()
  const steps: ReportExecutionStep[] = [
    { name: 'setup', status: 'pending', progress: 0 },
    { name: 'execute_prompts', status: 'pending', progress: 0 },
    { name: 'analyze_results', status: 'pending', progress: 0 },
    { name: 'generate_insights', status: 'pending', progress: 0 },
    { name: 'finalize', status: 'pending', progress: 0 }
  ]

  let response: GenerateReportResponse = {
    reportId,
    brandId,
    reportType,
    status: 'processing',
    progress: 0,
    steps,
    estimatedCompletion: new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 minutes
  }

  try {
    // Step 1: Setup - Get prompts and validate models
    steps[0].status = 'running'
    steps[0].startTime = new Date().toISOString()

    let selectedPrompts
    if (promptIds && promptIds.length > 0) {
      const { data: prompts } = await supabaseClient
        .from('brand_prompts')
        .select('*')
        .eq('brand_id', brandId)
        .in('id', promptIds)
        .eq('is_active', true)
      selectedPrompts = prompts || []
    } else {
      // Get all active prompts for the brand
      const { data: prompts } = await supabaseClient
        .from('brand_prompts')
        .select('*')
        .eq('brand_id', brandId)
        .eq('is_active', true)
        .order('performance_score', { ascending: false })
        .limit(reportType === 'baseline' ? 5 : 10)
      selectedPrompts = prompts || []
    }

    const selectedModels = models && models.length > 0 
      ? models.filter(m => LLM_MODELS.includes(m))
      : (reportType === 'baseline' ? LLM_MODELS.slice(0, 3) : LLM_MODELS)

    if (selectedPrompts.length === 0) {
      throw new Error('No active prompts found for this brand')
    }

    steps[0].status = 'completed'
    steps[0].progress = 100
    steps[0].endTime = new Date().toISOString()
    steps[0].data = {
      promptCount: selectedPrompts.length,
      modelCount: selectedModels.length
    }

    response.progress = 20

    // Step 2: Execute prompts across models
    steps[1].status = 'running'
    steps[1].startTime = new Date().toISOString()

    const executionResults = await executePromptsAcrossModels(
      supabaseClient, 
      brandId, 
      selectedPrompts, 
      selectedModels,
      reportType,
      (progress) => {
        steps[1].progress = progress
        response.progress = 20 + (progress * 0.5) // 20-70%
      }
    )

    steps[1].status = 'completed'
    steps[1].progress = 100
    steps[1].endTime = new Date().toISOString()
    steps[1].data = {
      totalExecutions: executionResults.length,
      successfulExecutions: executionResults.filter(r => r.success).length,
      totalCost: executionResults.reduce((sum, r) => sum + r.cost, 0)
    }

    response.progress = 70

    // Step 3: Analyze results
    steps[2].status = 'running'
    steps[2].startTime = new Date().toISOString()

    const analysis = await analyzeExecutionResults(
      supabaseClient,
      brandId,
      executionResults,
      reportType
    )

    steps[2].status = 'completed'
    steps[2].progress = 100
    steps[2].endTime = new Date().toISOString()
    steps[2].data = analysis

    response.progress = 85

    // Step 4: Generate insights and recommendations
    steps[3].status = 'running'
    steps[3].startTime = new Date().toISOString()

    const insights = await generateInsights(
      supabaseClient,
      brand,
      analysis,
      options
    )

    steps[3].status = 'completed'
    steps[3].progress = 100
    steps[3].endTime = new Date().toISOString()
    steps[3].data = insights

    response.progress = 95

    // Step 5: Finalize - Save summary and update snapshots
    steps[4].status = 'running'
    steps[4].startTime = new Date().toISOString()

    await finalizeReport(supabaseClient, reportId, brandId, reportType, analysis, insights)

    steps[4].status = 'completed'
    steps[4].progress = 100
    steps[4].endTime = new Date().toISOString()

    response.status = 'completed'
    response.progress = 100
    response.results = {
      totalPrompts: selectedPrompts.length,
      totalModels: selectedModels.length,
      averageScore: analysis.averageVisibilityScore,
      topPerformingModel: analysis.topPerformingModel,
      concerningPatterns: insights.concerningPatterns || [],
      recommendations: insights.recommendations || []
    }

  } catch (error) {
    const currentStepIndex = steps.findIndex(s => s.status === 'running')
    if (currentStepIndex >= 0) {
      steps[currentStepIndex].status = 'failed'
      steps[currentStepIndex].error = error.message
      steps[currentStepIndex].endTime = new Date().toISOString()
    }
    
    response.status = 'failed'
    response.error = error.message
  }

  return new Response(
    JSON.stringify(response),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function executePromptsAcrossModels(
  supabaseClient: any,
  brandId: string,
  prompts: any[],
  models: string[],
  reportType: string,
  progressCallback: (progress: number) => void
): Promise<any[]> {
  const results = []
  const totalExecutions = prompts.length * models.length
  let completedExecutions = 0

  for (const prompt of prompts) {
    for (const model of models) {
      try {
        // Call the LLM orchestration function
        const response = await fetch('https://alaxjkbdistiwvckfysi.supabase.co/functions/v1/llm-orchestration', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
          },
          body: JSON.stringify({
            model,
            prompt: prompt.prompt,
            brandId,
            metadata: {
              scoreType: 'visibility',
              promptId: prompt.id,
              reportType,
              intentType: prompt.intent_type
            }
          })
        })

        if (response.ok) {
          const llmResult = await response.json()
          
          // Calculate visibility score based on brand mentions and positioning
          const visibilityScore = calculateVisibilityScore(
            llmResult.response.content,
            prompt,
            brandId
          )

          // Store the result in llm_reports table
          const { data: reportRecord, error: reportError } = await supabaseClient
            .from('llm_reports')
            .insert({
              brand_id: brandId,
              prompt_id: prompt.id,
              model_name: model,
              score_type: 'visibility',
              score_value: visibilityScore.score,
              response_text: llmResult.response.content,
              hallucination_rate: visibilityScore.hallucination_rate,
              citation_accuracy: visibilityScore.citation_accuracy,
              source_overlap: visibilityScore.source_overlap,
              cost_estimate: llmResult.response.cost.totalCost,
              execution_time_ms: llmResult.response.executionTime || 0
            })
            .select()
            .single()

          if (!reportError) {
            results.push({
              success: true,
              promptId: prompt.id,
              model,
              score: visibilityScore.score,
              cost: llmResult.response.cost.totalCost,
              reportId: reportRecord.id,
              content: llmResult.response.content,
              metrics: visibilityScore
            })
          } else {
            console.error('Error saving report:', reportError)
            results.push({
              success: false,
              promptId: prompt.id,
              model,
              error: reportError.message
            })
          }
        } else {
          results.push({
            success: false,
            promptId: prompt.id,
            model,
            error: `LLM request failed: ${response.status}`
          })
        }
      } catch (error) {
        results.push({
          success: false,
          promptId: prompt.id,
          model,
          error: error.message
        })
      }

      completedExecutions++
      progressCallback((completedExecutions / totalExecutions) * 100)

      // Add small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  return results
}

function calculateVisibilityScore(
  content: string,
  prompt: any,
  brandId: string
): {
  score: number
  hallucination_rate: number
  citation_accuracy: number
  source_overlap: number
} {
  const contentLower = content.toLowerCase()
  
  // Basic scoring algorithm
  let score = 0
  let hallucination_rate = 0
  let citation_accuracy = 0.5 // default moderate
  let source_overlap = 0

  // Check for brand mention
  const brandName = prompt.brand_name || ''
  if (brandName && contentLower.includes(brandName.toLowerCase())) {
    score += 40
  }

  // Check for domain mention
  const domain = prompt.domain || ''
  if (domain && contentLower.includes(domain.toLowerCase())) {
    score += 20
  }

  // Analyze positioning quality
  const positiveWords = ['best', 'leading', 'top', 'excellent', 'recommended', 'innovative']
  const negativeWords = ['worst', 'poor', 'bad', 'avoid', 'terrible', 'outdated']
  
  const positiveMatches = positiveWords.filter(word => contentLower.includes(word)).length
  const negativeMatches = negativeWords.filter(word => contentLower.includes(word)).length
  
  score += (positiveMatches * 5) - (negativeMatches * 10)

  // Content length and detail factor
  if (content.length > 500) score += 10
  if (content.length > 1000) score += 5

  // Check for factual accuracy indicators
  if (contentLower.includes('founded') || contentLower.includes('established')) {
    citation_accuracy += 0.2
  }
  if (contentLower.includes('http') || contentLower.includes('www.')) {
    citation_accuracy += 0.3
  }

  // Normalize score to 0-100 range
  score = Math.max(0, Math.min(100, score))
  citation_accuracy = Math.max(0, Math.min(1, citation_accuracy))

  return {
    score,
    hallucination_rate,
    citation_accuracy,
    source_overlap
  }
}

async function analyzeExecutionResults(
  supabaseClient: any,
  brandId: string,
  results: any[],
  reportType: string
) {
  const successfulResults = results.filter(r => r.success)
  
  if (successfulResults.length === 0) {
    throw new Error('No successful executions to analyze')
  }

  // Calculate aggregated metrics
  const averageVisibilityScore = successfulResults.reduce((sum, r) => sum + r.score, 0) / successfulResults.length
  
  // Group by model
  const modelScores: Record<string, number[]> = {}
  successfulResults.forEach(r => {
    if (!modelScores[r.model]) modelScores[r.model] = []
    modelScores[r.model].push(r.score)
  })

  // Find top performing model
  const modelAverages = Object.entries(modelScores).map(([model, scores]) => ({
    model,
    average: scores.reduce((sum, score) => sum + score, 0) / scores.length,
    count: scores.length
  }))

  const topPerformingModel = modelAverages.sort((a, b) => b.average - a.average)[0]?.model || 'unknown'

  // Group by prompt
  const promptScores: Record<string, number[]> = {}
  successfulResults.forEach(r => {
    if (!promptScores[r.promptId]) promptScores[r.promptId] = []
    promptScores[r.promptId].push(r.score)
  })

  // Find concerning patterns
  const concerningPatterns = []
  if (averageVisibilityScore < 20) {
    concerningPatterns.push('Overall visibility is very low across models')
  }

  const modelVariance = Object.values(modelScores).map(scores => {
    const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / scores.length
    return Math.sqrt(variance)
  })

  if (modelVariance.some(v => v > 25)) {
    concerningPatterns.push('High variance in scores between models indicates inconsistent brand representation')
  }

  return {
    averageVisibilityScore,
    topPerformingModel,
    modelAverages,
    promptPerformance: Object.entries(promptScores).map(([promptId, scores]) => ({
      promptId,
      average: scores.reduce((sum, s) => sum + s, 0) / scores.length,
      count: scores.length
    })),
    concerningPatterns,
    totalCost: successfulResults.reduce((sum, r) => sum + r.cost, 0),
    executionSummary: {
      total: results.length,
      successful: successfulResults.length,
      failed: results.length - successfulResults.length
    }
  }
}

async function generateInsights(
  supabaseClient: any,
  brand: any,
  analysis: any,
  options: any
) {
  const insights = {
    recommendations: [],
    concerningPatterns: analysis.concerningPatterns,
    opportunities: [],
    nextSteps: []
  }

  // Generate recommendations based on analysis
  if (analysis.averageVisibilityScore < 30) {
    insights.recommendations.push('Consider updating brand content and improving online presence')
    insights.recommendations.push('Focus on SEO optimization and content marketing')
  }

  if (analysis.averageVisibilityScore > 70) {
    insights.recommendations.push('Maintain current strategy and monitor for consistency')
    insights.opportunities.push('Explore expansion into related keywords and topics')
  }

  // Model-specific recommendations
  const lowPerformingModels = analysis.modelAverages
    .filter(m => m.average < analysis.averageVisibilityScore - 10)
    .map(m => m.model)

  if (lowPerformingModels.length > 0) {
    insights.recommendations.push(
      `Focus on improving representation in: ${lowPerformingModels.join(', ')}`
    )
  }

  // Generate next steps
  insights.nextSteps = [
    'Review and optimize underperforming prompts',
    'Monitor competitor performance',
    'Schedule follow-up report in 2 weeks'
  ]

  if (options.scheduleFollowUp) {
    insights.nextSteps.push('Automated follow-up report scheduled')
  }

  return insights
}

async function finalizeReport(
  supabaseClient: any,
  reportId: string,
  brandId: string,
  reportType: string,
  analysis: any,
  insights: any
) {
  // Create monthly report summary if it's a monthly report
  if (reportType === 'monthly') {
    const currentMonth = new Date().toISOString().slice(0, 7) + '-01'
    
    await supabaseClient
      .from('monthly_reports')
      .upsert({
        brand_id: brandId,
        month: currentMonth,
        model_name: 'aggregate',
        delta_scores: {
          visibility: analysis.averageVisibilityScore,
          modelBreakdown: analysis.modelAverages
        },
        top_queries: analysis.promptPerformance
          .sort((a, b) => b.average - a.average)
          .slice(0, 5)
          .map(p => p.promptId),
        recommendation_snapshot: insights.recommendations.join('; ')
      })
  }

  // Update visibility snapshot
  await supabaseClient
    .from('visibility_snapshots')
    .upsert({
      brand_id: brandId,
      visibility_pct: analysis.averageVisibilityScore,
      positioning_pct: analysis.averageVisibilityScore * 0.8, // Simplified calculation
      freshness_score: 75, // Based on recent execution
      robustness_score: Math.max(0, 100 - (analysis.concerningPatterns.length * 20))
    })
}

async function analyzeReports(supabaseClient: any, userId: string, req: Request): Promise<Response> {
  const { brandId, timeRange = '30d', models = [] } = await req.json()

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

  // Calculate date range
  const days = parseInt(timeRange.replace('d', ''))
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  // Get reports for analysis
  let query = supabaseClient
    .from('llm_reports')
    .select(`
      *,
      brand_prompts!inner(prompt, intent_type)
    `)
    .eq('brand_id', brandId)
    .gte('created_at', fromDate.toISOString())

  if (models.length > 0) {
    query = query.in('model_name', models)
  }

  const { data: reports, error: reportsError } = await query

  if (reportsError) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch reports' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Analyze the reports
  const analysis = {
    brand,
    timeRange,
    summary: {
      averageVisibility: reports.reduce((sum, r) => sum + r.score_value, 0) / reports.length,
      positioningTrend: 'stable', // Would be calculated based on historical data
      topPerformingPrompts: [...new Set(reports
        .sort((a, b) => b.score_value - a.score_value)
        .slice(0, 5)
        .map(r => r.brand_prompts.prompt))],
      concerningPatterns: []
    },
    modelComparison: [],
    recommendations: []
  }

  // Group by model for comparison
  const modelGroups = reports.reduce((acc, report) => {
    if (!acc[report.model_name]) acc[report.model_name] = []
    acc[report.model_name].push(report)
    return acc
  }, {})

  analysis.modelComparison = Object.entries(modelGroups).map(([model, modelReports]: [string, any[]]) => ({
    model,
    scores: {
      visibility: modelReports.reduce((sum, r) => sum + r.score_value, 0) / modelReports.length,
      accuracy: modelReports.reduce((sum, r) => sum + r.citation_accuracy, 0) / modelReports.length
    },
    reliability: Math.max(0, 1 - (modelReports.reduce((sum, r) => sum + r.hallucination_rate, 0) / modelReports.length))
  }))

  return new Response(
    JSON.stringify(analysis),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function compareModels(supabaseClient: any, userId: string, req: Request): Promise<Response> {
  const { brandIds, models = LLM_MODELS, timeRange = '30d' } = await req.json()

  // Verify brand ownership for all brands
  const { data: brands, error: brandsError } = await supabaseClient
    .from('brands')
    .select('*')
    .eq('owner_id', userId)
    .in('id', brandIds)

  if (brandsError || !brands || brands.length !== brandIds.length) {
    return new Response(
      JSON.stringify({ error: 'One or more brands not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const days = parseInt(timeRange.replace('d', ''))
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const { data: reports, error: reportsError } = await supabaseClient
    .from('llm_reports')
    .select('*')
    .in('brand_id', brandIds)
    .in('model_name', models)
    .gte('created_at', fromDate.toISOString())

  if (reportsError) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch reports' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const comparison = {
    brands: brands.map(brand => ({
      ...brand,
      models: models.map(model => {
        const modelReports = reports.filter(r => r.brand_id === brand.id && r.model_name === model)
        return {
          model,
          averageScore: modelReports.length > 0 
            ? modelReports.reduce((sum, r) => sum + r.score_value, 0) / modelReports.length 
            : 0,
          reportCount: modelReports.length
        }
      })
    })),
    summary: {
      topBrand: '',
      topModel: '',
      insights: []
    }
  }

  return new Response(
    JSON.stringify(comparison),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getReportStatus(supabaseClient: any, userId: string, reportId: string): Promise<Response> {
  // This would typically get the status from a reports table
  // For now, return a simple status
  return new Response(
    JSON.stringify({ reportId, status: 'completed', progress: 100 }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function listReports(supabaseClient: any, userId: string, searchParams: URLSearchParams): Promise<Response> {
  const brandId = searchParams.get('brandId')
  const limit = parseInt(searchParams.get('limit') || '20')
  const offset = parseInt(searchParams.get('offset') || '0')

  let query = supabaseClient
    .from('llm_reports')
    .select(`
      *,
      brands!inner(name, owner_id),
      brand_prompts(prompt, intent_type)
    `)
    .eq('brands.owner_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (brandId) {
    query = query.eq('brand_id', brandId)
  }

  const { data: reports, error } = await query

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch reports' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ reports }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}