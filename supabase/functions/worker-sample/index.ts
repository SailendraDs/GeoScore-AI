import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SampleJob {
  id: string
  brandId: string
  payload: {
    profile: 'lite' | 'standard' | 'full'
    models: string[]
    promptKeys: string[]
    paraphrases: number
    maxTokensPerPrompt?: number
    temperature?: number
    source: string
  }
}

interface SamplingContext {
  brand: {
    id: string
    name: string
    domain: string
    description?: string
    competitors: string[]
  }
  topClaims: Array<{
    id: string
    text: string
    type: string
    confidence: number
  }>
  topContent: Array<{
    id: string
    title: string
    url: string
    mainContent: string
    wordCount: number
  }>
  embeddings?: Array<{
    id: string
    chunkText: string
    similarity?: number
  }>
}

interface LLMSamplingRequest {
  model: string
  promptKey: string
  promptText: string
  paraphraseIndex: number
  context: SamplingContext
  maxTokens: number
  temperature: number
  metadata: Record<string, any>
}

interface LLMSamplingResult {
  model: string
  promptKey: string
  paraphraseIndex: number
  response: string
  tokens: {
    input: number
    output: number
    total: number
  }
  cost: number
  executionTime: number
  error?: string
  metadata: Record<string, any>
}

interface SampleResult {
  brandId: string
  profile: string
  totalSamples: number
  successfulSamples: number
  failedSamples: number
  totalCost: number
  averageExecutionTime: number
  modelResults: Record<string, { success: number; failed: number; cost: number }>
  nextJobPayload: {
    type: 'score'
    brandId: string
  }
}

const PROFILE_CONFIGS = {
  lite: {
    models: ['gpt-4', 'claude-opus'],
    prompts: ['def_01', 'local_01'],
    paraphrases: 2,
    maxTokens: 1000
  },
  standard: {
    models: ['gpt-4', 'claude-opus', 'gemini-pro'],
    prompts: ['def_01', 'local_01', 'comp_01'],
    paraphrases: 3,
    maxTokens: 2000
  },
  full: {
    models: ['gpt-4', 'claude-opus', 'gemini-pro', 'grok-beta', 'mistral-large'],
    prompts: ['def_01', 'local_01', 'comp_01', 'tech_01', 'brand_01'],
    paraphrases: 5,
    maxTokens: 4000
  }
}

const PROMPT_TEMPLATES = {
  def_01: {
    name: 'Default Brand Query',
    template: `What can you tell me about {brand_name}? I'm looking for information about their services, products, and reputation.`,
    intent: 'general_inquiry'
  },
  local_01: {
    name: 'Local Business Query',
    template: `I'm looking for a {service_type} company in {location}. What do you know about {brand_name}?`,
    intent: 'local_search'
  },
  comp_01: {
    name: 'Competitor Comparison',
    template: `I'm comparing {brand_name} with {competitor}. What are the key differences and which would you recommend?`,
    intent: 'comparison'
  },
  tech_01: {
    name: 'Technical Inquiry',
    template: `I need technical information about {brand_name}'s solutions. What technical capabilities do they offer?`,
    intent: 'technical'
  },
  brand_01: {
    name: 'Brand Reputation',
    template: `What is {brand_name}'s reputation in the industry? Are they a trusted company?`,
    intent: 'reputation'
  }
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

    const method = req.method
    
    if (method === 'POST') {
      return await processSampleJob(supabaseClient, req)
    }

    if (method === 'GET') {
      return await getJobStatus(supabaseClient, req)
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Worker sample error:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function processSampleJob(supabaseClient: any, req: Request) {
  const { jobId, brandId, payload }: { jobId: string, brandId: string, payload: SampleJob['payload'] } = await req.json()

  if (!jobId || !brandId) {
    return new Response(
      JSON.stringify({ error: 'Missing jobId or brandId' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  console.log(`Starting sample job ${jobId} for brand ${brandId} with profile: ${payload.profile}`)

  try {
    // Update job status to running
    await updateJobStatus(supabaseClient, jobId, 'running', { startedAt: new Date().toISOString() })

    // Check budget before proceeding
    const budgetCheck = await checkBudget(supabaseClient, brandId, payload.profile)
    if (!budgetCheck.allowed) {
      throw new Error(`Budget exceeded: ${budgetCheck.reason}`)
    }

    // Get profile configuration
    const profileConfig = payload.profile === 'custom' 
      ? { 
          models: payload.models, 
          prompts: payload.promptKeys,
          paraphrases: payload.paraphrases,
          maxTokens: payload.maxTokensPerPrompt || 2000
        }
      : PROFILE_CONFIGS[payload.profile]

    if (!profileConfig) {
      throw new Error(`Invalid profile: ${payload.profile}`)
    }

    // Build sampling context
    const context = await buildSamplingContext(supabaseClient, brandId)
    
    console.log(`Built context with ${context.topClaims.length} claims and ${context.topContent.length} content items`)

    // Generate all sampling requests
    const samplingRequests = generateSamplingRequests(
      profileConfig, 
      context, 
      payload.temperature || 0.7
    )

    console.log(`Generated ${samplingRequests.length} sampling requests`)

    // Execute sampling with concurrency control
    const results = await executeSamplingRequests(samplingRequests, 3) // Max 3 concurrent requests
    
    console.log(`Completed ${results.length} samples`)

    // Store results in database
    const storedResults = await storeLLMResults(supabaseClient, brandId, results)
    
    console.log(`Stored ${storedResults.success} out of ${results.length} results`)

    // Calculate statistics
    const successfulSamples = results.filter(r => !r.error)
    const failedSamples = results.filter(r => r.error)
    const totalCost = successfulSamples.reduce((sum, r) => sum + r.cost, 0)
    const averageExecutionTime = successfulSamples.length > 0
      ? successfulSamples.reduce((sum, r) => sum + r.executionTime, 0) / successfulSamples.length
      : 0

    // Calculate per-model statistics
    const modelResults: Record<string, { success: number; failed: number; cost: number }> = {}
    
    for (const result of results) {
      if (!modelResults[result.model]) {
        modelResults[result.model] = { success: 0, failed: 0, cost: 0 }
      }
      
      if (result.error) {
        modelResults[result.model].failed++
      } else {
        modelResults[result.model].success++
        modelResults[result.model].cost += result.cost
      }
    }

    // Create next job (score)
    const nextJobPayload = {
      brandId,
      source: 'sample',
      samplingProfile: payload.profile,
      samplingStats: {
        totalSamples: results.length,
        successfulSamples: successfulSamples.length,
        totalCost
      }
    }

    const { data: nextJobId } = await supabaseClient
      .rpc('create_job_with_deps', {
        p_brand_id: brandId,
        p_type: 'score',
        p_payload: nextJobPayload,
        p_depends_on: [jobId],
        p_priority: 4
      })

    const result: SampleResult = {
      brandId,
      profile: payload.profile,
      totalSamples: results.length,
      successfulSamples: successfulSamples.length,
      failedSamples: failedSamples.length,
      totalCost,
      averageExecutionTime,
      modelResults,
      nextJobPayload: {
        type: 'score',
        brandId
      }
    }

    // Complete the job
    await updateJobStatus(supabaseClient, jobId, 'complete', {
      ...result,
      nextJobId,
      completedAt: new Date().toISOString(),
      detailedStats: {
        profileConfig,
        contextSize: {
          claims: context.topClaims.length,
          content: context.topContent.length,
          embeddings: context.embeddings?.length || 0
        },
        executionMetrics: {
          averageTokensPerRequest: successfulSamples.reduce((sum, r) => sum + r.tokens.total, 0) / Math.max(successfulSamples.length, 1),
          averageCostPerRequest: totalCost / Math.max(successfulSamples.length, 1),
          totalExecutionTime: successfulSamples.reduce((sum, r) => sum + r.executionTime, 0)
        }
      }
    })

    console.log(`Sample job ${jobId} completed successfully`)

    return new Response(
      JSON.stringify({
        jobId,
        status: 'complete',
        result,
        nextJobId,
        message: `Successfully completed ${successfulSamples.length}/${results.length} samples for profile ${payload.profile}`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error(`Sample job ${jobId} failed:`, error)
    
    await updateJobStatus(supabaseClient, jobId, 'failed', {
      error: error.message,
      stack: error.stack,
      failedAt: new Date().toISOString()
    })

    return new Response(
      JSON.stringify({
        jobId,
        status: 'failed',
        error: error.message,
        message: 'Sample job failed'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function getJobStatus(supabaseClient: any, req: Request) {
  const url = new URL(req.url)
  const jobId = url.searchParams.get('jobId')

  if (!jobId) {
    return new Response(
      JSON.stringify({ error: 'Missing jobId' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const { data: job, error } = await supabaseClient
      .from('jobs')
      .select(`
        id, brand_id, type, status, payload, result,
        created_at, started_at, completed_at, error_message
      `)
      .eq('id', jobId)
      .single()

    if (error || !job) {
      return new Response(
        JSON.stringify({ error: 'Job not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ job }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to get job status' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Helper functions
async function checkBudget(supabaseClient: any, brandId: string, profile: string): Promise<{ allowed: boolean; reason?: string }> {
  try {
    // Get brand's current usage and limits
    const { data: brand, error } = await supabaseClient
      .from('brands')
      .select(`
        id, name, 
        users!brands_owner_id_fkey (
          user_plans (
            plan_id,
            plans (monthly_llm_budget, monthly_api_calls)
          )
        )
      `)
      .eq('id', brandId)
      .single()

    if (error || !brand) {
      return { allowed: false, reason: 'Brand not found' }
    }

    // Get current month usage
    const currentMonth = new Date().toISOString().slice(0, 7)
    const { data: usage } = await supabaseClient
      .from('llm_reports')
      .select('cost_estimate')
      .eq('brand_id', brandId)
      .gte('created_at', currentMonth + '-01')
      .lt('created_at', currentMonth + '-31')

    const currentUsage = usage?.reduce((sum: number, record: any) => sum + (record.cost_estimate || 0), 0) || 0
    
    // Estimate cost for this sampling job
    const profileConfig = PROFILE_CONFIGS[profile as keyof typeof PROFILE_CONFIGS]
    const estimatedCost = profileConfig 
      ? profileConfig.models.length * profileConfig.prompts.length * profileConfig.paraphrases * 0.02 // Rough estimate
      : 1.0

    const plan = brand.users.user_plans?.plans
    const monthlyBudget = plan?.monthly_llm_budget || 100 // Default budget

    if (currentUsage + estimatedCost > monthlyBudget) {
      return { 
        allowed: false, 
        reason: `Would exceed monthly budget. Current: $${currentUsage.toFixed(2)}, Estimated: $${estimatedCost.toFixed(2)}, Limit: $${monthlyBudget}` 
      }
    }

    return { allowed: true }

  } catch (error) {
    console.error('Budget check failed:', error)
    return { allowed: true } // Fail open for now
  }
}

async function buildSamplingContext(supabaseClient: any, brandId: string): Promise<SamplingContext> {
  // Get brand information
  const { data: brand, error: brandError } = await supabaseClient
    .from('brands')
    .select('id, domain, name, description, competitors')
    .eq('id', brandId)
    .single()

  if (brandError || !brand) {
    throw new Error(`Brand not found: ${brandId}`)
  }

  // Get top claims
  const { data: claims } = await supabaseClient
    .from('claims')
    .select('id, claim_text, claim_type, confidence_score')
    .eq('brand_id', brandId)
    .order('confidence_score', { ascending: false })
    .limit(10)

  // Get top content
  const { data: content } = await supabaseClient
    .from('page_content')
    .select('id, title, url, main_content, word_count')
    .eq('brand_id', brandId)
    .order('word_count', { ascending: false })
    .limit(5)

  // Get relevant embeddings (placeholder for now)
  const { data: embeddings } = await supabaseClient
    .from('content_chunks')
    .select('id, chunk_text')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .limit(3)

  return {
    brand: {
      id: brand.id,
      name: brand.name || brand.domain,
      domain: brand.domain,
      description: brand.description,
      competitors: brand.competitors || []
    },
    topClaims: claims?.map((claim: any) => ({
      id: claim.id,
      text: claim.claim_text,
      type: claim.claim_type,
      confidence: claim.confidence_score
    })) || [],
    topContent: content?.map((item: any) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      mainContent: item.main_content?.substring(0, 1000), // Truncate for context
      wordCount: item.word_count
    })) || [],
    embeddings: embeddings?.map((item: any) => ({
      id: item.id,
      chunkText: item.chunk_text
    })) || []
  }
}

function generateSamplingRequests(profileConfig: any, context: SamplingContext, temperature: number): LLMSamplingRequest[] {
  const requests: LLMSamplingRequest[] = []

  for (const model of profileConfig.models) {
    for (const promptKey of profileConfig.prompts) {
      for (let paraphraseIndex = 0; paraphraseIndex < profileConfig.paraphrases; paraphraseIndex++) {
        const promptTemplate = PROMPT_TEMPLATES[promptKey as keyof typeof PROMPT_TEMPLATES]
        
        if (!promptTemplate) {
          console.warn(`Unknown prompt template: ${promptKey}`)
          continue
        }

        // Generate prompt variations based on paraphrase index
        let promptText = promptTemplate.template
          .replace('{brand_name}', context.brand.name)
          .replace('{service_type}', extractServiceType(context))
          .replace('{location}', extractLocation(context))
          .replace('{competitor}', getRandomCompetitor(context))

        // Add paraphrase variation
        if (paraphraseIndex > 0) {
          promptText = paraphrasePrompt(promptText, paraphraseIndex)
        }

        requests.push({
          model,
          promptKey,
          promptText,
          paraphraseIndex,
          context,
          maxTokens: profileConfig.maxTokens,
          temperature,
          metadata: {
            intent: promptTemplate.intent,
            brandId: context.brand.id,
            timestamp: new Date().toISOString()
          }
        })
      }
    }
  }

  return requests
}

function extractServiceType(context: SamplingContext): string {
  // Extract service type from claims or content
  const serviceKeywords = ['consulting', 'development', 'design', 'marketing', 'software', 'technology']
  
  for (const claim of context.topClaims) {
    const lowerText = claim.text.toLowerCase()
    for (const keyword of serviceKeywords) {
      if (lowerText.includes(keyword)) {
        return keyword
      }
    }
  }
  
  return 'technology'
}

function extractLocation(context: SamplingContext): string {
  // Extract location from claims or content
  const locationPatterns = [
    /(?:in|at|located|based)\s+([A-Z][a-z]+,?\s*[A-Z]{2})/gi,
    /(?:in|at|located|based)\s+([A-Z][a-z]+\s*[A-Z][a-z]*)/gi
  ]
  
  for (const claim of context.topClaims) {
    for (const pattern of locationPatterns) {
      const match = pattern.exec(claim.text)
      if (match) {
        return match[1]
      }
    }
  }
  
  return 'United States'
}

function getRandomCompetitor(context: SamplingContext): string {
  if (context.brand.competitors.length > 0) {
    return context.brand.competitors[Math.floor(Math.random() * context.brand.competitors.length)]
  }
  return 'industry leaders'
}

function paraphrasePrompt(original: string, index: number): string {
  const variations = [
    original, // Original
    original.replace(/What can you tell me about/, 'I\'d like to know more about'),
    original.replace(/I\'m looking for/, 'I need information about'),
    original.replace(/What do you know about/, 'Can you provide details on'),
    original.replace(/What is/, 'Tell me about')
  ]
  
  return variations[index % variations.length]
}

async function executeSamplingRequests(requests: LLMSamplingRequest[], concurrency: number): Promise<LLMSamplingResult[]> {
  const results: LLMSamplingResult[] = []
  
  // Process requests in batches to control concurrency
  for (let i = 0; i < requests.length; i += concurrency) {
    const batch = requests.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map(request => executeSingleSample(request))
    )
    results.push(...batchResults)
    
    console.log(`Completed batch ${Math.floor(i/concurrency) + 1}/${Math.ceil(requests.length/concurrency)}`)
    
    // Add delay between batches to respect rate limits
    if (i + concurrency < requests.length) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  
  return results
}

async function executeSingleSample(request: LLMSamplingRequest): Promise<LLMSamplingResult> {
  try {
    const startTime = Date.now()
    
    // Call LLM orchestration service
    const response = await fetch('https://alaxjkbdistiwvckfysi.supabase.co/functions/v1/llm-orchestration/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        model: request.model,
        prompt: request.promptText,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        brandId: request.context.brand.id,
        metadata: {
          ...request.metadata,
          promptKey: request.promptKey,
          paraphraseIndex: request.paraphraseIndex
        }
      })
    })

    const executionTime = Date.now() - startTime

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`)
    }

    const data = await response.json()
    
    return {
      model: request.model,
      promptKey: request.promptKey,
      paraphraseIndex: request.paraphraseIndex,
      response: data.response.content,
      tokens: {
        input: data.response.usage.inputTokens,
        output: data.response.usage.outputTokens,
        total: data.response.usage.totalTokens
      },
      cost: data.response.cost.totalCost,
      executionTime,
      metadata: {
        ...request.metadata,
        llmApiVersion: data.timestamp
      }
    }

  } catch (error) {
    return {
      model: request.model,
      promptKey: request.promptKey,
      paraphraseIndex: request.paraphraseIndex,
      response: '',
      tokens: { input: 0, output: 0, total: 0 },
      cost: 0,
      executionTime: 0,
      error: error.message,
      metadata: request.metadata
    }
  }
}

async function storeLLMResults(supabaseClient: any, brandId: string, results: LLMSamplingResult[]): Promise<{ success: number; failed: number }> {
  let success = 0
  let failed = 0

  for (const result of results) {
    try {
      const { error } = await supabaseClient
        .from('llm_reports')
        .insert({
          brand_id: brandId,
          model_name: result.model,
          prompt_key: result.promptKey,
          prompt_text: result.metadata.promptText || '',
          response_text: result.response,
          score_type: result.metadata.intent || 'general',
          score_value: null, // Will be calculated in scoring job
          cost_estimate: result.cost,
          execution_time_ms: result.executionTime,
          tokens_used: result.tokens.total,
          paraphrase_index: result.paraphraseIndex,
          metadata: {
            ...result.metadata,
            tokens: result.tokens,
            error: result.error || null
          },
          created_at: new Date().toISOString()
        })

      if (error) {
        console.error('Failed to store LLM result:', error)
        failed++
      } else {
        success++
      }
    } catch (error) {
      console.error('Failed to store LLM result:', error)
      failed++
    }
  }

  return { success, failed }
}

async function updateJobStatus(supabaseClient: any, jobId: string, status: string, result: any) {
  const updateData: any = {
    status,
    updated_at: new Date().toISOString()
  }

  if (status === 'complete') {
    updateData.completed_at = new Date().toISOString()
    updateData.result = result
  } else if (status === 'failed') {
    updateData.error_message = result.error || 'Unknown error'
    updateData.result = result
  } else if (status === 'running') {
    updateData.started_at = result.startedAt
  }

  await supabaseClient
    .from('jobs')
    .update(updateData)
    .eq('id', jobId)

  console.log(`Job ${jobId} status updated to: ${status}`)
}