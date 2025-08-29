import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CrawlResult {
  url: string
  statusCode: number
  contentType: string
  content: string
  contentHash: string
  fetchTime: string
  title?: string
  metaDescription?: string
  canonicalUrl?: string
  error?: string
}

interface OnboardJob {
  id: string
  brandId: string
  payload: {
    seedUrls: string[]
    maxPages?: number
    respectRobots?: boolean
    crawlDelay?: number
    userAgent?: string
  }
}

interface OnboardResult {
  brandId: string
  crawledPages: number
  rawPageIds: string[]
  sitemapFound: boolean
  robotsAnalysis: {
    allowed: boolean
    crawlDelay: number
    restrictions: string[]
  }
  nextJobPayload: {
    type: 'normalize'
    rawPageIds: string[]
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
      return await processBrandOnboardJob(supabaseClient, req)
    }

    if (method === 'GET') {
      return await getJobStatus(supabaseClient, req)
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Worker brand onboard error:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message,
        stack: error.stack 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function processBrandOnboardJob(supabaseClient: any, req: Request) {
  const { jobId, brandId, payload }: { jobId: string, brandId: string, payload: OnboardJob['payload'] } = await req.json()

  if (!jobId || !brandId) {
    return new Response(
      JSON.stringify({ error: 'Missing jobId or brandId' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  console.log(`Starting brand onboard job ${jobId} for brand ${brandId}`)

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

    const seedUrls = payload.seedUrls || [`https://${brand.domain}`, `https://${brand.domain}/sitemap.xml`]
    const maxPages = payload.maxPages || 50
    const userAgent = payload.userAgent || 'GeoScore-AI-Bot/1.0 (+https://geoscore.ai/bot)'

    console.log(`Crawling ${seedUrls.length} seed URLs for ${brand.domain}`)

    // Step 1: Check robots.txt
    const robotsAnalysis = await analyzeRobots(brand.domain, userAgent)
    
    if (!robotsAnalysis.allowed && payload.respectRobots !== false) {
      const result = {
        error: 'Crawling blocked by robots.txt',
        robotsAnalysis,
        crawledPages: 0
      }
      await updateJobStatus(supabaseClient, jobId, 'failed', result)
      return new Response(
        JSON.stringify({ jobId, status: 'failed', result }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Step 2: Discover URLs from sitemap and homepage
    const discoveredUrls = await discoverUrls(seedUrls, brand.domain, maxPages)
    console.log(`Discovered ${discoveredUrls.length} URLs to crawl`)

    // Step 3: Crawl discovered URLs
    const crawlResults: CrawlResult[] = []
    const batchSize = 5 // Parallel crawl batch size
    
    for (let i = 0; i < discoveredUrls.length; i += batchSize) {
      const batch = discoveredUrls.slice(i, i + batchSize)
      const batchResults = await Promise.all(
        batch.map(url => crawlPage(url, userAgent, robotsAnalysis.crawlDelay))
      )
      crawlResults.push(...batchResults)
      
      // Respect crawl delay between batches
      if (robotsAnalysis.crawlDelay > 0 && i + batchSize < discoveredUrls.length) {
        await new Promise(resolve => setTimeout(resolve, robotsAnalysis.crawlDelay * 1000))
      }
    }

    console.log(`Crawled ${crawlResults.length} pages`)

    // Step 4: Store raw pages and upload content to S3
    const rawPageIds: string[] = []
    const s3Results = await Promise.all(
      crawlResults.map(async (result) => {
        if (result.statusCode === 200 && result.content) {
          try {
            // Upload to S3
            const s3Key = `snapshots/${brandId}/${new Date().toISOString().split('T')[0]}/${result.contentHash}.html`
            const s3Url = await uploadToS3(s3Key, result.content, result.contentType)

            // Store raw page record
            const { data: rawPage, error } = await supabaseClient
              .from('raw_pages')
              .insert({
                brand_id: brandId,
                url: result.url,
                canonical_url: result.canonicalUrl || result.url,
                status_code: result.statusCode,
                content_type: result.contentType,
                content_hash: result.contentHash,
                title: result.title,
                meta_description: result.metaDescription,
                html_s3_path: s3Url,
                fetch_time: result.fetchTime,
                content_length: result.content.length
              })
              .select('id')
              .single()

            if (!error && rawPage) {
              rawPageIds.push(rawPage.id)
              console.log(`Stored raw page ${rawPage.id} for URL: ${result.url}`)
            }

            return { success: true, url: result.url, rawPageId: rawPage?.id }
          } catch (error) {
            console.error(`Failed to store page ${result.url}:`, error)
            return { success: false, url: result.url, error: error.message }
          }
        } else {
          console.warn(`Skipping page ${result.url}: status ${result.statusCode}`)
          return { success: false, url: result.url, reason: 'Invalid response' }
        }
      })
    )

    const successfulPages = s3Results.filter(r => r.success).length
    console.log(`Successfully stored ${successfulPages} pages out of ${crawlResults.length}`)

    // Step 5: Create next job (normalize)
    const nextJobPayload = {
      rawPageIds,
      brandId,
      source: 'brand_onboard'
    }

    const { data: nextJobId } = await supabaseClient
      .rpc('create_job_with_deps', {
        p_brand_id: brandId,
        p_type: 'normalize',
        p_payload: nextJobPayload,
        p_depends_on: [jobId],
        p_priority: 4
      })

    const result: OnboardResult = {
      brandId,
      crawledPages: successfulPages,
      rawPageIds,
      sitemapFound: discoveredUrls.some(url => url.includes('sitemap')),
      robotsAnalysis,
      nextJobPayload: {
        type: 'normalize',
        rawPageIds
      }
    }

    // Complete the job
    await updateJobStatus(supabaseClient, jobId, 'complete', {
      ...result,
      nextJobId,
      completedAt: new Date().toISOString(),
      storageSummary: {
        totalPages: crawlResults.length,
        successfullyStored: successfulPages,
        failed: crawlResults.length - successfulPages
      }
    })

    console.log(`Brand onboard job ${jobId} completed successfully`)

    return new Response(
      JSON.stringify({
        jobId,
        status: 'complete',
        result,
        nextJobId,
        message: `Successfully onboarded brand with ${successfulPages} pages`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error(`Brand onboard job ${jobId} failed:`, error)
    
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
        message: 'Brand onboard job failed'
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
async function analyzeRobots(domain: string, userAgent: string) {
  try {
    const robotsUrl = `https://${domain}/robots.txt`
    const response = await fetch(robotsUrl, {
      headers: { 'User-Agent': userAgent },
      timeout: 10000
    })

    if (!response.ok) {
      // No robots.txt means crawling is allowed
      return {
        allowed: true,
        crawlDelay: 0,
        restrictions: []
      }
    }

    const robotsText = await response.text()
    const lines = robotsText.split('\n').map(line => line.trim())
    
    let isRelevantSection = false
    let crawlDelay = 0
    const restrictions: string[] = []
    let allowed = true

    for (const line of lines) {
      if (line.startsWith('User-agent:')) {
        const agent = line.split(':')[1].trim()
        isRelevantSection = agent === '*' || agent.toLowerCase().includes('geoscore') || agent.toLowerCase().includes('bot')
      } else if (isRelevantSection) {
        if (line.startsWith('Disallow:')) {
          const path = line.split(':')[1].trim()
          if (path === '/') {
            allowed = false
          } else {
            restrictions.push(path)
          }
        } else if (line.startsWith('Crawl-delay:')) {
          crawlDelay = parseInt(line.split(':')[1].trim()) || 0
        }
      }
    }

    return {
      allowed,
      crawlDelay,
      restrictions
    }
  } catch (error) {
    console.warn(`Failed to analyze robots.txt for ${domain}:`, error)
    // Default to allowing crawling if robots.txt can't be fetched
    return {
      allowed: true,
      crawlDelay: 1, // Be conservative
      restrictions: []
    }
  }
}

async function discoverUrls(seedUrls: string[], domain: string, maxPages: number): Promise<string[]> {
  const discovered = new Set<string>()
  const processed = new Set<string>()

  for (const seedUrl of seedUrls) {
    if (processed.has(seedUrl)) continue
    processed.add(seedUrl)

    try {
      const response = await fetch(seedUrl, {
        headers: {
          'User-Agent': 'GeoScore-AI-Bot/1.0 (+https://geoscore.ai/bot)'
        },
        timeout: 15000
      })

      if (!response.ok) continue

      const contentType = response.headers.get('content-type') || ''
      
      if (contentType.includes('xml')) {
        // Parse sitemap
        const xml = await response.text()
        const urls = extractUrlsFromSitemap(xml)
        urls.forEach(url => {
          if (url.includes(domain) && discovered.size < maxPages) {
            discovered.add(url)
          }
        })
      } else if (contentType.includes('html')) {
        // Parse HTML for internal links
        const html = await response.text()
        discovered.add(seedUrl)
        
        const urls = extractUrlsFromHtml(html, seedUrl, domain)
        urls.forEach(url => {
          if (discovered.size < maxPages) {
            discovered.add(url)
          }
        })
      }
    } catch (error) {
      console.warn(`Failed to process seed URL ${seedUrl}:`, error)
    }

    if (discovered.size >= maxPages) break
  }

  return Array.from(discovered).slice(0, maxPages)
}

function extractUrlsFromSitemap(xml: string): string[] {
  const urls: string[] = []
  const urlRegex = /<loc>(.*?)<\/loc>/g
  let match

  while ((match = urlRegex.exec(xml)) !== null) {
    urls.push(match[1])
  }

  return urls
}

function extractUrlsFromHtml(html: string, baseUrl: string, domain: string): string[] {
  const urls: string[] = []
  
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const links = doc?.querySelectorAll('a[href]') || []

    for (const link of links) {
      const href = link.getAttribute('href')
      if (!href) continue

      let fullUrl: string
      if (href.startsWith('http')) {
        fullUrl = href
      } else if (href.startsWith('/')) {
        const base = new URL(baseUrl)
        fullUrl = `${base.protocol}//${base.host}${href}`
      } else {
        const base = new URL(baseUrl)
        fullUrl = new URL(href, base.href).href
      }

      // Only include URLs from the same domain
      if (fullUrl.includes(domain) && !fullUrl.includes('#')) {
        urls.push(fullUrl)
      }
    }
  } catch (error) {
    console.warn('Failed to parse HTML for URLs:', error)
  }

  return urls
}

async function crawlPage(url: string, userAgent: string, crawlDelay: number): Promise<CrawlResult> {
  try {
    if (crawlDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, crawlDelay * 1000))
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'DNT': '1',
        'Connection': 'keep-alive'
      },
      timeout: 30000
    })

    const contentType = response.headers.get('content-type') || ''
    const content = await response.text()
    const contentHash = await hashContent(content)

    const result: CrawlResult = {
      url,
      statusCode: response.status,
      contentType,
      content,
      contentHash,
      fetchTime: new Date().toISOString()
    }

    // Extract metadata if HTML
    if (contentType.includes('html')) {
      try {
        const doc = new DOMParser().parseFromString(content, 'text/html')
        
        result.title = doc?.querySelector('title')?.textContent?.trim() || ''
        result.metaDescription = doc?.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() || ''
        
        const canonical = doc?.querySelector('link[rel="canonical"]')?.getAttribute('href')
        if (canonical) {
          result.canonicalUrl = canonical.startsWith('http') ? canonical : new URL(canonical, url).href
        }
      } catch (parseError) {
        console.warn(`Failed to parse HTML metadata for ${url}:`, parseError)
      }
    }

    return result
  } catch (error) {
    return {
      url,
      statusCode: 0,
      contentType: '',
      content: '',
      contentHash: '',
      fetchTime: new Date().toISOString(),
      error: error.message
    }
  }
}

async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

async function uploadToS3(key: string, content: string, contentType: string): Promise<string> {
  // For now, return a mock S3 URL
  // In production, this would upload to actual S3
  const mockS3Url = `s3://geoscore-snapshots/${key}`
  
  // Log the upload for debugging
  console.log(`Mock S3 upload: ${key} (${content.length} bytes, ${contentType})`)
  
  return mockS3Url
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

  // Log the status change
  console.log(`Job ${jobId} status updated to: ${status}`)
}