import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface GenerateSchemaRequest {
  brandId: string
  schemaType: 'organization' | 'product' | 'service' | 'local_business' | 'custom'
  includeFields: string[]
  customData?: Record<string, any>
  model?: string
}

interface ValidateSchemaRequest {
  schema: Record<string, any>
  schemaType: string
}

const SCHEMA_TEMPLATES = {
  organization: {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "",
    url: "",
    logo: "",
    description: "",
    address: {
      "@type": "PostalAddress",
      streetAddress: "",
      addressLocality: "",
      addressRegion: "",
      postalCode: "",
      addressCountry: ""
    },
    contactPoint: {
      "@type": "ContactPoint",
      telephone: "",
      contactType: "customer service",
      email: ""
    },
    sameAs: [],
    foundingDate: "",
    industry: ""
  },
  product: {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "",
    description: "",
    brand: {
      "@type": "Brand",
      name: ""
    },
    offers: {
      "@type": "Offer",
      price: "",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock"
    },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "",
      reviewCount: ""
    }
  },
  service: {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "",
    description: "",
    provider: {
      "@type": "Organization",
      name: ""
    },
    serviceType: "",
    areaServed: ""
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

    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const action = pathParts[pathParts.length - 1]

    if (req.method === 'POST') {
      if (action === 'generate') {
        return await generateSchema(supabaseClient, user.id, req)
      } else if (action === 'validate') {
        return await validateSchema(supabaseClient, req)
      }
    }

    if (req.method === 'GET') {
      const brandId = pathParts[pathParts.length - 1]
      if (brandId && brandId !== 'schema') {
        return await getSchemas(supabaseClient, user.id, brandId)
      } else {
        return await listSchemas(supabaseClient, user.id, url.searchParams)
      }
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Schema builder error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function generateSchema(supabaseClient: any, userId: string, req: Request): Promise<Response> {
  const { brandId, schemaType, includeFields, customData, model }: GenerateSchemaRequest = await req.json()

  // Verify brand ownership
  const { data: brand, error: brandError } = await supabaseClient
    .from('brands')
    .select('*')
    .eq('id', brandId)
    .eq('owner_id', userId)
    .single()

  if (brandError || !brand) {
    return new Response(
      JSON.stringify({ error: 'Brand not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get base template
  const template = SCHEMA_TEMPLATES[schemaType as keyof typeof SCHEMA_TEMPLATES]
  if (!template) {
    return new Response(
      JSON.stringify({ error: 'Invalid schema type' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Generate schema using LLM if requested
  let generatedSchema = { ...template }
  
  if (model) {
    const llmPrompt = `
      Generate a complete JSON-LD schema for a ${schemaType} based on the following brand information:
      
      Brand Name: ${brand.name}
      Domain: ${brand.domain}
      Industry: ${brand.industry || 'Not specified'}
      Description: ${brand.description || 'Not provided'}
      
      Include these specific fields: ${includeFields.join(', ')}
      
      ${customData ? `Additional data: ${JSON.stringify(customData, null, 2)}` : ''}
      
      Return a valid JSON-LD schema following schema.org standards. Make sure all required fields are populated with realistic values.
    `

    try {
      const response = await fetch('https://alaxjkbdistiwvckfysi.supabase.co/functions/v1/llm-orchestration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
        },
        body: JSON.stringify({
          model: model || 'gpt-4',
          prompt: llmPrompt,
          brandId,
          metadata: { 
            scoreType: 'schema_generation',
            schemaType 
          }
        })
      })

      if (response.ok) {
        const llmResult = await response.json()
        try {
          const parsedSchema = JSON.parse(llmResult.response.content)
          generatedSchema = parsedSchema
        } catch (parseError) {
          console.warn('Failed to parse LLM-generated schema, using template')
        }
      }
    } catch (error) {
      console.warn('LLM schema generation failed:', error)
    }
  }

  // Fill in basic brand information
  if (generatedSchema.name === "") generatedSchema.name = brand.name
  if (generatedSchema.url === "") generatedSchema.url = `https://${brand.domain}`
  if (generatedSchema.description === "") generatedSchema.description = brand.description || `${brand.name} - ${brand.industry} company`

  // Validate the generated schema
  const validation = validateSchemaStructure(generatedSchema, schemaType)

  // Save schema to database
  const { data: savedSchema, error: saveError } = await supabaseClient
    .from('schemas')
    .insert({
      brand_id: brandId,
      schema_type: schemaType,
      json_schema: generatedSchema,
      generated_by: model || 'template',
      validation_status: validation.isValid ? 'valid' : (validation.errors.length > 0 ? 'error' : 'warning'),
      validation_errors: validation.errors.length > 0 ? validation : null
    })
    .select()
    .single()

  if (saveError) {
    return new Response(
      JSON.stringify({ error: 'Failed to save schema' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Log generation for analytics
  await supabaseClient
    .from('schema_generations')
    .insert({
      brand_id: brandId,
      request_data: { schemaType, includeFields, customData },
      generated_schema: generatedSchema,
      model_used: model || 'template',
      quality_score: validation.isValid ? 0.9 : 0.6
    })

  const response = {
    schema: generatedSchema,
    validation,
    suggestions: generateSuggestions(generatedSchema, schemaType),
    estimatedImpact: {
      seoScore: calculateSEOScore(generatedSchema),
      richSnippetEligibility: getRichSnippetEligibility(generatedSchema, schemaType)
    },
    schemaId: savedSchema.id
  }

  return new Response(
    JSON.stringify(response),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function validateSchema(supabaseClient: any, req: Request): Promise<Response> {
  const { schema, schemaType }: ValidateSchemaRequest = await req.json()

  const validation = validateSchemaStructure(schema, schemaType)
  const suggestions = generateSuggestions(schema, schemaType)
  const compliance = checkCompliance(schema)

  const response = {
    isValid: validation.isValid,
    errors: validation.errors,
    warnings: validation.warnings,
    suggestions,
    compliance
  }

  return new Response(
    JSON.stringify(response),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

function validateSchemaStructure(schema: any, schemaType: string) {
  const errors = []
  const warnings = []

  // Basic JSON-LD validation
  if (!schema['@context']) {
    errors.push({ path: '@context', message: '@context is required', severity: 'error' })
  }
  if (!schema['@type']) {
    errors.push({ path: '@type', message: '@type is required', severity: 'error' })
  }

  // Type-specific validation
  if (schemaType === 'organization') {
    if (!schema.name) warnings.push({ path: 'name', message: 'Organization name is recommended', severity: 'warning' })
    if (!schema.url) warnings.push({ path: 'url', message: 'Website URL is recommended', severity: 'warning' })
  } else if (schemaType === 'product') {
    if (!schema.name) errors.push({ path: 'name', message: 'Product name is required', severity: 'error' })
    if (!schema.description) warnings.push({ path: 'description', message: 'Product description is recommended', severity: 'warning' })
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}

function generateSuggestions(schema: any, schemaType: string): Array<{ field: string, recommendation: string, impact: string }> {
  const suggestions = []

  if (schemaType === 'organization') {
    if (!schema.logo) {
      suggestions.push({
        field: 'logo',
        recommendation: 'Add a logo URL to improve brand recognition in search results',
        impact: 'Enhanced visual appearance in knowledge panels'
      })
    }
    if (!schema.sameAs || schema.sameAs.length === 0) {
      suggestions.push({
        field: 'sameAs',
        recommendation: 'Add social media profiles to establish credibility',
        impact: 'Improved entity recognition and trust signals'
      })
    }
  }

  if (schemaType === 'product') {
    if (!schema.aggregateRating) {
      suggestions.push({
        field: 'aggregateRating',
        recommendation: 'Add customer ratings to increase click-through rates',
        impact: 'Rich snippets with star ratings in search results'
      })
    }
  }

  return suggestions
}

function calculateSEOScore(schema: any): number {
  let score = 0
  
  // Basic structure (40 points)
  if (schema['@context']) score += 20
  if (schema['@type']) score += 20
  
  // Content quality (40 points)
  if (schema.name && schema.name.length > 0) score += 10
  if (schema.description && schema.description.length > 50) score += 10
  if (schema.url) score += 10
  if (schema.logo) score += 10
  
  // Additional features (20 points)
  if (schema.sameAs && schema.sameAs.length > 0) score += 10
  if (schema.contactPoint || schema.address) score += 10
  
  return Math.min(100, score)
}

function getRichSnippetEligibility(schema: any, schemaType: string): string[] {
  const eligible = []
  
  if (schemaType === 'organization') {
    if (schema.name && schema.url) eligible.push('Knowledge Panel')
    if (schema.logo) eligible.push('Branded Results')
    if (schema.contactPoint) eligible.push('Contact Information')
  }
  
  if (schemaType === 'product') {
    if (schema.name && schema.description) eligible.push('Product Rich Snippets')
    if (schema.offers && schema.offers.price) eligible.push('Price Information')
    if (schema.aggregateRating) eligible.push('Review Stars')
  }
  
  return eligible
}

function checkCompliance(schema: any) {
  return {
    googleStructuredData: !!(schema['@context'] && schema['@type']),
    schemaOrg: schema['@context'] === 'https://schema.org',
    openGraph: false // Would check for og: properties if this were HTML
  }
}

async function getSchemas(supabaseClient: any, userId: string, brandId: string): Promise<Response> {
  // Verify brand ownership
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

  const { data: schemas, error } = await supabaseClient
    .from('schemas')
    .select('*')
    .eq('brand_id', brandId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch schemas' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ schemas }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function listSchemas(supabaseClient: any, userId: string, searchParams: URLSearchParams): Promise<Response> {
  const schemaType = searchParams.get('type')
  const limit = parseInt(searchParams.get('limit') || '20')

  let query = supabaseClient
    .from('schemas')
    .select(`
      *,
      brands!inner(name, owner_id)
    `)
    .eq('brands.owner_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (schemaType) {
    query = query.eq('schema_type', schemaType)
  }

  const { data: schemas, error } = await query

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch schemas' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ schemas }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}