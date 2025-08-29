import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    const brandId = pathParts[pathParts.length - 3] // /brands/:brandId/reports/:reportId
    const reportId = pathParts[pathParts.length - 1]

    if (req.method === 'GET') {
      if (url.pathname.endsWith('/pdf')) {
        // Remove /pdf to get reportId
        const actualReportId = pathParts[pathParts.length - 2]
        return await getReportPDF(supabaseClient, user.id, brandId, actualReportId)
      } else if (reportId && reportId !== 'reports') {
        return await getReportJSON(supabaseClient, user.id, brandId, reportId)
      } else {
        return await listReports(supabaseClient, user.id, brandId, url.searchParams)
      }
    }

    if (req.method === 'DELETE' && reportId) {
      return await deleteReport(supabaseClient, user.id, brandId, reportId)
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Reports API error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function listReports(supabaseClient: any, userId: string, brandId: string, searchParams: URLSearchParams) {
  // Validate brand ownership
  const { data: brand, error: brandError } = await supabaseClient
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .eq('owner_id', userId)
    .single()

  if (brandError || !brand) {
    return new Response(
      JSON.stringify({ error: 'Brand not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const limit = parseInt(searchParams.get('limit') || '20')
  const offset = parseInt(searchParams.get('offset') || '0')
  const status = searchParams.get('status')
  const profile = searchParams.get('profile')

  let query = supabaseClient
    .from('reports')
    .select(`
      id,
      status,
      profile,
      overall_score,
      created_at,
      completed_at,
      pdf_s3_path,
      metadata,
      pipeline_executions!inner(
        id,
        profile,
        estimated_cost,
        actual_cost
      )
    `)
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) {
    query = query.eq('status', status)
  }
  if (profile) {
    query = query.eq('profile', profile)
  }

  const { data: reports, error } = await query

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch reports' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get total count for pagination
  const { count } = await supabaseClient
    .from('reports')
    .select('*', { count: 'exact', head: true })
    .eq('brand_id', brandId)

  const formattedReports = reports.map((report: any) => ({
    id: report.id,
    status: report.status,
    profile: report.profile,
    overallScore: report.overall_score,
    createdAt: report.created_at,
    completedAt: report.completed_at,
    hasPDF: !!report.pdf_s3_path,
    estimatedCost: report.pipeline_executions?.estimated_cost,
    actualCost: report.pipeline_executions?.actual_cost || report.metadata?.cost?.total,
    summary: report.metadata?.summary
  }))

  return new Response(
    JSON.stringify({
      reports: formattedReports,
      pagination: {
        total: count || 0,
        limit,
        offset,
        hasMore: (count || 0) > offset + limit
      }
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getReportJSON(supabaseClient: any, userId: string, brandId: string, reportId: string) {
  // Validate brand ownership
  const { data: brand, error: brandError } = await supabaseClient
    .from('brands')
    .select('id, name, domain')
    .eq('id', brandId)
    .eq('owner_id', userId)
    .single()

  if (brandError || !brand) {
    return new Response(
      JSON.stringify({ error: 'Brand not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get report with all related data
  const { data: report, error } = await supabaseClient
    .from('reports')
    .select(`
      *,
      pipeline_executions!inner(
        id,
        profile,
        config,
        estimated_cost,
        actual_cost,
        started_at,
        completed_at
      ),
      scores!inner(
        overall_score,
        component_scores,
        evidence_pointers,
        model_breakdown,
        created_at
      ),
      llm_results(
        id,
        model_name,
        prompt_key,
        response_content,
        usage,
        cost,
        created_at
      )
    `)
    .eq('id', reportId)
    .eq('brand_id', brandId)
    .single()

  if (error || !report) {
    return new Response(
      JSON.stringify({ error: 'Report not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get additional insights and recommendations
  const { data: claims } = await supabaseClient
    .from('claims')
    .select('*')
    .eq('brand_id', brandId)
    .limit(10)

  const { data: competitors } = await supabaseClient
    .from('competitor_scores')
    .select('*')
    .eq('brand_id', brandId)
    .limit(5)

  // Assemble comprehensive report JSON
  const reportData = {
    id: report.id,
    brandId,
    brand: {
      name: brand.name,
      domain: brand.domain
    },
    metadata: {
      profile: report.pipeline_executions.profile,
      status: report.status,
      createdAt: report.created_at,
      completedAt: report.completed_at,
      processingTime: report.pipeline_executions.completed_at ? 
        new Date(report.pipeline_executions.completed_at).getTime() - 
        new Date(report.pipeline_executions.started_at).getTime() : null,
      cost: {
        estimated: report.pipeline_executions.estimated_cost,
        actual: report.pipeline_executions.actual_cost,
        breakdown: report.metadata?.cost || {}
      }
    },
    scores: {
      overall: report.scores.overall_score,
      components: report.scores.component_scores,
      breakdown: report.scores.model_breakdown,
      lastUpdated: report.scores.created_at
    },
    analysis: {
      modelsUsed: [...new Set(report.llm_results.map((r: any) => r.model_name))],
      totalResponses: report.llm_results.length,
      averageConfidence: report.metadata?.analysis?.averageConfidence,
      keyFindings: report.metadata?.analysis?.keyFindings || [],
      recommendations: report.metadata?.recommendations || []
    },
    evidence: {
      claims: claims?.slice(0, 5) || [],
      claimsCount: claims?.length || 0,
      competitors: competitors || [],
      sources: report.scores.evidence_pointers || []
    },
    llmResults: report.llm_results.map((result: any) => ({
      id: result.id,
      model: result.model_name,
      prompt: result.prompt_key,
      response: result.response_content,
      usage: result.usage,
      cost: result.cost,
      timestamp: result.created_at
    })),
    files: {
      hasPDF: !!report.pdf_s3_path,
      jsonSize: JSON.stringify(report).length
    }
  }

  // Log report access
  console.log(JSON.stringify({
    event: 'report.accessed',
    reportId,
    brandId,
    userId,
    profile: report.pipeline_executions.profile,
    timestamp: new Date().toISOString()
  }))

  return new Response(
    JSON.stringify(reportData),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getReportPDF(supabaseClient: any, userId: string, brandId: string, reportId: string) {
  // Validate brand ownership and report exists
  const { data: report, error } = await supabaseClient
    .from('reports')
    .select('pdf_s3_path, status')
    .eq('id', reportId)
    .eq('brand_id', brandId)
    .single()

  if (error || !report) {
    return new Response(
      JSON.stringify({ error: 'Report not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Validate brand ownership
  const { data: brand, error: brandError } = await supabaseClient
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .eq('owner_id', userId)
    .single()

  if (brandError || !brand) {
    return new Response(
      JSON.stringify({ error: 'Brand not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (!report.pdf_s3_path) {
    return new Response(
      JSON.stringify({ 
        error: 'PDF not available',
        status: report.status,
        message: report.status === 'completed' ? 'PDF generation failed' : 'Report not yet completed'
      }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Generate signed URL for PDF download
  // In production, this would create a signed S3 URL
  const signedUrl = await generateSignedURL(report.pdf_s3_path)

  // Log PDF access
  console.log(JSON.stringify({
    event: 'report.pdf_accessed',
    reportId,
    brandId,
    userId,
    s3Path: report.pdf_s3_path,
    timestamp: new Date().toISOString()
  }))

  return new Response(
    JSON.stringify({
      downloadUrl: signedUrl,
      expires: new Date(Date.now() + 3600000).toISOString(), // 1 hour
      filename: `geoscore-report-${brandId}-${reportId}.pdf`,
      contentType: 'application/pdf'
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function deleteReport(supabaseClient: any, userId: string, brandId: string, reportId: string) {
  // Validate brand ownership
  const { data: brand, error: brandError } = await supabaseClient
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .eq('owner_id', userId)
    .single()

  if (brandError || !brand) {
    return new Response(
      JSON.stringify({ error: 'Brand not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get report info before deletion
  const { data: report } = await supabaseClient
    .from('reports')
    .select('pdf_s3_path, status')
    .eq('id', reportId)
    .eq('brand_id', brandId)
    .single()

  if (!report) {
    return new Response(
      JSON.stringify({ error: 'Report not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Delete report and related data
  const { error: deleteError } = await supabaseClient
    .from('reports')
    .delete()
    .eq('id', reportId)
    .eq('brand_id', brandId)

  if (deleteError) {
    return new Response(
      JSON.stringify({ error: 'Failed to delete report' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Schedule S3 cleanup if PDF exists
  if (report.pdf_s3_path) {
    // In production, queue S3 delete operation
    console.log(JSON.stringify({
      event: 'report.pdf_delete_scheduled',
      reportId,
      s3Path: report.pdf_s3_path,
      timestamp: new Date().toISOString()
    }))
  }

  return new Response(
    JSON.stringify({ message: 'Report deleted successfully' }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function generateSignedURL(s3Path: string): Promise<string> {
  // Mock implementation - in production, generate actual signed S3 URL
  const baseUrl = Deno.env.get('S3_BASE_URL') || 'https://storage.example.com'
  const signedToken = btoa(JSON.stringify({
    path: s3Path,
    expires: Date.now() + 3600000, // 1 hour
    nonce: crypto.randomUUID()
  }))
  
  return `${baseUrl}${s3Path}?token=${signedToken}`
}