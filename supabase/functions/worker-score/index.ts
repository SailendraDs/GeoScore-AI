import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ScoreJob {
  id: string
  brandId: string
  payload: {
    source: string
    samplingProfile?: string
    scoringMethod?: 'weighted' | 'neural' | 'hybrid'
    includeCompetitorAnalysis?: boolean
  }
}

interface BrandMention {
  llmReportId: string
  model: string
  promptKey: string
  response: string
  mentioned: boolean
  mentionType: 'explicit' | 'implicit' | 'none'
  mentionCount: number
  sentiment: 'positive' | 'neutral' | 'negative'
  confidence: number
  contextSnippets: string[]
}

interface CompetitorMention {
  competitor: string
  mentioned: boolean
  mentionCount: number
  sentiment: 'positive' | 'neutral' | 'negative'
  contextSnippets: string[]
}

interface GeoScoreComponents {
  presence: number      // 0-100: How often the brand is mentioned
  accuracy: number      // 0-100: Accuracy of information mentioned
  salience: number      // 0-100: Prominence/importance of mentions
  authority: number     // 0-100: Authoritative context of mentions
  freshness: number     // 0-100: Recency and currency of information
  robustness: number    // 0-100: Consistency across models/prompts
}

interface GeoScore {
  overall: number
  components: GeoScoreComponents
  breakdown: {
    byModel: Record<string, number>
    byPrompt: Record<string, number>
    byIntent: Record<string, number>
  }
  competitorComparison: Record<string, number>
  evidencePointers: string[]
  metadata: {
    totalSamples: number
    mentionRate: number
    averageConfidence: number
    consistencyScore: number
  }
}

interface ScoreResult {
  brandId: string
  geoScore: GeoScore
  brandMentions: BrandMention[]
  competitorAnalysis: Record<string, CompetitorMention[]>
  scoringMetrics: {
    totalLLMReports: number
    processedReports: number
    mentionedReports: number
    scoringMethod: string
    processingTime: number
  }
  nextJobPayload: {
    type: 'assemble_report'
    brandId: string
  }
}

const SCORING_WEIGHTS = {
  presence: 0.25,     // Most important - basic visibility
  accuracy: 0.20,     // Critical for brand reputation
  salience: 0.20,     // Important for brand prominence
  authority: 0.15,    // Context quality matters
  freshness: 0.10,    // Information currency
  robustness: 0.10    // Consistency across sources
}

const BRAND_KEYWORDS_PATTERNS = [
  // Direct brand mentions
  /\b{brand_name}\b/gi,
  /\b{brand_domain}\b/gi,
  
  // Company variations
  /\b{brand_name}[\s\.,]+(inc|llc|corp|company|ltd)\b/gi,
  /\b{brand_name}[\s\.,]+(solutions|services|technologies)\b/gi,
  
  // Possessive and descriptive
  /\b{brand_name}'s\b/gi,
  /\bthe\s+{brand_name}\b/gi,
  /\bat\s+{brand_name}\b/gi,
  /\bwith\s+{brand_name}\b/gi
]

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
      return await processScoreJob(supabaseClient, req)
    }

    if (method === 'GET') {
      return await getJobStatus(supabaseClient, req)
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Worker score error:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function processScoreJob(supabaseClient: any, req: Request) {
  const { jobId, brandId, payload }: { jobId: string, brandId: string, payload: ScoreJob['payload'] } = await req.json()

  if (!jobId || !brandId) {
    return new Response(
      JSON.stringify({ error: 'Missing jobId or brandId' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  console.log(`Starting score job ${jobId} for brand ${brandId}`)

  try {
    const startTime = Date.now()
    
    // Update job status to running
    await updateJobStatus(supabaseClient, jobId, 'running', { startedAt: new Date().toISOString() })

    // Get brand information
    const { data: brand, error: brandError } = await supabaseClient
      .from('brands')
      .select('id, domain, name, competitors')
      .eq('id', brandId)
      .single()

    if (brandError || !brand) {
      throw new Error(`Brand not found: ${brandId}`)
    }

    // Get all LLM reports for this brand
    const { data: llmReports, error: reportsError } = await supabaseClient
      .from('llm_reports')
      .select(`
        id, model_name, prompt_key, prompt_text, response_text,
        score_type, cost_estimate, execution_time_ms, tokens_used,
        paraphrase_index, metadata, created_at
      `)
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })

    if (reportsError) {
      throw new Error(`Failed to fetch LLM reports: ${reportsError.message}`)
    }

    if (!llmReports || llmReports.length === 0) {
      throw new Error('No LLM reports found for scoring')
    }

    console.log(`Processing ${llmReports.length} LLM reports`)

    // Analyze brand mentions in all reports
    const brandMentions = await analyzeBrandMentions(llmReports, brand)
    
    console.log(`Found ${brandMentions.filter(m => m.mentioned).length} brand mentions out of ${brandMentions.length} reports`)

    // Analyze competitor mentions if requested
    const competitorAnalysis: Record<string, CompetitorMention[]> = {}
    if (payload.includeCompetitorAnalysis && brand.competitors?.length > 0) {
      for (const competitor of brand.competitors) {
        competitorAnalysis[competitor] = await analyzeCompetitorMentions(llmReports, competitor)
      }
      console.log(`Analyzed ${Object.keys(competitorAnalysis).length} competitors`)
    }

    // Calculate GeoScore components
    const scoringMethod = payload.scoringMethod || 'weighted'
    const geoScore = await calculateGeoScore(brandMentions, competitorAnalysis, scoringMethod)
    
    console.log(`Calculated GeoScore: ${geoScore.overall}/100`)

    // Store scoring results
    await storeScoreResults(supabaseClient, brandId, geoScore, brandMentions)

    // Update LLM reports with calculated scores
    await updateLLMReportScores(supabaseClient, brandMentions)

    const processingTime = Date.now() - startTime

    // Create next job (assemble_report)
    const nextJobPayload = {
      brandId,
      source: 'score',
      geoScore: geoScore.overall,
      scoringMethod
    }

    const { data: nextJobId } = await supabaseClient
      .rpc('create_job_with_deps', {
        p_brand_id: brandId,
        p_type: 'assemble_report',
        p_payload: nextJobPayload,
        p_depends_on: [jobId],
        p_priority: 4
      })

    const result: ScoreResult = {
      brandId,
      geoScore,
      brandMentions: brandMentions.slice(0, 10), // Limit for response size
      competitorAnalysis,
      scoringMetrics: {
        totalLLMReports: llmReports.length,
        processedReports: brandMentions.length,
        mentionedReports: brandMentions.filter(m => m.mentioned).length,
        scoringMethod,
        processingTime
      },
      nextJobPayload: {
        type: 'assemble_report',
        brandId
      }
    }

    // Complete the job
    await updateJobStatus(supabaseClient, jobId, 'complete', {
      ...result,
      nextJobId,
      completedAt: new Date().toISOString(),
      processingStats: {
        totalReports: llmReports.length,
        mentionRate: (brandMentions.filter(m => m.mentioned).length / brandMentions.length * 100).toFixed(1),
        averageScore: geoScore.overall,
        processingTimeMs: processingTime
      }
    })

    console.log(`Score job ${jobId} completed successfully`)

    return new Response(
      JSON.stringify({
        jobId,
        status: 'complete',
        result,
        nextJobId,
        message: `Successfully calculated GeoScore: ${geoScore.overall}/100 from ${llmReports.length} reports`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error(`Score job ${jobId} failed:`, error)
    
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
        message: 'Score job failed'
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
async function analyzeBrandMentions(llmReports: any[], brand: any): Promise<BrandMention[]> {
  const brandMentions: BrandMention[] = []
  const brandName = brand.name || brand.domain.split('.')[0]
  const brandDomain = brand.domain

  for (const report of llmReports) {
    const response = report.response_text || ''
    const mention = analyzeSingleResponse(response, brandName, brandDomain)
    
    brandMentions.push({
      llmReportId: report.id,
      model: report.model_name,
      promptKey: report.prompt_key,
      response,
      mentioned: mention.mentioned,
      mentionType: mention.mentionType,
      mentionCount: mention.mentionCount,
      sentiment: mention.sentiment,
      confidence: mention.confidence,
      contextSnippets: mention.contextSnippets
    })
  }

  return brandMentions
}

function analyzeSingleResponse(response: string, brandName: string, brandDomain: string) {
  const lowerResponse = response.toLowerCase()
  const lowerBrandName = brandName.toLowerCase()
  const lowerBrandDomain = brandDomain.toLowerCase()

  // Check for direct mentions
  const directMentions = (lowerResponse.match(new RegExp(`\\b${lowerBrandName}\\b`, 'g')) || []).length +
                        (lowerResponse.match(new RegExp(`\\b${lowerBrandDomain}\\b`, 'g')) || []).length

  // Check for implicit mentions (possessives, contextual references)
  const implicitPatterns = [
    new RegExp(`\\b${lowerBrandName}'s\\b`, 'g'),
    new RegExp(`\\bthe\\s+${lowerBrandName}\\b`, 'g'),
    new RegExp(`\\bat\\s+${lowerBrandName}\\b`, 'g'),
    new RegExp(`\\bwith\\s+${lowerBrandName}\\b`, 'g')
  ]

  const implicitMentions = implicitPatterns.reduce((count, pattern) => {
    return count + (lowerResponse.match(pattern) || []).length
  }, 0)

  const totalMentions = directMentions + implicitMentions
  const mentioned = totalMentions > 0

  // Determine mention type
  let mentionType: 'explicit' | 'implicit' | 'none' = 'none'
  if (directMentions > 0) {
    mentionType = 'explicit'
  } else if (implicitMentions > 0) {
    mentionType = 'implicit'
  }

  // Analyze sentiment
  const sentiment = analyzeSentiment(response, brandName)

  // Extract context snippets
  const contextSnippets = extractContextSnippets(response, brandName, brandDomain)

  // Calculate confidence based on mention clarity and context
  let confidence = 0
  if (mentioned) {
    confidence = Math.min(0.9, 0.3 + (directMentions * 0.2) + (implicitMentions * 0.1) + (contextSnippets.length * 0.1))
  }

  return {
    mentioned,
    mentionType,
    mentionCount: totalMentions,
    sentiment,
    confidence,
    contextSnippets
  }
}

function analyzeSentiment(text: string, brandName: string): 'positive' | 'neutral' | 'negative' {
  const sentences = text.split(/[.!?]+/)
  const brandSentences = sentences.filter(sentence => 
    sentence.toLowerCase().includes(brandName.toLowerCase())
  )

  if (brandSentences.length === 0) return 'neutral'

  const positiveWords = [
    'excellent', 'great', 'good', 'best', 'recommend', 'reliable', 'trusted',
    'quality', 'professional', 'innovative', 'leading', 'top', 'outstanding'
  ]
  
  const negativeWords = [
    'bad', 'poor', 'terrible', 'avoid', 'unreliable', 'problematic',
    'issues', 'complaints', 'disappointing', 'worst', 'failed'
  ]

  let positiveScore = 0
  let negativeScore = 0

  for (const sentence of brandSentences) {
    const lowerSentence = sentence.toLowerCase()
    
    positiveWords.forEach(word => {
      if (lowerSentence.includes(word)) positiveScore++
    })
    
    negativeWords.forEach(word => {
      if (lowerSentence.includes(word)) negativeScore++
    })
  }

  if (positiveScore > negativeScore) return 'positive'
  if (negativeScore > positiveScore) return 'negative'
  return 'neutral'
}

function extractContextSnippets(text: string, brandName: string, brandDomain: string): string[] {
  const sentences = text.split(/[.!?]+/)
  const snippets: string[] = []

  for (const sentence of sentences) {
    const lowerSentence = sentence.toLowerCase()
    if (lowerSentence.includes(brandName.toLowerCase()) || 
        lowerSentence.includes(brandDomain.toLowerCase())) {
      snippets.push(sentence.trim())
    }
  }

  // Limit to most relevant snippets
  return snippets.slice(0, 3)
}

async function analyzeCompetitorMentions(llmReports: any[], competitor: string): Promise<CompetitorMention[]> {
  const mentions: CompetitorMention[] = []

  for (const report of llmReports) {
    const response = report.response_text || ''
    const analysis = analyzeSingleResponse(response, competitor, competitor)
    
    mentions.push({
      competitor,
      mentioned: analysis.mentioned,
      mentionCount: analysis.mentionCount,
      sentiment: analysis.sentiment,
      contextSnippets: analysis.contextSnippets
    })
  }

  return mentions
}

async function calculateGeoScore(
  brandMentions: BrandMention[], 
  competitorAnalysis: Record<string, CompetitorMention[]>,
  method: string
): Promise<GeoScore> {
  const totalSamples = brandMentions.length
  const mentionedSamples = brandMentions.filter(m => m.mentioned)
  const mentionRate = totalSamples > 0 ? mentionedSamples.length / totalSamples : 0

  // Calculate component scores
  const components: GeoScoreComponents = {
    presence: calculatePresenceScore(brandMentions),
    accuracy: calculateAccuracyScore(brandMentions),
    salience: calculateSalienceScore(brandMentions),
    authority: calculateAuthorityScore(brandMentions),
    freshness: calculateFreshnessScore(brandMentions),
    robustness: calculateRobustnessScore(brandMentions)
  }

  // Calculate overall score using weighted average
  const overall = Math.round(
    components.presence * SCORING_WEIGHTS.presence +
    components.accuracy * SCORING_WEIGHTS.accuracy +
    components.salience * SCORING_WEIGHTS.salience +
    components.authority * SCORING_WEIGHTS.authority +
    components.freshness * SCORING_WEIGHTS.freshness +
    components.robustness * SCORING_WEIGHTS.robustness
  )

  // Calculate breakdown by model, prompt, and intent
  const breakdown = {
    byModel: calculateScoreByModel(brandMentions),
    byPrompt: calculateScoreByPrompt(brandMentions),
    byIntent: calculateScoreByIntent(brandMentions)
  }

  // Calculate competitor comparison scores
  const competitorComparison: Record<string, number> = {}
  for (const [competitor, mentions] of Object.entries(competitorAnalysis)) {
    const competitorMentionRate = mentions.filter(m => m.mentioned).length / mentions.length
    competitorComparison[competitor] = Math.round((mentionRate / Math.max(competitorMentionRate, 0.01)) * 50)
  }

  // Generate evidence pointers
  const evidencePointers = mentionedSamples
    .slice(0, 5)
    .map(m => `llm_report:${m.llmReportId}`)

  const averageConfidence = mentionedSamples.length > 0
    ? mentionedSamples.reduce((sum, m) => sum + m.confidence, 0) / mentionedSamples.length
    : 0

  const consistencyScore = calculateConsistencyScore(brandMentions)

  return {
    overall,
    components,
    breakdown,
    competitorComparison,
    evidencePointers,
    metadata: {
      totalSamples,
      mentionRate,
      averageConfidence,
      consistencyScore
    }
  }
}

function calculatePresenceScore(mentions: BrandMention[]): number {
  const mentionRate = mentions.filter(m => m.mentioned).length / mentions.length
  return Math.round(mentionRate * 100)
}

function calculateAccuracyScore(mentions: BrandMention[]): number {
  const mentionedOnes = mentions.filter(m => m.mentioned)
  if (mentionedOnes.length === 0) return 0

  // Base accuracy on sentiment and confidence
  const positiveRate = mentionedOnes.filter(m => m.sentiment === 'positive').length / mentionedOnes.length
  const neutralRate = mentionedOnes.filter(m => m.sentiment === 'neutral').length / mentionedOnes.length
  const averageConfidence = mentionedOnes.reduce((sum, m) => sum + m.confidence, 0) / mentionedOnes.length

  const accuracyScore = (positiveRate * 100 + neutralRate * 70) * averageConfidence
  return Math.round(Math.min(100, accuracyScore))
}

function calculateSalienceScore(mentions: BrandMention[]): number {
  const mentionedOnes = mentions.filter(m => m.mentioned)
  if (mentionedOnes.length === 0) return 0

  // Higher scores for explicit mentions and multiple mentions per response
  const explicitRate = mentionedOnes.filter(m => m.mentionType === 'explicit').length / mentionedOnes.length
  const averageMentionCount = mentionedOnes.reduce((sum, m) => sum + m.mentionCount, 0) / mentionedOnes.length

  const salienceScore = (explicitRate * 80 + Math.min(averageMentionCount, 3) * 10)
  return Math.round(Math.min(100, salienceScore))
}

function calculateAuthorityScore(mentions: BrandMention[]): number {
  const mentionedOnes = mentions.filter(m => m.mentioned)
  if (mentionedOnes.length === 0) return 0

  // Higher scores for mentions with good context and positive sentiment
  const contextQuality = mentionedOnes.reduce((sum, m) => {
    return sum + (m.contextSnippets.length > 0 ? 1 : 0)
  }, 0) / mentionedOnes.length

  const sentimentQuality = mentionedOnes.reduce((sum, m) => {
    if (m.sentiment === 'positive') return sum + 1
    if (m.sentiment === 'neutral') return sum + 0.7
    return sum + 0.3
  }, 0) / mentionedOnes.length

  const authorityScore = (contextQuality * 50 + sentimentQuality * 50)
  return Math.round(authorityScore)
}

function calculateFreshnessScore(mentions: BrandMention[]): number {
  // For now, assume all mentions are recent (this would use creation timestamps in real implementation)
  // This score would be based on how recent the information appears to be
  return 75 // Default to 75% freshness
}

function calculateRobustnessScore(mentions: BrandMention[]): number {
  if (mentions.length === 0) return 0

  // Group by model and prompt to check consistency
  const modelGroups: Record<string, BrandMention[]> = {}
  const promptGroups: Record<string, BrandMention[]> = {}

  for (const mention of mentions) {
    if (!modelGroups[mention.model]) modelGroups[mention.model] = []
    if (!promptGroups[mention.promptKey]) promptGroups[mention.promptKey] = []
    
    modelGroups[mention.model].push(mention)
    promptGroups[mention.promptKey].push(mention)
  }

  // Calculate consistency across models
  const modelConsistency = Object.values(modelGroups).map(group => {
    const mentionRate = group.filter(m => m.mentioned).length / group.length
    return mentionRate
  })

  // Calculate consistency across prompts
  const promptConsistency = Object.values(promptGroups).map(group => {
    const mentionRate = group.filter(m => m.mentioned).length / group.length
    return mentionRate
  })

  // Robustness is how consistent the mention rates are
  const modelStdDev = calculateStandardDeviation(modelConsistency)
  const promptStdDev = calculateStandardDeviation(promptConsistency)

  // Lower standard deviation = higher robustness
  const robustnessScore = Math.max(0, 100 - (modelStdDev + promptStdDev) * 200)
  return Math.round(robustnessScore)
}

function calculateScoreByModel(mentions: BrandMention[]): Record<string, number> {
  const modelGroups: Record<string, BrandMention[]> = {}
  
  for (const mention of mentions) {
    if (!modelGroups[mention.model]) modelGroups[mention.model] = []
    modelGroups[mention.model].push(mention)
  }

  const scores: Record<string, number> = {}
  for (const [model, group] of Object.entries(modelGroups)) {
    const mentionRate = group.filter(m => m.mentioned).length / group.length
    scores[model] = Math.round(mentionRate * 100)
  }

  return scores
}

function calculateScoreByPrompt(mentions: BrandMention[]): Record<string, number> {
  const promptGroups: Record<string, BrandMention[]> = {}
  
  for (const mention of mentions) {
    if (!promptGroups[mention.promptKey]) promptGroups[mention.promptKey] = []
    promptGroups[mention.promptKey].push(mention)
  }

  const scores: Record<string, number> = {}
  for (const [prompt, group] of Object.entries(promptGroups)) {
    const mentionRate = group.filter(m => m.mentioned).length / group.length
    scores[prompt] = Math.round(mentionRate * 100)
  }

  return scores
}

function calculateScoreByIntent(mentions: BrandMention[]): Record<string, number> {
  // This would map prompt keys to intents in a real implementation
  const intentMapping: Record<string, string> = {
    'def_01': 'general',
    'local_01': 'local_search',
    'comp_01': 'comparison',
    'tech_01': 'technical',
    'brand_01': 'reputation'
  }

  const intentGroups: Record<string, BrandMention[]> = {}
  
  for (const mention of mentions) {
    const intent = intentMapping[mention.promptKey] || 'general'
    if (!intentGroups[intent]) intentGroups[intent] = []
    intentGroups[intent].push(mention)
  }

  const scores: Record<string, number> = {}
  for (const [intent, group] of Object.entries(intentGroups)) {
    const mentionRate = group.filter(m => m.mentioned).length / group.length
    scores[intent] = Math.round(mentionRate * 100)
  }

  return scores
}

function calculateConsistencyScore(mentions: BrandMention[]): number {
  if (mentions.length === 0) return 0

  const confidenceScores = mentions.filter(m => m.mentioned).map(m => m.confidence)
  if (confidenceScores.length === 0) return 0

  const stdDev = calculateStandardDeviation(confidenceScores)
  return Math.max(0, Math.round((1 - stdDev) * 100))
}

function calculateStandardDeviation(values: number[]): number {
  if (values.length === 0) return 0

  const mean = values.reduce((sum, val) => sum + val, 0) / values.length
  const squaredDiffs = values.map(val => Math.pow(val - mean, 2))
  const variance = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / values.length
  
  return Math.sqrt(variance)
}

async function storeScoreResults(supabaseClient: any, brandId: string, geoScore: GeoScore, brandMentions: BrandMention[]) {
  try {
    // Store the main score record
    const { error: scoreError } = await supabaseClient
      .from('brand_scores')
      .insert({
        brand_id: brandId,
        overall_score: geoScore.overall,
        presence_score: geoScore.components.presence,
        accuracy_score: geoScore.components.accuracy,
        salience_score: geoScore.components.salience,
        authority_score: geoScore.components.authority,
        freshness_score: geoScore.components.freshness,
        robustness_score: geoScore.components.robustness,
        breakdown_data: geoScore.breakdown,
        competitor_comparison: geoScore.competitorComparison,
        evidence_pointers: geoScore.evidencePointers,
        metadata: geoScore.metadata,
        scored_at: new Date().toISOString()
      })

    if (scoreError) {
      console.error('Failed to store brand score:', scoreError)
    } else {
      console.log('Stored brand score successfully')
    }

  } catch (error) {
    console.error('Failed to store score results:', error)
  }
}

async function updateLLMReportScores(supabaseClient: any, brandMentions: BrandMention[]) {
  try {
    for (const mention of brandMentions) {
      if (mention.mentioned) {
        const scoreValue = mention.confidence * 100
        
        await supabaseClient
          .from('llm_reports')
          .update({
            score_value: scoreValue,
            metadata: {
              mentionAnalysis: {
                mentioned: mention.mentioned,
                mentionType: mention.mentionType,
                mentionCount: mention.mentionCount,
                sentiment: mention.sentiment,
                confidence: mention.confidence
              }
            }
          })
          .eq('id', mention.llmReportId)
      }
    }

    console.log('Updated LLM report scores')
  } catch (error) {
    console.error('Failed to update LLM report scores:', error)
  }
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