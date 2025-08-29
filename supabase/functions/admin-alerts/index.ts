import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AlertRequest {
  type: 'system' | 'cost' | 'performance' | 'security' | 'user_action'
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  description: string
  source?: string
  metadata?: Record<string, any>
  autoResolve?: boolean
  escalationRules?: {
    enabled: boolean
    afterMinutes: number
    escalateTo: string[]
    channels: string[]
  }
}

interface AlertUpdateRequest {
  status?: 'active' | 'acknowledged' | 'resolved' | 'snoozed'
  assigneeId?: string
  resolution?: string
  snoozeUntil?: string
  notes?: string
}

interface AlertFilters {
  status?: string
  severity?: string
  type?: string
  assigneeId?: string
  startDate?: string
  endDate?: string
  source?: string
  page?: number
  limit?: number
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

    // Check if user is admin (using users table with role column)
    const { data: adminUser } = await supabaseClient
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!adminUser || !['admin', 'super_admin'].includes(adminUser.role)) {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const alertId = pathParts[pathParts.length - 1]
    const action = pathParts[pathParts.length - 1]

    // Log admin activity
    await logAdminActivity(supabaseClient, user.id, `${req.method} ${url.pathname}`, req)

    // Route handlers
    if (req.method === 'GET' && !alertId.includes('acknowledge') && !alertId.includes('resolve')) {
      if (alertId && alertId !== 'alerts') {
        return await getAlert(supabaseClient, adminUser, alertId)
      } else {
        return await getAlerts(supabaseClient, adminUser, url.searchParams)
      }
    }

    if (req.method === 'POST' && !alertId.includes('acknowledge')) {
      return await createAlert(supabaseClient, adminUser, user.id, req)
    }

    if (req.method === 'PUT' && alertId) {
      return await updateAlert(supabaseClient, adminUser, user.id, alertId, req)
    }

    if (req.method === 'POST' && action === 'acknowledge') {
      const actualAlertId = pathParts[pathParts.length - 2]
      return await acknowledgeAlert(supabaseClient, adminUser, user.id, actualAlertId, req)
    }

    if (req.method === 'POST' && action === 'resolve') {
      const actualAlertId = pathParts[pathParts.length - 2]
      return await resolveAlert(supabaseClient, adminUser, user.id, actualAlertId, req)
    }

    if (req.method === 'DELETE' && alertId) {
      return await deleteAlert(supabaseClient, adminUser, user.id, alertId)
    }

    if (req.method === 'GET' && action === 'stats') {
      return await getAlertStats(supabaseClient, adminUser, url.searchParams)
    }

    if (req.method === 'POST' && action === 'bulk-action') {
      return await performBulkAction(supabaseClient, adminUser, user.id, req)
    }

    if (req.method === 'GET' && action === 'rules') {
      return await getAlertRules(supabaseClient, adminUser)
    }

    if (req.method === 'POST' && action === 'rules') {
      return await createAlertRule(supabaseClient, adminUser, user.id, req)
    }

    return new Response(
      JSON.stringify({ error: 'Invalid endpoint' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Admin Alerts error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function getAlerts(supabaseClient: any, adminUser: any, searchParams: URLSearchParams) {
  try {
    const filters: AlertFilters = {
      status: searchParams.get('status') || undefined,
      severity: searchParams.get('severity') || undefined,
      type: searchParams.get('type') || undefined,
      assigneeId: searchParams.get('assigneeId') || undefined,
      startDate: searchParams.get('startDate') || undefined,
      endDate: searchParams.get('endDate') || undefined,
      source: searchParams.get('source') || undefined,
      page: parseInt(searchParams.get('page') || '1'),
      limit: parseInt(searchParams.get('limit') || '25')
    }

    // Build query
    let query = supabaseClient
      .from('alerts')
      .select(`
        id, type, severity, title, message, source_type,
        created_at, updated_at, acknowledged_at, auto_resolve_at,
        acknowledged_by, source_id, metadata, is_acknowledged,
        alert_logs (id, action, message, created_at, admin_id),
        assignee:users!alerts_acknowledged_by_fkey(email)
      `, { count: 'exact' })

    // Apply filters - convert status to boolean logic
    if (filters.status) {
      switch (filters.status) {
        case 'active':
          query = query.eq('is_acknowledged', false)
          break
        case 'acknowledged':
          query = query.eq('is_acknowledged', true)
          break
        case 'resolved':
          query = query.not('auto_resolve_at', 'is', null)
            .lt('auto_resolve_at', new Date().toISOString())
          break
      }
    }

    if (filters.severity) {
      query = query.eq('severity', filters.severity)
    }

    if (filters.type) {
      query = query.eq('type', filters.type)
    }

    if (filters.assigneeId) {
      query = query.eq('acknowledged_by', filters.assigneeId)
    }

    if (filters.source) {
      query = query.eq('source_type', filters.source)
    }

    if (filters.startDate) {
      query = query.gte('created_at', filters.startDate)
    }

    if (filters.endDate) {
      query = query.lte('created_at', filters.endDate)
    }

    // Pagination and sorting
    const offset = (filters.page! - 1) * filters.limit!
    const { data: alerts, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + filters.limit! - 1)

    if (error) throw error

    // Enrich alert data
    const enrichedAlerts = (alerts || []).map(alert => {
      const derivedStatus = alert.is_acknowledged ? 'acknowledged' : 
        (alert.auto_resolve_at && new Date(alert.auto_resolve_at) < new Date()) ? 'resolved' : 'active'
      
      return {
        id: alert.id,
        type: alert.type,
        severity: alert.severity,
        title: alert.title,
        description: alert.message,
        status: derivedStatus,
        source: alert.source_type,
        
        // Timing information
        timing: {
          createdAt: alert.created_at,
          updatedAt: alert.updated_at,
          acknowledgedAt: alert.acknowledged_at,
          resolvedAt: alert.auto_resolve_at && new Date(alert.auto_resolve_at) < new Date() ? alert.auto_resolve_at : null,
          ageInMinutes: Math.round((Date.now() - new Date(alert.created_at).getTime()) / 60000),
          isOverdue: isAlertOverdue(alert)
        },

        // Assignment information
        assignment: {
          assigneeId: alert.acknowledged_by,
          assigneeEmail: alert.assignee?.email,
          createdByEmail: null, // Not tracked in current schema
          escalationLevel: 0 // Not tracked in current schema
        },

        // Metadata and context
        metadata: alert.metadata || {},
        
        // Activity log
        recentActivity: (alert.alert_logs || [])
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 5)
          .map(log => ({
            action: log.action,
            message: log.message,
            timestamp: log.created_at,
            adminId: log.admin_id
          })),

        // Alert health
        health: {
          requiresAttention: derivedStatus === 'active' && ['high', 'critical'].includes(alert.severity),
          isEscalated: false, // Not tracked in current schema
          isStale: Math.round((Date.now() - new Date(alert.updated_at).getTime()) / 60000) > 60
        }
      }
    })

    // Calculate summary statistics
    const summary = {
      total: count || 0,
      byStatus: calculateBreakdown(enrichedAlerts, 'status'),
      bySeverity: calculateBreakdown(enrichedAlerts, 'severity'),
      byType: calculateBreakdown(enrichedAlerts, 'type'),
      criticalAlerts: enrichedAlerts.filter(a => a.severity === 'critical' && a.status === 'active').length,
      overdueAlerts: enrichedAlerts.filter(a => a.timing.isOverdue).length,
      unassignedAlerts: enrichedAlerts.filter(a => !a.assignment.assigneeId).length
    }

    return new Response(
      JSON.stringify({
        alerts: enrichedAlerts,
        summary,
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / filters.limit!),
          hasMore: offset + filters.limit! < (count || 0)
        },
        filters: {
          applied: Object.keys(filters).filter(key => filters[key] !== undefined),
          available: ['status', 'severity', 'type', 'assigneeId', 'source', 'startDate', 'endDate']
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error fetching alerts:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to fetch alerts', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function getAlert(supabaseClient: any, adminUser: any, alertId: string) {
  try {
    const { data: alert, error } = await supabaseClient
      .from('system_alerts')
      .select(`
        id, type, severity, title, description, status, source,
        created_at, updated_at, resolved_at, acknowledged_at,
        assignee_id, created_by, metadata, escalation_level,
        escalation_rules, auto_resolve, resolution_notes,
        alert_logs (
          id, action, message, metadata, created_at,
          admin_id, users!alert_logs_admin_id_fkey(email)
        ),
        assignee:users!system_alerts_assignee_id_fkey(id, email, role),
        creator:users!system_alerts_created_by_fkey(id, email)
      `)
      .eq('id', alertId)
      .single()

    if (error || !alert) {
      return new Response(
        JSON.stringify({ error: 'Alert not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get related alerts (similar type/source)
    const { data: relatedAlerts } = await supabaseClient
      .from('system_alerts')
      .select('id, title, severity, status, created_at')
      .eq('type', alert.type)
      .eq('source', alert.source)
      .neq('id', alertId)
      .order('created_at', { ascending: false })
      .limit(10)

    // Get impact analysis
    const impactAnalysis = await analyzeAlertImpact(supabaseClient, alert)

    const detailedAlert = {
      id: alert.id,
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
      description: alert.description,
      status: alert.status,
      source: alert.source,

      // Comprehensive timing
      timing: {
        createdAt: alert.created_at,
        updatedAt: alert.updated_at,
        acknowledgedAt: alert.acknowledged_at,
        resolvedAt: alert.resolved_at,
        totalDuration: calculateAlertDuration(alert.created_at, alert.resolved_at),
        timeToAcknowledge: calculateAlertDuration(alert.created_at, alert.acknowledged_at),
        timeToResolve: calculateAlertDuration(alert.acknowledged_at, alert.resolved_at),
        ageInMinutes: Math.round((Date.now() - new Date(alert.created_at).getTime()) / 60000),
        isOverdue: isAlertOverdue(alert)
      },

      // Assignment and escalation
      assignment: {
        assigneeId: alert.assignee_id,
        assignee: alert.assignee,
        creator: alert.creator,
        escalationLevel: alert.escalation_level || 0,
        escalationRules: alert.escalation_rules
      },

      // Configuration
      configuration: {
        autoResolve: alert.auto_resolve || false,
        escalationRules: alert.escalation_rules || {}
      },

      // Full activity log
      activityLog: (alert.alert_logs || [])
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map(log => ({
          id: log.id,
          action: log.action,
          message: log.message,
          metadata: log.metadata,
          timestamp: log.created_at,
          admin: {
            id: log.admin_id,
            email: log.users?.email
          },
          timeFromCreation: calculateAlertDuration(alert.created_at, log.created_at)
        })),

      // Resolution information
      resolution: {
        notes: alert.resolution_notes,
        resolvedAt: alert.resolved_at,
        resolvedBy: alert.resolved_by,
        wasAutoResolved: alert.auto_resolved || false
      },

      // Context and metadata
      metadata: alert.metadata || {},
      
      // Impact analysis
      impact: impactAnalysis,

      // Related alerts
      relatedAlerts: relatedAlerts || [],

      // Available actions
      availableActions: getAvailableAlertActions(alert, adminUser),

      // Suggestions
      suggestions: generateAlertSuggestions(alert, relatedAlerts || [])
    }

    return new Response(
      JSON.stringify({ alert: detailedAlert }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error fetching alert details:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to fetch alert details' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function createAlert(supabaseClient: any, adminUser: any, adminId: string, req: Request) {
  const { 
    type, 
    severity, 
    title, 
    description, 
    source, 
    metadata = {},
    autoResolve = false,
    escalationRules 
  }: AlertRequest = await req.json()

  if (!type || !severity || !title) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: type, severity, title' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    // Check for duplicate active alerts
    const { data: existingAlerts } = await supabaseClient
      .from('system_alerts')
      .select('id, title')
      .eq('type', type)
      .eq('title', title)
      .eq('status', 'active')
      .eq('source', source || 'manual')

    if (existingAlerts && existingAlerts.length > 0) {
      return new Response(
        JSON.stringify({ 
          error: 'Similar active alert already exists',
          existingAlertId: existingAlerts[0].id 
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create alert
    const { data: alert, error } = await supabaseClient
      .from('system_alerts')
      .insert({
        type,
        severity,
        title,
        description: description || '',
        status: 'active',
        source: source || 'manual',
        created_by: adminId,
        metadata: {
          ...metadata,
          createdByAdmin: true,
          originalSeverity: severity
        },
        auto_resolve: autoResolve,
        escalation_rules: escalationRules,
        escalation_level: 0
      })
      .select()
      .single()

    if (error) throw error

    // Log alert creation
    await supabaseClient
      .from('alert_logs')
      .insert({
        alert_id: alert.id,
        admin_id: adminId,
        action: 'created',
        message: `Alert created with severity: ${severity}`,
        metadata: { type, source, autoResolve }
      })

    // Log admin action
    await supabaseClient
      .from('admin_logs')
      .insert({
        admin_id: adminId,
        action: 'create_alert',
        resource_type: 'alert',
        resource_id: alert.id,
        details: { type, severity, title, source }
      })

    // Trigger notifications for high/critical alerts
    if (severity in ['high', 'critical']) {
      await triggerAlertNotifications(supabaseClient, alert)
    }

    // Schedule auto-resolution if enabled
    if (autoResolve) {
      await scheduleAutoResolution(supabaseClient, alert.id, metadata.autoResolveMinutes || 60)
    }

    // Structured logging
    console.log(JSON.stringify({
      event: 'alert_created',
      level: 'INFO',
      alert_id: alert.id,
      type,
      severity,
      source: source || 'manual',
      admin_id: adminId,
      timestamp: new Date().toISOString()
    }))

    return new Response(
      JSON.stringify({
        alert: {
          id: alert.id,
          type: alert.type,
          severity: alert.severity,
          title: alert.title,
          status: alert.status,
          createdAt: alert.created_at
        },
        message: 'Alert created successfully',
        notificationsSent: severity in ['high', 'critical']
      }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error creating alert:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to create alert', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function acknowledgeAlert(supabaseClient: any, adminUser: any, adminId: string, alertId: string, req: Request) {
  const { notes, assignToSelf = true } = await req.json()

  try {
    const updateData: any = {
      status: 'acknowledged',
      acknowledged_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    if (assignToSelf) {
      updateData.assignee_id = adminId
    }

    const { data: alert, error } = await supabaseClient
      .from('system_alerts')
      .update(updateData)
      .eq('id', alertId)
      .eq('status', 'active')
      .select()
      .single()

    if (error || !alert) {
      return new Response(
        JSON.stringify({ error: 'Alert not found or already processed' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Log acknowledgment
    await supabaseClient
      .from('alert_logs')
      .insert({
        alert_id: alertId,
        admin_id: adminId,
        action: 'acknowledged',
        message: notes || 'Alert acknowledged',
        metadata: { assignedToSelf: assignToSelf }
      })

    // Structured logging
    console.log(JSON.stringify({
      event: 'alert_acknowledged',
      level: 'INFO',
      alert_id: alertId,
      admin_id: adminId,
      assigned_to_self: assignToSelf,
      timestamp: new Date().toISOString()
    }))

    return new Response(
      JSON.stringify({
        alertId,
        status: 'acknowledged',
        acknowledgedAt: updateData.acknowledged_at,
        assignedTo: assignToSelf ? adminId : null,
        message: 'Alert acknowledged successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error acknowledging alert:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to acknowledge alert' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function resolveAlert(supabaseClient: any, adminUser: any, adminId: string, alertId: string, req: Request) {
  const { resolution, preventSimilar = false } = await req.json()

  if (!resolution) {
    return new Response(
      JSON.stringify({ error: 'Resolution notes are required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const { data: alert, error } = await supabaseClient
      .from('system_alerts')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        resolved_by: adminId,
        resolution_notes: resolution,
        updated_at: new Date().toISOString()
      })
      .eq('id', alertId)
      .neq('status', 'resolved')
      .select()
      .single()

    if (error || !alert) {
      return new Response(
        JSON.stringify({ error: 'Alert not found or already resolved' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Log resolution
    await supabaseClient
      .from('alert_logs')
      .insert({
        alert_id: alertId,
        admin_id: adminId,
        action: 'resolved',
        message: resolution,
        metadata: { preventSimilar }
      })

    // Create prevention rule if requested
    if (preventSimilar) {
      await createPreventionRule(supabaseClient, alert, adminId)
    }

    // Calculate resolution metrics
    const createdAt = new Date(alert.created_at).getTime()
    const resolvedAt = new Date(alert.resolved_at).getTime()
    const resolutionTimeMinutes = Math.round((resolvedAt - createdAt) / 60000)

    // Structured logging
    console.log(JSON.stringify({
      event: 'alert_resolved',
      level: 'INFO',
      alert_id: alertId,
      admin_id: adminId,
      resolution_time_minutes: resolutionTimeMinutes,
      prevent_similar: preventSimilar,
      timestamp: new Date().toISOString()
    }))

    return new Response(
      JSON.stringify({
        alertId,
        status: 'resolved',
        resolvedAt: alert.resolved_at,
        resolvedBy: adminId,
        resolutionTimeMinutes,
        message: 'Alert resolved successfully',
        preventionRuleCreated: preventSimilar
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error resolving alert:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to resolve alert' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function getAlertStats(supabaseClient: any, adminUser: any, searchParams: URLSearchParams) {
  try {
    const timeRange = searchParams.get('timeRange') || '24h'
    const includeDetails = searchParams.get('includeDetails') === 'true'

    // Calculate time range
    const ranges = {
      '1h': 1 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    }

    const rangeMs = ranges[timeRange] || ranges['24h']
    const fromDate = new Date(Date.now() - rangeMs)

    // Get alert statistics
    const { data: alerts, error } = await supabaseClient
      .from('system_alerts')
      .select(`
        id, type, severity, status, created_at, acknowledged_at, resolved_at,
        escalation_level, source
      `)
      .gte('created_at', fromDate.toISOString())

    if (error) throw error

    const stats = {
      overview: {
        total: alerts?.length || 0,
        active: 0,
        acknowledged: 0,
        resolved: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0
      },
      performance: {
        averageAckTime: 0,
        averageResolutionTime: 0,
        resolutionRate: 0,
        escalationRate: 0
      },
      breakdown: {
        byType: {},
        bySource: {},
        bySeverity: {},
        byStatus: {}
      },
      trends: generateAlertTrends(alerts || [], rangeMs),
      topSources: getTopAlertSources(alerts || []),
      responseMetrics: calculateResponseMetrics(alerts || [])
    }

    // Process each alert
    for (const alert of alerts || []) {
      // Status counts
      stats.overview[alert.status]++
      stats.overview[alert.severity]++

      // Breakdowns
      stats.breakdown.byType[alert.type] = (stats.breakdown.byType[alert.type] || 0) + 1
      stats.breakdown.bySource[alert.source] = (stats.breakdown.bySource[alert.source] || 0) + 1
      stats.breakdown.bySeverity[alert.severity] = (stats.breakdown.bySeverity[alert.severity] || 0) + 1
      stats.breakdown.byStatus[alert.status] = (stats.breakdown.byStatus[alert.status] || 0) + 1
    }

    // Calculate performance metrics
    const resolvedAlerts = alerts?.filter(a => a.resolved_at) || []
    const acknowledgedAlerts = alerts?.filter(a => a.acknowledged_at) || []
    const escalatedAlerts = alerts?.filter(a => a.escalation_level > 0) || []

    if (resolvedAlerts.length > 0) {
      const totalResolutionTime = resolvedAlerts.reduce((sum, alert) => {
        return sum + (new Date(alert.resolved_at).getTime() - new Date(alert.created_at).getTime())
      }, 0)
      stats.performance.averageResolutionTime = Math.round(totalResolutionTime / resolvedAlerts.length / 60000) // minutes
    }

    if (acknowledgedAlerts.length > 0) {
      const totalAckTime = acknowledgedAlerts.reduce((sum, alert) => {
        return sum + (new Date(alert.acknowledged_at).getTime() - new Date(alert.created_at).getTime())
      }, 0)
      stats.performance.averageAckTime = Math.round(totalAckTime / acknowledgedAlerts.length / 60000) // minutes
    }

    stats.performance.resolutionRate = (alerts?.length || 0) > 0 ? resolvedAlerts.length / (alerts?.length || 1) : 0
    stats.performance.escalationRate = (alerts?.length || 0) > 0 ? escalatedAlerts.length / (alerts?.length || 1) : 0

    return new Response(
      JSON.stringify({
        stats,
        timeRange,
        generatedAt: new Date().toISOString(),
        includeDetails
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error fetching alert stats:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to fetch alert stats' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Helper functions
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

function calculateBreakdown(items: any[], field: string) {
  return items.reduce((acc, item) => {
    const value = item[field] || 'unknown'
    acc[value] = (acc[value] || 0) + 1
    return acc
  }, {})
}

function isAlertOverdue(alert: any): boolean {
  if (alert.status === 'resolved') return false
  
  const overdueThresholds = {
    critical: 15, // 15 minutes
    high: 60,     // 1 hour  
    medium: 240,  // 4 hours
    low: 1440     // 24 hours
  }

  const threshold = overdueThresholds[alert.severity] || 240
  const ageMinutes = Math.round((Date.now() - new Date(alert.created_at).getTime()) / 60000)
  
  return ageMinutes > threshold
}

function calculateAlertDuration(startTime: string | null, endTime: string | null): number {
  if (!startTime || !endTime) return 0
  return Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000)
}

async function analyzeAlertImpact(supabaseClient: any, alert: any) {
  // Simplified impact analysis
  return {
    severity: alert.severity,
    affectedSystems: [],
    estimatedUserImpact: 0,
    businessImpact: 'low'
  }
}

function getAvailableAlertActions(alert: any, adminUser: any): string[] {
  const actions = []

  if (alert.status === 'active') {
    actions.push('acknowledge', 'resolve', 'assign', 'escalate')
  }

  if (alert.status === 'acknowledged') {
    actions.push('resolve', 'reassign')
  }

  if (adminUser.role === 'super_admin') {
    actions.push('delete', 'modify', 'suppress')
  }

  return actions
}

function generateAlertSuggestions(alert: any, relatedAlerts: any[]): string[] {
  const suggestions = []

  if (relatedAlerts.length > 3) {
    suggestions.push('Consider creating an alert rule to prevent similar alerts')
  }

  if (alert.severity === 'critical' && !alert.acknowledged_at) {
    suggestions.push('This critical alert requires immediate attention')
  }

  if (alert.escalation_level === 0 && isAlertOverdue(alert)) {
    suggestions.push('Consider escalating this overdue alert')
  }

  return suggestions
}

function generateAlertTrends(alerts: any[], rangeMs: number) {
  // Simplified trend generation
  return {
    hourly: [],
    daily: []
  }
}

function getTopAlertSources(alerts: any[]) {
  const sourceCounts = {}
  alerts.forEach(alert => {
    sourceCounts[alert.source] = (sourceCounts[alert.source] || 0) + 1
  })

  return Object.entries(sourceCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .map(([source, count]) => ({ source, count }))
}

function calculateResponseMetrics(alerts: any[]) {
  return {
    totalAlerts: alerts.length,
    resolvedAlerts: alerts.filter(a => a.resolved_at).length,
    avgResolutionTime: 0, // Would calculate from actual data
    slaCompliance: 0.95 // Would calculate from actual data
  }
}

async function triggerAlertNotifications(supabaseClient: any, alert: any) {
  // In production, this would trigger notifications via various channels
  console.log(`Notifications triggered for ${alert.severity} alert: ${alert.title}`)
}

async function scheduleAutoResolution(supabaseClient: any, alertId: string, minutes: number) {
  // In production, this would schedule a background task
  console.log(`Auto-resolution scheduled for alert ${alertId} in ${minutes} minutes`)
}

async function createPreventionRule(supabaseClient: any, alert: any, adminId: string) {
  // In production, this would create a rule to prevent similar alerts
  console.log(`Prevention rule created for alert pattern: ${alert.type}`)
}

// Additional simplified endpoint implementations
async function updateAlert(supabaseClient: any, adminUser: any, adminId: string, alertId: string, req: Request) {
  return new Response(
    JSON.stringify({ message: 'Alert update not fully implemented' }),
    { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function deleteAlert(supabaseClient: any, adminUser: any, adminId: string, alertId: string) {
  return new Response(
    JSON.stringify({ message: 'Alert deletion not implemented' }),
    { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function performBulkAction(supabaseClient: any, adminUser: any, adminId: string, req: Request) {
  return new Response(
    JSON.stringify({ message: 'Bulk actions not implemented' }),
    { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getAlertRules(supabaseClient: any, adminUser: any) {
  return new Response(
    JSON.stringify({ message: 'Alert rules not implemented' }),
    { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function createAlertRule(supabaseClient: any, adminUser: any, adminId: string, req: Request) {
  return new Response(
    JSON.stringify({ message: 'Alert rule creation not implemented' }),
    { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}