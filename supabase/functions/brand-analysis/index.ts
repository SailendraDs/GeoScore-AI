import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AnalysisProgress {
  step: string
  progress: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  message: string
  data?: any
}

interface BrandAnalysisRequest {
  brandName: string
  brandDomain: string
  brandDescription?: string
  analysisTypes: ('competitor_discovery' | 'prompt_generation' | 'multi_llm_analysis')[]
  models?: string[]
  promptCount?: number
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(
      req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    )
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const url = new URL(req.url)
    const action = url.pathname.split('/').pop()

    if (action === 'start') {
      // POST /brand-analysis/start - Start comprehensive brand analysis
      return await startBrandAnalysis(supabaseClient, user.id, req)
    }

    if (action === 'progress') {
      // GET /brand-analysis/progress?analysisId=xxx - Get analysis progress
      const analysisId = url.searchParams.get('analysisId')
      return await getAnalysisProgress(supabaseClient, user.id, analysisId)
    }

    if (action === 'results') {
      // GET /brand-analysis/results?analysisId=xxx - Get completed analysis results
      const analysisId = url.searchParams.get('analysisId')
      return await getAnalysisResults(supabaseClient, user.id, analysisId)
    }

    if (action === 'cancel') {
      // POST /brand-analysis/cancel - Cancel running analysis
      const { analysisId } = await req.json()
      return await cancelAnalysis(supabaseClient, user.id, analysisId)
    }

    return new Response(
      JSON.stringify({ error: 'Invalid endpoint' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Brand analysis error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function startBrandAnalysis(supabaseClient: any, userId: string, req: Request) {
  const { 
    brandName, 
    brandDomain, 
    brandDescription = '', 
    analysisTypes = ['competitor_discovery', 'prompt_generation', 'multi_llm_analysis'],
    models = ['gpt-4o', 'claude-opus', 'gemini-pro'],
    promptCount = 20 
  }: BrandAnalysisRequest = await req.json()

  if (!brandName || !brandDomain) {
    return new Response(
      JSON.stringify({ error: 'Missing brandName or brandDomain' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Get or create brand
    const { data: brand } = await supabaseClient
      .from('brands')
      .select('id')
      .eq('domain', brandDomain)
      .eq('owner_id', userId)
      .single()

    let brandId = brand?.id

    if (!brandId) {
      // Create new brand
      const { data: newBrand, error: brandError } = await supabaseClient
        .from('brands')
        .insert({
          name: brandName,
          domain: brandDomain,
          description: brandDescription,
          owner_id: userId
        })
        .select('id')
        .single()

      if (brandError) throw brandError
      brandId = newBrand.id
    }

    // Create analysis job
    const analysisId = crypto.randomUUID()
    const { error: jobError } = await supabaseClient
      .from('jobs')
      .insert({
        id: analysisId,
        brand_id: brandId,
        type: 'brand_analysis',
        status: 'queued',
        payload: {
          brandName,
          brandDomain,
          brandDescription,
          analysisTypes,
          models,
          promptCount,
          userId
        },
        priority: 3
      })

    if (jobError) throw jobError

    // Trigger the analysis pipeline via job queue
    await supabaseClient.functions.invoke('job-runner', {
      body: { 
        jobId: analysisId,
        immediate: true // Process immediately for better UX
      }
    })

    return new Response(
      JSON.stringify({
        analysisId,
        brandId,
        brandName,
        status: 'queued',
        estimatedTimeMinutes: Math.ceil(promptCount * models.length / 20), // Rough estimate
        message: 'Brand analysis started successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: `Failed to start brand analysis: ${error.message}`,
        brandName 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function getAnalysisProgress(supabaseClient: any, userId: string, analysisId: string | null) {
  if (!analysisId) {
    return new Response(
      JSON.stringify({ error: 'Missing analysisId' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Get job status and progress
    const { data: job, error: jobError } = await supabaseClient
      .from('jobs')
      .select(`
        id, status, created_at, completed_at, failed_at, 
        payload, result,
        brands!inner(owner_id)
      `)
      .eq('id', analysisId)
      .eq('brands.owner_id', userId)
      .single()

    if (jobError || !job) {
      return new Response(
        JSON.stringify({ error: 'Analysis not found or access denied' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Calculate progress based on completed steps
    let progress = 0
    let currentStep = 'Initializing'
    
    switch (job.status) {
      case 'queued':
        progress = 0
        currentStep = 'Waiting in queue'
        break
      case 'running':
        // Estimate progress based on job result data
        const result = job.result || {}
        if (result.competitorsDiscovered) progress = 25
        if (result.promptsGenerated) progress = 50
        if (result.analysisStarted) progress = 75
        currentStep = result.currentStep || 'Processing'
        break
      case 'complete':
        progress = 100
        currentStep = 'Analysis complete'
        break
      case 'failed':
        progress = 0
        currentStep = 'Analysis failed'
        break
    }

    // Get partial results if available
    const partialResults = job.result || {}

    return new Response(
      JSON.stringify({
        analysisId,
        status: job.status,
        progress,
        currentStep,
        startedAt: job.created_at,
        completedAt: job.completed_at,
        failedAt: job.failed_at,
        partialResults: {
          competitors: partialResults.competitors || [],
          prompts: partialResults.prompts || [],
          completedAnalyses: partialResults.completedAnalyses || 0,
          totalAnalyses: partialResults.totalAnalyses || 0
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: `Failed to get analysis progress: ${error.message}`
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function getAnalysisResults(supabaseClient: any, userId: string, analysisId: string | null) {
  if (!analysisId) {
    return new Response(
      JSON.stringify({ error: 'Missing analysisId' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Get completed job with results
    const { data: job, error: jobError } = await supabaseClient
      .from('jobs')
      .select(`
        id, status, result, completed_at,
        brands!inner(id, name, domain, owner_id)
      `)
      .eq('id', analysisId)
      .eq('brands.owner_id', userId)
      .eq('status', 'complete')
      .single()

    if (jobError || !job) {
      return new Response(
        JSON.stringify({ error: 'Completed analysis not found or access denied' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get related data
    const [competitorsRes, llmReportsRes, promptsRes] = await Promise.allSettled([
      supabaseClient
        .from('competitors')
        .select('*')
        .eq('brand_id', job.brands.id),
      
      supabaseClient
        .from('llm_reports')
        .select('*')
        .eq('brand_id', job.brands.id)
        .order('created_at', { ascending: false })
        .limit(100),
      
      supabaseClient
        .from('brand_prompts')
        .select('*')
        .eq('brand_id', job.brands.id)
        .order('created_at', { ascending: false })
        .limit(50)
    ])

    const competitors = competitorsRes.status === 'fulfilled' ? competitorsRes.value.data || [] : []
    const llmReports = llmReportsRes.status === 'fulfilled' ? llmReportsRes.value.data || [] : []
    const prompts = promptsRes.status === 'fulfilled' ? promptsRes.value.data || [] : []

    // Calculate summary statistics
    const summary = calculateAnalysisSummary(competitors, llmReports, prompts)

    return new Response(
      JSON.stringify({
        analysisId,
        brand: job.brands,
        completedAt: job.completed_at,
        results: job.result,
        competitors,
        llmReports,
        prompts,
        summary
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: `Failed to get analysis results: ${error.message}`
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function cancelAnalysis(supabaseClient: any, userId: string, analysisId: string) {
  try {
    // Update job status to cancelled (if still queued or running)
    const { error } = await supabaseClient
      .from('jobs')
      .update({ 
        status: 'failed',
        failed_at: new Date().toISOString(),
        result: { cancelled: true, cancelledBy: userId }
      })
      .eq('id', analysisId)
      .in('status', ['queued', 'running'])

    if (error) throw error

    return new Response(
      JSON.stringify({
        analysisId,
        status: 'cancelled',
        message: 'Analysis cancelled successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: `Failed to cancel analysis: ${error.message}`
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

function calculateAnalysisSummary(competitors: any[], llmReports: any[], prompts: any[]) {
  const totalPrompts = prompts.length
  const totalLLMResponses = llmReports.length
  const modelsAnalyzed = [...new Set(llmReports.map(r => r.model_name))].length
  
  // Brand mention statistics
  const brandMentionCount = llmReports.filter(r => 
    r.response_text && r.response_text.toLowerCase().includes('brand')
  ).length
  const brandMentionRate = totalLLMResponses > 0 ? 
    Math.round((brandMentionCount / totalLLMResponses) * 100) : 0

  // Competitor statistics  
  const totalCompetitors = competitors.length
  const topCompetitors = competitors
    .sort((a, b) => (b.mention_count || 0) - (a.mention_count || 0))
    .slice(0, 5)

  // Cost and performance
  const totalCost = llmReports.reduce((sum, r) => sum + (r.cost_estimate || 0), 0)
  const avgExecutionTime = totalLLMResponses > 0 ? 
    llmReports.reduce((sum, r) => sum + (r.execution_time_ms || 0), 0) / totalLLMResponses : 0

  return {
    totalPrompts,
    totalLLMResponses,
    modelsAnalyzed,
    brandMentionRate,
    totalCompetitors,
    topCompetitors,
    totalCost: Math.round(totalCost * 10000) / 10000, // Round to 4 decimal places
    avgExecutionTimeMs: Math.round(avgExecutionTime)
  }
}