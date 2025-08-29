import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ScriptRequest {
  brand: string // domain or brand ID
  type?: 'schema' | 'analytics' | 'monitoring' | 'combined'
  version?: string
  debug?: boolean
}

interface ScriptConfig {
  id: string
  brand_id: string
  script_type: string
  config: any
  is_active: boolean
  version: string
  cache_duration: number
}

serve(async (req) => {
  const url = new URL(req.url)
  const params = Object.fromEntries(url.searchParams.entries()) as ScriptRequest

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    // Handle script serving
    if (req.method === 'GET' && url.pathname.endsWith('.js')) {
      return await serveScript(supabaseClient, params, req)
    }

    // Handle script configuration (requires auth)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required for configuration endpoints' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseClientAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    )

    const { data: { user }, error: userError } = await supabaseClientAuth.auth.getUser()
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (req.method === 'POST') {
      return await configureScript(supabaseClientAuth, user.id, req)
    }

    if (req.method === 'GET') {
      return await getScriptConfig(supabaseClientAuth, user.id, url.searchParams)
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Script serving error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function serveScript(supabaseClient: any, params: ScriptRequest, req: Request): Promise<Response> {
  const { brand, type = 'combined', version = 'latest', debug = false } = params

  if (!brand) {
    return new Response(
      'console.error("GeoScore: Brand parameter required");',
      { 
        status: 400,
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/javascript',
          'Cache-Control': 'no-cache'
        } 
      }
    )
  }

  // Find brand by domain or ID
  let brandData
  if (brand.includes('.')) {
    // Search by domain
    const { data } = await supabaseClient
      .from('brands')
      .select('*')
      .eq('domain', brand)
      .single()
    brandData = data
  } else {
    // Search by ID
    const { data } = await supabaseClient
      .from('brands')
      .select('*')
      .eq('id', brand)
      .single()
    brandData = data
  }

  if (!brandData) {
    return new Response(
      'console.warn("GeoScore: Brand not found");',
      { 
        status: 404,
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/javascript',
          'Cache-Control': 'no-cache'
        } 
      }
    )
  }

  // Get script configuration
  const { data: scriptConfig } = await supabaseClient
    .from('script_configs')
    .select('*')
    .eq('brand_id', brandData.id)
    .eq('script_type', type)
    .eq('is_active', true)
    .single()

  // Get brand schema if needed
  let schema = null
  if (type === 'schema' || type === 'combined') {
    const { data: schemaData } = await supabaseClient
      .from('schemas')
      .select('json_schema')
      .eq('brand_id', brandData.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    
    if (schemaData) {
      schema = schemaData.json_schema
    }
  }

  // Generate the script
  const script = generateScript(brandData, type, schema, scriptConfig?.config, debug)

  // Calculate cache duration
  const cacheDuration = scriptConfig?.cache_duration || 3600 // 1 hour default
  const etag = `"${generateETag(brandData.id, type, version)}"`

  // Check if client has cached version
  const clientETag = req.headers.get('If-None-Match')
  if (clientETag === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ...corsHeaders,
        'Cache-Control': `public, max-age=${cacheDuration}`,
        'ETag': etag
      }
    })
  }

  // Track usage
  trackScriptUsage(supabaseClient, brandData.id, req, version)

  return new Response(script, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': `public, max-age=${cacheDuration}`,
      'ETag': etag,
      'X-GeoScore-Version': version,
      'X-GeoScore-Type': type
    }
  })
}

function generateScript(brand: any, type: string, schema: any, config: any, debug: boolean): string {
  const apiEndpoint = Deno.env.get('SUPABASE_URL') + '/functions/v1'
  
  const baseScript = `
(function(window, document) {
  'use strict';
  
  // Configuration
  const GeoScore = {
    version: '${config?.version || '1.0.0'}',
    debug: ${debug},
    config: {
      brandId: '${brand.id}',
      brandName: '${brand.name}',
      domain: '${brand.domain}',
      schemaEnabled: ${type === 'schema' || type === 'combined'},
      analyticsEnabled: ${type === 'analytics' || type === 'combined'},
      monitoringEnabled: ${type === 'monitoring' || type === 'combined'},
      apiEndpoint: '${apiEndpoint}',
      trackingEndpoint: '${apiEndpoint}/script-tracking'
    },
    
    // Core methods
    log: function(message, data) {
      if (this.debug) {
        console.log('[GeoScore]', message, data || '');
      }
    },
    
    error: function(message, error) {
      console.error('[GeoScore]', message, error || '');
    },
    
    // Schema injection
    injectSchema: function(schema) {
      if (!this.config.schemaEnabled || !schema) return;
      
      try {
        const existingSchema = document.querySelector('script[type="application/ld+json"][data-geoscore]');
        if (existingSchema) {
          existingSchema.remove();
        }
        
        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.setAttribute('data-geoscore', 'true');
        script.textContent = JSON.stringify(schema, null, this.debug ? 2 : 0);
        document.head.appendChild(script);
        
        this.log('Schema injected successfully', schema);
      } catch (error) {
        this.error('Failed to inject schema', error);
      }
    },
    
    // Analytics tracking
    track: function(event, data) {
      if (!this.config.analyticsEnabled) return;
      
      const payload = {
        brandId: this.config.brandId,
        event: event,
        data: data || {},
        url: window.location.href,
        referrer: document.referrer,
        timestamp: Date.now(),
        userAgent: navigator.userAgent
      };
      
      // Use sendBeacon if available, fallback to fetch
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          this.config.trackingEndpoint,
          JSON.stringify(payload)
        );
      } else {
        fetch(this.config.trackingEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true
        }).catch(error => this.error('Tracking failed', error));
      }
      
      this.log('Event tracked', payload);
    },
    
    // Performance monitoring
    monitor: function() {
      if (!this.config.monitoringEnabled) return;
      
      // Track page load performance
      if (window.performance && window.performance.timing) {
        const timing = window.performance.timing;
        const loadTime = timing.loadEventEnd - timing.navigationStart;
        
        this.track('page_performance', {
          loadTime: loadTime,
          domContentLoaded: timing.domContentLoadedEventEnd - timing.navigationStart,
          firstPaint: timing.responseStart - timing.navigationStart
        });
      }
      
      // Monitor for errors
      window.addEventListener('error', (event) => {
        this.track('javascript_error', {
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        });
      });
      
      // Monitor for unhandled promise rejections
      window.addEventListener('unhandledrejection', (event) => {
        this.track('promise_rejection', {
          reason: event.reason
        });
      });
    },
    
    // Main initialization
    init: function() {
      this.log('Initializing GeoScore for ' + this.config.brandName);
      
      // Inject schema if provided
      ${schema ? `this.injectSchema(${JSON.stringify(schema)});` : ''}
      
      // Track page view
      this.track('page_view', {
        title: document.title,
        location: window.location.href
      });
      
      // Start monitoring if enabled
      this.monitor();
      
      // Custom configuration
      ${config?.customInit || ''}
      
      this.log('GeoScore initialization complete');
    }
  };
  
  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      GeoScore.init();
    });
  } else {
    // DOM is already ready
    setTimeout(function() { GeoScore.init(); }, 0);
  }
  
  // Expose global API
  window.GeoScore = GeoScore;
  
  // Mark as loaded
  window.GeoScoreLoaded = true;
  
})(window, document);
`

  return debug ? baseScript : minifyScript(baseScript)
}

function minifyScript(script: string): string {
  // Basic minification - remove comments and excess whitespace
  return script
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
    .replace(/\/\/.*$/gm, '') // Remove line comments
    .replace(/\s+/g, ' ') // Collapse whitespace
    .replace(/;\s*}/g, ';}') // Remove spaces before closing braces
    .trim()
}

function generateETag(brandId: string, type: string, version: string): string {
  const content = `${brandId}-${type}-${version}-${Date.now()}`
  // Simple hash function
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36)
}

async function trackScriptUsage(supabaseClient: any, brandId: string, req: Request, version: string) {
  try {
    const userAgent = req.headers.get('User-Agent') || ''
    const referer = req.headers.get('Referer') || ''
    const url = new URL(req.url)
    
    await supabaseClient
      .from('script_usage')
      .insert({
        brand_id: brandId,
        domain: referer ? new URL(referer).hostname : null,
        script_version: version,
        page_url: referer,
        user_agent: userAgent,
        ip_address: req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || 'unknown'
      })
  } catch (error) {
    console.warn('Failed to track script usage:', error)
  }
}

async function configureScript(supabaseClient: any, userId: string, req: Request): Promise<Response> {
  const { brandId, scriptType, config, version } = await req.json()

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

  // Upsert script configuration
  const { data: scriptConfig, error: configError } = await supabaseClient
    .from('script_configs')
    .upsert({
      brand_id: brandId,
      script_type: scriptType,
      config: config,
      version: version || '1.0.0',
      is_active: true,
      cache_duration: config.cacheDuration || 3600
    })
    .select()
    .single()

  if (configError) {
    return new Response(
      JSON.stringify({ error: 'Failed to save configuration' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({
      scriptConfig,
      scriptUrl: `${Deno.env.get('SUPABASE_URL')}/functions/v1/script-serving/geoscore.js?brand=${brand.domain}&type=${scriptType}&version=${version}`,
      message: 'Script configuration saved successfully'
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getScriptConfig(supabaseClient: any, userId: string, searchParams: URLSearchParams): Promise<Response> {
  const brandId = searchParams.get('brandId')

  if (!brandId) {
    return new Response(
      JSON.stringify({ error: 'Brand ID required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const { data: configs, error } = await supabaseClient
    .from('script_configs')
    .select(`
      *,
      brands!inner(name, domain, owner_id)
    `)
    .eq('brands.owner_id', userId)
    .eq('brand_id', brandId)
    .eq('is_active', true)

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch configurations' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({ configs }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}