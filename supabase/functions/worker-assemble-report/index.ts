import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AssembleReportJob {
  id: string
  brandId: string
  payload: {
    source: string
    geoScore?: number
    scoringMethod?: string
    reportType?: 'monthly' | 'quarterly' | 'custom'
    includeCompetitorAnalysis?: boolean
    includeRecommendations?: boolean
  }
}

interface ReportData {
  brand: {
    id: string
    name: string
    domain: string
    description?: string
    competitors: string[]
  }
  score: {
    overall: number
    components: Record<string, number>
    breakdown: Record<string, any>
    competitorComparison: Record<string, number>
  }
  analysis: {
    totalSamples: number
    mentionRate: number
    averageConfidence: number
    modelPerformance: Record<string, any>
    promptPerformance: Record<string, any>
  }
  content: {
    topMentions: Array<{
      model: string
      prompt: string
      response: string
      sentiment: string
      confidence: number
    }>
    topClaims: Array<{
      text: string
      type: string
      confidence: number
      sourceUrl: string
    }>
    keyInsights: string[]
  }
  recommendations: Array<{
    category: string
    priority: 'high' | 'medium' | 'low'
    title: string
    description: string
    estimatedImpact: string
    timeframe: string
    resources: string[]
  }>
  metadata: {
    generatedAt: string
    reportPeriod: string
    reportVersion: string
    dataSourceCount: number
    processingTime: number
  }
}

interface PDFGenerationOptions {
  template: 'standard' | 'executive' | 'technical'
  includeCharts: boolean
  includeAppendix: boolean
  brandingOptions: {
    primaryColor?: string
    logoUrl?: string
    companyName?: string
  }
}

interface AssembleResult {
  brandId: string
  reportId: string
  reportData: ReportData
  pdfS3Path: string
  jsonS3Path: string
  reportUrl: string
  reportMetrics: {
    totalDataPoints: number
    reportSize: number
    generationTime: number
    pdfPageCount: number
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
      return await processAssembleReportJob(supabaseClient, req)
    }

    if (method === 'GET') {
      return await getJobStatus(supabaseClient, req)
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Worker assemble report error:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function processAssembleReportJob(supabaseClient: any, req: Request) {
  const { jobId, brandId, payload }: { jobId: string, brandId: string, payload: AssembleReportJob['payload'] } = await req.json()

  if (!jobId || !brandId) {
    return new Response(
      JSON.stringify({ error: 'Missing jobId or brandId' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  console.log(`Starting assemble report job ${jobId} for brand ${brandId}`)

  try {
    const startTime = Date.now()
    
    // Update job status to running
    await updateJobStatus(supabaseClient, jobId, 'running', { startedAt: new Date().toISOString() })

    // Gather all data needed for the report
    console.log('Gathering report data...')
    const reportData = await gatherReportData(supabaseClient, brandId)

    // Generate recommendations
    console.log('Generating recommendations...')
    const recommendations = await generateRecommendations(reportData)
    reportData.recommendations = recommendations

    // Add metadata
    reportData.metadata = {
      generatedAt: new Date().toISOString(),
      reportPeriod: getCurrentReportPeriod(),
      reportVersion: '1.0',
      dataSourceCount: calculateDataSourceCount(reportData),
      processingTime: Date.now() - startTime
    }

    // Store report data in database
    console.log('Storing report in database...')
    const reportRecord = await storeReportRecord(supabaseClient, brandId, reportData, payload)

    // Generate PDF
    console.log('Generating PDF report...')
    const pdfOptions: PDFGenerationOptions = {
      template: 'standard',
      includeCharts: true,
      includeAppendix: true,
      brandingOptions: {
        primaryColor: '#2563eb',
        companyName: reportData.brand.name
      }
    }
    
    const pdfResult = await generatePDFReport(reportData, pdfOptions)

    // Upload JSON and PDF to S3
    console.log('Uploading report files to S3...')
    const jsonS3Path = await uploadJSONToS3(brandId, reportRecord.id, reportData)
    const pdfS3Path = await uploadPDFToS3(brandId, reportRecord.id, pdfResult.pdfBuffer)

    // Update report record with file paths
    await supabaseClient
      .from('reports')
      .update({
        json_s3_path: jsonS3Path,
        pdf_s3_path: pdfS3Path,
        pdf_page_count: pdfResult.pageCount,
        file_size_bytes: pdfResult.pdfBuffer.length,
        status: 'complete'
      })
      .eq('id', reportRecord.id)

    const processingTime = Date.now() - startTime

    const result: AssembleResult = {
      brandId,
      reportId: reportRecord.id,
      reportData,
      pdfS3Path,
      jsonS3Path,
      reportUrl: generateReportUrl(reportRecord.id),
      reportMetrics: {
        totalDataPoints: calculateDataSourceCount(reportData),
        reportSize: pdfResult.pdfBuffer.length,
        generationTime: processingTime,
        pdfPageCount: pdfResult.pageCount
      }
    }

    // Complete the job
    await updateJobStatus(supabaseClient, jobId, 'complete', {
      ...result,
      completedAt: new Date().toISOString(),
      reportStats: {
        geoScore: reportData.score.overall,
        mentionRate: reportData.analysis.mentionRate,
        totalSamples: reportData.analysis.totalSamples,
        recommendationCount: reportData.recommendations.length,
        processingTimeMs: processingTime
      }
    })

    console.log(`Assemble report job ${jobId} completed successfully`)

    return new Response(
      JSON.stringify({
        jobId,
        status: 'complete',
        result,
        message: `Successfully assembled report ${reportRecord.id} with GeoScore ${reportData.score.overall}/100`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error(`Assemble report job ${jobId} failed:`, error)
    
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
        message: 'Assemble report job failed'
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
async function gatherReportData(supabaseClient: any, brandId: string): Promise<ReportData> {
  // Get brand information
  const { data: brand, error: brandError } = await supabaseClient
    .from('brands')
    .select('id, domain, name, description, competitors')
    .eq('id', brandId)
    .single()

  if (brandError || !brand) {
    throw new Error(`Brand not found: ${brandId}`)
  }

  // Get latest brand score
  const { data: score, error: scoreError } = await supabaseClient
    .from('brand_scores')
    .select('*')
    .eq('brand_id', brandId)
    .order('scored_at', { ascending: false })
    .limit(1)
    .single()

  if (scoreError || !score) {
    throw new Error('No brand score found')
  }

  // Get LLM reports for analysis
  const { data: llmReports } = await supabaseClient
    .from('llm_reports')
    .select(`
      id, model_name, prompt_key, response_text, score_value,
      cost_estimate, execution_time_ms, tokens_used, metadata
    `)
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .limit(100)

  // Get top claims
  const { data: claims } = await supabaseClient
    .from('claims')
    .select('claim_text, claim_type, confidence_score, source_url')
    .eq('brand_id', brandId)
    .order('confidence_score', { ascending: false })
    .limit(20)

  // Process analysis data
  const totalSamples = llmReports?.length || 0
  const mentionedReports = llmReports?.filter(r => r.score_value > 0) || []
  const mentionRate = totalSamples > 0 ? mentionedReports.length / totalSamples : 0

  // Calculate model performance
  const modelGroups = groupBy(llmReports || [], 'model_name')
  const modelPerformance: Record<string, any> = {}
  for (const [model, reports] of Object.entries(modelGroups)) {
    const mentionedInModel = reports.filter(r => r.score_value > 0).length
    modelPerformance[model] = {
      totalSamples: reports.length,
      mentionRate: reports.length > 0 ? mentionedInModel / reports.length : 0,
      averageScore: reports.length > 0 ? reports.reduce((sum, r) => sum + (r.score_value || 0), 0) / reports.length : 0,
      totalCost: reports.reduce((sum, r) => sum + (r.cost_estimate || 0), 0)
    }
  }

  // Calculate prompt performance
  const promptGroups = groupBy(llmReports || [], 'prompt_key')
  const promptPerformance: Record<string, any> = {}
  for (const [prompt, reports] of Object.entries(promptGroups)) {
    const mentionedInPrompt = reports.filter(r => r.score_value > 0).length
    promptPerformance[prompt] = {
      totalSamples: reports.length,
      mentionRate: reports.length > 0 ? mentionedInPrompt / reports.length : 0,
      averageScore: reports.length > 0 ? reports.reduce((sum, r) => sum + (r.score_value || 0), 0) / reports.length : 0
    }
  }

  // Get top mentions with good scores
  const topMentions = mentionedReports
    .filter(r => r.score_value >= 70)
    .slice(0, 10)
    .map(r => ({
      model: r.model_name,
      prompt: r.prompt_key,
      response: r.response_text?.substring(0, 500) + '...',
      sentiment: r.metadata?.mentionAnalysis?.sentiment || 'neutral',
      confidence: (r.score_value || 0) / 100
    }))

  // Generate key insights
  const keyInsights = generateKeyInsights(score, modelPerformance, promptPerformance, mentionRate)

  return {
    brand: {
      id: brand.id,
      name: brand.name || brand.domain,
      domain: brand.domain,
      description: brand.description,
      competitors: brand.competitors || []
    },
    score: {
      overall: score.overall_score,
      components: {
        presence: score.presence_score,
        accuracy: score.accuracy_score,
        salience: score.salience_score,
        authority: score.authority_score,
        freshness: score.freshness_score,
        robustness: score.robustness_score
      },
      breakdown: score.breakdown_data,
      competitorComparison: score.competitor_comparison || {}
    },
    analysis: {
      totalSamples,
      mentionRate,
      averageConfidence: score.metadata?.averageConfidence || 0,
      modelPerformance,
      promptPerformance
    },
    content: {
      topMentions,
      topClaims: claims?.slice(0, 15).map(c => ({
        text: c.claim_text,
        type: c.claim_type,
        confidence: c.confidence_score,
        sourceUrl: c.source_url
      })) || [],
      keyInsights
    },
    recommendations: [], // Will be filled later
    metadata: {
      generatedAt: '',
      reportPeriod: '',
      reportVersion: '',
      dataSourceCount: 0,
      processingTime: 0
    }
  }
}

function groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
  return array.reduce((groups: Record<string, T[]>, item) => {
    const value = String(item[key])
    if (!groups[value]) groups[value] = []
    groups[value].push(item)
    return groups
  }, {})
}

function generateKeyInsights(score: any, modelPerformance: Record<string, any>, promptPerformance: Record<string, any>, mentionRate: number): string[] {
  const insights: string[] = []

  // Overall performance insight
  if (score.overall_score >= 80) {
    insights.push(`Excellent brand visibility with an overall GeoScore of ${score.overall_score}/100`)
  } else if (score.overall_score >= 60) {
    insights.push(`Good brand visibility with room for improvement (GeoScore: ${score.overall_score}/100)`)
  } else {
    insights.push(`Low brand visibility detected (GeoScore: ${score.overall_score}/100) - immediate action recommended`)
  }

  // Component analysis
  const components = ['presence', 'accuracy', 'salience', 'authority', 'freshness', 'robustness']
  const strongestComponent = components.reduce((best, component) => 
    score[`${component}_score`] > score[`${best}_score`] ? component : best
  )
  const weakestComponent = components.reduce((worst, component) => 
    score[`${component}_score`] < score[`${worst}_score`] ? component : worst
  )

  insights.push(`Strongest aspect: ${strongestComponent} (${score[`${strongestComponent}_score`]}/100)`)
  insights.push(`Area for improvement: ${weakestComponent} (${score[`${weakestComponent}_score`]}/100)`)

  // Model performance insights
  const bestModel = Object.entries(modelPerformance).reduce(([bestName, bestData], [name, data]) => 
    data.mentionRate > bestData.mentionRate ? [name, data] : [bestName, bestData]
  )
  insights.push(`Best performing model: ${bestModel[0]} with ${(bestModel[1].mentionRate * 100).toFixed(1)}% mention rate`)

  // Mention rate insights
  if (mentionRate < 0.3) {
    insights.push('Low overall mention rate suggests need for improved content strategy')
  } else if (mentionRate > 0.7) {
    insights.push('High mention rate indicates strong brand recognition in AI responses')
  }

  return insights
}

async function generateRecommendations(reportData: ReportData): Promise<Array<{
  category: string
  priority: 'high' | 'medium' | 'low'
  title: string
  description: string
  estimatedImpact: string
  timeframe: string
  resources: string[]
}>> {
  const recommendations = []

  // Score-based recommendations
  if (reportData.score.components.presence < 50) {
    recommendations.push({
      category: 'Content Strategy',
      priority: 'high' as const,
      title: 'Increase Brand Presence in AI Training Data',
      description: 'Your brand has low visibility in AI model responses. Focus on creating more discoverable, high-quality content that AI models can reference.',
      estimatedImpact: 'Could improve presence score by 20-30 points',
      timeframe: '3-6 months',
      resources: ['Content team', 'SEO specialist', 'PR team']
    })
  }

  if (reportData.score.components.accuracy < 60) {
    recommendations.push({
      category: 'Information Quality',
      priority: 'high' as const,
      title: 'Improve Information Accuracy and Consistency',
      description: 'AI models are providing inaccurate information about your brand. Ensure all public information is consistent and up-to-date.',
      estimatedImpact: 'Could improve accuracy score by 15-25 points',
      timeframe: '1-3 months',
      resources: ['Brand team', 'Web development', 'Content team']
    })
  }

  if (reportData.score.components.authority < 55) {
    recommendations.push({
      category: 'Authority Building',
      priority: 'medium' as const,
      title: 'Build Authoritative Content and Partnerships',
      description: 'Increase the authority of your brand mentions through thought leadership, expert content, and strategic partnerships.',
      estimatedImpact: 'Could improve authority score by 10-20 points',
      timeframe: '6-12 months',
      resources: ['Content team', 'PR team', 'Executive team']
    })
  }

  // Model performance based recommendations
  const modelPerf = reportData.analysis.modelPerformance
  const lowPerformingModels = Object.entries(modelPerf)
    .filter(([_, data]) => data.mentionRate < 0.3)
    .map(([model, _]) => model)

  if (lowPerformingModels.length > 0) {
    recommendations.push({
      category: 'Model-Specific Optimization',
      priority: 'medium' as const,
      title: `Optimize Content for ${lowPerformingModels.join(', ')}`,
      description: `These AI models have low mention rates for your brand. Consider targeted content strategies for these specific platforms.`,
      estimatedImpact: 'Could improve overall mention rate by 10-15%',
      timeframe: '2-4 months',
      resources: ['AI specialist', 'Content team', 'Data analyst']
    })
  }

  // Competitor analysis recommendations
  const competitorScores = Object.entries(reportData.score.competitorComparison)
  const strongCompetitors = competitorScores.filter(([_, score]) => score > 60)

  if (strongCompetitors.length > 0) {
    recommendations.push({
      category: 'Competitive Strategy',
      priority: 'medium' as const,
      title: 'Competitive Visibility Enhancement',
      description: `Your competitors (${strongCompetitors.map(([name, _]) => name).join(', ')}) have strong AI visibility. Analyze their content strategies and differentiate your approach.`,
      estimatedImpact: 'Could improve competitive positioning by 15-25%',
      timeframe: '3-6 months',
      resources: ['Competitive intelligence', 'Strategy team', 'Content team']
    })
  }

  // General recommendations
  if (reportData.analysis.mentionRate < 0.5) {
    recommendations.push({
      category: 'Overall Strategy',
      priority: 'high' as const,
      title: 'Comprehensive AI Visibility Program',
      description: 'Implement a comprehensive program to improve your brand\'s visibility in AI model training data and responses.',
      estimatedImpact: 'Could improve overall GeoScore by 25-40 points',
      timeframe: '6-12 months',
      resources: ['Cross-functional team', 'AI consultant', 'Content strategy team']
    })
  }

  return recommendations.slice(0, 8) // Limit to top 8 recommendations
}

async function storeReportRecord(supabaseClient: any, brandId: string, reportData: ReportData, payload: any) {
  const { data: report, error } = await supabaseClient
    .from('reports')
    .insert({
      brand_id: brandId,
      report_type: payload.reportType || 'custom',
      overall_score: reportData.score.overall,
      report_data: reportData,
      status: 'generating',
      generated_at: new Date().toISOString()
    })
    .select('id')
    .single()

  if (error) {
    throw new Error(`Failed to store report: ${error.message}`)
  }

  return report
}

async function generatePDFReport(reportData: ReportData, options: PDFGenerationOptions): Promise<{ pdfBuffer: Uint8Array; pageCount: number }> {
  // Mock PDF generation - in production this would use a library like Puppeteer or a service
  console.log('Generating PDF with options:', options)
  
  // Create mock PDF content based on report data
  const htmlContent = generateHTMLReport(reportData, options)
  
  // Mock PDF buffer (in production, this would be actual PDF generation)
  const mockPDFContent = `Mock PDF Report for ${reportData.brand.name}
GeoScore: ${reportData.score.overall}/100
Generated: ${reportData.metadata.generatedAt}
Total Samples: ${reportData.analysis.totalSamples}
Mention Rate: ${(reportData.analysis.mentionRate * 100).toFixed(1)}%

Key Insights:
${reportData.content.keyInsights.map((insight, i) => `${i + 1}. ${insight}`).join('\n')}

Recommendations:
${reportData.recommendations.map((rec, i) => `${i + 1}. ${rec.title} (${rec.priority} priority)`).join('\n')}
`

  const encoder = new TextEncoder()
  const pdfBuffer = encoder.encode(mockPDFContent)
  
  // Estimate page count based on content length
  const pageCount = Math.max(1, Math.ceil(mockPDFContent.length / 2000))

  return { pdfBuffer, pageCount }
}

function generateHTMLReport(reportData: ReportData, options: PDFGenerationOptions): string {
  const primaryColor = options.brandingOptions.primaryColor || '#2563eb'
  
  return `
<!DOCTYPE html>
<html>
<head>
    <title>GeoScore Report - ${reportData.brand.name}</title>
    <style>
        body { font-family: Arial, sans-serif; color: #333; margin: 40px; }
        .header { text-align: center; border-bottom: 2px solid ${primaryColor}; padding-bottom: 20px; }
        .score-circle { display: inline-block; width: 120px; height: 120px; border-radius: 50%; 
                        background: conic-gradient(${primaryColor} ${reportData.score.overall * 3.6}deg, #e5e7eb 0deg); 
                        position: relative; margin: 20px; }
        .score-text { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                      font-size: 24px; font-weight: bold; }
        .section { margin: 30px 0; }
        .section h2 { color: ${primaryColor}; border-bottom: 1px solid #ddd; padding-bottom: 10px; }
        .component-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
        .component { padding: 15px; border: 1px solid #ddd; border-radius: 8px; text-align: center; }
        .insight { margin: 15px 0; padding: 15px; background: #f8fafc; border-radius: 8px; }
        .recommendation { margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 8px; }
        .priority-high { border-left: 4px solid #ef4444; }
        .priority-medium { border-left: 4px solid #f59e0b; }
        .priority-low { border-left: 4px solid #10b981; }
    </style>
</head>
<body>
    <div class="header">
        <h1>GeoScore AI Visibility Report</h1>
        <h2>${reportData.brand.name}</h2>
        <div class="score-circle">
            <div class="score-text">${reportData.score.overall}</div>
        </div>
        <p>Generated on ${new Date(reportData.metadata.generatedAt).toLocaleDateString()}</p>
    </div>

    <div class="section">
        <h2>Executive Summary</h2>
        <p>This report analyzes ${reportData.brand.name}'s visibility across AI models based on ${reportData.analysis.totalSamples} samples.</p>
        <p>Overall GeoScore: <strong>${reportData.score.overall}/100</strong></p>
        <p>Mention Rate: <strong>${(reportData.analysis.mentionRate * 100).toFixed(1)}%</strong></p>
    </div>

    <div class="section">
        <h2>Score Components</h2>
        <div class="component-grid">
            <div class="component">
                <h3>Presence</h3>
                <div class="score-text">${reportData.score.components.presence}</div>
            </div>
            <div class="component">
                <h3>Accuracy</h3>
                <div class="score-text">${reportData.score.components.accuracy}</div>
            </div>
            <div class="component">
                <h3>Salience</h3>
                <div class="score-text">${reportData.score.components.salience}</div>
            </div>
            <div class="component">
                <h3>Authority</h3>
                <div class="score-text">${reportData.score.components.authority}</div>
            </div>
            <div class="component">
                <h3>Freshness</h3>
                <div class="score-text">${reportData.score.components.freshness}</div>
            </div>
            <div class="component">
                <h3>Robustness</h3>
                <div class="score-text">${reportData.score.components.robustness}</div>
            </div>
        </div>
    </div>

    <div class="section">
        <h2>Key Insights</h2>
        ${reportData.content.keyInsights.map(insight => `<div class="insight">${insight}</div>`).join('')}
    </div>

    <div class="section">
        <h2>Recommendations</h2>
        ${reportData.recommendations.map(rec => `
            <div class="recommendation priority-${rec.priority}">
                <h3>${rec.title}</h3>
                <p><strong>Priority:</strong> ${rec.priority.toUpperCase()}</p>
                <p><strong>Description:</strong> ${rec.description}</p>
                <p><strong>Estimated Impact:</strong> ${rec.estimatedImpact}</p>
                <p><strong>Timeframe:</strong> ${rec.timeframe}</p>
                <p><strong>Resources:</strong> ${rec.resources.join(', ')}</p>
            </div>
        `).join('')}
    </div>
</body>
</html>
  `
}

async function uploadJSONToS3(brandId: string, reportId: string, reportData: ReportData): Promise<string> {
  const s3Key = `reports/${brandId}/${reportId}/report.json`
  
  // Mock S3 upload
  console.log(`Mock S3 upload JSON: ${s3Key}`)
  console.log(`JSON size: ${JSON.stringify(reportData).length} bytes`)
  
  return `s3://geoscore-reports/${s3Key}`
}

async function uploadPDFToS3(brandId: string, reportId: string, pdfBuffer: Uint8Array): Promise<string> {
  const s3Key = `reports/${brandId}/${reportId}/report.pdf`
  
  // Mock S3 upload
  console.log(`Mock S3 upload PDF: ${s3Key}`)
  console.log(`PDF size: ${pdfBuffer.length} bytes`)
  
  return `s3://geoscore-reports/${s3Key}`
}

function generateReportUrl(reportId: string): string {
  return `https://geoscore.ai/reports/${reportId}`
}

function getCurrentReportPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function calculateDataSourceCount(reportData: ReportData): number {
  return (
    reportData.analysis.totalSamples +
    reportData.content.topClaims.length +
    Object.keys(reportData.analysis.modelPerformance).length +
    Object.keys(reportData.analysis.promptPerformance).length
  )
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