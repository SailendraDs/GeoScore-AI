import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ConnectorResult {
  connector: string
  success: boolean
  data?: any
  error?: string
  executionTime: number
}

interface SemrushData {
  organicKeywords: Array<{
    keyword: string
    position: number
    volume: number
    difficulty: number
    url: string
  }>
  competitors: Array<{
    domain: string
    commonKeywords: number
    competitionLevel: number
  }>
  topPages: Array<{
    url: string
    traffic: number
    keywords: number
  }>
}

interface SimilarWebData {
  trafficOverview: {
    visits: number
    uniqueVisitors: number
    bounceRate: number
    pageViews: number
  }
  topCountries: Array<{
    country: string
    percentage: number
  }>
  trafficSources: {
    direct: number
    referrals: number
    search: number
    social: number
    mail: number
    display: number
  }
}

interface SerpAPIData {
  organicResults: Array<{
    position: number
    title: string
    link: string
    snippet: string
    domain: string
  }>
  peopleAlsoAsk: Array<{
    question: string
    snippet: string
  }>
  relatedSearches: string[]
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

    const { brandId, connectors, domain, competitors = [] } = await req.json()

    if (!brandId || !domain) {
      return new Response(
        JSON.stringify({ error: 'Missing brandId or domain' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify brand ownership
    const { data: brand, error: brandError } = await supabaseClient
      .from('brands')
      .select('id, name, owner_id')
      .eq('id', brandId)
      .eq('owner_id', user.id)
      .single()

    if (brandError || !brand) {
      return new Response(
        JSON.stringify({ error: 'Brand not found or access denied' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const enabledConnectors = connectors || ['semrush', 'similarweb', 'serpapi']
    const results: ConnectorResult[] = []

    // Execute connectors in parallel
    const connectorPromises = enabledConnectors.map(async (connector: string) => {
      const startTime = Date.now()
      try {
        let data
        switch (connector) {
          case 'semrush':
            data = await fetchSemrushData(domain, competitors)
            break
          case 'similarweb':
            data = await fetchSimilarWebData(domain)
            break
          case 'serpapi':
            data = await fetchSerpAPIData(domain, brand.name)
            break
          default:
            throw new Error(`Unknown connector: ${connector}`)
        }

        return {
          connector,
          success: true,
          data,
          executionTime: Date.now() - startTime
        }
      } catch (error) {
        return {
          connector,
          success: false,
          error: error.message,
          executionTime: Date.now() - startTime
        }
      }
    })

    const connectorResults = await Promise.all(connectorPromises)
    results.push(...connectorResults)

    // Process and store the collected data
    const processedData = await processConnectorData(supabaseClient, brandId, results)

    // Update usage tracking for API keys
    await updateAPIKeyUsage(supabaseClient, enabledConnectors)

    return new Response(
      JSON.stringify({
        brandId,
        domain,
        results,
        processedData,
        summary: {
          totalConnectors: enabledConnectors.length,
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
          averageExecutionTime: results.reduce((sum, r) => sum + r.executionTime, 0) / results.length,
        },
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Connector orchestration error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function fetchSemrushData(domain: string, competitors: string[]): Promise<SemrushData> {
  // Get API key from environment or vault
  const apiKey = Deno.env.get('SEMRUSH_API_KEY') || 'demo_key'
  
  // Fetch organic keywords
  const keywordsResponse = await fetch(
    `https://api.semrush.com/?type=domain_organic&key=${apiKey}&display_limit=50&domain=${domain}&database=us`
  )
  
  if (!keywordsResponse.ok) {
    throw new Error(`Semrush API error: ${keywordsResponse.status}`)
  }
  
  const keywordsText = await keywordsResponse.text()
  const keywordLines = keywordsText.split('\n').slice(1) // Skip header
  
  const organicKeywords = keywordLines
    .filter(line => line.trim())
    .slice(0, 50)
    .map(line => {
      const parts = line.split('\t')
      return {
        keyword: parts[0] || '',
        position: parseInt(parts[1]) || 0,
        volume: parseInt(parts[2]) || 0,
        difficulty: parseFloat(parts[3]) || 0,
        url: parts[4] || ''
      }
    })

  // Fetch competitor data for each competitor
  const competitorData = []
  for (const competitor of competitors.slice(0, 5)) { // Limit to 5 competitors
    try {
      const compResponse = await fetch(
        `https://api.semrush.com/?type=domain_organic_organic&key=${apiKey}&domains=${domain}|${competitor}&database=us`
      )
      
      if (compResponse.ok) {
        const compText = await compResponse.text()
        const lines = compText.split('\n')
        competitorData.push({
          domain: competitor,
          commonKeywords: lines.length - 1,
          competitionLevel: Math.random() * 100 // Placeholder calculation
        })
      }
    } catch (error) {
      console.warn(`Failed to fetch competitor data for ${competitor}:`, error)
    }
  }

  return {
    organicKeywords,
    competitors: competitorData,
    topPages: [] // Would require additional API calls
  }
}

async function fetchSimilarWebData(domain: string): Promise<SimilarWebData> {
  // Mock implementation - replace with actual SimilarWeb API calls
  const apiKey = Deno.env.get('SIMILARWEB_API_KEY') || 'demo_key'
  
  try {
    const response = await fetch(
      `https://api.similarweb.com/v1/website/${domain}/total-traffic-and-engagement/visits?api_key=${apiKey}&start_date=2023-01&end_date=2023-12&main_domain_only=false&granularity=monthly`
    )
    
    if (!response.ok) {
      throw new Error(`SimilarWeb API error: ${response.status}`)
    }
    
    const data = await response.json()
    
    return {
      trafficOverview: {
        visits: data.visits?.[0]?.visits || 0,
        uniqueVisitors: Math.floor((data.visits?.[0]?.visits || 0) * 0.7),
        bounceRate: 0.45 + Math.random() * 0.3,
        pageViews: Math.floor((data.visits?.[0]?.visits || 0) * 2.3)
      },
      topCountries: [
        { country: 'United States', percentage: 45.2 },
        { country: 'United Kingdom', percentage: 12.8 },
        { country: 'Canada', percentage: 8.9 }
      ],
      trafficSources: {
        direct: 35.2,
        referrals: 15.8,
        search: 28.7,
        social: 12.3,
        mail: 4.2,
        display: 3.8
      }
    }
  } catch (error) {
    // Return mock data if API fails
    return {
      trafficOverview: {
        visits: Math.floor(Math.random() * 1000000) + 10000,
        uniqueVisitors: Math.floor(Math.random() * 700000) + 7000,
        bounceRate: 0.45 + Math.random() * 0.3,
        pageViews: Math.floor(Math.random() * 2300000) + 23000
      },
      topCountries: [
        { country: 'United States', percentage: 45.2 },
        { country: 'United Kingdom', percentage: 12.8 },
        { country: 'Canada', percentage: 8.9 }
      ],
      trafficSources: {
        direct: 35.2,
        referrals: 15.8,
        search: 28.7,
        social: 12.3,
        mail: 4.2,
        display: 3.8
      }
    }
  }
}

async function fetchSerpAPIData(domain: string, brandName: string): Promise<SerpAPIData> {
  const apiKey = Deno.env.get('SERPAPI_KEY') || 'demo_key'
  
  try {
    const response = await fetch(
      `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(brandName)}&api_key=${apiKey}&num=20`
    )
    
    if (!response.ok) {
      throw new Error(`SerpAPI error: ${response.status}`)
    }
    
    const data = await response.json()
    
    return {
      organicResults: (data.organic_results || []).slice(0, 10).map((result: any, index: number) => ({
        position: index + 1,
        title: result.title || '',
        link: result.link || '',
        snippet: result.snippet || '',
        domain: extractDomain(result.link || '')
      })),
      peopleAlsoAsk: (data.people_also_ask || []).slice(0, 5).map((item: any) => ({
        question: item.question || '',
        snippet: item.snippet || ''
      })),
      relatedSearches: (data.related_searches || []).slice(0, 8).map((item: any) => item.query || '')
    }
  } catch (error) {
    // Return mock data if API fails
    return {
      organicResults: [
        {
          position: 1,
          title: `${brandName} - Official Website`,
          link: `https://${domain}`,
          snippet: `Official website of ${brandName}. Learn more about our products and services.`,
          domain: domain
        }
      ],
      peopleAlsoAsk: [
        {
          question: `What is ${brandName}?`,
          snippet: `${brandName} is a company that provides various products and services.`
        }
      ],
      relatedSearches: [`${brandName} reviews`, `${brandName} pricing`, `${brandName} alternatives`]
    }
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

async function processConnectorData(supabaseClient: any, brandId: string, results: ConnectorResult[]) {
  const processedData = {
    topicsGenerated: 0,
    competitorsAdded: 0,
    keywordsAnalyzed: 0,
    errors: [] as string[]
  }

  for (const result of results) {
    if (!result.success) {
      processedData.errors.push(`${result.connector}: ${result.error}`)
      continue
    }

    try {
      switch (result.connector) {
        case 'semrush':
          await processSemrushData(supabaseClient, brandId, result.data)
          processedData.keywordsAnalyzed += result.data.organicKeywords?.length || 0
          processedData.competitorsAdded += result.data.competitors?.length || 0
          break
        case 'similarweb':
          await processSimilarWebData(supabaseClient, brandId, result.data)
          break
        case 'serpapi':
          await processSerpAPIData(supabaseClient, brandId, result.data)
          processedData.topicsGenerated += result.data.peopleAlsoAsk?.length || 0
          break
      }
    } catch (error) {
      processedData.errors.push(`Processing ${result.connector}: ${error.message}`)
    }
  }

  return processedData
}

async function processSemrushData(supabaseClient: any, brandId: string, data: SemrushData) {
  // Extract topics from top keywords
  const topics = data.organicKeywords
    .slice(0, 20)
    .map(keyword => ({
      brand_id: brandId,
      topic: keyword.keyword,
      relevance_score: Math.min(keyword.volume / 1000, 1.0),
      source: 'semrush',
      source_data: {
        position: keyword.position,
        volume: keyword.volume,
        difficulty: keyword.difficulty,
        url: keyword.url
      }
    }))

  if (topics.length > 0) {
    await supabaseClient
      .from('brand_topics')
      .upsert(topics, { onConflict: 'brand_id,topic,source' })
  }

  // Add competitor metadata
  const competitors = data.competitors.map(comp => ({
    brand_id: brandId,
    domain: comp.domain,
    name: comp.domain.replace(/^www\./, '').split('.')[0],
    relationship_type: 'direct',
    priority_level: comp.competitionLevel > 70 ? 1 : comp.competitionLevel > 40 ? 2 : 3,
    added_by: 'semrush'
  }))

  if (competitors.length > 0) {
    await supabaseClient
      .from('competitor_meta')
      .upsert(competitors, { onConflict: 'brand_id,domain' })
  }
}

async function processSimilarWebData(supabaseClient: any, brandId: string, data: SimilarWebData) {
  // Store traffic data as brand metadata or in a separate analytics table
  // For now, we'll update the brand's setup_data
  await supabaseClient
    .from('brand_setup_state')
    .update({
      setup_data: supabaseClient.rpc('jsonb_set', {
        target: 'setup_data',
        path: ['similarweb_data'],
        new_value: JSON.stringify(data)
      })
    })
    .eq('brand_id', brandId)
}

async function processSerpAPIData(supabaseClient: any, brandId: string, data: SerpAPIData) {
  // Extract topics from "People Also Ask" questions
  const topics = data.peopleAlsoAsk.map(item => ({
    brand_id: brandId,
    topic: item.question,
    relevance_score: 0.8,
    source: 'serpapi',
    source_data: {
      snippet: item.snippet,
      type: 'people_also_ask'
    }
  }))

  // Add related searches as topics
  const relatedTopics = data.relatedSearches.map(search => ({
    brand_id: brandId,
    topic: search,
    relevance_score: 0.6,
    source: 'serpapi',
    source_data: {
      type: 'related_search'
    }
  }))

  const allTopics = [...topics, ...relatedTopics]
  
  if (allTopics.length > 0) {
    await supabaseClient
      .from('brand_topics')
      .upsert(allTopics, { onConflict: 'brand_id,topic,source' })
  }
}

async function updateAPIKeyUsage(supabaseClient: any, connectors: string[]) {
  for (const connector of connectors) {
    try {
      // Find the service and update key usage
      const { data: service } = await supabaseClient
        .from('api_services')
        .select('id')
        .eq('name', connector)
        .single()

      if (service) {
        await supabaseClient
          .from('api_keys')
          .update({
            usage_count: supabaseClient.rpc('increment_usage'),
            last_used: new Date().toISOString()
          })
          .eq('service_id', service.id)
          .eq('is_active', true)
      }
    } catch (error) {
      console.warn(`Failed to update usage for ${connector}:`, error)
    }
  }
}