import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// AI Visibility Score™ algorithm weights (from ai-visibility)
const SCORE_WEIGHTS = {
  prompt_sov: 0.30,           // 30% - Prompt Share of Voice
  generative_appearance: 0.20, // 20% - Generative appearance rate
  citation_authority: 0.15,   // 15% - Citation authority mix
  answer_quality: 0.10,       // 10% - Answer quality proxy
  voice_presence: 0.05,       // 5% - Voice assistant presence
  ai_traffic: 0.10,           // 10% - AI traffic attribution
  ai_conversions: 0.10        // 10% - AI conversion attribution
}

// Domain authority mapping (expanded from ai-visibility)
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
  'coursera.org': 88,
  'npmjs.com': 90,
  'pypi.org': 88,
  'rubygems.org': 85,
  'packagist.org': 82,
  'maven.org': 85,
  'nuget.org': 83,
  'crates.io': 88,
  'golang.org': 92,
  'kubernetes.io': 90,
  'docker.com': 88,
  'aws.amazon.com': 95,
  'cloud.google.com': 93,
  'azure.microsoft.com': 92,
  'firebase.google.com': 90,
  'netlify.com': 85,
  'vercel.com': 83,
  'heroku.com': 82,
  'digitalocean.com': 80,
  'mongodb.com': 88,
  'postgresql.org': 90,
  'mysql.com': 87,
  'redis.io': 85,
  'elastic.co': 87,
  'apache.org': 92,
  'nginx.org': 88,
  'reactjs.org': 92,
  'vuejs.org': 90,
  'angular.io': 90,
  'svelte.dev': 85,
  'nextjs.org': 88,
  'nuxtjs.org': 85,
  'gatsbyjs.com': 83,
  'stripe.com': 90,
  'twilio.com': 87,
  'sendgrid.com': 85,
  'mailgun.com': 82,
  'auth0.com': 87,
  'okta.com': 88,
  'salesforce.com': 92,
  'hubspot.com': 88,
  'zendesk.com': 85,
  'intercom.com': 83,
  'slack.com': 88,
  'discord.com': 85,
  'zoom.us': 87,
  'atlassian.com': 90,
  'jetbrains.com': 88,
  'visualstudio.com': 90,
  'code.visualstudio.com': 88,
  'sublimetext.com': 85,
  'vim.org': 83,
  'emacs.org': 80,
  'tensorflow.org': 95,
  'pytorch.org': 93,
  'scikit-learn.org': 90,
  'jupyter.org': 88,
  'pandas.pydata.org': 87,
  'numpy.org': 88,
  'scipy.org': 87
}

interface ScoreComponents {
  prompt_sov: number
  generative_appearance: number
  citation_authority: number
  answer_quality: number
  voice_presence: number
  ai_traffic: number
  ai_conversions: number
}

interface ScoreRequest {
  brandId: string
  engine?: string
  dateRange?: {
    start: string
    end: string
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

    if (action === 'calculate') {
      // POST /ai-visibility-score/calculate - Calculate AI Visibility Score for brand
      return await calculateAIVisibilityScore(supabaseClient, user.id, req)
    }

    if (action === 'history') {
      // GET /ai-visibility-score/history?brandId=xxx - Get score history
      const brandId = url.searchParams.get('brandId')
      const engine = url.searchParams.get('engine')
      return await getScoreHistory(supabaseClient, user.id, brandId, engine)
    }

    if (action === 'benchmark') {
      // GET /ai-visibility-score/benchmark?brandId=xxx - Get competitive benchmarking
      const brandId = url.searchParams.get('brandId')
      return await getBenchmarkData(supabaseClient, user.id, brandId)
    }

    return new Response(
      JSON.stringify({ error: 'Invalid endpoint' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('AI Visibility Score error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function calculateAIVisibilityScore(supabaseClient: any, userId: string, req: Request) {
  const { brandId, engine, dateRange }: ScoreRequest = await req.json()

  if (!brandId) {
    return new Response(
      JSON.stringify({ error: 'Missing brandId' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Verify brand ownership
    const { data: brand, error: brandError } = await supabaseClient
      .from('brands')
      .select('id, name, domain')
      .eq('id', brandId)
      .eq('owner_id', userId)
      .single()

    if (brandError || !brand) {
      return new Response(
        JSON.stringify({ error: 'Brand not found or access denied' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get LLM reports for analysis
    let query = supabaseClient
      .from('llm_reports')
      .select(`
        id, model_name, response_text, created_at, score_value,
        cost_estimate, execution_time_ms
      `)
      .eq('brand_id', brandId)

    if (engine) {
      query = query.eq('model_name', engine)
    }

    if (dateRange) {
      query = query
        .gte('created_at', dateRange.start)
        .lte('created_at', dateRange.end)
    } else {
      // Default to last 30 days
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      query = query.gte('created_at', thirtyDaysAgo.toISOString())
    }

    const { data: reports, error: reportsError } = await query
      .order('created_at', { ascending: false })
      .limit(500)

    if (reportsError) throw reportsError

    if (!reports || reports.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: 'No LLM reports found for this brand in the specified time range',
          brandId,
          engine 
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get competitors for competitive analysis
    const { data: competitors } = await supabaseClient
      .from('competitors')
      .select('name, mention_count')
      .eq('brand_id', brandId)

    // Calculate each component of the AI Visibility Score
    const scoreComponents = await calculateScoreComponents(
      supabaseClient, 
      brand, 
      reports, 
      competitors || []
    )

    // Calculate final weighted score (0-100)
    const totalScore = Math.round(
      (scoreComponents.prompt_sov * SCORE_WEIGHTS.prompt_sov) +
      (scoreComponents.generative_appearance * SCORE_WEIGHTS.generative_appearance) +
      (scoreComponents.citation_authority * SCORE_WEIGHTS.citation_authority) +
      (scoreComponents.answer_quality * SCORE_WEIGHTS.answer_quality) +
      (scoreComponents.voice_presence * SCORE_WEIGHTS.voice_presence) +
      (scoreComponents.ai_traffic * SCORE_WEIGHTS.ai_traffic) +
      (scoreComponents.ai_conversions * SCORE_WEIGHTS.ai_conversions)
    )

    // Store the calculated score
    await supabaseClient
      .from('ai_visibility_scores')
      .insert({
        brand_id: brandId,
        engine: engine || 'aggregate',
        prompt_sov: scoreComponents.prompt_sov,
        generative_appearance: scoreComponents.generative_appearance,
        citation_authority: scoreComponents.citation_authority,
        answer_quality: scoreComponents.answer_quality,
        voice_presence: scoreComponents.voice_presence,
        ai_traffic: scoreComponents.ai_traffic,
        ai_conversions: scoreComponents.ai_conversions,
        total_score: totalScore,
        calculation_metadata: {
          reports_analyzed: reports.length,
          date_range: dateRange,
          engine: engine,
          calculated_at: new Date().toISOString()
        }
      })

    return new Response(
      JSON.stringify({
        brandId,
        brandName: brand.name,
        engine: engine || 'aggregate',
        totalScore,
        scoreComponents,
        weights: SCORE_WEIGHTS,
        metadata: {
          reportsAnalyzed: reports.length,
          dateRange,
          calculatedAt: new Date().toISOString()
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: `Failed to calculate AI Visibility Score: ${error.message}`,
        brandId 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function calculateScoreComponents(
  supabaseClient: any,
  brand: any, 
  reports: any[], 
  competitors: any[]
): Promise<ScoreComponents> {
  // 1. Prompt Share of Voice (30%)
  const totalMentions = competitors.reduce((sum, c) => sum + (c.mention_count || 0), 0)
  const brandMentions = reports.filter(r => 
    r.response_text && r.response_text.toLowerCase().includes(brand.name.toLowerCase())
  ).length
  const prompt_sov = totalMentions > 0 ? Math.min(100, (brandMentions / totalMentions) * 100) : 50

  // 2. Generative Appearance Rate (20%) 
  const totalPrompts = reports.length
  const appearanceCount = reports.filter(r => 
    r.response_text && (
      r.response_text.toLowerCase().includes(brand.name.toLowerCase()) ||
      r.response_text.toLowerCase().includes(brand.domain.replace(/^www\./, ''))
    )
  ).length
  const generative_appearance = totalPrompts > 0 ? (appearanceCount / totalPrompts) * 100 : 0

  // 3. Citation Authority (15%)
  const citation_authority = await calculateCitationAuthority(reports)

  // 4. Answer Quality (10%)
  const answer_quality = calculateAnswerQuality(reports)

  // 5. Voice Presence (5%) - Placeholder for voice assistant data
  const voice_presence = 50 // Default until voice data is available

  // 6. AI Traffic Attribution (10%) - Placeholder for analytics integration
  const ai_traffic = 50 // Default until GA4 integration

  // 7. AI Conversions (10%) - Placeholder for conversion tracking
  const ai_conversions = 50 // Default until conversion tracking

  return {
    prompt_sov,
    generative_appearance,
    citation_authority,
    answer_quality,
    voice_presence,
    ai_traffic,
    ai_conversions
  }
}

async function calculateCitationAuthority(reports: any[]): Promise<number> {
  let totalAuthority = 0
  let citationCount = 0

  for (const report of reports) {
    if (!report.response_text) continue

    // Extract URLs from response text
    const urlPattern = /https?:\/\/[^\s\]]+/g
    const urls = report.response_text.match(urlPattern) || []

    for (const url of urls) {
      try {
        const domain = new URL(url).hostname.replace('www.', '')
        const authority = DOMAIN_AUTHORITY[domain] || 50 // Default authority
        totalAuthority += authority
        citationCount++
      } catch (error) {
        // Invalid URL, skip
      }
    }
  }

  return citationCount > 0 ? Math.round(totalAuthority / citationCount) : 50
}

function calculateAnswerQuality(reports: any[]): number {
  if (reports.length === 0) return 0

  let totalQuality = 0

  for (const report of reports) {
    if (!report.response_text) continue

    let quality = 50 // Base quality score

    const content = report.response_text
    const wordCount = content.split(/\s+/).length

    // Length optimization (50-120 words optimal)
    if (wordCount >= 50 && wordCount <= 120) {
      quality += 20
    } else if (wordCount >= 30 && wordCount <= 200) {
      quality += 10
    }

    // Structure analysis
    if (content.includes('\n') || content.includes('•') || content.includes('-')) {
      quality += 10
    }

    // URL count (indicates comprehensive answers)
    const urlCount = (content.match(/https?:\/\/[^\s\]]+/g) || []).length
    if (urlCount > 3) quality += 15
    else if (urlCount > 1) quality += 10
    else if (urlCount > 0) quality += 5

    // Question format bonus
    if (content.includes('?')) quality += 5

    totalQuality += Math.min(100, Math.max(0, quality))
  }

  return Math.round(totalQuality / reports.length)
}

async function getScoreHistory(supabaseClient: any, userId: string, brandId: string | null, engine: string | null) {
  if (!brandId) {
    return new Response(
      JSON.stringify({ error: 'Missing brandId' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Verify brand ownership
    const { data: brand, error: brandError } = await supabaseClient
      .from('brands')
      .select('id, name')
      .eq('id', brandId)
      .eq('owner_id', userId)
      .single()

    if (brandError || !brand) {
      return new Response(
        JSON.stringify({ error: 'Brand not found or access denied' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get score history
    let query = supabaseClient
      .from('ai_visibility_scores')
      .select('*')
      .eq('brand_id', brandId)

    if (engine) {
      query = query.eq('engine', engine)
    }

    const { data: scores, error: scoresError } = await query
      .order('created_at', { ascending: false })
      .limit(100)

    if (scoresError) throw scoresError

    // Group by engine and calculate trends
    const groupedScores = (scores || []).reduce((acc, score) => {
      const engineKey = score.engine || 'aggregate'
      if (!acc[engineKey]) acc[engineKey] = []
      acc[engineKey].push(score)
      return acc
    }, {} as Record<string, any[]>)

    const trends = Object.entries(groupedScores).map(([engine, engineScores]) => {
      const latest = engineScores[0]
      const previous = engineScores[1]
      const trend = previous ? latest.total_score - previous.total_score : 0

      return {
        engine,
        latestScore: latest?.total_score || 0,
        trend,
        scoreHistory: engineScores.slice(0, 30) // Last 30 scores
      }
    })

    return new Response(
      JSON.stringify({
        brandId,
        brandName: brand.name,
        trends,
        totalScores: scores?.length || 0
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: `Failed to get score history: ${error.message}`,
        brandId 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function getBenchmarkData(supabaseClient: any, userId: string, brandId: string | null) {
  if (!brandId) {
    return new Response(
      JSON.stringify({ error: 'Missing brandId' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Get brand and its competitors
    const { data: brand } = await supabaseClient
      .from('brands')
      .select(`
        id, name, domain,
        competitors(name, mention_count)
      `)
      .eq('id', brandId)
      .eq('owner_id', userId)
      .single()

    if (!brand) {
      return new Response(
        JSON.stringify({ error: 'Brand not found or access denied' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get industry average (placeholder - would need industry classification)
    const industryAverage = 65 // Placeholder

    // Get latest brand score
    const { data: latestScore } = await supabaseClient
      .from('ai_visibility_scores')
      .select('total_score, engine')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const benchmark = {
      brand: {
        name: brand.name,
        score: latestScore?.total_score || 0
      },
      industryAverage,
      competitors: brand.competitors || [],
      percentile: latestScore?.total_score ? 
        Math.round((latestScore.total_score / 100) * 100) : 0,
      recommendations: generateRecommendations(
        latestScore?.total_score || 0, 
        industryAverage,
        brand.competitors || []
      )
    }

    return new Response(
      JSON.stringify(benchmark),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: `Failed to get benchmark data: ${error.message}`,
        brandId 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

function generateRecommendations(brandScore: number, industryAverage: number, competitors: any[]): string[] {
  const recommendations: string[] = []

  if (brandScore < industryAverage) {
    recommendations.push(`Your AI Visibility Score is ${Math.round(industryAverage - brandScore)} points below industry average. Focus on improving brand mentions and citation quality.`)
  }

  if (brandScore < 50) {
    recommendations.push("Consider creating more comprehensive, well-structured content that AI models are likely to cite.")
    recommendations.push("Optimize your content for common questions in your industry.")
  }

  if (competitors.length > 0) {
    const topCompetitor = competitors.sort((a, b) => (b.mention_count || 0) - (a.mention_count || 0))[0]
    if (topCompetitor) {
      recommendations.push(`${topCompetitor.name} appears more frequently in AI responses. Analyze their content strategy.`)
    }
  }

  if (brandScore >= 80) {
    recommendations.push("Excellent AI visibility! Focus on maintaining your position and expanding to new AI engines.")
  }

  return recommendations
}