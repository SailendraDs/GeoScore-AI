import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface WorkerConfiguration {
  workerType: string
  endpoint: string
  maxConcurrency: number
  timeout: number
  retryPolicy: {
    maxRetries: number
    backoffMultiplier: number
    maxBackoffDelay: number
  }
  healthCheck: {
    enabled: boolean
    intervalMs: number
    timeoutMs: number
  }
}

interface JobRunnerConfig {
  workerId: string
  supportedJobTypes: string[]
  pollingInterval: number
  maxJobsPerBatch: number
  shutdownGracePeriod: number
}

interface JobExecution {
  jobId: string
  workerId: string
  status: 'claimed' | 'running' | 'completed' | 'failed' | 'retrying'
  startTime: string
  endTime?: string
  attempts: number
  lastError?: string
  executionLog: Array<{
    timestamp: string
    level: 'INFO' | 'WARN' | 'ERROR'
    message: string
    metadata?: Record<string, any>
  }>
}

const WORKER_CONFIGURATIONS: Record<string, WorkerConfiguration> = {
  'brand_onboard': {
    workerType: 'brand_onboard',
    endpoint: '/functions/v1/worker-brand-onboard',
    maxConcurrency: 2,
    timeout: 300000, // 5 minutes
    retryPolicy: {
      maxRetries: 3,
      backoffMultiplier: 2,
      maxBackoffDelay: 60000
    },
    healthCheck: {
      enabled: true,
      intervalMs: 30000,
      timeoutMs: 5000
    }
  },
  'normalize': {
    workerType: 'normalize',
    endpoint: '/functions/v1/worker-normalize',
    maxConcurrency: 3,
    timeout: 180000, // 3 minutes
    retryPolicy: {
      maxRetries: 3,
      backoffMultiplier: 2,
      maxBackoffDelay: 60000
    },
    healthCheck: {
      enabled: true,
      intervalMs: 30000,
      timeoutMs: 5000
    }
  },
  'embed': {
    workerType: 'embed',
    endpoint: '/functions/v1/worker-embed',
    maxConcurrency: 2,
    timeout: 600000, // 10 minutes
    retryPolicy: {
      maxRetries: 2,
      backoffMultiplier: 2,
      maxBackoffDelay: 120000
    },
    healthCheck: {
      enabled: true,
      intervalMs: 60000,
      timeoutMs: 10000
    }
  },
  'sample': {
    workerType: 'sample',
    endpoint: '/functions/v1/worker-sample',
    maxConcurrency: 1, // Lower concurrency for expensive LLM operations
    timeout: 1800000, // 30 minutes
    retryPolicy: {
      maxRetries: 2,
      backoffMultiplier: 2,
      maxBackoffDelay: 300000
    },
    healthCheck: {
      enabled: true,
      intervalMs: 60000,
      timeoutMs: 15000
    }
  },
  'score': {
    workerType: 'score',
    endpoint: '/functions/v1/worker-score',
    maxConcurrency: 3,
    timeout: 120000, // 2 minutes
    retryPolicy: {
      maxRetries: 3,
      backoffMultiplier: 2,
      maxBackoffDelay: 60000
    },
    healthCheck: {
      enabled: true,
      intervalMs: 30000,
      timeoutMs: 5000
    }
  },
  'assemble_report': {
    workerType: 'assemble_report',
    endpoint: '/functions/v1/worker-assemble-report',
    maxConcurrency: 2,
    timeout: 300000, // 5 minutes
    retryPolicy: {
      maxRetries: 2,
      backoffMultiplier: 2,
      maxBackoffDelay: 120000
    },
    healthCheck: {
      enabled: true,
      intervalMs: 30000,
      timeoutMs: 10000
    }
  }
}

let isRunning = false
let currentExecutions: Map<string, JobExecution> = new Map()
let shutdownSignal = false

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const url = new URL(req.url)
    const action = url.pathname.split('/').pop()
    const method = req.method

    if (method === 'POST' && action === 'start') {
      return await startJobRunner(supabaseClient, req)
    }
    
    if (method === 'POST' && action === 'stop') {
      return await stopJobRunner(supabaseClient)
    }
    
    if (method === 'GET' && action === 'status') {
      return await getRunnerStatus(supabaseClient)
    }
    
    if (method === 'GET' && action === 'health') {
      return await healthCheck(supabaseClient)
    }
    
    if (method === 'POST' && action === 'execute') {
      return await executeJob(supabaseClient, req)
    }
    
    if (method === 'GET' && action === 'executions') {
      return await getExecutions(supabaseClient)
    }

    return new Response(
      JSON.stringify({ error: 'Invalid endpoint' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Job runner error:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function startJobRunner(supabaseClient: any, req: Request) {
  if (isRunning) {
    return new Response(
      JSON.stringify({ message: 'Job runner is already running', workerId: getWorkerId() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const config: JobRunnerConfig = {
    workerId: getWorkerId(),
    supportedJobTypes: Object.keys(WORKER_CONFIGURATIONS),
    pollingInterval: parseInt(Deno.env.get('JOB_POLLING_INTERVAL') || '5000'),
    maxJobsPerBatch: parseInt(Deno.env.get('MAX_JOBS_PER_BATCH') || '5'),
    shutdownGracePeriod: parseInt(Deno.env.get('SHUTDOWN_GRACE_PERIOD') || '30000')
  }

  console.log(`Starting job runner with config:`, config)

  isRunning = true
  shutdownSignal = false
  currentExecutions.clear()

  // Start the main processing loop
  processJobsLoop(supabaseClient, config).catch(error => {
    console.error('Job processing loop failed:', error)
    isRunning = false
  })

  // Start health check monitors for workers
  startHealthChecks(supabaseClient)

  return new Response(
    JSON.stringify({
      message: 'Job runner started successfully',
      config,
      startedAt: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function stopJobRunner(supabaseClient: any) {
  if (!isRunning) {
    return new Response(
      JSON.stringify({ message: 'Job runner is not running' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  console.log('Initiating graceful shutdown...')
  shutdownSignal = true

  // Wait for current executions to complete or timeout
  const shutdownStart = Date.now()
  const gracePeriod = 30000 // 30 seconds

  while (currentExecutions.size > 0 && (Date.now() - shutdownStart) < gracePeriod) {
    console.log(`Waiting for ${currentExecutions.size} jobs to complete...`)
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  // Force stop remaining executions
  if (currentExecutions.size > 0) {
    console.log(`Force stopping ${currentExecutions.size} remaining executions`)
    for (const [jobId, execution] of currentExecutions.entries()) {
      execution.status = 'failed'
      execution.endTime = new Date().toISOString()
      execution.lastError = 'Job runner shutdown'
      
      // Update job status in database
      await updateJobStatus(supabaseClient, jobId, 'failed', {
        error: 'Job runner shutdown',
        workerId: execution.workerId
      })
    }
    currentExecutions.clear()
  }

  isRunning = false
  console.log('Job runner stopped')

  return new Response(
    JSON.stringify({
      message: 'Job runner stopped successfully',
      stoppedAt: new Date().toISOString(),
      gracefulShutdown: currentExecutions.size === 0
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getRunnerStatus(supabaseClient: any) {
  const queueStats = await getQueueStatistics(supabaseClient)
  
  return new Response(
    JSON.stringify({
      running: isRunning,
      workerId: getWorkerId(),
      currentExecutions: currentExecutions.size,
      supportedJobTypes: Object.keys(WORKER_CONFIGURATIONS),
      queueStats,
      runningJobs: Array.from(currentExecutions.values()).map(exec => ({
        jobId: exec.jobId,
        status: exec.status,
        startTime: exec.startTime,
        attempts: exec.attempts
      })),
      timestamp: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function healthCheck(supabaseClient: any) {
  const checks = {
    runner: isRunning,
    database: false,
    workers: {} as Record<string, boolean>
  }

  // Database health check
  try {
    const { error } = await supabaseClient.from('jobs').select('id').limit(1)
    checks.database = !error
  } catch (error) {
    checks.database = false
  }

  // Worker health checks
  for (const [jobType, config] of Object.entries(WORKER_CONFIGURATIONS)) {
    if (config.healthCheck.enabled) {
      checks.workers[jobType] = await checkWorkerHealth(config)
    }
  }

  const allHealthy = checks.runner && checks.database && Object.values(checks.workers).every(h => h)

  return new Response(
    JSON.stringify({
      healthy: allHealthy,
      checks,
      timestamp: new Date().toISOString()
    }),
    { 
      status: allHealthy ? 200 : 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    }
  )
}

async function executeJob(supabaseClient: any, req: Request) {
  const { jobId, jobType, brandId, payload } = await req.json()

  if (!jobId || !jobType) {
    return new Response(
      JSON.stringify({ error: 'Missing jobId or jobType' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const result = await executeJobWithRetry(supabaseClient, {
      id: jobId,
      type: jobType,
      brand_id: brandId,
      payload
    })

    return new Response(
      JSON.stringify({
        jobId,
        result,
        message: 'Job executed successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({
        jobId,
        error: error.message,
        message: 'Job execution failed'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function getExecutions(supabaseClient: any) {
  return new Response(
    JSON.stringify({
      executions: Array.from(currentExecutions.values()),
      totalExecutions: currentExecutions.size
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// Helper functions
async function processJobsLoop(supabaseClient: any, config: JobRunnerConfig) {
  console.log('Starting job processing loop')

  while (!shutdownSignal) {
    try {
      // Check current capacity
      const availableSlots = calculateAvailableSlots()
      
      if (availableSlots > 0) {
        // Get next batch of jobs
        const jobs = await getNextJobBatch(supabaseClient, config.supportedJobTypes, Math.min(availableSlots, config.maxJobsPerBatch))
        
        if (jobs.length > 0) {
          console.log(`Processing ${jobs.length} jobs`)
          
          // Execute jobs concurrently
          const execPromises = jobs.map(job => executeJobWithRetry(supabaseClient, job))
          
          // Don't await all - let them run in background
          Promise.allSettled(execPromises).then(results => {
            const successful = results.filter(r => r.status === 'fulfilled').length
            const failed = results.filter(r => r.status === 'rejected').length
            console.log(`Batch completed: ${successful} successful, ${failed} failed`)
          })
        }
      }

      // Clean up completed executions
      cleanupCompletedExecutions()

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, config.pollingInterval))

    } catch (error) {
      console.error('Error in job processing loop:', error)
      await new Promise(resolve => setTimeout(resolve, 5000)) // Wait 5s on error
    }
  }

  console.log('Job processing loop stopped')
}

function calculateAvailableSlots(): number {
  const totalConcurrency = Object.values(WORKER_CONFIGURATIONS).reduce((sum, config) => sum + config.maxConcurrency, 0)
  return totalConcurrency - currentExecutions.size
}

async function getNextJobBatch(supabaseClient: any, supportedTypes: string[], batchSize: number) {
  try {
    const { data: jobs, error } = await supabaseClient
      .from('jobs')
      .select('id, brand_id, type, payload, priority, retry_count, max_retries')
      .eq('status', 'queued')
      .in('type', supportedTypes)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(batchSize)

    if (error) {
      console.error('Failed to fetch jobs:', error)
      return []
    }

    return jobs || []
  } catch (error) {
    console.error('Error getting job batch:', error)
    return []
  }
}

async function executeJobWithRetry(supabaseClient: any, job: any): Promise<any> {
  const jobId = job.id
  const jobType = job.type
  const brandId = job.brand_id
  const payload = job.payload

  const workerConfig = WORKER_CONFIGURATIONS[jobType]
  if (!workerConfig) {
    throw new Error(`No worker configuration found for job type: ${jobType}`)
  }

  const execution: JobExecution = {
    jobId,
    workerId: getWorkerId(),
    status: 'claimed',
    startTime: new Date().toISOString(),
    attempts: (job.retry_count || 0) + 1,
    executionLog: []
  }

  currentExecutions.set(jobId, execution)
  logExecution(execution, 'INFO', 'Job execution started')

  let attempt = 0
  const maxAttempts = workerConfig.retryPolicy.maxRetries + 1

  while (attempt < maxAttempts) {
    try {
      execution.status = 'running'
      execution.attempts = attempt + 1
      
      logExecution(execution, 'INFO', `Attempt ${attempt + 1}/${maxAttempts}`)

      // Call the appropriate worker
      const result = await callWorker(workerConfig, {
        jobId,
        brandId,
        payload
      })

      execution.status = 'completed'
      execution.endTime = new Date().toISOString()
      logExecution(execution, 'INFO', 'Job completed successfully')

      currentExecutions.delete(jobId)
      return result

    } catch (error) {
      attempt++
      execution.lastError = error.message
      logExecution(execution, 'ERROR', `Attempt ${attempt} failed: ${error.message}`)

      if (attempt >= maxAttempts) {
        // Final failure
        execution.status = 'failed'
        execution.endTime = new Date().toISOString()
        logExecution(execution, 'ERROR', 'Job failed permanently after all retries')

        await updateJobStatus(supabaseClient, jobId, 'failed', {
          error: error.message,
          attempts: attempt,
          workerId: execution.workerId
        })

        currentExecutions.delete(jobId)
        throw error
      }

      // Calculate backoff delay
      const baseDelay = 1000 * Math.pow(workerConfig.retryPolicy.backoffMultiplier, attempt - 1)
      const delay = Math.min(baseDelay, workerConfig.retryPolicy.maxBackoffDelay)
      
      execution.status = 'retrying'
      logExecution(execution, 'WARN', `Retrying in ${delay}ms`)

      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}

async function callWorker(config: WorkerConfiguration, request: any): Promise<any> {
  const baseUrl = Deno.env.get('SUPABASE_URL')?.replace('/rest/v1', '') || 'http://localhost:54321'
  const workerUrl = `${baseUrl}${config.endpoint}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), config.timeout)

  try {
    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify(request),
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Worker ${config.workerType} returned ${response.status}: ${errorText}`)
    }

    const result = await response.json()
    return result

  } catch (error) {
    clearTimeout(timeoutId)
    
    if (error.name === 'AbortError') {
      throw new Error(`Worker ${config.workerType} timed out after ${config.timeout}ms`)
    }
    
    throw new Error(`Worker ${config.workerType} error: ${error.message}`)
  }
}

async function checkWorkerHealth(config: WorkerConfiguration): Promise<boolean> {
  try {
    const baseUrl = Deno.env.get('SUPABASE_URL')?.replace('/rest/v1', '') || 'http://localhost:54321'
    const healthUrl = `${baseUrl}${config.endpoint}?health=true`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), config.healthCheck.timeoutMs)

    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
      },
      signal: controller.signal
    })

    clearTimeout(timeoutId)
    return response.ok

  } catch (error) {
    console.warn(`Health check failed for worker ${config.workerType}:`, error.message)
    return false
  }
}

function startHealthChecks(supabaseClient: any) {
  for (const [jobType, config] of Object.entries(WORKER_CONFIGURATIONS)) {
    if (config.healthCheck.enabled) {
      setInterval(async () => {
        if (!isRunning) return

        const healthy = await checkWorkerHealth(config)
        
        if (!healthy) {
          console.warn(`Worker ${jobType} failed health check`)
          // Could implement alerting here
        }
      }, config.healthCheck.intervalMs)
    }
  }
}

function logExecution(execution: JobExecution, level: 'INFO' | 'WARN' | 'ERROR', message: string, metadata?: Record<string, any>) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    metadata
  }
  
  execution.executionLog.push(logEntry)
  console.log(`[${execution.jobId}] ${level}: ${message}`, metadata || '')
}

function cleanupCompletedExecutions() {
  const now = Date.now()
  const maxAge = 300000 // 5 minutes

  for (const [jobId, execution] of currentExecutions.entries()) {
    if (execution.status === 'completed' || execution.status === 'failed') {
      const endTime = execution.endTime ? new Date(execution.endTime).getTime() : now
      
      if (now - endTime > maxAge) {
        currentExecutions.delete(jobId)
      }
    }
  }
}

async function getQueueStatistics(supabaseClient: any) {
  try {
    const { data: stats } = await supabaseClient
      .from('jobs')
      .select('status, type')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours

    const queuedByType: Record<string, number> = {}
    const runningByType: Record<string, number> = {}
    let totalQueued = 0
    let totalRunning = 0
    let totalCompleted = 0
    let totalFailed = 0

    for (const job of stats || []) {
      switch (job.status) {
        case 'queued':
          totalQueued++
          queuedByType[job.type] = (queuedByType[job.type] || 0) + 1
          break
        case 'running':
          totalRunning++
          runningByType[job.type] = (runningByType[job.type] || 0) + 1
          break
        case 'complete':
          totalCompleted++
          break
        case 'failed':
          totalFailed++
          break
      }
    }

    return {
      totalQueued,
      totalRunning,
      totalCompleted,
      totalFailed,
      queuedByType,
      runningByType,
      lastUpdated: new Date().toISOString()
    }
  } catch (error) {
    console.error('Failed to get queue statistics:', error)
    return {
      totalQueued: 0,
      totalRunning: 0,
      totalCompleted: 0,
      totalFailed: 0,
      queuedByType: {},
      runningByType: {},
      lastUpdated: new Date().toISOString()
    }
  }
}

async function updateJobStatus(supabaseClient: any, jobId: string, status: string, result: any) {
  try {
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
      // Increment retry count
      updateData.retry_count = supabaseClient.from('jobs').select('retry_count').eq('id', jobId).single().then((data: any) => (data?.retry_count || 0) + 1)
    }

    await supabaseClient
      .from('jobs')
      .update(updateData)
      .eq('id', jobId)

  } catch (error) {
    console.error('Failed to update job status:', error)
  }
}

function getWorkerId(): string {
  return `job-runner-${Deno.env.get('DENO_DEPLOYMENT_ID')?.substring(0, 8) || Math.random().toString(36).substring(2, 10)}`
}