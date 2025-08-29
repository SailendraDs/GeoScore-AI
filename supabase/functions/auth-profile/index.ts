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

    // Get the current user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (req.method === 'GET') {
      // Get user profile with brands
      const { data: profileData, error: profileError } = await supabaseClient
        .from('users')
        .select(`
          *,
          brands (
            id,
            name,
            domain,
            industry,
            created_at,
            brand_setup_state (
              completed_steps,
              is_complete,
              current_step
            )
          )
        `)
        .eq('id', user.id)
        .single()

      if (profileError) {
        return new Response(
          JSON.stringify({ error: 'Failed to fetch profile' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({
          user: profileData,
          brandCount: profileData.brands?.length || 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (req.method === 'PUT') {
      // Update user profile
      const { email, phone } = await req.json()

      const updates: any = {}
      if (email && email !== user.email) {
        updates.email = email
      }
      if (phone !== undefined) {
        updates.phone = phone
      }

      if (Object.keys(updates).length === 0) {
        return new Response(
          JSON.stringify({ error: 'No valid updates provided' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Update user record
      const { data: updatedUser, error: updateError } = await supabaseClient
        .from('users')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)
        .select()
        .single()

      if (updateError) {
        return new Response(
          JSON.stringify({ error: 'Failed to update profile' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // If email was updated, also update auth user
      if (email && email !== user.email) {
        const { error: authUpdateError } = await supabaseClient.auth.updateUser({
          email: email
        })

        if (authUpdateError) {
          console.error('Auth email update error:', authUpdateError)
          // Continue anyway, as the database was updated
        }
      }

      return new Response(
        JSON.stringify({
          user: updatedUser,
          message: 'Profile updated successfully',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Profile error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})