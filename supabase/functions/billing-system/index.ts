import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.21.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16',
})

interface CreateCheckoutRequest {
  planId: string
  successUrl: string
  cancelUrl: string
}

interface BillingPortalRequest {
  returnUrl?: string
}

interface UsageTrackingRequest {
  userId: string
  resourceType: 'llm_reports' | 'api_calls' | 'storage_gb' | 'competitors_tracked'
  usageCount: number
}

const PLAN_CONFIGS = {
  starter: {
    name: 'Starter',
    stripePriceId: 'price_starter_monthly',
    monthlyPrice: 29.00,
    features: {
      maxBrands: 1,
      maxLLMs: 3,
      maxReportsPerMonth: 50,
      maxCompetitorsTracked: 5,
      realTimeMonitoring: false,
      customSchemas: false,
      apiAccess: false,
      whiteLabel: false,
      prioritySupport: false
    }
  },
  professional: {
    name: 'Professional',
    stripePriceId: 'price_professional_monthly',
    monthlyPrice: 99.00,
    features: {
      maxBrands: 5,
      maxLLMs: 7,
      maxReportsPerMonth: 500,
      maxCompetitorsTracked: 25,
      realTimeMonitoring: true,
      customSchemas: true,
      apiAccess: true,
      whiteLabel: false,
      prioritySupport: true
    }
  },
  enterprise: {
    name: 'Enterprise',
    stripePriceId: 'price_enterprise_monthly',
    monthlyPrice: 299.00,
    features: {
      maxBrands: -1, // unlimited
      maxLLMs: -1,
      maxReportsPerMonth: -1,
      maxCompetitorsTracked: -1,
      realTimeMonitoring: true,
      customSchemas: true,
      apiAccess: true,
      whiteLabel: true,
      prioritySupport: true
    }
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

    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const action = pathParts[pathParts.length - 1]

    // Webhook endpoint doesn't require authentication
    if (action === 'webhook' && req.method === 'POST') {
      return await handleStripeWebhook(supabaseClient, req)
    }

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (req.method === 'POST') {
      switch (action) {
        case 'checkout':
          return await createCheckoutSession(supabaseClient, user.id, req)
        case 'portal':
          return await createBillingPortal(supabaseClient, user.id, req)
        case 'track-usage':
          return await trackUsage(supabaseClient, user.id, req)
        case 'cancel-subscription':
          return await cancelSubscription(supabaseClient, user.id, req)
        default:
          return new Response(
            JSON.stringify({ error: 'Invalid action' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
      }
    }

    if (req.method === 'GET') {
      switch (action) {
        case 'subscription':
          return await getSubscription(supabaseClient, user.id)
        case 'usage':
          return await getUsage(supabaseClient, user.id, url.searchParams)
        case 'plans':
          return await getPlans()
        case 'invoices':
          return await getInvoices(supabaseClient, user.id, url.searchParams)
        default:
          return await getBillingDashboard(supabaseClient, user.id)
      }
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Billing system error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function createCheckoutSession(supabaseClient: any, userId: string, req: Request): Promise<Response> {
  const { planId, successUrl, cancelUrl }: CreateCheckoutRequest = await req.json()

  const planConfig = PLAN_CONFIGS[planId as keyof typeof PLAN_CONFIGS]
  if (!planConfig) {
    return new Response(
      JSON.stringify({ error: 'Invalid plan' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get or create Stripe customer
  const { data: user } = await supabaseClient
    .from('users')
    .select('email, stripe_customer_id')
    .eq('id', userId)
    .single()

  let stripeCustomerId = user?.stripe_customer_id

  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: {
        supabase_user_id: userId
      }
    })
    
    stripeCustomerId = customer.id
    
    // Update user with Stripe customer ID
    await supabaseClient
      .from('users')
      .update({ stripe_customer_id: stripeCustomerId })
      .eq('id', userId)
  }

  // Create checkout session
  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    payment_method_types: ['card'],
    line_items: [
      {
        price: planConfig.stripePriceId,
        quantity: 1,
      }
    ],
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      user_id: userId,
      plan_id: planId
    }
  })

  return new Response(
    JSON.stringify({
      sessionId: session.id,
      url: session.url
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function createBillingPortal(supabaseClient: any, userId: string, req: Request): Promise<Response> {
  const { returnUrl }: BillingPortalRequest = await req.json()

  // Get user's Stripe customer ID
  const { data: user } = await supabaseClient
    .from('users')
    .select('stripe_customer_id')
    .eq('id', userId)
    .single()

  if (!user?.stripe_customer_id) {
    return new Response(
      JSON.stringify({ error: 'No billing account found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: returnUrl || `${Deno.env.get('FRONTEND_URL')}/billing`
  })

  return new Response(
    JSON.stringify({ url: session.url }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function trackUsage(supabaseClient: any, userId: string, req: Request): Promise<Response> {
  const { resourceType, usageCount }: UsageTrackingRequest = await req.json()

  const currentDate = new Date()
  const billingPeriodStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
  const billingPeriodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)

  // Upsert usage tracking record
  const { data: usageRecord, error } = await supabaseClient
    .from('usage_tracking')
    .upsert({
      user_id: userId,
      resource_type: resourceType,
      usage_count: usageCount,
      billing_period_start: billingPeriodStart.toISOString().split('T')[0],
      billing_period_end: billingPeriodEnd.toISOString().split('T')[0]
    }, {
      onConflict: 'user_id,resource_type,billing_period_start',
      ignoreDuplicates: false
    })
    .select()
    .single()

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to track usage' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Check if user is approaching limits
  const limits = await checkUsageLimits(supabaseClient, userId, resourceType, usageCount)

  return new Response(
    JSON.stringify({
      usageRecord,
      limits,
      message: 'Usage tracked successfully'
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function checkUsageLimits(supabaseClient: any, userId: string, resourceType: string, currentUsage: number) {
  // Get user's current plan
  const { data: userPlan } = await supabaseClient
    .from('user_plans')
    .select(`
      *,
      plans!inner(*)
    `)
    .eq('user_id', userId)
    .eq('status', 'active')
    .single()

  if (!userPlan) {
    return { warning: false, limit: 0, usage: currentUsage }
  }

  const planLimits = userPlan.plans.limits || {}
  const resourceLimit = planLimits[resourceType] || 0

  // -1 means unlimited
  if (resourceLimit === -1) {
    return { warning: false, limit: -1, usage: currentUsage, unlimited: true }
  }

  const warningThreshold = resourceLimit * 0.8 // 80% warning
  const isApproachingLimit = currentUsage >= warningThreshold
  const isOverLimit = currentUsage >= resourceLimit

  return {
    warning: isApproachingLimit,
    overLimit: isOverLimit,
    limit: resourceLimit,
    usage: currentUsage,
    percentUsed: (currentUsage / resourceLimit) * 100
  }
}

async function getSubscription(supabaseClient: any, userId: string): Promise<Response> {
  const { data: userPlan, error } = await supabaseClient
    .from('user_plans')
    .select(`
      *,
      plans!inner(*)
    `)
    .eq('user_id', userId)
    .eq('status', 'active')
    .single()

  if (error && error.code !== 'PGRST116') { // Not found is OK
    return new Response(
      JSON.stringify({ error: 'Failed to fetch subscription' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  let stripeSubscription = null
  if (userPlan?.stripe_subscription_id) {
    try {
      stripeSubscription = await stripe.subscriptions.retrieve(userPlan.stripe_subscription_id)
    } catch (error) {
      console.warn('Failed to fetch Stripe subscription:', error)
    }
  }

  const subscription = {
    plan: userPlan || null,
    stripeData: stripeSubscription,
    isActive: userPlan?.status === 'active',
    currentPeriodEnd: userPlan?.current_period_end,
    cancelAtPeriodEnd: userPlan?.cancel_at_period_end || false
  }

  return new Response(
    JSON.stringify(subscription),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getUsage(supabaseClient: any, userId: string, searchParams: URLSearchParams): Promise<Response> {
  const month = searchParams.get('month') || new Date().toISOString().slice(0, 7)
  const billingPeriodStart = `${month}-01`

  const { data: usage, error } = await supabaseClient
    .from('usage_tracking')
    .select('*')
    .eq('user_id', userId)
    .eq('billing_period_start', billingPeriodStart)

  if (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch usage' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Get user's plan limits for comparison
  const { data: userPlan } = await supabaseClient
    .from('user_plans')
    .select(`
      *,
      plans!inner(*)
    `)
    .eq('user_id', userId)
    .eq('status', 'active')
    .single()

  const planLimits = userPlan?.plans?.limits || {}

  const usageBreakdown = (usage || []).reduce((acc, record) => {
    acc[record.resource_type] = {
      used: record.usage_count,
      limit: planLimits[record.resource_type] || 0,
      unlimited: planLimits[record.resource_type] === -1
    }
    return acc
  }, {})

  return new Response(
    JSON.stringify({
      month,
      usage: usageBreakdown,
      planLimits
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getPlans(): Promise<Response> {
  const plans = Object.entries(PLAN_CONFIGS).map(([id, config]) => ({
    id,
    ...config
  }))

  return new Response(
    JSON.stringify({ plans }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function getInvoices(supabaseClient: any, userId: string, searchParams: URLSearchParams): Promise<Response> {
  const limit = parseInt(searchParams.get('limit') || '10')

  // Get user's Stripe customer ID
  const { data: user } = await supabaseClient
    .from('users')
    .select('stripe_customer_id')
    .eq('id', userId)
    .single()

  if (!user?.stripe_customer_id) {
    return new Response(
      JSON.stringify({ invoices: [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const invoices = await stripe.invoices.list({
      customer: user.stripe_customer_id,
      limit
    })

    const formattedInvoices = invoices.data.map(invoice => ({
      id: invoice.id,
      amount: invoice.amount_paid,
      currency: invoice.currency,
      status: invoice.status,
      date: new Date(invoice.created * 1000).toISOString(),
      downloadUrl: invoice.hosted_invoice_url,
      description: invoice.lines.data[0]?.description
    }))

    return new Response(
      JSON.stringify({ invoices: formattedInvoices }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Failed to fetch invoices:', error)
    return new Response(
      JSON.stringify({ invoices: [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function getBillingDashboard(supabaseClient: any, userId: string): Promise<Response> {
  // Get current subscription
  const { data: userPlan } = await supabaseClient
    .from('user_plans')
    .select(`
      *,
      plans!inner(*)
    `)
    .eq('user_id', userId)
    .eq('status', 'active')
    .single()

  // Get current month usage
  const currentMonth = new Date().toISOString().slice(0, 7)
  const { data: usage } = await supabaseClient
    .from('usage_tracking')
    .select('*')
    .eq('user_id', userId)
    .eq('billing_period_start', `${currentMonth}-01`)

  // Get recent billing events
  const { data: billingEvents } = await supabaseClient
    .from('billing_events')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5)

  const dashboard = {
    subscription: userPlan || null,
    usage: usage || [],
    recentEvents: billingEvents || [],
    billing: {
      nextBillingDate: userPlan?.current_period_end,
      amount: userPlan?.plans?.monthly_price || 0,
      currency: 'USD'
    }
  }

  return new Response(
    JSON.stringify(dashboard),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

async function cancelSubscription(supabaseClient: any, userId: string, req: Request): Promise<Response> {
  const { immediate = false } = await req.json()

  const { data: userPlan } = await supabaseClient
    .from('user_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single()

  if (!userPlan?.stripe_subscription_id) {
    return new Response(
      JSON.stringify({ error: 'No active subscription found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    if (immediate) {
      // Cancel immediately
      await stripe.subscriptions.cancel(userPlan.stripe_subscription_id)
      
      await supabaseClient
        .from('user_plans')
        .update({ 
          status: 'canceled',
          cancel_at_period_end: false 
        })
        .eq('id', userPlan.id)
    } else {
      // Cancel at period end
      await stripe.subscriptions.update(userPlan.stripe_subscription_id, {
        cancel_at_period_end: true
      })
      
      await supabaseClient
        .from('user_plans')
        .update({ cancel_at_period_end: true })
        .eq('id', userPlan.id)
    }

    return new Response(
      JSON.stringify({
        message: immediate ? 'Subscription canceled immediately' : 'Subscription will cancel at period end',
        canceledAt: immediate ? new Date().toISOString() : userPlan.current_period_end
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Failed to cancel subscription:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to cancel subscription' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

async function handleStripeWebhook(supabaseClient: any, req: Request): Promise<Response> {
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')

  if (!signature) {
    return new Response('No signature', { status: 400 })
  }

  let event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET') || ''
    )
  } catch (error) {
    console.error('Webhook signature verification failed:', error)
    return new Response('Invalid signature', { status: 400 })
  }

  // Log the event
  await supabaseClient
    .from('billing_events')
    .insert({
      stripe_event_id: event.id,
      event_type: event.type,
      event_data: event.data,
      processed: false
    })

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(supabaseClient, event.data.object)
        break
      
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(supabaseClient, event.data.object)
        break
      
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(supabaseClient, event.data.object)
        break
      
      case 'invoice.payment_failed':
        await handlePaymentFailed(supabaseClient, event.data.object)
        break
    }

    // Mark event as processed
    await supabaseClient
      .from('billing_events')
      .update({ processed: true })
      .eq('stripe_event_id', event.id)

  } catch (error) {
    console.error('Error processing webhook:', error)
  }

  return new Response('OK', { status: 200 })
}

async function handleSubscriptionUpdate(supabaseClient: any, subscription: any) {
  const customerId = subscription.customer
  
  // Find user by Stripe customer ID
  const { data: user } = await supabaseClient
    .from('users')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single()

  if (!user) return

  // Update or create user plan
  await supabaseClient
    .from('user_plans')
    .upsert({
      user_id: user.id,
      stripe_subscription_id: subscription.id,
      status: subscription.status,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end
    })
}

async function handleSubscriptionDeleted(supabaseClient: any, subscription: any) {
  await supabaseClient
    .from('user_plans')
    .update({ status: 'canceled' })
    .eq('stripe_subscription_id', subscription.id)
}

async function handlePaymentSucceeded(supabaseClient: any, invoice: any) {
  // Could implement payment success logic here
  console.log('Payment succeeded for invoice:', invoice.id)
}

async function handlePaymentFailed(supabaseClient: any, invoice: any) {
  // Could implement payment failure logic here
  console.log('Payment failed for invoice:', invoice.id)
}