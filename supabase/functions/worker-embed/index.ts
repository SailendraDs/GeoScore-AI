import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface EmbedJob {
  id: string
  brandId: string
  payload: {
    contentIds: string[]
    source: string
    embeddingProvider?: 'openai' | 'cohere' | 'sentence-transformers'
    chunkSize?: number
    chunkOverlap?: number
  }
}

interface EmbeddingConfig {
  provider: string
  model: string
  dimensions: number
  maxTokens: number
  costPerToken: number
  apiEndpoint: string
  rateLimit: {
    requestsPerMinute: number
    tokensPerMinute: number
  }
}

interface ContentChunk {
  id: string
  pageContentId: string
  chunkText: string
  chunkIndex: number
  tokenCount: number
  chunkType: 'title' | 'heading' | 'paragraph' | 'claim' | 'metadata'
  metadata: Record<string, any>
}

interface EmbeddingResult {
  contentChunkId: string
  embedding: number[]
  provider: string
  model: string
  cost: number
  processingTime: number
  error?: string
}

interface EmbedResult {
  brandId: string
  processedContent: number
  generatedChunks: number
  successfulEmbeddings: number
  failedEmbeddings: number
  totalCost: number
  nextJobPayload: {
    type: 'sample'
    brandId: string
  }
}

const EMBEDDING_CONFIGS: Record<string, EmbeddingConfig> = {
  'openai-ada-002': {
    provider: 'openai',
    model: 'text-embedding-ada-002',
    dimensions: 1536,
    maxTokens: 8191,
    costPerToken: 0.0000001,
    apiEndpoint: 'https://api.openai.com/v1/embeddings',
    rateLimit: { requestsPerMinute: 3000, tokensPerMinute: 1000000 }
  },
  'openai-3-small': {
    provider: 'openai',
    model: 'text-embedding-3-small',
    dimensions: 1536,
    maxTokens: 8191,
    costPerToken: 0.00000002,
    apiEndpoint: 'https://api.openai.com/v1/embeddings',
    rateLimit: { requestsPerMinute: 3000, tokensPerMinute: 1000000 }
  },
  'cohere-embed': {
    provider: 'cohere',
    model: 'embed-english-v3.0',
    dimensions: 1024,
    maxTokens: 512,
    costPerToken: 0.0000001,
    apiEndpoint: 'https://api.cohere.ai/v1/embed',
    rateLimit: { requestsPerMinute: 10000, tokensPerMinute: 1000000 }
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
      return await processEmbedJob(supabaseClient, req)
    }

    if (method === 'GET') {
      return await getJobStatus(supabaseClient, req)
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Worker embed error:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function processEmbedJob(supabaseClient: any, req: Request) {
  const { jobId, brandId, payload }: { jobId: string, brandId: string, payload: EmbedJob['payload'] } = await req.json()

  if (!jobId || !brandId || !payload.contentIds?.length) {
    return new Response(
      JSON.stringify({ error: 'Missing jobId, brandId, or contentIds' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  console.log(`Starting embed job ${jobId} for brand ${brandId} with ${payload.contentIds.length} content items`)

  try {
    // Update job status to running
    await updateJobStatus(supabaseClient, jobId, 'running', { startedAt: new Date().toISOString() })

    // Get brand information
    const { data: brand, error: brandError } = await supabaseClient
      .from('brands')
      .select('domain, name, competitors')
      .eq('id', brandId)
      .single()

    if (brandError || !brand) {
      throw new Error(`Brand not found: ${brandId}`)
    }

    // Get page content data
    const { data: pageContents, error: contentError } = await supabaseClient
      .from('page_content')
      .select(`
        id, url, title, description, main_content, 
        headings, json_ld, word_count
      `)
      .in('id', payload.contentIds)
      .eq('brand_id', brandId)

    if (contentError) {
      throw new Error(`Failed to fetch page content: ${contentError.message}`)
    }

    if (!pageContents || pageContents.length === 0) {
      throw new Error('No page content found for processing')
    }

    console.log(`Processing ${pageContents.length} page contents`)

    // Configuration
    const embeddingProvider = payload.embeddingProvider || 'openai-3-small'
    const embeddingConfig = EMBEDDING_CONFIGS[embeddingProvider]
    const chunkSize = payload.chunkSize || 500
    const chunkOverlap = payload.chunkOverlap || 50

    if (!embeddingConfig) {
      throw new Error(`Unknown embedding provider: ${embeddingProvider}`)
    }

    // Step 1: Create content chunks
    console.log('Creating content chunks...')
    const allChunks: ContentChunk[] = []
    
    for (const pageContent of pageContents) {
      const chunks = await createContentChunks(pageContent, chunkSize, chunkOverlap)
      allChunks.push(...chunks)
    }

    console.log(`Created ${allChunks.length} content chunks`)

    // Step 2: Store chunks in database
    const chunkInserts = allChunks.map(chunk => ({
      brand_id: brandId,
      page_content_id: chunk.pageContentId,
      chunk_text: chunk.chunkText,
      chunk_index: chunk.chunkIndex,
      chunk_type: chunk.chunkType,
      token_count: chunk.tokenCount,
      metadata: chunk.metadata,
      created_at: new Date().toISOString()
    }))

    const { data: storedChunks, error: chunkError } = await supabaseClient
      .from('content_chunks')
      .insert(chunkInserts)
      .select('id, chunk_text, token_count')

    if (chunkError) {
      throw new Error(`Failed to store content chunks: ${chunkError.message}`)
    }

    console.log(`Stored ${storedChunks.length} chunks in database`)

    // Step 3: Generate embeddings
    console.log(`Generating embeddings using ${embeddingProvider}...`)
    const embeddingResults: EmbeddingResult[] = []
    const batchSize = 50 // Process in batches to respect rate limits
    let totalCost = 0

    for (let i = 0; i < storedChunks.length; i += batchSize) {
      const batch = storedChunks.slice(i, i + batchSize)
      
      console.log(`Processing embedding batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(storedChunks.length/batchSize)}`)
      
      const batchResults = await generateEmbeddingsBatch(batch, embeddingConfig)
      embeddingResults.push(...batchResults)
      
      // Update total cost
      totalCost += batchResults.reduce((sum, result) => sum + result.cost, 0)
      
      // Respect rate limits
      if (i + batchSize < storedChunks.length) {
        await new Promise(resolve => setTimeout(resolve, 2000)) // 2 second delay between batches
      }
    }

    console.log(`Generated ${embeddingResults.length} embeddings with total cost: $${totalCost.toFixed(6)}`)

    // Step 4: Store embeddings in pgvector
    const successfulEmbeddings = embeddingResults.filter(r => !r.error)
    const failedEmbeddings = embeddingResults.filter(r => r.error)
    
    if (successfulEmbeddings.length > 0) {
      const embeddingInserts = successfulEmbeddings.map(result => ({
        content_chunk_id: result.contentChunkId,
        embedding: result.embedding,
        provider: result.provider,
        model: result.model,
        embedding_cost: result.cost,
        processing_time_ms: result.processingTime,
        created_at: new Date().toISOString()
      }))

      const { error: embeddingError } = await supabaseClient
        .from('content_embeddings')
        .insert(embeddingInserts)

      if (embeddingError) {
        console.error('Failed to store embeddings:', embeddingError)
        throw new Error(`Failed to store embeddings: ${embeddingError.message}`)
      }
    }

    console.log(`Stored ${successfulEmbeddings.length} embeddings, ${failedEmbeddings.length} failed`)

    // Step 5: Create next job (sample)
    const nextJobPayload = {
      brandId,
      source: 'embed',
      embeddingStats: {
        totalChunks: allChunks.length,
        successfulEmbeddings: successfulEmbeddings.length,
        embeddingProvider
      }
    }

    const { data: nextJobId } = await supabaseClient
      .rpc('create_job_with_deps', {
        p_brand_id: brandId,
        p_type: 'sample',
        p_payload: nextJobPayload,
        p_depends_on: [jobId],
        p_priority: 4
      })

    const result: EmbedResult = {
      brandId,
      processedContent: pageContents.length,
      generatedChunks: allChunks.length,
      successfulEmbeddings: successfulEmbeddings.length,
      failedEmbeddings: failedEmbeddings.length,
      totalCost,
      nextJobPayload: {
        type: 'sample',
        brandId
      }
    }

    // Complete the job
    await updateJobStatus(supabaseClient, jobId, 'complete', {
      ...result,
      nextJobId,
      completedAt: new Date().toISOString(),
      embeddingStats: {
        provider: embeddingProvider,
        model: embeddingConfig.model,
        dimensions: embeddingConfig.dimensions,
        totalChunks: allChunks.length,
        successfulEmbeddings: successfulEmbeddings.length,
        failedEmbeddings: failedEmbeddings.length,
        totalCost,
        averageCostPerEmbedding: totalCost / Math.max(successfulEmbeddings.length, 1)
      }
    })

    console.log(`Embed job ${jobId} completed successfully`)

    return new Response(
      JSON.stringify({
        jobId,
        status: 'complete',
        result,
        nextJobId,
        message: `Successfully generated ${successfulEmbeddings.length} embeddings from ${pageContents.length} pages`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error(`Embed job ${jobId} failed:`, error)
    
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
        message: 'Embed job failed'
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
async function createContentChunks(pageContent: any, chunkSize: number, chunkOverlap: number): Promise<ContentChunk[]> {
  const chunks: ContentChunk[] = []
  
  // Chunk the main content
  const mainContentChunks = splitTextIntoChunks(pageContent.main_content || '', chunkSize, chunkOverlap)
  
  mainContentChunks.forEach((chunkText, index) => {
    chunks.push({
      id: `${pageContent.id}-main-${index}`,
      pageContentId: pageContent.id,
      chunkText,
      chunkIndex: index,
      tokenCount: estimateTokenCount(chunkText),
      chunkType: 'paragraph',
      metadata: {
        source: 'main_content',
        url: pageContent.url,
        wordCount: chunkText.split(' ').length
      }
    })
  })

  // Add title as a separate chunk
  if (pageContent.title) {
    chunks.push({
      id: `${pageContent.id}-title`,
      pageContentId: pageContent.id,
      chunkText: pageContent.title,
      chunkIndex: -1,
      tokenCount: estimateTokenCount(pageContent.title),
      chunkType: 'title',
      metadata: {
        source: 'title',
        url: pageContent.url
      }
    })
  }

  // Add description as a separate chunk
  if (pageContent.description) {
    chunks.push({
      id: `${pageContent.id}-description`,
      pageContentId: pageContent.id,
      chunkText: pageContent.description,
      chunkIndex: -2,
      tokenCount: estimateTokenCount(pageContent.description),
      chunkType: 'metadata',
      metadata: {
        source: 'description',
        url: pageContent.url
      }
    })
  }

  // Add headings as separate chunks
  if (pageContent.headings && Array.isArray(pageContent.headings)) {
    pageContent.headings.forEach((heading: any, index: number) => {
      if (heading.text && heading.text.trim()) {
        chunks.push({
          id: `${pageContent.id}-heading-${index}`,
          pageContentId: pageContent.id,
          chunkText: heading.text,
          chunkIndex: -(index + 10), // Negative to distinguish from main content
          tokenCount: estimateTokenCount(heading.text),
          chunkType: 'heading',
          metadata: {
            source: 'heading',
            level: heading.level,
            url: pageContent.url
          }
        })
      }
    })
  }

  return chunks
}

function splitTextIntoChunks(text: string, chunkSize: number, overlap: number): string[] {
  if (!text || text.length === 0) return []
  
  const chunks: string[] = []
  const words = text.split(/\s+/)
  
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(' ')
    if (chunk.trim()) {
      chunks.push(chunk.trim())
    }
  }
  
  return chunks
}

function estimateTokenCount(text: string): number {
  // Rough estimation: 1 token ≈ 4 characters for English text
  return Math.ceil(text.length / 4)
}

async function generateEmbeddingsBatch(chunks: any[], config: EmbeddingConfig): Promise<EmbeddingResult[]> {
  const results: EmbeddingResult[] = []
  
  try {
    const startTime = Date.now()
    const texts = chunks.map(chunk => chunk.chunk_text)
    const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.token_count, 0)
    
    // Get API key
    const apiKey = await getAPIKey(config.provider)
    
    let embeddings: number[][]
    
    if (config.provider === 'openai') {
      embeddings = await generateOpenAIEmbeddings(texts, config, apiKey)
    } else if (config.provider === 'cohere') {
      embeddings = await generateCohereEmbeddings(texts, config, apiKey)
    } else {
      throw new Error(`Unsupported embedding provider: ${config.provider}`)
    }
    
    const processingTime = Date.now() - startTime
    const costPerResult = (totalTokens * config.costPerToken) / chunks.length
    
    // Create results
    embeddings.forEach((embedding, index) => {
      results.push({
        contentChunkId: chunks[index].id,
        embedding,
        provider: config.provider,
        model: config.model,
        cost: costPerResult,
        processingTime: processingTime / embeddings.length
      })
    })
    
  } catch (error) {
    console.error('Batch embedding generation failed:', error)
    
    // Create error results for all chunks
    chunks.forEach(chunk => {
      results.push({
        contentChunkId: chunk.id,
        embedding: [],
        provider: config.provider,
        model: config.model,
        cost: 0,
        processingTime: 0,
        error: error.message
      })
    })
  }
  
  return results
}

async function generateOpenAIEmbeddings(texts: string[], config: EmbeddingConfig, apiKey: string): Promise<number[][]> {
  const response = await fetch(config.apiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      input: texts,
      model: config.model
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  return data.data.map((item: any) => item.embedding)
}

async function generateCohereEmbeddings(texts: string[], config: EmbeddingConfig, apiKey: string): Promise<number[][]> {
  const response = await fetch(config.apiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      texts,
      model: config.model,
      input_type: 'search_document'
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Cohere API error (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  return data.embeddings
}

async function getAPIKey(provider: string): Promise<string> {
  // In production, retrieve from Supabase Vault
  const keyMap: Record<string, string> = {
    'openai': Deno.env.get('OPENAI_API_KEY') || '',
    'cohere': Deno.env.get('COHERE_API_KEY') || ''
  }

  const key = keyMap[provider]
  if (!key) {
    throw new Error(`No API key configured for provider: ${provider}`)
  }

  return key
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