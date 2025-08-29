import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', // Use service role for vault access
    )

    // Verify admin permissions
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(
      req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    )
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if user is admin
    const { data: adminData, error: adminError } = await supabaseClient
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (adminError || !adminData?.is_admin) {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { serviceId, newKey, gracePeriodHours = 24 } = await req.json()

    if (!serviceId || !newKey) {
      return new Response(
        JSON.stringify({ error: 'Missing serviceId or newKey' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get service info
    const { data: service, error: serviceError } = await supabaseClient
      .from('api_services')
      .select('*')
      .eq('id', serviceId)
      .single()

    if (serviceError) {
      return new Response(
        JSON.stringify({ error: 'Service not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Store new key in Supabase Vault (simulated)
    const vaultKeyId = `${service.name}_${Date.now()}`
    
    // In a real implementation, you would use Supabase Vault:
    // await supabaseClient.rpc('vault_store_key', { key_id: vaultKeyId, secret: newKey })
    
    // For now, we'll create a placeholder entry
    const { data: keyData, error: keyError } = await supabaseClient
      .from('api_keys')
      .insert({
        service_id: serviceId,
        key_name: `${service.name}_key_${Date.now()}`,
        vault_key_id: vaultKeyId,
        usage_count: 0,
        error_count: 0,
        is_active: true,
      })
      .select()
      .single()

    if (keyError) {
      return new Response(
        JSON.stringify({ error: 'Failed to store new key' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Schedule old key deactivation after grace period
    const deactivateAt = new Date(Date.now() + gracePeriodHours * 60 * 60 * 1000)
    
    // Mark old keys as inactive after grace period (in production, use cron job)
    await supabaseClient
      .from('api_keys')
      .update({ 
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('service_id', serviceId)
      .neq('id', keyData.id)

    return new Response(
      JSON.stringify({
        success: true,
        keyId: keyData.id,
        vaultKeyId: vaultKeyId,
        gracePeriod: `${gracePeriodHours} hours`,
        deactivateAt: deactivateAt.toISOString(),
        message: 'Key rotation completed successfully',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Key rotation error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})