import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface JobFilters {
  brandId?: string
  type?: string
  status?: 'queued' | 'running' | 'failed' | 'complete'
  startDate?: string
  endDate?: string
  userId?: string
  priority?: number
  page?: number
  limit?: number
  sortBy?: 'created_at' | 'updated_at' | 'priority' | 'status'
  sortOrder?: 'asc' | 'desc'
}

interface JobRerunRequest {
  reason?: string
  priority?: number
  options?: {
    resetDependencies?: boolean
    forceReprocessing?: boolean
    skipValidation?: boolean
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

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if user is admin (using users table with role column)
    const { data: adminUser } = await supabaseClient
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!adminUser || !['admin', 'super_admin'].includes(adminUser.role)) {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const jobId = pathParts[pathParts.length - 1]
    const action = pathParts[pathParts.length - 1]

    // Log admin activity
    await logAdminActivity(supabaseClient, user.id, `${req.method} ${url.pathname}`, req)

    // Route handlers
    if (req.method === 'GET' && !jobId.includes('rerun')) {
      return await getJobs(supabaseClient, adminUser, url.searchParams)
    }

    if (req.method === 'POST' && action === 'rerun') {
      const actualJobId = pathParts[pathParts.length - 2]
      return await rerunJob(supabaseClient, adminUser, user.id, actualJobId, req)
    }

    if (req.method === 'GET' && jobId && !action.includes('rerun')) {
      return await getJobDetails(supabaseClient, adminUser, jobId)
    }

    if (req.method === 'PUT' && jobId) {
      return await updateJob(supabaseClient, adminUser, user.id, jobId, req)
    }

    if (req.method === 'DELETE' && jobId) {
      return await cancelJob(supabaseClient, adminUser, user.id, jobId)
    }

    if (req.method === 'POST' && action === 'bulk-action') {
      return await performBulkAction(supabaseClient, adminUser, user.id, req)
    }

    if (req.method === 'GET' && action === 'stats') {
      return await getJobStats(supabaseClient, adminUser, url.searchParams)
    }

    return new Response(
      JSON.stringify({ error: 'Invalid endpoint' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Admin Jobs error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function getJobs(supabaseClient: any, adminUser: any, searchParams: URLSearchParams) {
  try {
    // Parse filters
    const filters: JobFilters = {
      brandId: searchParams.get('brandId') || undefined,
      type: searchParams.get('type') || undefined,
      status: searchParams.get('status') as any || undefined,
      startDate: searchParams.get('startDate') || undefined,
      endDate: searchParams.get('endDate') || undefined,
      userId: searchParams.get('userId') || undefined,
      priority: searchParams.get('priority') ? parseInt(searchParams.get('priority')!) : undefined,
      page: parseInt(searchParams.get('page') || '1'),
      limit: parseInt(searchParams.get('limit') || '25'),
      sortBy: searchParams.get('sortBy') as any || 'created_at',
      sortOrder: searchParams.get('sortOrder') as any || 'desc'
    }

    // Build query
    let query = supabaseClient
      .from('jobs')
      .select(`
        id, brand_id, type, status, priority, payload, result,
        max_retries, retry_count, error_message,
        created_at, started_at, completed_at, updated_at,
        brands (id, name, domain, users!inner(id, email)),
        job_dependencies (depends_on_job_id),
        job_logs (id, level, message, created_at)
      `, { count: 'exact' })

    // Apply filters
    if (filters.brandId) {
      query = query.eq('brand_id', filters.brandId)
    }

    if (filters.type) {
      query = query.eq('type', filters.type)
    }

    if (filters.status) {
      query = query.eq('status', filters.status)
    }

    if (filters.userId) {
      query = query.eq('brands.users.id', filters.userId)
    }

    if (filters.priority) {
      query = query.gte('priority', filters.priority)
    }

    if (filters.startDate) {
      query = query.gte('created_at', filters.startDate)
    }

    if (filters.endDate) {
      query = query.lte('created_at', filters.endDate)
    }

    // Pagination and sorting
    const offset = (filters.page! - 1) * filters.limit!
    query = query
      .order(filters.sortBy!, { ascending: filters.sortOrder === 'asc' })
      .range(offset, offset + filters.limit! - 1)

    const { data: jobs, error, count } = await query

    if (error) throw error

    // Enrich job data
    const enrichedJobs = (jobs || []).map(job => ({
      id: job.id,
      brandId: job.brand_id,
      brand: {
        id: job.brands?.id,
        name: job.brands?.name,
        domain: job.brands?.domain,
        owner: {
          id: job.brands?.users?.id,
          email: job.brands?.users?.email
        }
      },
      type: job.type,
      status: job.status,
      priority: job.priority,
      payload: job.payload,
      result: job.result,
      
      // Retry information
      retryInfo: {
        count: job.retry_count || 0,
        maxRetries: job.max_retries || 3,
        canRetry: (job.retry_count || 0) < (job.max_retries || 3)
      },

      // Timing information
      timing: {
        createdAt: job.created_at,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        updatedAt: job.updated_at,
        duration: calculateDuration(job.started_at, job.completed_at),
        queueTime: calculateDuration(job.created_at, job.started_at)
      },

      // Dependencies
      dependencies: (job.job_dependencies || []).map(d => d.depends_on_job_id),

      // Recent logs
      recentLogs: (job.job_logs || [])
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 5)
        .map(log => ({
          level: log.level,
          message: log.message,
          timestamp: log.created_at
        })),

      // Error information
      errorInfo: job.error_message ? {
        message: job.error_message,
        canRerun: job.status === 'failed' && (job.retry_count || 0) < (job.max_retries || 3)
      } : null
    }))

    return new Response(
      JSON.stringify({
        jobs: enrichedJobs,
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / filters.limit!),
          hasMore: offset + filters.limit! < (count || 0)
        },
        filters: {
          applied: Object.keys(filters).filter(key => filters[key] !== undefined),
          available: ['brandId', 'type', 'status', 'startDate', 'endDate', 'userId', 'priority']
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error fetching jobs:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to fetch jobs', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function getJobDetails(supabaseClient: any, adminUser: any, jobId: string) {
  try {
    // Get job with full details
    const { data: job, error } = await supabaseClient
      .from('jobs')
      .select(`
        id, brand_id, type, status, priority, payload, result,
        max_retries, retry_count, error_message, idempotency_key,
        created_at, started_at, completed_at, updated_at,
        brands (id, name, domain, users!inner(id, email)),
        job_dependencies (depends_on_job_id, jobs!job_dependencies_depends_on_job_id_fkey(id, type, status)),
        dependent_jobs:job_dependencies!job_dependencies_depends_on_job_id_fkey(job_id, jobs!inner(id, type, status)),
        job_logs (id, level, message, metadata, created_at)
      `)
      .eq('id', jobId)
      .single()

    if (error || !job) {
      return new Response(
        JSON.stringify({ error: 'Job not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get related jobs (retries, dependencies)
    const { data: relatedJobs } = await supabaseClient
      .from('jobs')
      .select('id, type, status, created_at, retry_count')
      .or(`retries_from.eq.${jobId},id.eq.${job.retries_from || 'none'}`)

    // Process logs with analysis
    const logs = (job.job_logs || [])
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map(log => ({
        id: log.id,
        level: log.level,
        message: log.message,
        metadata: log.metadata,
        timestamp: log.created_at,
        timeFromStart: job.started_at ? 
          Math.round((new Date(log.created_at).getTime() - new Date(job.started_at).getTime()) / 1000) : 0
      }))

    const detailedJob = {
      id: job.id,
      brandId: job.brand_id,
      brand: {
        id: job.brands?.id,
        name: job.brands?.name,
        domain: job.brands?.domain,
        owner: {
          id: job.brands?.users?.id,
          email: job.brands?.users?.email
        }
      },
      type: job.type,
      status: job.status,
      priority: job.priority,
      payload: job.payload,
      result: job.result,
      idempotencyKey: job.idempotency_key,

      // Comprehensive timing
      timing: {
        createdAt: job.created_at,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        updatedAt: job.updated_at,
        totalDuration: calculateDuration(job.created_at, job.completed_at),
        queueTime: calculateDuration(job.created_at, job.started_at),
        processingTime: calculateDuration(job.started_at, job.completed_at),
        isLongRunning: isLongRunning(job.type, job.started_at, job.completed_at)
      },

      // Retry information
      retryInfo: {
        count: job.retry_count || 0,
        maxRetries: job.max_retries || 3,
        canRetry: (job.retry_count || 0) < (job.max_retries || 3),
        retriesFrom: job.retries_from,
        relatedRetries: (relatedJobs || []).filter(r => r.id !== jobId)
      },

      // Dependencies
      dependencies: {
        dependsOn: (job.job_dependencies || []).map(dep => ({
          jobId: dep.depends_on_job_id,
          type: dep.jobs?.type,
          status: dep.jobs?.status
        })),
        dependents: (job.dependent_jobs || []).map(dep => ({
          jobId: dep.job_id,
          type: dep.jobs?.type,
          status: dep.jobs?.status
        }))
      },

      // Full logs
      logs,
      logSummary: {
        total: logs.length,
        byLevel: logs.reduce((acc, log) => {
          acc[log.level] = (acc[log.level] || 0) + 1
          return acc
        }, {}),
        errors: logs.filter(log => log.level === 'ERROR'),
        warnings: logs.filter(log => log.level === 'WARN')
      },

      // Error analysis
      errorAnalysis: job.error_message ? analyzeError(job.error_message, logs) : null,

      // Performance metrics
      performance: calculatePerformanceMetrics(job, logs),

      // Admin actions
      availableActions: getAvailableActions(job, adminUser)
    }

    return new Response(
      JSON.stringify({ job: detailedJob }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error fetching job details:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to fetch job details' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function rerunJob(supabaseClient: any, adminUser: any, adminId: string, jobId: string, req: Request) {
  const { 
    reason = 'manual_admin_rerun', 
    priority, 
    options = {} 
  }: JobRerunRequest = await req.json()

  try {
    // Get original job
    const { data: originalJob, error: fetchError } = await supabaseClient
      .from('jobs')
      .select(`
        id, brand_id, type, payload, priority, max_retries, retry_count,
        brands (name, domain)
      `)
      .eq('id', jobId)
      .single()

    if (fetchError || !originalJob) {
      return new Response(
        JSON.stringify({ error: 'Job not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if job can be rerun
    if (!options.skipValidation && originalJob.retry_count >= originalJob.max_retries) {
      return new Response(
        JSON.stringify({ 
          error: 'Job has exceeded maximum retry attempts',
          maxRetries: originalJob.max_retries,
          currentRetries: originalJob.retry_count
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create new job via job queue manager
    const newJobPayload = {
      brandId: originalJob.brand_id,
      type: originalJob.type,
      payload: originalJob.payload,
      priority: priority || originalJob.priority + 2, // Higher priority for reruns
      idempotencyKey: `rerun_${jobId}_${Date.now()}`,
      options: {
        retryPolicy: 'exponential',
        maxRetries: originalJob.max_retries,
        isRerun: true,
        originalJobId: jobId,
        rerunReason: reason
      }
    }

    // Call job queue manager
    const queueResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/job-queue-manager/enqueue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify(newJobPayload)
    })

    const queueResult = await queueResponse.json()

    if (!queueResult.jobId) {
      throw new Error('Failed to enqueue rerun job')
    }

    // Update original job to mark it as rerun
    await supabaseClient
      .from('jobs')
      .update({
        rerun_job_id: queueResult.jobId,
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId)

    // Log admin rerun action
    await supabaseClient
      .from('admin_logs')
      .insert({
        admin_id: adminId,
        action: 'rerun_job',
        resource_type: 'job',
        resource_id: jobId,
        details: {
          newJobId: queueResult.jobId,
          reason,
          priority: newJobPayload.priority,
          brandName: originalJob.brands?.name,
          jobType: originalJob.type,
          options
        }
      })

    // Structured logging
    console.log(JSON.stringify({
      event: 'job_rerun',
      level: 'INFO',
      original_job_id: jobId,
      new_job_id: queueResult.jobId,
      brand_id: originalJob.brand_id,
      job_type: originalJob.type,
      reason,
      admin_id: adminId,
      timestamp: new Date().toISOString()
    }))

    return new Response(
      JSON.stringify({
        originalJobId: jobId,
        newJobId: queueResult.jobId,
        status: 'rerun_queued',
        reason,
        priority: newJobPayload.priority,
        message: `Job rerun successfully queued. New job ID: ${queueResult.jobId}`,
        estimatedStartTime: getEstimatedStartTime(newJobPayload.priority)
      }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error rerunning job:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to rerun job', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function getJobStats(supabaseClient: any, adminUser: any, searchParams: URLSearchParams) {
  try {
    const timeRange = searchParams.get('timeRange') || '24h'
    const groupBy = searchParams.get('groupBy') || 'hour'

    // Calculate time range
    const ranges = {
      '1h': 1 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    }

    const rangeMs = ranges[timeRange] || ranges['24h']
    const fromDate = new Date(Date.now() - rangeMs)

    // Get job statistics
    const { data: jobs, error } = await supabaseClient
      .from('jobs')
      .select(`
        id, type, status, priority, created_at, started_at, completed_at,
        retry_count, error_message, brands (id, name)
      `)
      .gte('created_at', fromDate.toISOString())

    if (error) throw error

    // Process statistics
    const stats = {
      overview: {
        total: jobs?.length || 0,
        byStatus: {},
        byType: {},
        byPriority: {},
        averageQueueTime: 0,
        averageProcessingTime: 0
      },
      trends: generateTimeTrends(jobs || [], groupBy, rangeMs),
      performance: {
        successRate: 0,
        retryRate: 0,
        errorRate: 0,
        longRunningJobs: 0
      },
      topErrors: getTopErrors(jobs || []),
      brandActivity: getBrandActivity(jobs || [])
    }

    // Calculate overview stats
    const statusCounts = {}
    const typeCounts = {}
    const priorityCounts = {}
    let totalQueueTime = 0
    let totalProcessingTime = 0
    let queueTimeCount = 0
    let processingTimeCount = 0

    for (const job of jobs || []) {
      // Status counts
      statusCounts[job.status] = (statusCounts[job.status] || 0) + 1

      // Type counts
      typeCounts[job.type] = (typeCounts[job.type] || 0) + 1

      // Priority counts
      const priorityGroup = job.priority >= 8 ? 'high' : job.priority >= 5 ? 'medium' : 'low'
      priorityCounts[priorityGroup] = (priorityCounts[priorityGroup] || 0) + 1

      // Timing calculations
      if (job.created_at && job.started_at) {
        totalQueueTime += new Date(job.started_at).getTime() - new Date(job.created_at).getTime()
        queueTimeCount++
      }

      if (job.started_at && job.completed_at) {
        totalProcessingTime += new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()
        processingTimeCount++
      }
    }

    stats.overview.byStatus = statusCounts
    stats.overview.byType = typeCounts
    stats.overview.byPriority = priorityCounts
    stats.overview.averageQueueTime = queueTimeCount > 0 ? totalQueueTime / queueTimeCount : 0
    stats.overview.averageProcessingTime = processingTimeCount > 0 ? totalProcessingTime / processingTimeCount : 0

    // Performance metrics
    const total = jobs?.length || 1
    const successful = statusCounts['complete'] || 0
    const failed = statusCounts['failed'] || 0
    const retried = (jobs || []).filter(j => j.retry_count > 0).length

    stats.performance.successRate = successful / total
    stats.performance.errorRate = failed / total
    stats.performance.retryRate = retried / total
    stats.performance.longRunningJobs = (jobs || []).filter(j => 
      isLongRunning(j.type, j.started_at, j.completed_at)
    ).length

    return new Response(
      JSON.stringify({
        stats,
        timeRange,
        generatedAt: new Date().toISOString(),
        dataPoints: jobs?.length || 0
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error fetching job stats:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to fetch job stats' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Helper functions
async function logAdminActivity(supabaseClient: any, adminId: string, action: string, req: Request) {
  try {
    await supabaseClient
      .from('admin_logs')
      .insert({
        admin_id: adminId,
        action,
        ip_address: req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For'),
        user_agent: req.headers.get('User-Agent'),
        details: { timestamp: new Date().toISOString() }
      })
  } catch (error) {
    console.warn('Failed to log admin activity:', error)
  }
}

function calculateDuration(startTime: string | null, endTime: string | null): number {
  if (!startTime || !endTime) return 0
  return Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000)
}

function isLongRunning(jobType: string, startTime: string | null, endTime: string | null): boolean {
  if (!startTime) return false
  
  const thresholds = {
    'brand_onboard': 300, // 5 minutes
    'sample': 600,        // 10 minutes
    'normalize': 120,     // 2 minutes
    'embed': 180,         // 3 minutes
    'score': 60,          // 1 minute
    'assemble_report': 120 // 2 minutes
  }

  const threshold = thresholds[jobType] || 300
  const actualDuration = endTime ? 
    (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000 :
    (Date.now() - new Date(startTime).getTime()) / 1000

  return actualDuration > threshold
}

function analyzeError(errorMessage: string, logs: any[]) {
  const errorLogs = logs.filter(log => log.level === 'ERROR')
  
  // Common error patterns
  const patterns = [
    { pattern: /timeout/i, category: 'timeout', severity: 'medium' },
    { pattern: /rate.?limit/i, category: 'rate_limit', severity: 'low' },
    { pattern: /unauthorized|auth/i, category: 'authentication', severity: 'high' },
    { pattern: /network|connection/i, category: 'network', severity: 'medium' },
    { pattern: /memory|oom/i, category: 'memory', severity: 'high' },
    { pattern: /validation|invalid/i, category: 'validation', severity: 'medium' }
  ]

  const matches = patterns.filter(p => p.pattern.test(errorMessage))
  
  return {
    message: errorMessage,
    category: matches[0]?.category || 'unknown',
    severity: matches[0]?.severity || 'medium',
    isRetryable: !['validation', 'authentication'].includes(matches[0]?.category),
    errorLogCount: errorLogs.length,
    suggestedActions: getSuggestedActions(matches[0]?.category)
  }
}

function getSuggestedActions(category: string): string[] {
  const actions = {
    timeout: ['Increase timeout limit', 'Check service availability', 'Retry with exponential backoff'],
    rate_limit: ['Wait for rate limit reset', 'Use different API key', 'Implement request throttling'],
    authentication: ['Check API key validity', 'Refresh credentials', 'Verify permissions'],
    network: ['Check network connectivity', 'Verify service endpoints', 'Retry after delay'],
    memory: ['Optimize payload size', 'Increase memory allocation', 'Process in smaller chunks'],
    validation: ['Check input data format', 'Verify required fields', 'Update validation rules'],
    unknown: ['Check logs for more details', 'Contact system administrator', 'Retry after investigation']
  }

  return actions[category] || actions.unknown
}

function calculatePerformanceMetrics(job: any, logs: any[]) {
  const metrics = {
    efficiency: 0.5,
    resourceUsage: 'normal',
    logHealth: 'good',
    recommendations: []
  }

  // Calculate efficiency based on timing
  if (job.started_at && job.completed_at) {
    const duration = (new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000
    const expected = getExpectedDuration(job.type)
    metrics.efficiency = Math.max(0, Math.min(1, expected / duration))
  }

  // Analyze log patterns
  const errorCount = logs.filter(l => l.level === 'ERROR').length
  const warnCount = logs.filter(l => l.level === 'WARN').length
  
  if (errorCount === 0 && warnCount <= 2) {
    metrics.logHealth = 'excellent'
  } else if (errorCount <= 1 && warnCount <= 5) {
    metrics.logHealth = 'good'
  } else {
    metrics.logHealth = 'poor'
    metrics.recommendations.push('Review error logs for optimization opportunities')
  }

  if (metrics.efficiency < 0.7) {
    metrics.recommendations.push('Performance optimization needed')
  }

  return metrics
}

function getExpectedDuration(jobType: string): number {
  const durations = {
    'brand_onboard': 120,
    'normalize': 60,
    'embed': 90,
    'sample': 300,
    'score': 30,
    'assemble_report': 60
  }
  return durations[jobType] || 120
}

function getAvailableActions(job: any, adminUser: any) {
  const actions = []

  if (job.status === 'failed' && job.retry_count < job.max_retries) {
    actions.push('rerun')
  }

  if (job.status === 'queued') {
    actions.push('cancel', 'change_priority')
  }

  if (job.status === 'running') {
    actions.push('cancel')
  }

  if (adminUser.role === 'super_admin') {
    actions.push('force_complete', 'delete', 'modify_payload')
  }

  return actions
}

function getEstimatedStartTime(priority: number): string {
  const delayMinutes = Math.max(1, 10 - priority)
  return new Date(Date.now() + delayMinutes * 60 * 1000).toISOString()
}

function generateTimeTrends(jobs: any[], groupBy: string, rangeMs: number) {
  // Simplified time trend generation
  return []
}

function getTopErrors(jobs: any[]) {
  const errorCounts = {}
  jobs.filter(j => j.error_message).forEach(job => {
    const key = job.error_message.substring(0, 100) // Truncate for grouping
    errorCounts[key] = (errorCounts[key] || 0) + 1
  })

  return Object.entries(errorCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .map(([error, count]) => ({ error, count }))
}

function getBrandActivity(jobs: any[]) {
  const brandActivity = {}
  jobs.forEach(job => {
    const brandId = job.brands?.id
    const brandName = job.brands?.name
    if (brandId) {
      if (!brandActivity[brandId]) {
        brandActivity[brandId] = { name: brandName, total: 0, successful: 0, failed: 0 }
      }
      brandActivity[brandId].total++
      if (job.status === 'complete') brandActivity[brandId].successful++
      if (job.status === 'failed') brandActivity[brandId].failed++
    }
  })

  return Object.values(brandActivity)
    .sort((a: any, b: any) => b.total - a.total)
    .slice(0, 10)
}

// Additional endpoints (simplified implementations)
async function updateJob(supabaseClient: any, adminUser: any, adminId: string, jobId: string, req: Request) {
  const { priority, status, payload, maxRetries } = await req.json()

  try {
    // Get current job
    const { data: currentJob, error: fetchError } = await supabaseClient
      .from('jobs')
      .select('*, brands(name)')
      .eq('id', jobId)
      .single()

    if (fetchError || !currentJob) {
      return new Response(
        JSON.stringify({ error: 'Job not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build update object
    const updateData: any = {
      updated_at: new Date().toISOString()
    }

    if (priority !== undefined) updateData.priority = Math.max(1, Math.min(10, priority))
    if (status && ['queued', 'running', 'failed', 'complete'].includes(status)) {
      updateData.status = status
    }
    if (payload) updateData.payload = { ...currentJob.payload, ...payload }
    if (maxRetries !== undefined) updateData.max_retries = Math.max(0, maxRetries)

    // Special handling for status changes
    if (status === 'queued' && currentJob.status !== 'queued') {
      updateData.started_at = null
      updateData.completed_at = null
      updateData.error_message = null
    } else if (status === 'running' && currentJob.status !== 'running') {
      updateData.started_at = new Date().toISOString()
      updateData.completed_at = null
    } else if (status === 'complete' && currentJob.status !== 'complete') {
      updateData.completed_at = new Date().toISOString()
      updateData.error_message = null
    }

    // Update the job
    const { data: updatedJob, error: updateError } = await supabaseClient
      .from('jobs')
      .update(updateData)
      .eq('id', jobId)
      .select()
      .single()

    if (updateError) throw updateError

    // Log the update
    await supabaseClient
      .from('job_logs')
      .insert({
        job_id: jobId,
        level: 'INFO',
        message: `Job updated by admin ${adminId}`,
        metadata: {
          changes: updateData,
          adminUpdate: true,
          previousStatus: currentJob.status
        }
      })

    // Log admin action
    await supabaseClient
      .from('admin_logs')
      .insert({
        admin_id: adminId,
        action: 'update_job',
        resource_type: 'job',
        resource_id: jobId,
        details: {
          changes: updateData,
          brandName: currentJob.brands?.name,
          jobType: currentJob.type
        }
      })

    console.log(JSON.stringify({
      event: 'job_updated_by_admin',
      level: 'INFO',
      job_id: jobId,
      admin_id: adminId,
      changes: Object.keys(updateData),
      previous_status: currentJob.status,
      new_status: updateData.status || currentJob.status,
      timestamp: new Date().toISOString()
    }))

    return new Response(
      JSON.stringify({
        job: {
          id: updatedJob.id,
          status: updatedJob.status,
          priority: updatedJob.priority,
          updatedAt: updatedJob.updated_at
        },
        message: 'Job updated successfully',
        changes: Object.keys(updateData)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error updating job:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to update job', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function cancelJob(supabaseClient: any, adminUser: any, adminId: string, jobId: string) {
  try {
    // Get current job
    const { data: currentJob, error: fetchError } = await supabaseClient
      .from('jobs')
      .select('*, brands(name)')
      .eq('id', jobId)
      .single()

    if (fetchError || !currentJob) {
      return new Response(
        JSON.stringify({ error: 'Job not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if job can be cancelled
    if (!['queued', 'running'].includes(currentJob.status)) {
      return new Response(
        JSON.stringify({ 
          error: 'Job cannot be cancelled',
          reason: `Job status is '${currentJob.status}'. Only queued or running jobs can be cancelled.`,
          currentStatus: currentJob.status
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Cancel the job
    const { data: cancelledJob, error: updateError } = await supabaseClient
      .from('jobs')
      .update({
        status: 'failed',
        error_message: `Job cancelled by admin ${adminId}`,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId)
      .select()
      .single()

    if (updateError) throw updateError

    // Cancel dependent jobs if they exist
    const { data: dependentJobs } = await supabaseClient
      .from('job_dependencies')
      .select('job_id, jobs(id, status, type)')
      .eq('depends_on_job_id', jobId)

    const cancelledDependents = []
    if (dependentJobs && dependentJobs.length > 0) {
      for (const dep of dependentJobs) {
        if (dep.jobs.status === 'queued') {
          await supabaseClient
            .from('jobs')
            .update({
              status: 'failed',
              error_message: `Cancelled because dependency job ${jobId} was cancelled`,
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', dep.job_id)
          
          cancelledDependents.push({
            id: dep.job_id,
            type: dep.jobs.type
          })
        }
      }
    }

    // Log the cancellation
    await supabaseClient
      .from('job_logs')
      .insert({
        job_id: jobId,
        level: 'WARN',
        message: `Job cancelled by admin ${adminId}`,
        metadata: {
          adminCancellation: true,
          previousStatus: currentJob.status,
          cancelledDependents: cancelledDependents.length
        }
      })

    // Log admin action
    await supabaseClient
      .from('admin_logs')
      .insert({
        admin_id: adminId,
        action: 'cancel_job',
        resource_type: 'job',
        resource_id: jobId,
        details: {
          brandName: currentJob.brands?.name,
          jobType: currentJob.type,
          previousStatus: currentJob.status,
          dependentJobsCancelled: cancelledDependents.length
        }
      })

    console.log(JSON.stringify({
      event: 'job_cancelled_by_admin',
      level: 'WARN',
      job_id: jobId,
      admin_id: adminId,
      previous_status: currentJob.status,
      dependent_jobs_cancelled: cancelledDependents.length,
      timestamp: new Date().toISOString()
    }))

    return new Response(
      JSON.stringify({
        job: {
          id: cancelledJob.id,
          status: cancelledJob.status,
          cancelledAt: cancelledJob.completed_at
        },
        message: 'Job cancelled successfully',
        dependentJobsCancelled: cancelledDependents.length,
        cancelledDependents
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error cancelling job:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to cancel job', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function performBulkAction(supabaseClient: any, adminUser: any, adminId: string, req: Request) {
  const { action, jobIds, filters } = await req.json()

  if (!action) {
    return new Response(
      JSON.stringify({ error: 'Missing action type' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    let targetJobs = []

    // Get target jobs either by IDs or filters
    if (jobIds && jobIds.length > 0) {
      const { data: jobs, error } = await supabaseClient
        .from('jobs')
        .select('id, type, status, brand_id, brands(name)')
        .in('id', jobIds)

      if (error) throw error
      targetJobs = jobs || []
    } else if (filters) {
      // Apply filters to get jobs
      let query = supabaseClient
        .from('jobs')
        .select('id, type, status, brand_id, brands(name)')

      if (filters.status) query = query.eq('status', filters.status)
      if (filters.type) query = query.eq('type', filters.type)
      if (filters.brandId) query = query.eq('brand_id', filters.brandId)
      if (filters.olderThan) query = query.lt('created_at', filters.olderThan)

      const { data: jobs, error } = await query.limit(100) // Limit bulk operations
      if (error) throw error
      targetJobs = jobs || []
    }

    if (targetJobs.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No jobs found matching criteria' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const results = {
      action,
      totalTargeted: targetJobs.length,
      successful: 0,
      failed: 0,
      details: []
    }

    // Perform bulk action
    switch (action) {
      case 'cancel':
        for (const job of targetJobs) {
          if (['queued', 'running'].includes(job.status)) {
            try {
              await supabaseClient
                .from('jobs')
                .update({
                  status: 'failed',
                  error_message: `Bulk cancelled by admin ${adminId}`,
                  completed_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                })
                .eq('id', job.id)

              results.successful++
              results.details.push({ jobId: job.id, status: 'cancelled' })
            } catch (error) {
              results.failed++
              results.details.push({ jobId: job.id, status: 'failed', error: error.message })
            }
          } else {
            results.failed++
            results.details.push({ 
              jobId: job.id, 
              status: 'skipped', 
              reason: `Cannot cancel job with status: ${job.status}` 
            })
          }
        }
        break

      case 'retry':
        for (const job of targetJobs) {
          if (job.status === 'failed') {
            try {
              await supabaseClient
                .from('jobs')
                .update({
                  status: 'queued',
                  error_message: null,
                  started_at: null,
                  completed_at: null,
                  retry_count: 0,
                  updated_at: new Date().toISOString()
                })
                .eq('id', job.id)

              results.successful++
              results.details.push({ jobId: job.id, status: 'queued_for_retry' })
            } catch (error) {
              results.failed++
              results.details.push({ jobId: job.id, status: 'failed', error: error.message })
            }
          } else {
            results.failed++
            results.details.push({ 
              jobId: job.id, 
              status: 'skipped', 
              reason: `Cannot retry job with status: ${job.status}` 
            })
          }
        }
        break

      case 'delete':
        // Only allow deletion of completed or failed jobs
        for (const job of targetJobs) {
          if (['complete', 'failed'].includes(job.status)) {
            try {
              // Soft delete by marking as deleted
              await supabaseClient
                .from('jobs')
                .update({
                  status: 'deleted',
                  updated_at: new Date().toISOString()
                })
                .eq('id', job.id)

              results.successful++
              results.details.push({ jobId: job.id, status: 'deleted' })
            } catch (error) {
              results.failed++
              results.details.push({ jobId: job.id, status: 'failed', error: error.message })
            }
          } else {
            results.failed++
            results.details.push({ 
              jobId: job.id, 
              status: 'skipped', 
              reason: `Cannot delete job with status: ${job.status}` 
            })
          }
        }
        break

      case 'change_priority':
        const newPriority = Math.max(1, Math.min(10, filters?.newPriority || 5))
        for (const job of targetJobs) {
          if (['queued', 'running'].includes(job.status)) {
            try {
              await supabaseClient
                .from('jobs')
                .update({
                  priority: newPriority,
                  updated_at: new Date().toISOString()
                })
                .eq('id', job.id)

              results.successful++
              results.details.push({ jobId: job.id, status: 'priority_updated', newPriority })
            } catch (error) {
              results.failed++
              results.details.push({ jobId: job.id, status: 'failed', error: error.message })
            }
          } else {
            results.failed++
            results.details.push({ 
              jobId: job.id, 
              status: 'skipped', 
              reason: `Cannot change priority for job with status: ${job.status}` 
            })
          }
        }
        break

      default:
        return new Response(
          JSON.stringify({ error: `Unknown bulk action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

    // Log bulk action
    await supabaseClient
      .from('admin_logs')
      .insert({
        admin_id: adminId,
        action: `bulk_${action}`,
        resource_type: 'job',
        resource_id: null,
        details: {
          targetedJobs: targetJobs.length,
          successful: results.successful,
          failed: results.failed,
          action,
          filters: filters || null,
          jobIds: jobIds || null
        }
      })

    console.log(JSON.stringify({
      event: 'bulk_job_action',
      level: 'INFO',
      action,
      admin_id: adminId,
      targeted_jobs: targetJobs.length,
      successful: results.successful,
      failed: results.failed,
      timestamp: new Date().toISOString()
    }))

    return new Response(
      JSON.stringify({
        ...results,
        message: `Bulk ${action} completed: ${results.successful} successful, ${results.failed} failed`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error performing bulk action:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to perform bulk action', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}