import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    const { email, password, brandName, domain, industry, description } = await req.json()

    // Validate required fields
    if (!email || !password || !brandName || !domain) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: email, password, brandName, domain' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate domain format
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/
    if (!domainRegex.test(domain)) {
      return new Response(
        JSON.stringify({ error: 'Invalid domain format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Sign up user
    const { data: authData, error: authError } = await supabaseClient.auth.signUp({
      email,
      password,
    })

    if (authError) {
      return new Response(
        JSON.stringify({ error: authError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!authData.user) {
      return new Response(
        JSON.stringify({ error: 'User creation failed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create user record
    const { data: userData, error: userError } = await supabaseClient
      .from('users')
      .insert({
        id: authData.user.id,
        email: authData.user.email,
        role: 'user',
        is_admin: false,
      })
      .select()
      .single()

    if (userError) {
      console.error('User creation error:', userError)
      return new Response(
        JSON.stringify({ error: 'Failed to create user record' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create brand record
    const { data: brandData, error: brandError } = await supabaseClient
      .from('brands')
      .insert({
        owner_id: authData.user.id,
        name: brandName,
        domain,
        industry: industry || null,
        description: description || null,
      })
      .select()
      .single()

    if (brandError) {
      console.error('Brand creation error:', brandError)
      return new Response(
        JSON.stringify({ error: 'Failed to create brand record' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create brand setup state
    const { data: setupData, error: setupError } = await supabaseClient
      .from('brand_setup_state')
      .insert({
        brand_id: brandData.id,
        completed_steps: ['basic_info'],
        current_step: 'competitors',
        is_complete: false,
        setup_data: {
          brand_name: brandName,
          domain,
          industry: industry || null,
          description: description || null,
        },
      })
      .select()
      .single()

    if (setupError) {
      console.error('Setup state creation error:', setupError)
      // Non-critical error, continue
    }

    // Generate setup token (JWT with brand info)
    const setupToken = await generateSetupToken(brandData.id, authData.user.id)

    return new Response(
      JSON.stringify({
        user: {
          id: userData.id,
          email: userData.email,
          role: userData.role,
        },
        brand: {
          id: brandData.id,
          name: brandData.name,
          domain: brandData.domain,
          industry: brandData.industry,
        },
        setupToken,
        nextStep: 'competitors',
      }),
      {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )

  } catch (error) {
    console.error('Onboarding error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function generateSetupToken(brandId: string, userId: string): Promise<string> {
  // For now, return a simple token. In production, use proper JWT signing
  return btoa(JSON.stringify({
    brandId,
    userId,
    purpose: 'setup',
    expiresAt: Date.now() + (24 * 60 * 60 * 1000), // 24 hours
  }))
}