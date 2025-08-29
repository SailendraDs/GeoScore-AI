import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PipelineRequest {
  profile: 'lite' | 'standard' | 'full'
  options?: {
    models?: string[]
    prompts?: string[]
    competitors?: string[]
    skipSteps?: string[]
    priority?: number
  }
}

interface PipelineProfile {
  name: string
  models: string[]
  promptCount: number
  paraphrases: number
  steps: string[]
  estimatedCost: number
  estimatedTime: string
}

const PIPELINE_PROFILES: Record<string, PipelineProfile> = {
  lite: {
    name: 'Lite Analysis',
    models: ['gpt-4o-mini', 'claude-haiku'],
    promptCount: 3,
    paraphrases: 1,
    steps: ['brand_onboard', 'normalize', 'sample', 'score', 'assemble_report'],
    estimatedCost: 5.00,
    estimatedTime: '15-30 minutes'
  },
  standard: {
    name: 'Standard Analysis',
    models: ['gpt-4o', 'claude-opus', 'gemini-pro'],
    promptCount: 5,
    paraphrases: 2,
    steps: ['brand_onboard', 'normalize', 'embed', 'sample', 'score', 'assemble_report'],
    estimatedCost: 15.00,
    estimatedTime: '30-60 minutes'
  },
  full: {
    name: 'Comprehensive Analysis',
    models: ['gpt-5', 'claude-opus', 'gemini-pro', 'grok-4', 'deepseek-chat'],
    promptCount: 10,
    paraphrases: 3,
    steps: ['brand_onboard', 'normalize', 'embed', 'sample', 'score', 'assemble_report'],
    estimatedCost: 50.00,
    estimatedTime: '1-2 hours'
  }
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

    // Get the current user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const brandId = pathParts[pathParts.length - 2] // /brands/:brandId/run

    if (req.method === 'POST' && url.pathname.endsWith('/run')) {
      return await runPipeline(supabaseClient, user.id, brandId, req)
    }

    if (req.method === 'GET' && url.pathname.endsWith('/status')) {
      return await getPipelineStatus(supabaseClient, user.id, brandId)
    }

    if (req.method === 'POST' && url.pathname.endsWith('/cancel')) {
      return await cancelPipeline(supabaseClient, user.id, brandId)
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Pipeline API error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function runPipeline(supabaseClient: any, userId: string, brandId: string, req: Request) {
  const { profile, options = {} }: PipelineRequest = await req.json()

  // Validate brand ownership
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

  // Validate profile
  if (!PIPELINE_PROFILES[profile]) {
    return new Response(
      JSON.stringify({ error: 'Invalid profile. Must be: lite, standard, or full' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Check if pipeline is already running
  const { data: runningJobs } = await supabaseClient
    .from('jobs')
    .select('id, type, status')
    .eq('brand_id', brandId)
    .in('status', ['queued', 'running'])

  if (runningJobs && runningJobs.length > 0) {
    return new Response(
      JSON.stringify({ 
        error: 'Pipeline already running',
        runningJobs: runningJobs.map((job: any) => ({ id: job.id, type: job.type, status: job.status }))
      }),
      { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Check user subscription and credits
  const { data: userPlan } = await supabaseClient
    .from('user_plans')
    .select('*, plans(*)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single()

  if (!userPlan) {
    return new Response(
      JSON.stringify({ 
        error: 'Active subscription required',
        code: 'subscription_inactive',
        next_action: 'subscribe'
      }),
      { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const profileConfig = PIPELINE_PROFILES[profile]
  
  // Check budget
  if (userPlan.remaining_credits < profileConfig.estimatedCost) {
    return new Response(
      JSON.stringify({ 
        error: 'Insufficient credits',
        required: profileConfig.estimatedCost,
        available: userPlan.remaining_credits,
        code: 'insufficient_budget'
      }),
      { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Create pipeline execution record
  const pipelineId = crypto.randomUUID()
  const { error: pipelineError } = await supabaseClient
    .from('pipeline_executions')
    .insert({
      id: pipelineId,
      brand_id: brandId,
      user_id: userId,
      profile,
      status: 'starting',
      config: {
        ...profileConfig,
        ...options,
        models: options.models || profileConfig.models,
        priority: options.priority || 0
      },
      estimated_cost: profileConfig.estimatedCost,
      started_at: new Date().toISOString()
    })

  if (pipelineError) {
    console.error('Pipeline execution creation error:', pipelineError)
    return new Response(
      JSON.stringify({ error: 'Failed to create pipeline execution' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Enqueue initial job
  const jobPayload = {
    profile,
    pipelineId,
    seedUrls: [
      `https://${brand.domain}`,
      `https://${brand.domain}/sitemap.xml`,
      ...(options.competitors || brand.competitors || []).map((c: string) => `https://${c}`)
    ],
    config: {
      ...profileConfig,
      ...options
    }
  }

  const { data: job, error: jobError } = await supabaseClient
    .from('jobs')
    .insert({
      brand_id: brandId,
      type: 'brand_onboard',
      status: 'queued',
      payload: jobPayload,
      priority: options.priority || 0,
      pipeline_execution_id: pipelineId,
      created_by: userId
    })
    .select()
    .single()

  if (jobError) {
    console.error('Job creation error:', jobError)
    return new Response(
      JSON.stringify({ error: 'Failed to enqueue pipeline job' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Update pipeline status
  await supabaseClient
    .from('pipeline_executions')
    .update({ 
      status: 'running',
      current_step: 'brand_onboard',
      jobs_created: 1
    })
    .eq('id', pipelineId)

  // Emit metrics and logs
  console.log(JSON.stringify({
    event: 'pipeline.started',
    pipelineId,
    brandId,
    userId,
    profile,
    jobId: job.id,
    estimatedCost: profileConfig.estimatedCost,
    timestamp: new Date().toISOString()
  }))

  return new Response(
    JSON.stringify({
      pipelineId,
      jobId: job.id,
      profile: profileConfig.name,
      status: 'running',
      estimatedCost: profileConfig.estimatedCost,
      estimatedTime: profileConfig.estimatedTime,
      steps: profileConfig.steps,
      message: 'Pipeline started successfully'
    }),
    { 
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    }
  )
}

async function getPipelineStatus(supabaseClient: any, userId: string, brandId: string) {
  // Get latest pipeline execution
  const { data: pipeline, error } = await supabaseClient
    .from('pipeline_executions')
    .select(`
      *,
      jobs (
        id,
        type,
        status,
        progress,
        result,
        created_at,
        started_at,
        completed_at,
        error
      )
    `)
    .eq('brand_id', brandId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !pipeline) {
    return new Response(
      JSON.stringify({ error: 'No pipeline executions found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Calculate overall progress
  const totalJobs = pipeline.jobs.length
  const completedJobs = pipeline.jobs.filter((j: any) => j.status === 'completed').length
  const failedJobs = pipeline.jobs.filter((j: any) => j.status === 'failed').length
  const overallProgress = totalJobs > 0 ? (completedJobs / totalJobs) * 100 : 0

  // Determine current status
  let status = pipeline.status
  if (failedJobs > 0 && completedJobs + failedJobs === totalJobs) {
    status = 'failed'
  } else if (completedJobs === totalJobs && totalJobs > 0) {
    status = 'completed'
  }

  return new Response(
    JSON.stringify({
      pipelineId: pipeline.id,
      status,
      profile: pipeline.profile,
      progress: Math.round(overallProgress),
      currentStep: pipeline.current_step,
      estimatedCost: pipeline.estimated_cost,
      actualCost: pipeline.actual_cost,
      startedAt: pipeline.started_at,
      completedAt: pipeline.completed_at,
      jobs: pipeline.jobs.map((job: any) => ({
        id: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress || 0,
        error: job.error,
        createdAt: job.created_at,
        completedAt: job.completed_at
      })),
      config: pipeline.config
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function cancelPipeline(supabaseClient: any, userId: string, brandId: string) {
  // Find running pipeline
  const { data: pipeline } = await supabaseClient
    .from('pipeline_executions')
    .select('id')
    .eq('brand_id', brandId)
    .eq('user_id', userId)
    .in('status', ['running', 'queued'])
    .single()

  if (!pipeline) {
    return new Response(
      JSON.stringify({ error: 'No running pipeline found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Cancel queued jobs
  const { error: jobError } = await supabaseClient
    .from('jobs')
    .update({ 
      status: 'cancelled',
      completed_at: new Date().toISOString(),
      result: { cancelled_by: userId, reason: 'user_request' }
    })
    .eq('brand_id', brandId)
    .eq('status', 'queued')

  // Update pipeline status
  const { error: pipelineError } = await supabaseClient
    .from('pipeline_executions')
    .update({ 
      status: 'cancelled',
      completed_at: new Date().toISOString()
    })
    .eq('id', pipeline.id)

  if (jobError || pipelineError) {
    return new Response(
      JSON.stringify({ error: 'Failed to cancel pipeline' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ message: 'Pipeline cancelled successfully' }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}