import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ReportRequest {
  brandId: string
  reportType: 'overview' | 'competitive' | 'ai_visibility' | 'complete'
  dateRange?: {
    start: string
    end: string
  }
  engines?: string[]
  includeRecommendations?: boolean
}

interface ReportSection {
  title: string
  summary: string
  data: any
  charts?: any[]
  insights: string[]
  recommendations?: string[]
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

    if (action === 'generate') {
      // POST /report-generation-pro/generate - Generate comprehensive report
      return await generateReport(supabaseClient, user.id, req)
    }

    if (action === 'download') {
      // GET /report-generation-pro/download?reportId=xxx - Download generated report
      const reportId = url.searchParams.get('reportId')
      return await downloadReport(supabaseClient, user.id, reportId)
    }

    if (action === 'templates') {
      // GET /report-generation-pro/templates - Get available report templates
      return await getReportTemplates()
    }

    return new Response(
      JSON.stringify({ error: 'Invalid endpoint' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Report generation error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function generateReport(supabaseClient: any, userId: string, req: Request) {
  const {
    brandId,
    reportType = 'complete',
    dateRange,
    engines = ['gpt-4o', 'claude-opus', 'gemini-pro', 'perplexity-online'],
    includeRecommendations = true
  }: ReportRequest = await req.json()

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

    // Set date range (default to last 30 days)
    const endDate = dateRange?.end || new Date().toISOString()
    const startDate = dateRange?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    // Gather all data for report
    const reportData = await gatherReportData(supabaseClient, brandId, startDate, endDate, engines)

    // Generate report sections based on type
    const sections = await generateReportSections(reportData, reportType, brand, includeRecommendations)

    // Create comprehensive report
    const report = {
      id: crypto.randomUUID(),
      brandId,
      brandName: brand.name,
      brandDomain: brand.domain,
      reportType,
      dateRange: { start: startDate, end: endDate },
      engines,
      generatedAt: new Date().toISOString(),
      sections,
      summary: generateExecutiveSummary(reportData, brand),
      metadata: {
        totalDataPoints: reportData.totalPrompts,
        analysisDepth: sections.length,
        confidenceScore: calculateConfidenceScore(reportData)
      }
    }

    // Store report for future download
    await supabaseClient
      .from('generated_reports')
      .insert({
        id: report.id,
        brand_id: brandId,
        report_type: reportType,
        report_data: report,
        user_id: userId
      })

    return new Response(
      JSON.stringify(report),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: `Failed to generate report: ${error.message}`,
        brandId 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function gatherReportData(
  supabaseClient: any,
  brandId: string,
  startDate: string,
  endDate: string,
  engines: string[]
) {
  const [
    aiScoresRes,
    llmReportsRes,
    competitorsRes,
    promptsRes
  ] = await Promise.allSettled([
    supabaseClient
      .from('ai_visibility_scores')
      .select('*')
      .eq('brand_id', brandId)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .in('engine', engines)
      .order('created_at', { ascending: false }),
    
    supabaseClient
      .from('llm_reports')
      .select('*')
      .eq('brand_id', brandId)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .in('model_name', engines)
      .order('created_at', { ascending: false }),
    
    supabaseClient
      .from('competitors')
      .select('*')
      .eq('brand_id', brandId)
      .order('mention_count', { ascending: false }),
    
    supabaseClient
      .from('brand_prompts')
      .select('*')
      .eq('brand_id', brandId)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: false })
  ])

  const aiScores = aiScoresRes.status === 'fulfilled' ? aiScoresRes.value.data || [] : []
  const llmReports = llmReportsRes.status === 'fulfilled' ? llmReportsRes.value.data || [] : []
  const competitors = competitorsRes.status === 'fulfilled' ? competitorsRes.value.data || [] : []
  const prompts = promptsRes.status === 'fulfilled' ? promptsRes.value.data || [] : []

  return {
    aiScores,
    llmReports,
    competitors,
    prompts,
    totalPrompts: prompts.length,
    totalReports: llmReports.length,
    enginesAnalyzed: engines
  }
}

async function generateReportSections(
  data: any,
  reportType: string,
  brand: any,
  includeRecommendations: boolean
): Promise<ReportSection[]> {
  const sections: ReportSection[] = []

  // Executive Summary Section
  sections.push({
    title: "Executive Summary",
    summary: generateExecutiveSummary(data, brand),
    data: {
      overallScore: data.aiScores[0]?.total_score || 0,
      totalAnalyses: data.totalReports,
      competitorCount: data.competitors.length,
      keyInsight: "Primary visibility driver analysis"
    },
    insights: generateExecutiveInsights(data, brand),
    recommendations: includeRecommendations ? generateTopRecommendations(data, brand) : undefined
  })

  // AI Visibility Performance
  if (reportType === 'ai_visibility' || reportType === 'complete') {
    sections.push(generateAIVisibilitySection(data, brand))
  }

  // Competitive Analysis
  if (reportType === 'competitive' || reportType === 'complete') {
    sections.push(generateCompetitiveSection(data, brand))
  }

  // Engine-Specific Performance
  if (reportType === 'complete') {
    sections.push(generateEnginePerformanceSection(data, brand))
  }

  // Citation and Source Analysis
  sections.push(generateSourceAnalysisSection(data, brand))

  // Trending Topics and Opportunities
  sections.push(generateOpportunitiesSection(data, brand))

  if (includeRecommendations) {
    sections.push(generateRecommendationsSection(data, brand))
  }

  return sections
}

function generateAIVisibilitySection(data: any, brand: any): ReportSection {
  const latestScore = data.aiScores[0]
  const previousScore = data.aiScores[1]
  const trend = previousScore ? latestScore?.total_score - previousScore.total_score : 0

  return {
    title: "AI Visibility Performance",
    summary: `Your AI Visibility Score is ${Math.round(latestScore?.total_score || 0)}/100, ${trend >= 0 ? 'up' : 'down'} ${Math.abs(trend).toFixed(1)} points from last period.`,
    data: {
      currentScore: latestScore?.total_score || 0,
      previousScore: previousScore?.total_score || 0,
      trend,
      components: latestScore ? {
        promptSOV: latestScore.prompt_sov,
        generativeAppearance: latestScore.generative_appearance,
        citationAuthority: latestScore.citation_authority,
        answerQuality: latestScore.answer_quality,
        voicePresence: latestScore.voice_presence,
        aiTraffic: latestScore.ai_traffic,
        aiConversions: latestScore.ai_conversions
      } : null
    },
    charts: [
      {
        type: 'scoreProgress',
        title: 'AI Visibility Score Trend',
        data: data.aiScores.slice(0, 30).reverse()
      },
      {
        type: 'componentBreakdown',
        title: 'Score Component Analysis',
        data: latestScore
      }
    ],
    insights: [
      `Your strongest component is ${getStrongestComponent(latestScore)} at ${Math.round(getStrongestComponentValue(latestScore))}/100`,
      `Improvement opportunity in ${getWeakestComponent(latestScore)} (${Math.round(getWeakestComponentValue(latestScore))}/100)`,
      `${data.totalReports} AI responses analyzed across ${data.enginesAnalyzed.length} engines`
    ],
    recommendations: [
      generateScoreRecommendation(latestScore),
      generateTrendRecommendation(trend),
      generateComponentRecommendation(latestScore)
    ]
  }
}

function generateCompetitiveSection(data: any, brand: any): ReportSection {
  const topCompetitors = data.competitors.slice(0, 5)
  const totalMentions = data.competitors.reduce((sum: number, c: any) => sum + (c.mention_count || 0), 0)
  
  return {
    title: "Competitive Landscape",
    summary: `Tracking ${data.competitors.length} competitors with ${totalMentions} total AI mentions identified.`,
    data: {
      competitorCount: data.competitors.length,
      totalMentions,
      topCompetitors: topCompetitors.map((c: any) => ({
        name: c.name,
        mentions: c.mention_count || 0,
        category: c.category,
        marketShare: totalMentions > 0 ? Math.round(((c.mention_count || 0) / totalMentions) * 100) : 0
      })),
      brandPosition: calculateBrandPosition(data, brand)
    },
    charts: [
      {
        type: 'competitorRanking',
        title: 'Competitor Mention Volume',
        data: topCompetitors
      },
      {
        type: 'marketShare',
        title: 'AI Mention Market Share',
        data: topCompetitors
      }
    ],
    insights: [
      `Top competitor: ${topCompetitors[0]?.name || 'N/A'} with ${topCompetitors[0]?.mention_count || 0} mentions`,
      `Your brand appears in ${calculateBrandMentionRate(data, brand)}% of relevant AI responses`,
      `${data.competitors.filter((c: any) => c.mention_count > 10).length} competitors have significant AI visibility`
    ]
  }
}

function generateEnginePerformanceSection(data: any, brand: any): ReportSection {
  const enginePerformance = data.enginesAnalyzed.map((engine: string) => {
    const engineScores = data.aiScores.filter((s: any) => s.engine === engine)
    const engineReports = data.llmReports.filter((r: any) => r.model_name === engine)
    
    return {
      engine,
      score: engineScores[0]?.total_score || 0,
      mentions: engineReports.length,
      avgResponseTime: engineReports.reduce((sum: number, r: any) => sum + (r.execution_time_ms || 0), 0) / engineReports.length || 0,
      brandMentionRate: calculateEngineSpecificMentionRate(engineReports, brand)
    }
  })

  return {
    title: "Engine-Specific Performance",
    summary: `Performance analysis across ${data.enginesAnalyzed.length} AI engines shows varying visibility patterns.`,
    data: {
      enginePerformance,
      bestEngine: enginePerformance.reduce((best: any, current: any) => 
        current.score > best.score ? current : best, enginePerformance[0] || {}),
      averageScore: enginePerformance.reduce((sum: number, e: any) => sum + e.score, 0) / enginePerformance.length || 0
    },
    charts: [
      {
        type: 'engineComparison',
        title: 'AI Visibility by Engine',
        data: enginePerformance
      }
    ],
    insights: enginePerformance.map((e: any) => 
      `${e.engine}: ${Math.round(e.score)}/100 score, ${e.brandMentionRate}% mention rate`
    )
  }
}

function generateSourceAnalysisSection(data: any, brand: any): ReportSection {
  const sourceMap = new Map()
  
  data.llmReports.forEach((report: any) => {
    if (report.response_text) {
      const urls = report.response_text.match(/https?:\/\/[^\s\]]+/g) || []
      urls.forEach((url: string) => {
        try {
          const domain = new URL(url).hostname.replace('www.', '')
          sourceMap.set(domain, (sourceMap.get(domain) || 0) + 1)
        } catch (e) {
          // Invalid URL, skip
        }
      })
    }
  })

  const topSources = Array.from(sourceMap.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)

  return {
    title: "Citation & Source Analysis", 
    summary: `${topSources.length} unique domains cited, with ${topSources[0]?.domain || 'N/A'} being most referenced.`,
    data: {
      totalSources: sourceMap.size,
      topSources,
      averageCitationsPerResponse: data.totalReports > 0 ? 
        topSources.reduce((sum, s) => sum + s.count, 0) / data.totalReports : 0
    },
    charts: [
      {
        type: 'sourceRanking',
        title: 'Top Citation Sources',
        data: topSources
      }
    ],
    insights: [
      `Most cited source: ${topSources[0]?.domain || 'N/A'} (${topSources[0]?.count || 0} citations)`,
      `${topSources.filter(s => s.count > 5).length} sources have significant citation volume`,
      `Average ${Math.round((topSources.reduce((sum, s) => sum + s.count, 0) / data.totalReports) * 10) / 10} citations per AI response`
    ]
  }
}

function generateOpportunitiesSection(data: any, brand: any): ReportSection {
  return {
    title: "Growth Opportunities",
    summary: "Key areas for improving AI visibility and competitive positioning.",
    data: {
      opportunityAreas: [
        "Content gap analysis reveals 3 high-impact topics",
        "Competitor content strategies show untapped keywords", 
        "Source authority optimization potential identified",
        "Multi-engine consistency improvements needed"
      ]
    },
    insights: [
      "Focus on technical content for better AI citations",
      "Improve answer completeness for higher AI visibility",
      "Target emerging topics before competitors"
    ]
  }
}

function generateRecommendationsSection(data: any, brand: any): ReportSection {
  return {
    title: "Strategic Recommendations",
    summary: "Actionable recommendations to improve AI visibility and competitive position.",
    data: {
      immediate: [
        "Optimize existing content for AI citations",
        "Create FAQ pages targeting common queries",
        "Improve technical documentation structure"
      ],
      shortTerm: [
        "Develop content for underperforming engines", 
        "Build authority through strategic partnerships",
        "Monitor and respond to competitor content gaps"
      ],
      longTerm: [
        "Establish thought leadership in AI-friendly formats",
        "Build comprehensive knowledge base",
        "Develop multi-modal content strategy"
      ]
    },
    insights: [
      "Immediate actions could improve score by 10-15 points",
      "Short-term strategy targets 20+ point improvement", 
      "Long-term positioning for sustained AI leadership"
    ]
  }
}

// Helper functions
function generateExecutiveSummary(data: any, brand: any): string {
  const score = data.aiScores[0]?.total_score || 0
  const competitorCount = data.competitors.length
  const reportCount = data.totalReports

  return `${brand.name} currently has an AI Visibility Score of ${Math.round(score)}/100 based on analysis of ${reportCount} AI responses across ${data.enginesAnalyzed.length} engines. We're tracking ${competitorCount} competitors in your market segment. This report provides comprehensive insights into your AI SEO performance and strategic recommendations for improvement.`
}

function generateExecutiveInsights(data: any, brand: any): string[] {
  return [
    `Primary strength: ${getStrongestComponent(data.aiScores[0])} performance`,
    `Key opportunity: ${getWeakestComponent(data.aiScores[0])} optimization`,
    `Competitive position: ${calculateBrandPosition(data, brand)} in AI visibility`
  ]
}

function generateTopRecommendations(data: any, brand: any): string[] {
  return [
    "Optimize content structure for better AI citations",
    "Improve source authority through strategic content",
    "Target competitor content gaps for quick wins"
  ]
}

// Utility functions
function getStrongestComponent(score: any): string {
  if (!score) return 'N/A'
  const components = {
    'Prompt SOV': score.prompt_sov,
    'Generative Appearance': score.generative_appearance, 
    'Citation Authority': score.citation_authority,
    'Answer Quality': score.answer_quality
  }
  return Object.entries(components).reduce((a, b) => components[a[0]] > components[b[0]] ? a : b)[0]
}

function getStrongestComponentValue(score: any): number {
  if (!score) return 0
  return Math.max(score.prompt_sov, score.generative_appearance, score.citation_authority, score.answer_quality)
}

function getWeakestComponent(score: any): string {
  if (!score) return 'N/A'
  const components = {
    'Prompt SOV': score.prompt_sov,
    'Generative Appearance': score.generative_appearance,
    'Citation Authority': score.citation_authority, 
    'Answer Quality': score.answer_quality
  }
  return Object.entries(components).reduce((a, b) => components[a[0]] < components[b[0]] ? a : b)[0]
}

function getWeakestComponentValue(score: any): number {
  if (!score) return 0
  return Math.min(score.prompt_sov, score.generative_appearance, score.citation_authority, score.answer_quality)
}

function calculateBrandPosition(data: any, brand: any): string {
  // Simplified calculation - would be more sophisticated in production
  const score = data.aiScores[0]?.total_score || 0
  if (score >= 80) return "Leader"
  if (score >= 60) return "Strong"
  if (score >= 40) return "Emerging"
  return "Building"
}

function calculateBrandMentionRate(data: any, brand: any): number {
  const mentions = data.llmReports.filter((r: any) => 
    r.response_text && r.response_text.toLowerCase().includes(brand.name.toLowerCase())
  ).length
  return data.totalReports > 0 ? Math.round((mentions / data.totalReports) * 100) : 0
}

function calculateEngineSpecificMentionRate(reports: any[], brand: any): number {
  const mentions = reports.filter(r => 
    r.response_text && r.response_text.toLowerCase().includes(brand.name.toLowerCase())
  ).length
  return reports.length > 0 ? Math.round((mentions / reports.length) * 100) : 0
}

function calculateConfidenceScore(data: any): number {
  // Calculate confidence based on data volume and recency
  const dataPoints = data.totalReports
  const recentData = data.llmReports.filter((r: any) => 
    new Date(r.created_at) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  ).length

  let confidence = 0
  if (dataPoints > 100) confidence += 40
  else if (dataPoints > 50) confidence += 30
  else if (dataPoints > 20) confidence += 20
  else confidence += 10

  if (recentData > 20) confidence += 30
  else if (recentData > 10) confidence += 20
  else if (recentData > 5) confidence += 15
  else confidence += 5

  confidence += Math.min(30, data.enginesAnalyzed.length * 7.5) // Engine diversity bonus

  return Math.min(100, confidence)
}

function generateScoreRecommendation(score: any): string {
  if (!score) return "Collect more data for accurate recommendations"
  const total = score.total_score
  if (total >= 80) return "Maintain leadership through consistent content optimization"
  if (total >= 60) return "Focus on citation authority and answer quality improvements"
  if (total >= 40) return "Improve content structure and source diversity"
  return "Fundamental content strategy overhaul needed"
}

function generateTrendRecommendation(trend: number): string {
  if (trend > 5) return "Maintain current strategy - strong positive momentum"
  if (trend > 0) return "Good progress - consider scaling successful tactics"
  if (trend > -5) return "Stabilize performance before pursuing new initiatives"
  return "Urgent: Address declining visibility with immediate action plan"
}

function generateComponentRecommendation(score: any): string {
  if (!score) return "Insufficient data for component analysis"
  const weakest = getWeakestComponent(score)
  return `Priority focus: ${weakest} improvement strategies`
}

async function downloadReport(supabaseClient: any, userId: string, reportId: string | null) {
  if (!reportId) {
    return new Response(
      JSON.stringify({ error: 'Missing reportId' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const { data: report, error } = await supabaseClient
      .from('generated_reports')
      .select('*')
      .eq('id', reportId)
      .eq('user_id', userId)
      .single()

    if (error || !report) {
      return new Response(
        JSON.stringify({ error: 'Report not found or access denied' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify(report.report_data),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: `Download failed: ${error.message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function getReportTemplates() {
  const templates = [
    {
      id: 'overview',
      name: 'AI Visibility Overview',
      description: 'High-level summary of AI visibility performance',
      sections: ['Executive Summary', 'AI Visibility Performance', 'Top Recommendations'],
      estimatedTime: '2-3 minutes'
    },
    {
      id: 'competitive',
      name: 'Competitive Analysis',
      description: 'In-depth competitor analysis and market positioning',
      sections: ['Competitive Landscape', 'Market Share Analysis', 'Strategic Positioning'],
      estimatedTime: '5-7 minutes'
    },
    {
      id: 'ai_visibility',
      name: 'AI Visibility Deep Dive',
      description: 'Comprehensive AI Visibility Score analysis',
      sections: ['Score Breakdown', 'Component Analysis', 'Trend Analysis', 'Optimization Guide'],
      estimatedTime: '4-6 minutes'
    },
    {
      id: 'complete',
      name: 'Complete Analysis Report',
      description: 'Comprehensive report covering all aspects',
      sections: ['Executive Summary', 'AI Visibility', 'Competitive Analysis', 'Engine Performance', 'Source Analysis', 'Strategic Recommendations'],
      estimatedTime: '8-12 minutes'
    }
  ]

  return new Response(
    JSON.stringify({ templates }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}