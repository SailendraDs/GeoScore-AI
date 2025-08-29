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
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Verify admin permissions
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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

    // Get query parameters
    const url = new URL(req.url)
    const serviceId = url.searchParams.get('serviceId')
    const timeRange = url.searchParams.get('timeRange') || '7d'

    // Calculate time range
    const now = new Date()
    const timeRangeMap: Record<string, number> = {
      '1h': 1 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    }
    
    const rangeMs = timeRangeMap[timeRange] || timeRangeMap['7d']
    const startTime = new Date(now.getTime() - rangeMs)

    // Build query for API keys with services
    let query = supabaseClient
      .from('api_keys')
      .select(`
        *,
        api_services (
          name,
          type,
          status,
          rate_limits
        )
      `)
      .gte('created_at', startTime.toISOString())

    if (serviceId) {
      query = query.eq('service_id', serviceId)
    }

    const { data: keysData, error: keysError } = await query

    if (keysError) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch key statistics' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Calculate statistics
    const stats = {
      summary: {
        totalKeys: keysData.length,
        activeKeys: keysData.filter(k => k.is_active).length,
        totalUsage: keysData.reduce((sum, k) => sum + (k.usage_count || 0), 0),
        totalErrors: keysData.reduce((sum, k) => sum + (k.error_count || 0), 0),
        errorRate: 0,
      },
      byService: {} as Record<string, any>,
      byType: {} as Record<string, any>,
      recentActivity: [] as any[],
    }

    // Calculate error rate
    if (stats.summary.totalUsage > 0) {
      stats.summary.errorRate = (stats.summary.totalErrors / stats.summary.totalUsage) * 100
    }

    // Group by service
    keysData.forEach(key => {
      const serviceName = key.api_services?.name || 'unknown'
      const serviceType = key.api_services?.type || 'unknown'
      
      if (!stats.byService[serviceName]) {
        stats.byService[serviceName] = {
          name: serviceName,
          type: serviceType,
          keyCount: 0,
          totalUsage: 0,
          totalErrors: 0,
          status: key.api_services?.status || 'unknown',
          lastUsed: null,
        }
      }
      
      stats.byService[serviceName].keyCount++
      stats.byService[serviceName].totalUsage += key.usage_count || 0
      stats.byService[serviceName].totalErrors += key.error_count || 0
      
      if (key.last_used) {
        const lastUsed = new Date(key.last_used)
        if (!stats.byService[serviceName].lastUsed || 
            lastUsed > new Date(stats.byService[serviceName].lastUsed)) {
          stats.byService[serviceName].lastUsed = key.last_used
        }
      }

      // Group by type
      if (!stats.byType[serviceType]) {
        stats.byType[serviceType] = {
          type: serviceType,
          keyCount: 0,
          totalUsage: 0,
          totalErrors: 0,
        }
      }
      
      stats.byType[serviceType].keyCount++
      stats.byType[serviceType].totalUsage += key.usage_count || 0
      stats.byType[serviceType].totalErrors += key.error_count || 0
    })

    // Recent activity (last 10 most used keys)
    stats.recentActivity = keysData
      .filter(k => k.last_used)
      .sort((a, b) => new Date(b.last_used!).getTime() - new Date(a.last_used!).getTime())
      .slice(0, 10)
      .map(k => ({
        serviceName: k.api_services?.name,
        keyName: k.key_name,
        lastUsed: k.last_used,
        usageCount: k.usage_count,
        errorCount: k.error_count,
        isActive: k.is_active,
      }))

    return new Response(
      JSON.stringify({
        timeRange,
        startTime: startTime.toISOString(),
        endTime: now.toISOString(),
        stats,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Key stats error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})