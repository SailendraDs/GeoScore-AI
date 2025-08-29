import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface JobRequest {
  brandId: string
  type: 'brand_onboard' | 'crawl' | 'normalize' | 'embed' | 'sample' | 'score' | 'assemble_report'
  payload: Record<string, any>
  priority?: number
  dependsOn?: string[]
  idempotencyKey?: string
  options?: {
    retryPolicy?: 'exponential' | 'fixed' | 'none'
    maxRetries?: number
    timeout?: number
    webhook?: string
  }
}

interface JobQuery {
  brandId?: string
  type?: string
  status?: 'queued' | 'running' | 'failed' | 'complete'
  limit?: number
  offset?: number
}

interface JobUpdateRequest {
  status?: 'running' | 'failed' | 'complete'
  result?: Record<string, any>
  errorMessage?: string
  progress?: number
}

interface JobSchedule {
  jobId: string
  scheduledFor: string
  recurring?: {
    pattern: 'daily' | 'weekly' | 'monthly'
    enabled: boolean
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', // Using service role for job management
    )

    const url = new URL(req.url)
    const action = url.pathname.split('/').pop()
    const method = req.method

    // Route handlers
    if (method === 'POST' && action === 'enqueue') {
      return await enqueueJob(supabaseClient, req)
    }
    
    if (method === 'GET' && action === 'next') {
      return await getNextJob(supabaseClient, req)
    }
    
    if (method === 'PUT' && action?.startsWith('job-')) {
      const jobId = action.replace('job-', '')
      return await updateJob(supabaseClient, jobId, req)
    }
    
    if (method === 'GET' && (action === 'jobs' || !action)) {
      return await listJobs(supabaseClient, req)
    }
    
    if (method === 'POST' && action === 'schedule') {
      return await scheduleJob(supabaseClient, req)
    }
    
    if (method === 'GET' && action === 'stats') {
      return await getQueueStats(supabaseClient)
    }
    
    if (method === 'POST' && action === 'retry') {
      return await retryJob(supabaseClient, req)
    }
    
    if (method === 'DELETE' && action?.startsWith('job-')) {
      const jobId = action.replace('job-', '')
      return await cancelJob(supabaseClient, jobId)
    }

    return new Response(
      JSON.stringify({ error: 'Invalid endpoint' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Job queue manager error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function enqueueJob(supabaseClient: any, req: Request) {
  const { brandId, type, payload, priority = 5, dependsOn = [], idempotencyKey, options = {} }: JobRequest = await req.json()

  if (!brandId || !type) {
    return new Response(
      JSON.stringify({ error: 'Missing brandId or type' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Validate brand exists
  const { data: brand, error: brandError } = await supabaseClient
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .single()

  if (brandError || !brand) {
    return new Response(
      JSON.stringify({ error: 'Brand not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Create job with dependencies using the database function
    const { data: jobId, error: createError } = await supabaseClient
      .rpc('create_job_with_deps', {
        p_brand_id: brandId,
        p_type: type,
        p_payload: payload,
        p_depends_on: dependsOn.length > 0 ? dependsOn : null,
        p_priority: priority,
        p_idempotency_key: idempotencyKey
      })

    if (createError) {
      if (createError.code === '23505') { // Unique constraint violation
        return new Response(
          JSON.stringify({ error: 'Job with this idempotency key already exists' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      throw createError
    }

    // Log job creation
    await logJobEvent(supabaseClient, jobId, 'INFO', 'Job enqueued', {
      type,
      brandId,
      priority,
      dependencies: dependsOn,
      options
    })

    // Emit metrics
    await emitMetric(supabaseClient, 'jobs_enqueued_total', 1, { type })

    // Get complete job record to return
    const { data: job } = await supabaseClient
      .from('jobs')
      .select(`
        id, brand_id, type, status, payload, priority, 
        max_retries, retry_count, created_at,
        job_dependencies (depends_on_job_id)
      `)
      .eq('id', jobId)
      .single()

    return new Response(
      JSON.stringify({
        jobId,
        job,
        message: 'Job enqueued successfully'
      }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error enqueuing job:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to enqueue job', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function getNextJob(supabaseClient: any, req: Request) {
  const url = new URL(req.url)
  const jobTypesParam = url.searchParams.get('types')
  const workerIdParam = url.searchParams.get('workerId')
  
  const jobTypes = jobTypesParam ? jobTypesParam.split(',') : null

  try {
    // Get next available job using database function
    const { data: job, error } = await supabaseClient
      .rpc('get_next_job', {
        job_types: jobTypes
      })

    if (error) throw error

    if (!job) {
      return new Response(
        JSON.stringify({ job: null, message: 'No jobs available' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Claim the job by setting it to running
    const { error: updateError } = await supabaseClient
      .from('jobs')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', job.id)

    if (updateError) {
      console.error('Failed to claim job:', updateError)
      return new Response(
        JSON.stringify({ error: 'Failed to claim job' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Log job start
    await logJobEvent(supabaseClient, job.id, 'INFO', 'Job started', {
      workerId: workerIdParam,
      type: job.type
    })

    // Emit metrics
    await emitMetric(supabaseClient, 'jobs_started_total', 1, { type: job.type })

    return new Response(
      JSON.stringify({
        job: {
          id: job.id,
          brandId: job.brand_id,
          type: job.type,
          payload: job.payload,
          priority: job.priority,
          retryCount: job.retry_count,
          maxRetries: job.max_retries,
          createdAt: job.created_at
        },
        claimedAt: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error getting next job:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to get next job', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function updateJob(supabaseClient: any, jobId: string, req: Request) {
  const { status, result, errorMessage, progress }: JobUpdateRequest = await req.json()

  if (!status) {
    return new Response(
      JSON.stringify({ error: 'Missing status' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const updateData: any = {
      status,
      updated_at: new Date().toISOString()
    }

    if (status === 'complete') {
      updateData.completed_at = new Date().toISOString()
      updateData.result = result || {}
    }

    if (status === 'failed') {
      updateData.error_message = errorMessage
      updateData.result = result || {}
    }

    const { error } = await supabaseClient
      .from('jobs')
      .update(updateData)
      .eq('id', jobId)

    if (error) throw error

    // Log job update
    const logLevel = status === 'failed' ? 'ERROR' : 'INFO'
    const message = status === 'complete' ? 'Job completed successfully' :
                   status === 'failed' ? 'Job failed' : 'Job status updated'
    
    await logJobEvent(supabaseClient, jobId, logLevel, message, {
      status,
      progress,
      ...(errorMessage && { error: errorMessage })
    })

    // Emit metrics
    await emitMetric(supabaseClient, `jobs_${status}_total`, 1, { 
      job_id: jobId 
    })

    // If job completed successfully, check for dependent jobs
    if (status === 'complete') {
      await checkDependentJobs(supabaseClient, jobId)
    }

    // Handle retry logic for failed jobs
    if (status === 'failed') {
      await handleFailedJob(supabaseClient, jobId)
    }

    return new Response(
      JSON.stringify({
        jobId,
        status,
        message: `Job ${status} successfully`,
        updatedAt: updateData.updated_at
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

async function listJobs(supabaseClient: any, req: Request) {
  const url = new URL(req.url)
  const query: JobQuery = {
    brandId: url.searchParams.get('brandId') || undefined,
    type: url.searchParams.get('type') || undefined,
    status: url.searchParams.get('status') as any || undefined,
    limit: parseInt(url.searchParams.get('limit') || '50'),
    offset: parseInt(url.searchParams.get('offset') || '0')
  }

  try {
    let queryBuilder = supabaseClient
      .from('jobs')
      .select(`
        id, brand_id, type, status, priority, payload, result,
        max_retries, retry_count, error_message,
        created_at, started_at, completed_at,
        job_dependencies (depends_on_job_id),
        brands (domain, name)
      `, { count: 'exact' })

    if (query.brandId) {
      queryBuilder = queryBuilder.eq('brand_id', query.brandId)
    }
    
    if (query.type) {
      queryBuilder = queryBuilder.eq('type', query.type)
    }
    
    if (query.status) {
      queryBuilder = queryBuilder.eq('status', query.status)
    }

    const { data: jobs, error, count } = await queryBuilder
      .order('created_at', { ascending: false })
      .range(query.offset!, query.offset! + query.limit! - 1)

    if (error) throw error

    return new Response(
      JSON.stringify({
        jobs,
        pagination: {
          total: count,
          limit: query.limit,
          offset: query.offset,
          hasMore: (query.offset! + query.limit!) < (count || 0)
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error listing jobs:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to list jobs', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function getQueueStats(supabaseClient: any) {
  try {
    // Get job counts by status and type
    const { data: statusCounts } = await supabaseClient
      .from('jobs')
      .select('status, type')

    const stats = {
      total: statusCounts?.length || 0,
      byStatus: {},
      byType: {},
      queueHealth: 'healthy'
    }

    // Count by status
    const statusGroups = statusCounts?.reduce((acc: any, job: any) => {
      acc[job.status] = (acc[job.status] || 0) + 1
      return acc
    }, {}) || {}

    // Count by type
    const typeGroups = statusCounts?.reduce((acc: any, job: any) => {
      acc[job.type] = (acc[job.type] || 0) + 1
      return acc
    }, {}) || {}

    stats.byStatus = statusGroups
    stats.byType = typeGroups

    // Determine queue health
    const queuedJobs = statusGroups.queued || 0
    const runningJobs = statusGroups.running || 0
    const failedJobs = statusGroups.failed || 0

    if (failedJobs > queuedJobs * 0.2) {
      stats.queueHealth = 'unhealthy'
    } else if (queuedJobs > 100) {
      stats.queueHealth = 'backlogged'
    }

    return new Response(
      JSON.stringify({
        stats,
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error getting queue stats:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to get queue stats' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function scheduleJob(supabaseClient: any, req: Request) {
  const { jobId, scheduledFor, recurring }: JobSchedule = await req.json()

  // For now, return a placeholder response
  // In production, this would integrate with a job scheduler like Temporal or Bull
  return new Response(
    JSON.stringify({
      message: 'Job scheduling not implemented yet',
      jobId,
      scheduledFor
    }),
    { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function retryJob(supabaseClient: any, req: Request) {
  const { jobId, reason } = await req.json()

  if (!jobId) {
    return new Response(
      JSON.stringify({ error: 'Missing jobId' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Get the original job
    const { data: originalJob, error: fetchError } = await supabaseClient
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .single()

    if (fetchError || !originalJob) {
      return new Response(
        JSON.stringify({ error: 'Job not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if job can be retried
    if (originalJob.retry_count >= originalJob.max_retries) {
      return new Response(
        JSON.stringify({ error: 'Job has exceeded maximum retry attempts' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create new job as retry
    const { data: newJobId } = await supabaseClient
      .rpc('create_job_with_deps', {
        p_brand_id: originalJob.brand_id,
        p_type: originalJob.type,
        p_payload: originalJob.payload,
        p_priority: originalJob.priority + 1, // Higher priority for retries
      })

    // Update the new job to reference the original
    await supabaseClient
      .from('jobs')
      .update({
        retries_from: originalJob.id,
        retry_count: originalJob.retry_count + 1
      })
      .eq('id', newJobId)

    await logJobEvent(supabaseClient, newJobId, 'INFO', 'Job retry created', {
      originalJobId: jobId,
      reason,
      retryCount: originalJob.retry_count + 1
    })

    return new Response(
      JSON.stringify({
        newJobId,
        originalJobId: jobId,
        retryCount: originalJob.retry_count + 1,
        message: 'Retry job created successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error retrying job:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to retry job' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function cancelJob(supabaseClient: any, jobId: string) {
  try {
    const { error } = await supabaseClient
      .from('jobs')
      .update({
        status: 'failed',
        error_message: 'Job cancelled by user',
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId)
      .eq('status', 'queued') // Only cancel queued jobs

    if (error) throw error

    await logJobEvent(supabaseClient, jobId, 'INFO', 'Job cancelled', {})

    return new Response(
      JSON.stringify({
        jobId,
        message: 'Job cancelled successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to cancel job' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Helper functions
async function logJobEvent(supabaseClient: any, jobId: string, level: string, message: string, metadata: any) {
  try {
    await supabaseClient
      .rpc('log_job_event', {
        p_job_id: jobId,
        p_level: level,
        p_message: message,
        p_metadata: metadata
      })
  } catch (error) {
    console.warn('Failed to log job event:', error)
  }
}

async function emitMetric(supabaseClient: any, name: string, value: number, labels: any) {
  try {
    // In production, this would emit to a metrics system like Prometheus
    console.log('METRIC:', { name, value, labels, timestamp: new Date().toISOString() })
  } catch (error) {
    console.warn('Failed to emit metric:', error)
  }
}

async function checkDependentJobs(supabaseClient: any, completedJobId: string) {
  try {
    // Find jobs that depend on this completed job
    const { data: dependentJobIds } = await supabaseClient
      .from('job_dependencies')
      .select('job_id')
      .eq('depends_on_job_id', completedJobId)

    // Check if any dependent jobs are now ready to run
    for (const { job_id } of dependentJobIds || []) {
      const { data: job } = await supabaseClient
        .from('jobs')
        .select('id')
        .eq('id', job_id)
        .eq('status', 'queued')
        .single()

      if (job) {
        // Check if all dependencies are complete
        const { data: allDependencies } = await supabaseClient
          .from('job_dependencies')
          .select('depends_on_job_id, jobs!job_dependencies_depends_on_job_id_fkey(status)')
          .eq('job_id', job_id)

        const allComplete = allDependencies?.every((dep: any) => dep.jobs.status === 'complete')

        if (allComplete) {
          await logJobEvent(supabaseClient, job_id, 'INFO', 'Job dependencies satisfied', {
            triggeredBy: completedJobId
          })
        }
      }
    }
  } catch (error) {
    console.warn('Failed to check dependent jobs:', error)
  }
}

async function handleFailedJob(supabaseClient: any, jobId: string) {
  try {
    const { data: job } = await supabaseClient
      .from('jobs')
      .select('retry_count, max_retries, type')
      .eq('id', jobId)
      .single()

    if (job && job.retry_count < job.max_retries) {
      // Auto-retry logic could be implemented here
      await logJobEvent(supabaseClient, jobId, 'WARN', 'Job failed but retries available', {
        retryCount: job.retry_count,
        maxRetries: job.max_retries
      })
    } else {
      await logJobEvent(supabaseClient, jobId, 'ERROR', 'Job failed permanently', {
        retryCount: job?.retry_count,
        maxRetries: job?.max_retries
      })
    }
  } catch (error) {
    console.warn('Failed to handle failed job:', error)
  }
}