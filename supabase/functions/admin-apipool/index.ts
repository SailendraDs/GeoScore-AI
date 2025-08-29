import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ApiServiceRequest {
  name: string
  type: string
  adapterKey: string
  baseUrl?: string
  defaultConfig?: Record<string, any>
}

interface ApiKeyRequest {
  serviceId: string
  label: string
  secretPointer: string
  region?: string
  metadata?: Record<string, any>
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
      .from('admins')
      .select('role, permissions, is_active')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (adminError || !adminData) {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const resource = pathParts[pathParts.length - 1]
    const resourceId = pathParts[pathParts.length - 2]

    // Log admin activity
    await logAdminActivity(supabaseClient, user.id, `${req.method} ${url.pathname}`, req)

    // Route requests
    if (req.method === 'GET' && resource === 'services') {
      return await getServices(supabaseClient, adminData)
    }

    if (req.method === 'POST' && resource === 'services') {
      return await createService(supabaseClient, adminData, user.id, req)
    }

    if (req.method === 'GET' && resource === 'keys') {
      return await getKeys(supabaseClient, adminData, url.searchParams)
    }

    if (req.method === 'POST' && resource === 'keys') {
      return await createKey(supabaseClient, adminData, user.id, req)
    }

    if (req.method === 'POST' && pathParts.includes('rotate')) {
      const keyId = pathParts[pathParts.length - 2]
      return await rotateKey(supabaseClient, adminData, user.id, keyId, req)
    }

    if (req.method === 'DELETE' && resource !== 'services' && resource !== 'keys') {
      return await deleteKey(supabaseClient, adminData, user.id, resource)
    }

    if (req.method === 'GET' && resource === 'health') {
      return await getSystemHealth(supabaseClient, adminData)
    }

    return new Response(
      JSON.stringify({ error: 'Invalid endpoint' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Admin API Pool error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function logAdminActivity(supabaseClient: any, adminId: string, action: string, req: Request) {
  try {
    await supabaseClient
      .from('admin_logs')
      .insert({
        admin_id: adminId,
        action,
        ip_address: req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For'),
        user_agent: req.headers.get('User-Agent'),
        details: { timestamp: new Date().toISOString() }
      })
  } catch (error) {
    console.warn('Failed to log admin activity:', error)
  }
}

async function getServices(supabaseClient: any, adminData: any) {
  const { data: services, error } = await supabaseClient
    .from('api_services')
    .select(`
      id, name, type, adapter_key, base_url, default_config, is_active, created_at,
      api_keys!left(
        id, label, status, last_used_at, error_count, created_at
      )
    `)
    .order('created_at', { ascending: false })

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch services' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get health status for each service
  const servicesWithHealth = await Promise.all(services.map(async (service: any) => {
    const totalKeys = service.api_keys?.length || 0
    const activeKeys = service.api_keys?.filter((k: any) => k.status === 'active')?.length || 0
    const healthyKeys = service.api_keys?.filter((k: any) => k.error_count < 3)?.length || 0
    
    let healthStatus = 'unknown'
    if (totalKeys === 0) {
      healthStatus = 'no_keys'
    } else if (activeKeys === 0) {
      healthStatus = 'down'
    } else if (healthyKeys / totalKeys > 0.8) {
      healthStatus = 'healthy'
    } else if (healthyKeys / totalKeys > 0.5) {
      healthStatus = 'degraded'
    } else {
      healthStatus = 'unhealthy'
    }

    return {
      id: service.id,
      name: service.name,
      type: service.type,
      adapterKey: service.adapter_key,
      baseUrl: service.base_url,
      isActive: service.is_active,
      health: {
        status: healthStatus,
        totalKeys,
        activeKeys,
        healthyKeys,
        lastChecked: new Date().toISOString()
      },
      keys: service.api_keys?.map((key: any) => ({
        id: key.id,
        label: key.label,
        status: key.status,
        lastUsed: key.last_used_at,
        errorCount: key.error_count,
        healthScore: Math.max(0, 100 - (key.error_count * 10))
      })) || []
    }
  }))

  return new Response(
    JSON.stringify({ services: servicesWithHealth }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function createService(supabaseClient: any, adminData: any, adminId: string, req: Request) {
  const { name, type, adapterKey, baseUrl, defaultConfig }: ApiServiceRequest = await req.json()

  if (!name || !type || !adapterKey) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: name, type, adapterKey' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Check permissions
  if (!adminData.permissions?.apipool?.includes('write')) {
    return new Response(
      JSON.stringify({ error: 'Insufficient permissions' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { data: service, error } = await supabaseClient
    .from('api_services')
    .insert({
      name,
      type,
      adapter_key: adapterKey,
      base_url: baseUrl,
      default_config: defaultConfig || {},
      is_active: true,
      created_by: adminId
    })
    .select()
    .single()

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message.includes('duplicate') ? 'Service already exists' : 'Failed to create service' }),
      { status: error.message.includes('duplicate') ? 409 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Log creation
  console.log(JSON.stringify({
    event: 'apiservice.created',
    serviceId: service.id,
    name,
    type,
    adminId,
    timestamp: new Date().toISOString()
  }))

  return new Response(
    JSON.stringify({
      service: {
        id: service.id,
        name: service.name,
        type: service.type,
        adapterKey: service.adapter_key,
        isActive: service.is_active
      },
      message: 'Service created successfully'
    }),
    { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getKeys(supabaseClient: any, adminData: any, searchParams: URLSearchParams) {
  const serviceId = searchParams.get('serviceId')
  const status = searchParams.get('status')
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')

  let query = supabaseClient
    .from('api_keys')
    .select(`
      id, label, status, region, metadata, last_used_at, error_count, created_at,
      api_services!inner(id, name, type)
    `)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (serviceId) {
    query = query.eq('service_id', serviceId)
  }
  if (status) {
    query = query.eq('status', status)
  }

  const { data: keys, error } = await query

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch keys' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const formattedKeys = keys.map((key: any) => ({
    id: key.id,
    label: key.label,
    status: key.status,
    service: {
      id: key.api_services.id,
      name: key.api_services.name,
      type: key.api_services.type
    },
    region: key.region,
    metadata: key.metadata,
    lastUsed: key.last_used_at,
    errorCount: key.error_count,
    healthScore: Math.max(0, 100 - (key.error_count * 10)),
    createdAt: key.created_at
  }))

  return new Response(
    JSON.stringify({ keys: formattedKeys }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function createKey(supabaseClient: any, adminData: any, adminId: string, req: Request) {
  const { serviceId, label, secretPointer, region, metadata }: ApiKeyRequest = await req.json()

  if (!serviceId || !label || !secretPointer) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: serviceId, label, secretPointer' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Check permissions
  if (!adminData.permissions?.apipool?.includes('write')) {
    return new Response(
      JSON.stringify({ error: 'Insufficient permissions' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Validate service exists
  const { data: service, error: serviceError } = await supabaseClient
    .from('api_services')
    .select('id, name')
    .eq('id', serviceId)
    .single()

  if (serviceError || !service) {
    return new Response(
      JSON.stringify({ error: 'Service not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { data: key, error } = await supabaseClient
    .from('api_keys')
    .insert({
      service_id: serviceId,
      label,
      secret_pointer: secretPointer,
      region: region || 'us-east-1',
      metadata: metadata || {},
      status: 'active',
      created_by: adminId
    })
    .select()
    .single()

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message.includes('duplicate') ? 'Key label already exists' : 'Failed to create key' }),
      { status: error.message.includes('duplicate') ? 409 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Schedule health check (in production, this would be async)
  setTimeout(async () => {
    try {
      // Health check implementation would go here
      console.log(JSON.stringify({
        event: 'apikey.health_check_scheduled',
        keyId: key.id,
        serviceId,
        timestamp: new Date().toISOString()
      }))
    } catch (error) {
      console.error('Health check scheduling failed:', error)
    }
  }, 1000)

  // Log creation
  console.log(JSON.stringify({
    event: 'apikey.created',
    keyId: key.id,
    serviceId,
    label,
    adminId,
    timestamp: new Date().toISOString()
  }))

  return new Response(
    JSON.stringify({
      key: {
        id: key.id,
        label: key.label,
        status: key.status,
        service: service.name,
        region: key.region
      },
      message: 'API key created successfully. Health check scheduled.'
    }),
    { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function rotateKey(supabaseClient: any, adminData: any, adminId: string, keyId: string, req: Request) {
  const { newSecretPointer, gracePeriodHours = 24 } = await req.json()

  if (!adminData.permissions?.apipool?.includes('write')) {
    return new Response(
      JSON.stringify({ error: 'Insufficient permissions' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get existing key
  const { data: existingKey, error: keyError } = await supabaseClient
    .from('api_keys')
    .select('*, api_services(name)')
    .eq('id', keyId)
    .single()

  if (keyError || !existingKey) {
    return new Response(
      JSON.stringify({ error: 'API key not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Create rotation record
  const rotationId = crypto.randomUUID()
  const { error: rotationError } = await supabaseClient
    .from('api_key_rotations')
    .insert({
      id: rotationId,
      key_id: keyId,
      old_secret_pointer: existingKey.secret_pointer,
      new_secret_pointer: newSecretPointer,
      status: 'initiated',
      grace_period_ends: new Date(Date.now() + gracePeriodHours * 60 * 60 * 1000).toISOString(),
      initiated_by: adminId
    })

  if (rotationError) {
    return new Response(
      JSON.stringify({ error: 'Failed to create rotation record' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Update key with new secret pointer
  const { error: updateError } = await supabaseClient
    .from('api_keys')
    .update({
      secret_pointer: newSecretPointer,
      status: 'rotating',
      updated_at: new Date().toISOString()
    })
    .eq('id', keyId)

  if (updateError) {
    return new Response(
      JSON.stringify({ error: 'Failed to update key' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Log rotation
  console.log(JSON.stringify({
    event: 'apikey.rotation_started',
    keyId,
    rotationId,
    service: existingKey.api_services.name,
    gracePeriodHours,
    adminId,
    timestamp: new Date().toISOString()
  }))

  return new Response(
    JSON.stringify({
      rotationId,
      status: 'rotating',
      gracePeriodEnds: new Date(Date.now() + gracePeriodHours * 60 * 60 * 1000).toISOString(),
      message: `Key rotation initiated. Grace period: ${gracePeriodHours} hours`
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function deleteKey(supabaseClient: any, adminData: any, adminId: string, keyId: string) {
  if (!adminData.permissions?.apipool?.includes('delete')) {
    return new Response(
      JSON.stringify({ error: 'Insufficient permissions' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get key info before deletion
  const { data: key } = await supabaseClient
    .from('api_keys')
    .select('label, api_services(name)')
    .eq('id', keyId)
    .single()

  if (!key) {
    return new Response(
      JSON.stringify({ error: 'API key not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Soft delete by setting status to disabled
  const { error } = await supabaseClient
    .from('api_keys')
    .update({
      status: 'disabled',
      disabled_at: new Date().toISOString(),
      disabled_by: adminId
    })
    .eq('id', keyId)

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to delete key' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Log deletion
  console.log(JSON.stringify({
    event: 'apikey.deleted',
    keyId,
    label: key.label,
    service: key.api_services.name,
    adminId,
    timestamp: new Date().toISOString()
  }))

  return new Response(
    JSON.stringify({ message: 'API key disabled successfully' }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getSystemHealth(supabaseClient: any, adminData: any) {
  const { data: services } = await supabaseClient
    .from('api_services')
    .select(`
      id, name, type, is_active,
      api_keys(id, status, error_count, last_used_at)
    `)
    .eq('is_active', true)

  const healthSummary = {
    overall: 'healthy' as 'healthy' | 'degraded' | 'unhealthy',
    services: services?.map((service: any) => {
      const keys = service.api_keys || []
      const activeKeys = keys.filter((k: any) => k.status === 'active')
      const healthyKeys = keys.filter((k: any) => k.error_count < 3)
      
      let status = 'healthy'
      if (keys.length === 0) status = 'no_keys'
      else if (activeKeys.length === 0) status = 'down'
      else if (healthyKeys.length / keys.length < 0.5) status = 'unhealthy'
      else if (healthyKeys.length / keys.length < 0.8) status = 'degraded'
      
      return {
        id: service.id,
        name: service.name,
        type: service.type,
        status,
        keyCount: keys.length,
        activeKeyCount: activeKeys.length,
        healthyKeyCount: healthyKeys.length
      }
    }) || [],
    timestamp: new Date().toISOString()
  }

  // Determine overall health
  const serviceStatuses = healthSummary.services.map(s => s.status)
  if (serviceStatuses.includes('down') || serviceStatuses.includes('unhealthy')) {
    healthSummary.overall = 'unhealthy'
  } else if (serviceStatuses.includes('degraded')) {
    healthSummary.overall = 'degraded'
  }

  return new Response(
    JSON.stringify(healthSummary),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}