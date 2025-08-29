import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts"
import { Readability } from "https://esm.sh/@mozilla/readability@0.4.4"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface NormalizeJob {
  id: string
  brandId: string
  payload: {
    rawPageIds: string[]
    source: string
  }
}

interface ExtractedContent {
  title: string
  description: string
  mainContent: string
  jsonLd: any[]
  metaTags: Record<string, string>
  headings: { level: number; text: string }[]
  links: { text: string; href: string; internal: boolean }[]
  images: { src: string; alt: string; title?: string }[]
  wordCount: number
  readabilityScore?: number
}

interface ExtractedClaim {
  text: string
  type: 'company_info' | 'product_feature' | 'service_claim' | 'location' | 'contact' | 'other'
  confidence: number
  sourceUrl: string
  sourceContext: string
  extractedBy: string
  metadata: Record<string, any>
}

interface NormalizeResult {
  brandId: string
  processedPages: number
  extractedClaims: number
  contentEntries: number
  nextJobPayload: {
    type: 'embed'
    contentIds: string[]
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
      return await processNormalizeJob(supabaseClient, req)
    }

    if (method === 'GET') {
      return await getJobStatus(supabaseClient, req)
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Worker normalize error:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function processNormalizeJob(supabaseClient: any, req: Request) {
  const { jobId, brandId, payload }: { jobId: string, brandId: string, payload: NormalizeJob['payload'] } = await req.json()

  if (!jobId || !brandId || !payload.rawPageIds?.length) {
    return new Response(
      JSON.stringify({ error: 'Missing jobId, brandId, or rawPageIds' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  console.log(`Starting normalize job ${jobId} for brand ${brandId} with ${payload.rawPageIds.length} pages`)

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

    // Get raw pages data
    const { data: rawPages, error: rawPagesError } = await supabaseClient
      .from('raw_pages')
      .select('id, url, html_s3_path, title, content_type')
      .in('id', payload.rawPageIds)
      .eq('brand_id', brandId)

    if (rawPagesError) {
      throw new Error(`Failed to fetch raw pages: ${rawPagesError.message}`)
    }

    if (!rawPages || rawPages.length === 0) {
      throw new Error('No raw pages found for processing')
    }

    console.log(`Processing ${rawPages.length} raw pages`)

    // Process each page
    const contentIds: string[] = []
    const allClaims: ExtractedClaim[] = []
    let processedPages = 0

    for (const rawPage of rawPages) {
      try {
        console.log(`Processing page: ${rawPage.url}`)
        
        // Download content from S3 (mock for now)
        const htmlContent = await downloadFromS3(rawPage.html_s3_path)
        
        if (!htmlContent) {
          console.warn(`No content found for page ${rawPage.url}`)
          continue
        }

        // Extract structured content
        const extractedContent = await extractContent(htmlContent, rawPage.url, brand.domain)

        // Store normalized content
        const { data: contentRecord, error: contentError } = await supabaseClient
          .from('page_content')
          .insert({
            brand_id: brandId,
            raw_page_id: rawPage.id,
            url: rawPage.url,
            title: extractedContent.title,
            description: extractedContent.description,
            main_content: extractedContent.mainContent,
            json_ld: extractedContent.jsonLd,
            meta_tags: extractedContent.metaTags,
            headings: extractedContent.headings,
            links: extractedContent.links,
            images: extractedContent.images,
            word_count: extractedContent.wordCount,
            readability_score: extractedContent.readabilityScore,
            extracted_at: new Date().toISOString()
          })
          .select('id')
          .single()

        if (contentError) {
          console.error(`Failed to store content for ${rawPage.url}:`, contentError)
          continue
        }

        contentIds.push(contentRecord.id)

        // Extract claims from the content
        const pageClaims = await extractClaims(extractedContent, rawPage.url, brand)
        allClaims.push(...pageClaims)

        processedPages++
        console.log(`Processed page ${processedPages}/${rawPages.length}: ${rawPage.url}`)

      } catch (error) {
        console.error(`Failed to process page ${rawPage.url}:`, error)
        continue
      }
    }

    console.log(`Extracted ${allClaims.length} claims from ${processedPages} pages`)

    // Store all extracted claims
    const claimResults = await Promise.all(
      allClaims.map(async (claim) => {
        try {
          const { data, error } = await supabaseClient
            .from('claims')
            .insert({
              brand_id: brandId,
              claim_text: claim.text,
              claim_type: claim.type,
              confidence_score: claim.confidence,
              source_url: claim.sourceUrl,
              source_context: claim.sourceContext,
              extracted_by: claim.extractedBy,
              metadata: claim.metadata,
              extracted_at: new Date().toISOString()
            })
            .select('id')
            .single()

          if (error) {
            console.error('Failed to store claim:', error)
            return { success: false, error: error.message }
          }

          return { success: true, claimId: data.id }
        } catch (error) {
          return { success: false, error: error.message }
        }
      })
    )

    const storedClaims = claimResults.filter(r => r.success).length
    console.log(`Stored ${storedClaims} claims out of ${allClaims.length}`)

    // Create next job (embed)
    const nextJobPayload = {
      contentIds,
      brandId,
      source: 'normalize'
    }

    const { data: nextJobId } = await supabaseClient
      .rpc('create_job_with_deps', {
        p_brand_id: brandId,
        p_type: 'embed',
        p_payload: nextJobPayload,
        p_depends_on: [jobId],
        p_priority: 4
      })

    const result: NormalizeResult = {
      brandId,
      processedPages,
      extractedClaims: storedClaims,
      contentEntries: contentIds.length,
      nextJobPayload: {
        type: 'embed',
        contentIds
      }
    }

    // Complete the job
    await updateJobStatus(supabaseClient, jobId, 'complete', {
      ...result,
      nextJobId,
      completedAt: new Date().toISOString(),
      processingStats: {
        totalRawPages: rawPages.length,
        successfullyProcessed: processedPages,
        contentEntriesCreated: contentIds.length,
        claimsExtracted: allClaims.length,
        claimsStored: storedClaims
      }
    })

    console.log(`Normalize job ${jobId} completed successfully`)

    return new Response(
      JSON.stringify({
        jobId,
        status: 'complete',
        result,
        nextJobId,
        message: `Successfully normalized ${processedPages} pages with ${storedClaims} claims`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error(`Normalize job ${jobId} failed:`, error)
    
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
        message: 'Normalize job failed'
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
async function downloadFromS3(s3Path: string): Promise<string | null> {
  try {
    // Mock S3 download - in production this would download from actual S3
    console.log(`Mock S3 download: ${s3Path}`)
    
    // Return sample HTML content for testing
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Sample Page</title>
        <meta name="description" content="Sample page description">
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "Sample Company",
            "url": "https://example.com"
          }
        </script>
      </head>
      <body>
        <h1>Welcome to Sample Company</h1>
        <p>We provide excellent services to our customers worldwide.</p>
        <h2>Our Services</h2>
        <p>We offer web development, consulting, and support services.</p>
        <h3>Contact Information</h3>
        <p>Located in San Francisco, CA. Call us at (555) 123-4567.</p>
      </body>
      </html>
    `
  } catch (error) {
    console.error(`Failed to download from S3: ${s3Path}`, error)
    return null
  }
}

async function extractContent(html: string, url: string, domain: string): Promise<ExtractedContent> {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    
    if (!doc) {
      throw new Error('Failed to parse HTML')
    }

    // Extract basic metadata
    const title = doc.querySelector('title')?.textContent?.trim() || ''
    const description = doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() || ''

    // Extract JSON-LD structured data
    const jsonLdElements = doc.querySelectorAll('script[type="application/ld+json"]')
    const jsonLd: any[] = []
    
    for (const element of jsonLdElements) {
      try {
        const data = JSON.parse(element.textContent || '')
        jsonLd.push(data)
      } catch (error) {
        console.warn('Failed to parse JSON-LD:', error)
      }
    }

    // Extract meta tags
    const metaTags: Record<string, string> = {}
    const metaElements = doc.querySelectorAll('meta')
    
    for (const meta of metaElements) {
      const name = meta.getAttribute('name') || meta.getAttribute('property')
      const content = meta.getAttribute('content')
      if (name && content) {
        metaTags[name] = content
      }
    }

    // Extract headings
    const headings: { level: number; text: string }[] = []
    const headingElements = doc.querySelectorAll('h1, h2, h3, h4, h5, h6')
    
    for (const heading of headingElements) {
      const level = parseInt(heading.tagName.substring(1))
      const text = heading.textContent?.trim() || ''
      if (text) {
        headings.push({ level, text })
      }
    }

    // Extract links
    const links: { text: string; href: string; internal: boolean }[] = []
    const linkElements = doc.querySelectorAll('a[href]')
    
    for (const link of linkElements) {
      const href = link.getAttribute('href') || ''
      const text = link.textContent?.trim() || ''
      const internal = href.includes(domain) || href.startsWith('/')
      
      if (text && href) {
        links.push({ text, href, internal })
      }
    }

    // Extract images
    const images: { src: string; alt: string; title?: string }[] = []
    const imgElements = doc.querySelectorAll('img[src]')
    
    for (const img of imgElements) {
      const src = img.getAttribute('src') || ''
      const alt = img.getAttribute('alt') || ''
      const title = img.getAttribute('title') || undefined
      
      if (src) {
        images.push({ src, alt, title })
      }
    }

    // Extract main content using readability
    let mainContent = ''
    let readabilityScore: number | undefined
    
    try {
      const reader = new Readability(doc, {
        debug: false,
        maxElemsToParse: 0,
        nbTopCandidates: 5,
        charThreshold: 500,
        classesToPreserve: [],
        keepClasses: false,
        serializer: (el: any) => el.innerHTML,
        disableJSONLD: false,
        allowedVideoRegex: /https?:\/\/(www\.)?(youtube|vimeo)\.com/i
      })
      
      const article = reader.parse()
      if (article) {
        mainContent = article.textContent || ''
        readabilityScore = article.length // Simple readability metric
      }
    } catch (error) {
      console.warn('Readability extraction failed, using fallback:', error)
      // Fallback: extract text from body
      mainContent = doc.querySelector('body')?.textContent?.trim() || ''
    }

    // Calculate word count
    const wordCount = mainContent.split(/\s+/).filter(word => word.length > 0).length

    return {
      title,
      description,
      mainContent,
      jsonLd,
      metaTags,
      headings,
      links,
      images,
      wordCount,
      readabilityScore
    }

  } catch (error) {
    console.error('Content extraction failed:', error)
    throw new Error(`Failed to extract content: ${error.message}`)
  }
}

async function extractClaims(content: ExtractedContent, sourceUrl: string, brand: any): Promise<ExtractedClaim[]> {
  const claims: ExtractedClaim[] = []
  const brandName = brand.name || brand.domain
  
  try {
    // Extract company information claims
    if (content.jsonLd.length > 0) {
      for (const data of content.jsonLd) {
        if (data['@type'] === 'Organization') {
          if (data.name) {
            claims.push({
              text: `Company name: ${data.name}`,
              type: 'company_info',
              confidence: 0.95,
              sourceUrl,
              sourceContext: 'JSON-LD Organization schema',
              extractedBy: 'json_ld_parser',
              metadata: { schema: data }
            })
          }
          
          if (data.address) {
            claims.push({
              text: `Company address: ${JSON.stringify(data.address)}`,
              type: 'location',
              confidence: 0.9,
              sourceUrl,
              sourceContext: 'JSON-LD Organization address',
              extractedBy: 'json_ld_parser',
              metadata: { address: data.address }
            })
          }
        }
      }
    }

    // Extract claims from headings
    for (const heading of content.headings) {
      if (heading.text.toLowerCase().includes('service') || heading.text.toLowerCase().includes('product')) {
        claims.push({
          text: heading.text,
          type: 'service_claim',
          confidence: 0.7,
          sourceUrl,
          sourceContext: `H${heading.level} heading`,
          extractedBy: 'heading_parser',
          metadata: { headingLevel: heading.level }
        })
      }
    }

    // Extract contact information from content
    const contactPatterns = [
      { pattern: /(?:call|phone|tel):?\s*(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/gi, type: 'contact' },
      { pattern: /(?:email|mail|contact):?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi, type: 'contact' },
      { pattern: /(?:located|address|based)\s+(?:in|at)\s+([^.]+(?:CA|NY|TX|FL|[A-Z]{2}))/gi, type: 'location' }
    ]

    for (const { pattern, type } of contactPatterns) {
      let match
      while ((match = pattern.exec(content.mainContent)) !== null) {
        claims.push({
          text: match[0],
          type: type as ExtractedClaim['type'],
          confidence: 0.8,
          sourceUrl,
          sourceContext: 'Main content text',
          extractedBy: 'regex_parser',
          metadata: { pattern: pattern.source }
        })
      }
    }

    // Extract product/service claims from sentences mentioning the brand
    const sentences = content.mainContent.split(/[.!?]+/)
    
    for (const sentence of sentences) {
      if (sentence.toLowerCase().includes(brandName.toLowerCase()) || 
          sentence.toLowerCase().includes('we') || 
          sentence.toLowerCase().includes('our')) {
        
        // Check for service/product keywords
        const serviceKeywords = ['provide', 'offer', 'deliver', 'service', 'product', 'solution']
        const hasServiceKeyword = serviceKeywords.some(keyword => 
          sentence.toLowerCase().includes(keyword)
        )
        
        if (hasServiceKeyword && sentence.trim().length > 20 && sentence.trim().length < 200) {
          claims.push({
            text: sentence.trim(),
            type: 'service_claim',
            confidence: 0.6,
            sourceUrl,
            sourceContext: 'Main content sentence',
            extractedBy: 'content_analyzer',
            metadata: { sentenceLength: sentence.length }
          })
        }
      }
    }

    console.log(`Extracted ${claims.length} claims from ${sourceUrl}`)
    
    return claims

  } catch (error) {
    console.error('Claim extraction failed:', error)
    return []
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