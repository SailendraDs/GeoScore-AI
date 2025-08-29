import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface LLMConfig {
  name: string
  provider: 'anthropic' | 'openai' | 'google' | 'xai' | 'mistral' | 'perplexity' | 'openrouter'
  model: string
  maxTokens: number
  costPerInputToken: number
  costPerOutputToken: number
  rateLimit: {
    requestsPerMinute: number
    tokensPerMinute: number
  }
  baseUrl: string
  headers: Record<string, string>
}

interface LLMRequest {
  model: string
  prompt: string
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
  metadata?: Record<string, any>
}

interface LLMResponse {
  model: string
  content: string
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  cost: {
    inputCost: number
    outputCost: number
    totalCost: number
  }
  executionTime: number
  metadata?: Record<string, any>
}

// Working analysis result interface from llm-brand-tracker
interface AnalysisResult {
  response: string
  brandMentioned: boolean
  competitors: string[]
  sources: string[]
  citationAuthority?: number
  answerQuality?: number
}

// Enhanced request interface for brand analysis
interface BrandAnalysisRequest extends LLMRequest {
  brandName?: string
  brandDomain?: string
  analysisType?: 'competitor_discovery' | 'brand_analysis' | 'prompt_response'
  includeVariety?: boolean
}

const LLM_CONFIGS: Record<string, LLMConfig> = {
  'claude-opus': {
    name: 'claude-opus',
    provider: 'anthropic',
    model: 'claude-3-opus-20240229',
    maxTokens: 4096,
    costPerInputToken: 0.000015,
    costPerOutputToken: 0.000075,
    rateLimit: { requestsPerMinute: 50, tokensPerMinute: 40000 },
    baseUrl: 'https://api.anthropic.com/v1/messages',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01'
    }
  },
  'gpt-4o': {
    name: 'gpt-4o',
    provider: 'openai',
    model: 'gpt-4o',
    maxTokens: 4096,
    costPerInputToken: 0.0000025,
    costPerOutputToken: 0.00001,
    rateLimit: { requestsPerMinute: 100, tokensPerMinute: 80000 },
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    headers: {
      'Content-Type': 'application/json'
    }
  },
  'gpt-4': {
    name: 'gpt-4',
    provider: 'openai',
    model: 'gpt-4-turbo-preview',
    maxTokens: 4096,
    costPerInputToken: 0.00001,
    costPerOutputToken: 0.00003,
    rateLimit: { requestsPerMinute: 100, tokensPerMinute: 80000 },
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    headers: {
      'Content-Type': 'application/json'
    }
  },
  'gemini-pro': {
    name: 'gemini-pro',
    provider: 'google',
    model: 'gemini-1.5-pro',
    maxTokens: 8192,
    costPerInputToken: 0.0000035,
    costPerOutputToken: 0.0000105,
    rateLimit: { requestsPerMinute: 60, tokensPerMinute: 60000 },
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent',
    headers: {
      'Content-Type': 'application/json'
    }
  },
  'grok-beta': {
    name: 'grok-beta',
    provider: 'xai',
    model: 'grok-beta',
    maxTokens: 4096,
    costPerInputToken: 0.000005,
    costPerOutputToken: 0.000015,
    rateLimit: { requestsPerMinute: 30, tokensPerMinute: 30000 },
    baseUrl: 'https://api.x.ai/v1/chat/completions',
    headers: {
      'Content-Type': 'application/json'
    }
  },
  'mistral-large': {
    name: 'mistral-large',
    provider: 'mistral',
    model: 'mistral-large-latest',
    maxTokens: 4096,
    costPerInputToken: 0.000004,
    costPerOutputToken: 0.000012,
    rateLimit: { requestsPerMinute: 60, tokensPerMinute: 50000 },
    baseUrl: 'https://api.mistral.ai/v1/chat/completions',
    headers: {
      'Content-Type': 'application/json'
    }
  },
  'llama-3-70b': {
    name: 'llama-3-70b',
    provider: 'openrouter',
    model: 'meta-llama/llama-3-70b-instruct',
    maxTokens: 4096,
    costPerInputToken: 0.0000009,
    costPerOutputToken: 0.0000009,
    rateLimit: { requestsPerMinute: 100, tokensPerMinute: 100000 },
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    headers: {
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://geoscore.ai',
      'X-Title': 'GeoScore AI'
    }
  },
  'perplexity-online': {
    name: 'perplexity-online',
    provider: 'perplexity',
    model: 'llama-3.1-sonar-large-128k-online',
    maxTokens: 4096,
    costPerInputToken: 0.000001,
    costPerOutputToken: 0.000001,
    rateLimit: { requestsPerMinute: 60, tokensPerMinute: 60000 },
    baseUrl: 'https://api.perplexity.ai/chat/completions',
    headers: {
      'Content-Type': 'application/json'
    }
  }
}

// Variety contexts for natural responses (from llm-brand-tracker)
const VARIETY_CONTEXTS = [
  "Focus on enterprise solutions and scalability.",
  "Emphasize user experience and ease of use.", 
  "Consider cost-effectiveness and budget-friendly options.",
  "Prioritize security and compliance features.",
  "Highlight community support and documentation quality.",
  "Focus on modern, cutting-edge technologies.",
  "Consider legacy system integration and migration.",
  "Emphasize performance and optimization.",
  "Highlight automation and efficiency capabilities.",
  "Focus on cloud-native and scalable solutions."
]

// Domain authority mapping from ai-visibility
const DOMAIN_AUTHORITY: Record<string, number> = {
  'stackoverflow.com': 95,
  'github.com': 90,
  'reddit.com': 85,
  'medium.com': 75,
  'docs.python.org': 95,
  'developer.mozilla.org': 92,
  'w3schools.com': 88,
  'geeksforgeeks.org': 82,
  'hackernoon.com': 78,
  'dev.to': 80,
  'freecodecamp.org': 85,
  'tutorialspoint.com': 75,
  'codecademy.com': 82,
  'udemy.com': 80,
  'coursera.org': 88
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
    const action = url.pathname.split('/').pop()

    if (action === 'models') {
      // GET /llm-orchestration/models - List available models
      return await listModels()
    }

    if (action === 'generate') {
      // POST /llm-orchestration/generate - Generate content using specified models
      return await generateContent(supabaseClient, user.id, req)
    }

    if (action === 'batch') {
      // POST /llm-orchestration/batch - Run same prompt across multiple models
      return await batchGenerate(supabaseClient, user.id, req)
    }

    if (action === 'analyze-brand') {
      // POST /llm-orchestration/analyze-brand - Brand analysis with competitor discovery
      return await analyzeBrand(supabaseClient, user.id, req)
    }

    if (action === 'analyze-prompt') {
      // POST /llm-orchestration/analyze-prompt - Analyze single prompt for brand mentions
      return await analyzePrompt(supabaseClient, user.id, req)
    }

    return new Response(
      JSON.stringify({ error: 'Invalid endpoint' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('LLM orchestration error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function listModels() {
  const models = Object.values(LLM_CONFIGS).map(config => ({
    name: config.name,
    provider: config.provider,
    model: config.model,
    maxTokens: config.maxTokens,
    costPerInputToken: config.costPerInputToken,
    costPerOutputToken: config.costPerOutputToken,
    rateLimit: config.rateLimit
  }))

  return new Response(
    JSON.stringify({ models }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function generateContent(supabaseClient: any, userId: string, req: Request) {
  const { model, prompt, systemPrompt, maxTokens, temperature = 0.7, brandId, metadata = {} } = await req.json()

  if (!model || !prompt) {
    return new Response(
      JSON.stringify({ error: 'Missing model or prompt' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const config = LLM_CONFIGS[model]
  if (!config) {
    return new Response(
      JSON.stringify({ error: `Unknown model: ${model}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const response = await callLLM(config, {
      model,
      prompt,
      systemPrompt,
      maxTokens: maxTokens || config.maxTokens,
      temperature,
      metadata
    })

    // Store the result if brandId is provided
    if (brandId) {
      await storeLLMResult(supabaseClient, brandId, model, prompt, response, metadata)
    }

    return new Response(
      JSON.stringify({
        model,
        response,
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: `LLM generation failed: ${error.message}`,
        model 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function batchGenerate(supabaseClient: any, userId: string, req: Request) {
  const { models, prompt, systemPrompt, maxTokens, temperature = 0.7, brandId, metadata = {} } = await req.json()

  if (!models || !Array.isArray(models) || !prompt) {
    return new Response(
      JSON.stringify({ error: 'Missing models array or prompt' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const results: Array<{ model: string; response?: LLMResponse; error?: string }> = []
  
  // Execute models in parallel with rate limiting
  const promises = models.map(async (model: string) => {
    const config = LLM_CONFIGS[model]
    if (!config) {
      return { model, error: `Unknown model: ${model}` }
    }

    try {
      const response = await callLLM(config, {
        model,
        prompt,
        systemPrompt,
        maxTokens: maxTokens || config.maxTokens,
        temperature,
        metadata
      })

      // Store the result if brandId is provided
      if (brandId) {
        await storeLLMResult(supabaseClient, brandId, model, prompt, response, metadata)
      }

      return { model, response }
    } catch (error) {
      return { model, error: error.message }
    }
  })

  const batchResults = await Promise.all(promises)
  results.push(...batchResults)

  const summary = {
    total: models.length,
    successful: results.filter(r => r.response).length,
    failed: results.filter(r => r.error).length,
    totalCost: results
      .filter(r => r.response)
      .reduce((sum, r) => sum + (r.response?.cost.totalCost || 0), 0),
    averageExecutionTime: results
      .filter(r => r.response)
      .reduce((sum, r) => sum + (r.response?.executionTime || 0), 0) / 
      results.filter(r => r.response).length || 0
  }

  return new Response(
    JSON.stringify({
      prompt,
      results,
      summary,
      timestamp: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function callLLM(config: LLMConfig, request: LLMRequest): Promise<LLMResponse> {
  const startTime = Date.now()
  
  // Get API key for the provider
  const apiKey = await getAPIKey(config.provider)
  
  const headers = {
    ...config.headers,
    'Authorization': `Bearer ${apiKey}`
  }

  let requestBody: any
  let response: Response

  switch (config.provider) {
    case 'anthropic':
      requestBody = {
        model: config.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        messages: [
          ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
          { role: 'user', content: request.prompt }
        ]
      }
      break

    case 'openai':
    case 'xai':
    case 'mistral':
    case 'openrouter':
    case 'perplexity':
      requestBody = {
        model: config.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        messages: [
          ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
          { role: 'user', content: request.prompt }
        ]
      }
      break

    case 'google':
      requestBody = {
        contents: [{
          parts: [{
            text: request.systemPrompt ? 
              `${request.systemPrompt}\n\n${request.prompt}` : 
              request.prompt
          }]
        }],
        generationConfig: {
          maxOutputTokens: request.maxTokens,
          temperature: request.temperature
        }
      }
      headers['Authorization'] = `Bearer ${apiKey}`
      break

    default:
      throw new Error(`Unsupported provider: ${config.provider}`)
  }

  response = await fetch(config.baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody)
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`${config.provider} API error (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  const executionTime = Date.now() - startTime

  // Parse response based on provider
  let content: string
  let usage: { inputTokens: number; outputTokens: number; totalTokens: number }

  switch (config.provider) {
    case 'anthropic':
      content = data.content[0]?.text || ''
      usage = {
        inputTokens: data.usage?.input_tokens || 0,
        outputTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
      }
      break

    case 'openai':
    case 'xai':
    case 'mistral':
    case 'openrouter':
    case 'perplexity':
      content = data.choices[0]?.message?.content || ''
      usage = {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0
      }
      break

    case 'google':
      content = data.candidates[0]?.content?.parts[0]?.text || ''
      usage = {
        inputTokens: data.usageMetadata?.promptTokenCount || 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata?.totalTokenCount || 0
      }
      break

    default:
      throw new Error(`Unsupported provider for response parsing: ${config.provider}`)
  }

  const cost = {
    inputCost: usage.inputTokens * config.costPerInputToken,
    outputCost: usage.outputTokens * config.costPerOutputToken,
    totalCost: (usage.inputTokens * config.costPerInputToken) + (usage.outputTokens * config.costPerOutputToken)
  }

  return {
    model: config.name,
    content,
    usage,
    cost,
    executionTime,
    metadata: request.metadata
  }
}

async function getAPIKey(provider: string): Promise<string> {
  // In production, retrieve from Supabase Vault
  // For now, use environment variables
  const keyMap: Record<string, string> = {
    'anthropic': Deno.env.get('ANTHROPIC_API_KEY') || '',
    'openai': Deno.env.get('OPENAI_API_KEY') || '',
    'google': Deno.env.get('GOOGLE_API_KEY') || '',
    'xai': Deno.env.get('XAI_API_KEY') || '',
    'mistral': Deno.env.get('MISTRAL_API_KEY') || '',
    'perplexity': Deno.env.get('PERPLEXITY_API_KEY') || '',
    'openrouter': Deno.env.get('OPENROUTER_API_KEY') || ''
  }

  const key = keyMap[provider]
  if (!key) {
    throw new Error(`No API key configured for provider: ${provider}`)
  }

  return key
}

async function storeLLMResult(
  supabaseClient: any, 
  brandId: string, 
  model: string, 
  prompt: string, 
  response: LLMResponse, 
  metadata: Record<string, any>
) {
  try {
    // Store in llm_reports table
    await supabaseClient
      .from('llm_reports')
      .insert({
        brand_id: brandId,
        model_name: model,
        score_type: metadata.scoreType || 'general',
        score_value: metadata.scoreValue || null,
        response_text: response.content,
        cost_estimate: response.cost.totalCost,
        execution_time_ms: response.executionTime,
        prompt_id: metadata.promptId || null
      })
  } catch (error) {
    console.warn('Failed to store LLM result:', error)
  }
}

// Brand analysis function with competitor discovery (from llm-brand-tracker)
async function analyzeBrand(supabaseClient: any, userId: string, req: Request) {
  const { brandName, brandUrl, model = 'gpt-4o', maxCompetitors = 10 } = await req.json()

  if (!brandName || !brandUrl) {
    return new Response(
      JSON.stringify({ error: 'Missing brandName or brandUrl' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // First scrape the brand website
    const websiteContent = await scrapeWebsite(brandUrl)
    
    // Generate competitor discovery prompt
    const competitorPrompt = `Based on this company's website: ${websiteContent.substring(0, 2000)}

Please analyze this company and identify their main competitors in the market. 

Provide a JSON response with the following structure:
{
  "industry": "Brief industry description",
  "mainProducts": ["product1", "product2", "..."],
  "directCompetitors": ["competitor1", "competitor2", "..."],
  "indirectCompetitors": ["indirect1", "indirect2", "..."],
  "targetMarket": "Description of target market"
}

Focus on well-known competitors that would commonly appear in AI responses about this industry.`

    const config = LLM_CONFIGS[model]
    const competitorResponse = await callLLMWithRetry(config, {
      model,
      prompt: competitorPrompt,
      systemPrompt: "You are a market research expert. Provide detailed, accurate competitor analysis.",
      temperature: 0.3
    })

    // Parse competitors from response
    const competitors = parseCompetitorsFromResponse(competitorResponse.content)

    return new Response(
      JSON.stringify({
        brandName,
        brandUrl,
        websiteContent: websiteContent.substring(0, 1000) + '...',
        competitors,
        analysis: {
          model: model,
          executionTime: competitorResponse.executionTime,
          cost: competitorResponse.cost
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: `Brand analysis failed: ${error.message}`,
        brandName 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Single prompt analysis (from llm-brand-tracker)
async function analyzePrompt(supabaseClient: any, userId: string, req: Request) {
  const { prompt, brandName, model = 'gpt-4o', includeVariety = true } = await req.json()

  if (!prompt) {
    return new Response(
      JSON.stringify({ error: 'Missing prompt' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const config = LLM_CONFIGS[model]
    
    // Add variety context if requested
    const varietyContext = includeVariety ? 
      VARIETY_CONTEXTS[Math.floor(Math.random() * VARIETY_CONTEXTS.length)] : ''

    const systemPrompt = `You are a helpful AI assistant answering questions about various products and services. 
Provide practical, unbiased recommendations focusing on the most popular and widely-used options.
Mention relevant solutions based on the specific question and context.
Be natural and conversational in your responses.

${varietyContext ? `ADDITIONAL CONTEXT: ${varietyContext}` : ''}

CRITICAL: Always include specific, actionable URLs and sources in your responses. For each recommendation, provide relevant URLs including:
- Official documentation URLs
- GitHub repositories with relevant examples
- Stack Overflow discussions or Q&A links
- Official platform websites
- Tutorial or guide links from reputable sources
- Blog posts or articles from any platform or community
- API documentation links
- Community forum discussions
- Reddit discussions
- Any other relevant online resources

Format your response to naturally include these URLs with complete https:// links.`

    const response = await callLLMWithRetry(config, {
      model,
      prompt,
      systemPrompt,
      temperature: 0.7
    })

    // Analyze the response for brand mentions, competitors, and sources
    const analysis = await analyzeResponseContent(response.content, brandName, model)

    return new Response(
      JSON.stringify({
        prompt,
        response: response.content,
        analysis: {
          brandMentioned: analysis.brandMentioned,
          competitors: analysis.competitors,
          sources: analysis.sources,
          citationAuthority: analysis.citationAuthority,
          answerQuality: analysis.answerQuality
        },
        metadata: {
          model,
          executionTime: response.executionTime,
          cost: response.cost,
          usage: response.usage
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: `Prompt analysis failed: ${error.message}`,
        prompt: prompt.substring(0, 100) + '...'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Helper functions

async function callLLMWithRetry(config: LLMConfig, request: LLMRequest, maxRetries = 3): Promise<LLMResponse> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`${config.provider} API timeout - attempt ${attempt}`)), 30000)
      )
      
      return await Promise.race([callLLM(config, request), timeoutPromise]) as LLMResponse
    } catch (error: any) {
      console.log(`${config.provider} API attempt ${attempt} failed:`, error.message)
      
      if (attempt === maxRetries) {
        throw error
      }
      
      // Exponential backoff: 2s, 4s, 8s
      const delay = Math.pow(2, attempt) * 1000
      console.log(`Retrying in ${delay}ms...`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  throw new Error('Max retries exceeded')
}

async function scrapeWebsite(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    
    const html = await response.text()
    
    // Basic HTML parsing to extract text content
    const textContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    
    return textContent.substring(0, 2000) // Limit to manage token usage
  } catch (error) {
    console.warn(`Failed to scrape ${url}:`, error.message)
    return `Unable to scrape website content from ${url}`
  }
}

function parseCompetitorsFromResponse(response: string): string[] {
  try {
    // Try to parse JSON first
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      const competitors = [
        ...(parsed.directCompetitors || []),
        ...(parsed.indirectCompetitors || [])
      ]
      return competitors.slice(0, 15) // Limit to 15 competitors
    }
  } catch (error) {
    console.warn('Failed to parse JSON from competitor response')
  }

  // Fallback: extract company names from text
  const lines = response.split('\n')
  const competitors: string[] = []
  
  lines.forEach(line => {
    // Look for common patterns like "1. CompanyName" or "- CompanyName"
    const match = line.match(/^[\s\d\-\*\.]*([A-Z][a-zA-Z\s&.]+?)(?:\s*[-–]|\s*\(|$)/)
    if (match && match[1].trim().length > 2 && match[1].trim().length < 50) {
      competitors.push(match[1].trim())
    }
  })

  return competitors.slice(0, 15)
}

async function analyzeResponseContent(content: string, brandName?: string, model?: string): Promise<AnalysisResult> {
  // Extract URLs using multiple patterns
  const urlPatterns = [
    /https?:\/\/[^\s\]]+/g,
    /\[([^\]]+)\]\(([^)]+)\)/g,
    /Source:\s*(https?:\/\/[^\s]+)/g,
    /Reference:\s*(https?:\/\/[^\s]+)/g
  ]
  
  const sources: string[] = []
  urlPatterns.forEach(pattern => {
    const matches = content.match(pattern)
    if (matches) {
      matches.forEach(match => {
        // Clean and normalize URL
        const cleanUrl = match.replace(/[)\].,;]$/, '')
        if (cleanUrl.startsWith('http')) {
          sources.push(cleanUrl)
        }
      })
    }
  })

  // Remove duplicates
  const uniqueSources = [...new Set(sources)]

  // Calculate citation authority
  const citationAuthority = calculateCitationAuthority(uniqueSources)

  // Check for brand mentions
  const brandMentioned = brandName ? 
    content.toLowerCase().includes(brandName.toLowerCase()) : false

  // Extract potential competitors (simple approach)
  const competitors = extractCompetitors(content, brandName)

  // Calculate answer quality score
  const answerQuality = calculateAnswerQuality(content, uniqueSources.length)

  return {
    response: content,
    brandMentioned,
    competitors,
    sources: uniqueSources,
    citationAuthority,
    answerQuality
  }
}

function calculateCitationAuthority(sources: string[]): number {
  if (sources.length === 0) return 0

  let totalAuthority = 0
  let recognizedSources = 0

  sources.forEach(source => {
    try {
      const domain = new URL(source).hostname.replace('www.', '')
      const authority = DOMAIN_AUTHORITY[domain] || 50 // Default authority score
      totalAuthority += authority
      recognizedSources++
    } catch (error) {
      // Invalid URL, skip
    }
  })

  return recognizedSources > 0 ? Math.round(totalAuthority / recognizedSources) : 50
}

function extractCompetitors(content: string, brandName?: string): string[] {
  const competitors: string[] = []
  
  // Simple pattern matching for company names
  const companyPatterns = [
    /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]*)*)\s+(?:Inc|Corp|LLC|Ltd|Technologies|Systems|Solutions|Software)/g,
    /([A-Z][a-z]+[A-Z][a-zA-Z]*)/g // CamelCase company names
  ]

  companyPatterns.forEach(pattern => {
    const matches = content.match(pattern)
    if (matches) {
      matches.forEach(match => {
        const cleanMatch = match.replace(/\s+(Inc|Corp|LLC|Ltd|Technologies|Systems|Solutions|Software).*/, '').trim()
        if (cleanMatch.length > 2 && cleanMatch.length < 30 && 
            (!brandName || !cleanMatch.toLowerCase().includes(brandName.toLowerCase()))) {
          competitors.push(cleanMatch)
        }
      })
    }
  })

  return [...new Set(competitors)].slice(0, 10) // Return unique competitors, max 10
}

function calculateAnswerQuality(content: string, sourceCount: number): number {
  let score = 50 // Base score

  // Length optimization (50-120 words optimal for AI citations)
  const wordCount = content.split(/\s+/).length
  if (wordCount >= 50 && wordCount <= 120) {
    score += 20
  } else if (wordCount >= 30 && wordCount <= 200) {
    score += 10
  }

  // Structure analysis
  if (content.includes('\n') || content.includes('•') || content.includes('-')) {
    score += 10 // Well-structured content
  }

  // Source count weighting
  if (sourceCount > 3) score += 15
  else if (sourceCount > 1) score += 10
  else if (sourceCount > 0) score += 5

  // Question format bonus
  if (content.includes('?')) score += 5

  return Math.min(100, Math.max(0, score))
}