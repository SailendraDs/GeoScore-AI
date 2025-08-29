import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SETUP_STEPS = ['basic_info', 'competitors', 'topics', 'prompts', 'verification']

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
    const brandId = pathParts[pathParts.indexOf('setup') - 1]
    const action = pathParts[pathParts.indexOf('setup') + 1]

    if (!brandId) {
      return new Response(
        JSON.stringify({ error: 'Brand ID required' }),
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

    if (req.method === 'GET') {
      return await getSetupState(supabaseClient, brandId)
    }

    if (req.method === 'POST' && action === 'step') {
      return await updateSetupStep(supabaseClient, brandId, req)
    }

    if (req.method === 'POST' && action === 'complete') {
      return await completeSetup(supabaseClient, brandId)
    }

    return new Response(
      JSON.stringify({ error: 'Invalid endpoint' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Setup API error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function getSetupState(supabaseClient: any, brandId: string) {
  const { data: setupState, error } = await supabaseClient
    .from('brand_setup_state')
    .select('*')
    .eq('brand_id', brandId)
    .single()

  if (error && error.code !== 'PGRST116') { // Not found is ok
    return new Response(
      JSON.stringify({ error: 'Failed to fetch setup state' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const completedSteps = setupState?.completed_steps || []
  const currentStep = setupState?.current_step || SETUP_STEPS[0]
  const isComplete = setupState?.is_complete || false
  
  const progress = {
    steps: SETUP_STEPS.map(step => ({
      name: step,
      completed: completedSteps.includes(step),
      current: step === currentStep,
    })),
    completedCount: completedSteps.length,
    totalCount: SETUP_STEPS.length,
    percentage: Math.round((completedSteps.length / SETUP_STEPS.length) * 100),
    isComplete,
    currentStep,
    nextStep: getNextStep(completedSteps),
  }

  return new Response(
    JSON.stringify({
      brandId,
      setupState: setupState || {},
      progress,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function updateSetupStep(supabaseClient: any, brandId: string, req: Request) {
  const { step, data } = await req.json()

  if (!step || !SETUP_STEPS.includes(step)) {
    return new Response(
      JSON.stringify({ error: 'Invalid step name' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get current setup state
  const { data: currentSetup, error: fetchError } = await supabaseClient
    .from('brand_setup_state')
    .select('*')
    .eq('brand_id', brandId)
    .single()

  if (fetchError && fetchError.code !== 'PGRST116') {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch current setup state' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const completedSteps = currentSetup?.completed_steps || []
  const setupData = currentSetup?.setup_data || {}

  // Add step to completed if not already there
  if (!completedSteps.includes(step)) {
    completedSteps.push(step)
  }

  // Update setup data
  if (data) {
    Object.assign(setupData, { [step]: data })
  }

  const nextStep = getNextStep(completedSteps)
  const isComplete = completedSteps.length === SETUP_STEPS.length

  // Upsert setup state
  const { data: updatedSetup, error: upsertError } = await supabaseClient
    .from('brand_setup_state')
    .upsert({
      brand_id: brandId,
      completed_steps: completedSteps,
      current_step: nextStep,
      is_complete: isComplete,
      setup_data: setupData,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'brand_id'
    })
    .select()
    .single()

  if (upsertError) {
    return new Response(
      JSON.stringify({ error: 'Failed to update setup state' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({
      message: 'Setup step updated successfully',
      step,
      completedSteps,
      nextStep,
      isComplete,
      progress: Math.round((completedSteps.length / SETUP_STEPS.length) * 100),
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function completeSetup(supabaseClient: any, brandId: string) {
  // Mark all steps as complete
  const { data: updatedSetup, error } = await supabaseClient
    .from('brand_setup_state')
    .upsert({
      brand_id: brandId,
      completed_steps: SETUP_STEPS,
      current_step: null,
      is_complete: true,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'brand_id'
    })
    .select()
    .single()

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to complete setup' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Create initial visibility snapshot
  await supabaseClient
    .from('visibility_snapshots')
    .insert({
      brand_id: brandId,
      visibility_pct: 0,
      positioning_pct: 0,
      freshness_score: 0,
      robustness_score: 0,
    })

  return new Response(
    JSON.stringify({
      message: 'Brand setup completed successfully',
      isComplete: true,
      completedAt: new Date().toISOString(),
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

function getNextStep(completedSteps: string[]): string | null {
  for (const step of SETUP_STEPS) {
    if (!completedSteps.includes(step)) {
      return step
    }
  }
  return null // All steps completed
}