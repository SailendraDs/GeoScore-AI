import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createHmac } from "https://deno.land/std@0.192.0/node/crypto.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-razorpay-signature',
}

interface RazorpayPaymentEvent {
  event: string
  payload: {
    payment: {
      entity: {
        id: string
        status: string
        amount: number
        currency: string
        order_id: string
        invoice_id?: string
        method: string
        captured: boolean
        created_at: number
        error_code?: string
        error_description?: string
        contact?: string
        email?: string
      }
    }
    subscription?: {
      entity: {
        id: string
        status: string
        plan_id: string
        customer_id: string
        current_period_start: number
        current_period_end: number
        charge_at: number
        start_at: number
        end_at: number
        auth_attempts: number
        paid_count: number
        customer_notify: boolean
        created_at: number
        expire_by?: number
      }
    }
  }
}

interface NotificationEmail {
  to: string
  subject: string
  template: string
  data: Record<string, any>
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Verify webhook signature
    const signature = req.headers.get('X-Razorpay-Signature')
    const body = await req.text()
    
    if (!signature || !verifyWebhookSignature(body, signature)) {
      console.error('Invalid webhook signature')
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const webhookEvent: RazorpayPaymentEvent = JSON.parse(body)
    const eventType = webhookEvent.event

    // Structured logging for webhook reception
    console.log(JSON.stringify({
      event: 'webhook_received',
      level: 'INFO',
      webhook_type: 'razorpay',
      event_type: eventType,
      timestamp: new Date().toISOString(),
      payload_size: body.length
    }))

    // Route to appropriate handler based on event type
    let result
    switch (eventType) {
      case 'payment.captured':
        result = await handlePaymentCaptured(supabaseClient, webhookEvent)
        break
      case 'payment.failed':
        result = await handlePaymentFailed(supabaseClient, webhookEvent)
        break
      case 'subscription.activated':
        result = await handleSubscriptionActivated(supabaseClient, webhookEvent)
        break
      case 'subscription.charged':
        result = await handleSubscriptionCharged(supabaseClient, webhookEvent)
        break
      case 'subscription.cancelled':
        result = await handleSubscriptionCancelled(supabaseClient, webhookEvent)
        break
      case 'subscription.completed':
        result = await handleSubscriptionCompleted(supabaseClient, webhookEvent)
        break
      case 'subscription.paused':
        result = await handleSubscriptionPaused(supabaseClient, webhookEvent)
        break
      case 'subscription.halted':
        result = await handleSubscriptionHalted(supabaseClient, webhookEvent)
        break
      default:
        console.warn(`Unhandled webhook event type: ${eventType}`)
        result = { message: `Event type ${eventType} not handled`, status: 'ignored' }
    }

    // Log webhook processing result
    console.log(JSON.stringify({
      event: 'webhook_processed',
      level: 'INFO',
      webhook_type: 'razorpay',
      event_type: eventType,
      result_status: result.status || 'unknown',
      timestamp: new Date().toISOString()
    }))

    return new Response(
      JSON.stringify({
        received: true,
        event: eventType,
        result: result
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Webhook processing error:', error)
    
    // Log webhook error
    console.log(JSON.stringify({
      event: 'webhook_error',
      level: 'ERROR',
      webhook_type: 'razorpay',
      error: error.message,
      timestamp: new Date().toISOString()
    }))

    return new Response(
      JSON.stringify({ error: 'Webhook processing failed', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function verifyWebhookSignature(body: string, signature: string): boolean {
  const webhookSecret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')
  if (!webhookSecret) {
    console.error('RAZORPAY_WEBHOOK_SECRET not configured')
    return false
  }

  try {
    const expectedSignature = createHmac('sha256', webhookSecret)
      .update(body)
      .digest('hex')

    return signature === expectedSignature
  } catch (error) {
    console.error('Error verifying webhook signature:', error)
    return false
  }
}

async function handlePaymentCaptured(supabaseClient: any, event: RazorpayPaymentEvent) {
  const payment = event.payload.payment.entity
  
  try {
    // Find the user plan associated with this payment
    const { data: userPlan, error: planError } = await supabaseClient
      .from('user_plans')
      .select(`
        id, user_id, plan_id, status,
        users (email, full_name),
        plans (name, display_name, price_cents)
      `)
      .eq('razorpay_subscription_id', payment.order_id)
      .single()

    if (planError && planError.code !== 'PGRST116') {
      throw planError
    }

    if (!userPlan) {
      // This might be a one-time payment or invoice payment
      console.warn(`No user plan found for payment ${payment.id}`)
      
      // Log payment for manual reconciliation
      await logPaymentForReconciliation(supabaseClient, payment, 'no_subscription_found')
      
      return { 
        status: 'logged_for_reconciliation', 
        message: 'Payment logged for manual reconciliation',
        paymentId: payment.id 
      }
    }

    // Update subscription status if it's not already active
    if (userPlan.status !== 'active') {
      const { error: updateError } = await supabaseClient
        .from('user_plans')
        .update({
          status: 'active',
          updated_at: new Date().toISOString()
        })
        .eq('id', userPlan.id)

      if (updateError) {
        throw updateError
      }
    }

    // Record successful payment
    await recordPaymentTransaction(supabaseClient, payment, userPlan, 'success')

    // Send payment confirmation email
    await sendPaymentNotification(supabaseClient, {
      to: userPlan.users.email,
      subject: `Payment Confirmed - GeoScore AI ${userPlan.plans.display_name}`,
      template: 'payment_success',
      data: {
        userName: userPlan.users.full_name,
        planName: userPlan.plans.display_name,
        amount: (payment.amount / 100).toFixed(2),
        currency: payment.currency.toUpperCase(),
        paymentId: payment.id,
        paymentDate: new Date(payment.created_at * 1000).toLocaleDateString()
      }
    })

    // Create system alert for high-value payments
    if (payment.amount >= 500000) { // $5000+ payments
      await createSystemAlert(supabaseClient, {
        type: 'high_value_payment',
        severity: 'medium',
        title: 'High Value Payment Received',
        message: `Payment of ${payment.currency.toUpperCase()} ${payment.amount/100} received for ${userPlan.plans.display_name} plan`,
        metadata: {
          paymentId: payment.id,
          userId: userPlan.user_id,
          planId: userPlan.plan_id,
          amount: payment.amount
        }
      })
    }

    // Structured logging
    console.log(JSON.stringify({
      event: 'payment_processed',
      level: 'INFO',
      payment_id: payment.id,
      user_id: userPlan.user_id,
      plan_id: userPlan.plan_id,
      amount: payment.amount,
      currency: payment.currency,
      status: 'captured',
      timestamp: new Date().toISOString()
    }))

    return { 
      status: 'success', 
      message: 'Payment processed and user activated',
      userId: userPlan.user_id,
      planId: userPlan.plan_id
    }

  } catch (error) {
    console.error('Error processing payment captured:', error)
    
    // Record failed processing for manual review
    await recordPaymentTransaction(supabaseClient, payment, null, 'processing_error', error.message)
    
    throw error
  }
}

async function handlePaymentFailed(supabaseClient: any, event: RazorpayPaymentEvent) {
  const payment = event.payload.payment.entity
  
  try {
    // Find the associated user plan
    const { data: userPlan } = await supabaseClient
      .from('user_plans')
      .select(`
        id, user_id, plan_id, status,
        users (email, full_name),
        plans (name, display_name)
      `)
      .eq('razorpay_subscription_id', payment.order_id)
      .single()

    // Record failed payment
    await recordPaymentTransaction(supabaseClient, payment, userPlan, 'failed')

    if (userPlan) {
      // Send payment failure notification
      await sendPaymentNotification(supabaseClient, {
        to: userPlan.users.email,
        subject: 'Payment Failed - GeoScore AI',
        template: 'payment_failed',
        data: {
          userName: userPlan.users.full_name,
          planName: userPlan.plans.display_name,
          errorCode: payment.error_code,
          errorDescription: payment.error_description,
          paymentId: payment.id,
          retryUrl: `${Deno.env.get('FRONTEND_URL')}/billing/retry-payment`
        }
      })

      // Create alert for consecutive payment failures
      const recentFailures = await countRecentPaymentFailures(supabaseClient, userPlan.user_id)
      if (recentFailures >= 3) {
        await createSystemAlert(supabaseClient, {
          type: 'payment_failure_pattern',
          severity: 'high',
          title: 'Multiple Payment Failures',
          message: `User ${userPlan.users.email} has ${recentFailures} consecutive payment failures`,
          metadata: {
            userId: userPlan.user_id,
            failureCount: recentFailures,
            latestError: payment.error_description
          }
        })
      }
    } else {
      // Log for manual reconciliation
      await logPaymentForReconciliation(supabaseClient, payment, 'failed_no_subscription')
    }

    console.log(JSON.stringify({
      event: 'payment_failed',
      level: 'WARN',
      payment_id: payment.id,
      user_id: userPlan?.user_id,
      error_code: payment.error_code,
      error_description: payment.error_description,
      timestamp: new Date().toISOString()
    }))

    return { 
      status: 'processed', 
      message: 'Payment failure recorded and user notified',
      userId: userPlan?.user_id 
    }

  } catch (error) {
    console.error('Error processing payment failure:', error)
    throw error
  }
}

async function handleSubscriptionActivated(supabaseClient: any, event: RazorpayPaymentEvent) {
  const subscription = event.payload.subscription!.entity
  
  try {
    // Update user plan status to active
    const { data: userPlan, error: updateError } = await supabaseClient
      .from('user_plans')
      .update({
        status: 'active',
        starts_at: new Date(subscription.start_at * 1000).toISOString(),
        expires_at: subscription.end_at ? new Date(subscription.end_at * 1000).toISOString() : null,
        updated_at: new Date().toISOString()
      })
      .eq('razorpay_subscription_id', subscription.id)
      .select(`
        user_id, plan_id,
        users (email, full_name),
        plans (display_name)
      `)
      .single()

    if (updateError) {
      throw updateError
    }

    // Send welcome email
    await sendPaymentNotification(supabaseClient, {
      to: userPlan.users.email,
      subject: `Welcome to GeoScore AI ${userPlan.plans.display_name}!`,
      template: 'subscription_activated',
      data: {
        userName: userPlan.users.full_name,
        planName: userPlan.plans.display_name,
        activationDate: new Date().toLocaleDateString(),
        dashboardUrl: `${Deno.env.get('FRONTEND_URL')}/dashboard`
      }
    })

    console.log(JSON.stringify({
      event: 'subscription_activated',
      level: 'INFO',
      subscription_id: subscription.id,
      user_id: userPlan.user_id,
      plan_id: userPlan.plan_id,
      timestamp: new Date().toISOString()
    }))

    return { 
      status: 'activated', 
      message: 'Subscription activated successfully',
      userId: userPlan.user_id 
    }

  } catch (error) {
    console.error('Error activating subscription:', error)
    throw error
  }
}

async function handleSubscriptionCharged(supabaseClient: any, event: RazorpayPaymentEvent) {
  const subscription = event.payload.subscription!.entity
  
  try {
    // Record the subscription charge
    const { data: userPlan } = await supabaseClient
      .from('user_plans')
      .select(`
        user_id, plan_id,
        users (email, full_name),
        plans (display_name, price_cents)
      `)
      .eq('razorpay_subscription_id', subscription.id)
      .single()

    if (userPlan) {
      // Send billing confirmation
      await sendPaymentNotification(supabaseClient, {
        to: userPlan.users.email,
        subject: `Billing Confirmation - GeoScore AI ${userPlan.plans.display_name}`,
        template: 'subscription_charged',
        data: {
          userName: userPlan.users.full_name,
          planName: userPlan.plans.display_name,
          amount: (userPlan.plans.price_cents / 100).toFixed(2),
          currency: 'USD',
          chargeDate: new Date().toLocaleDateString(),
          nextChargeDate: new Date(subscription.charge_at * 1000).toLocaleDateString()
        }
      })
    }

    return { status: 'charged', message: 'Subscription charge processed' }

  } catch (error) {
    console.error('Error processing subscription charge:', error)
    throw error
  }
}

async function handleSubscriptionCancelled(supabaseClient: any, event: RazorpayPaymentEvent) {
  const subscription = event.payload.subscription!.entity
  
  try {
    // Update user plan status
    const { data: userPlan, error: updateError } = await supabaseClient
      .from('user_plans')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('razorpay_subscription_id', subscription.id)
      .select(`
        user_id, plan_id,
        users (email, full_name),
        plans (display_name)
      `)
      .single()

    if (updateError) {
      throw updateError
    }

    // Send cancellation confirmation
    await sendPaymentNotification(supabaseClient, {
      to: userPlan.users.email,
      subject: 'Subscription Cancelled - GeoScore AI',
      template: 'subscription_cancelled',
      data: {
        userName: userPlan.users.full_name,
        planName: userPlan.plans.display_name,
        cancellationDate: new Date().toLocaleDateString(),
        accessUntil: subscription.end_at ? new Date(subscription.end_at * 1000).toLocaleDateString() : 'Immediately',
        reactivateUrl: `${Deno.env.get('FRONTEND_URL')}/billing/reactivate`
      }
    })

    console.log(JSON.stringify({
      event: 'subscription_cancelled',
      level: 'INFO',
      subscription_id: subscription.id,
      user_id: userPlan.user_id,
      timestamp: new Date().toISOString()
    }))

    return { 
      status: 'cancelled', 
      message: 'Subscription cancelled successfully',
      userId: userPlan.user_id 
    }

  } catch (error) {
    console.error('Error cancelling subscription:', error)
    throw error
  }
}

async function handleSubscriptionCompleted(supabaseClient: any, event: RazorpayPaymentEvent) {
  const subscription = event.payload.subscription!.entity
  
  try {
    // Update user plan to expired
    const { data: userPlan } = await supabaseClient
      .from('user_plans')
      .update({
        status: 'expired',
        updated_at: new Date().toISOString()
      })
      .eq('razorpay_subscription_id', subscription.id)
      .select(`
        user_id,
        users (email, full_name),
        plans (display_name)
      `)
      .single()

    if (userPlan) {
      // Send subscription completion notice
      await sendPaymentNotification(supabaseClient, {
        to: userPlan.users.email,
        subject: 'Subscription Completed - GeoScore AI',
        template: 'subscription_completed',
        data: {
          userName: userPlan.users.full_name,
          planName: userPlan.plans.display_name,
          completionDate: new Date().toLocaleDateString(),
          renewUrl: `${Deno.env.get('FRONTEND_URL')}/billing/renew`
        }
      })
    }

    return { status: 'completed', message: 'Subscription completed successfully' }

  } catch (error) {
    console.error('Error completing subscription:', error)
    throw error
  }
}

async function handleSubscriptionPaused(supabaseClient: any, event: RazorpayPaymentEvent) {
  const subscription = event.payload.subscription!.entity
  
  // Update status to suspended
  await supabaseClient
    .from('user_plans')
    .update({
      status: 'suspended',
      updated_at: new Date().toISOString()
    })
    .eq('razorpay_subscription_id', subscription.id)

  return { status: 'paused', message: 'Subscription paused' }
}

async function handleSubscriptionHalted(supabaseClient: any, event: RazorpayPaymentEvent) {
  const subscription = event.payload.subscription!.entity
  
  // Update status to suspended and create alert
  const { data: userPlan } = await supabaseClient
    .from('user_plans')
    .update({
      status: 'suspended',
      updated_at: new Date().toISOString()
    })
    .eq('razorpay_subscription_id', subscription.id)
    .select('user_id, users (email)')
    .single()

  if (userPlan) {
    await createSystemAlert(supabaseClient, {
      type: 'subscription_halted',
      severity: 'high',
      title: 'Subscription Halted',
      message: `Subscription ${subscription.id} halted due to multiple payment failures`,
      metadata: {
        subscriptionId: subscription.id,
        userId: userPlan.user_id,
        userEmail: userPlan.users.email
      }
    })
  }

  return { status: 'halted', message: 'Subscription halted due to payment failures' }
}

// Helper functions
async function recordPaymentTransaction(
  supabaseClient: any, 
  payment: any, 
  userPlan: any | null, 
  status: string,
  errorMessage?: string
) {
  try {
    await supabaseClient
      .from('payment_transactions')
      .insert({
        razorpay_payment_id: payment.id,
        user_id: userPlan?.user_id,
        plan_id: userPlan?.plan_id,
        amount: payment.amount,
        currency: payment.currency,
        status,
        payment_method: payment.method,
        error_message: errorMessage,
        razorpay_data: payment,
        created_at: new Date(payment.created_at * 1000).toISOString()
      })
  } catch (error) {
    console.error('Error recording payment transaction:', error)
  }
}

async function logPaymentForReconciliation(
  supabaseClient: any, 
  payment: any, 
  reason: string
) {
  try {
    await supabaseClient
      .from('payment_reconciliation_log')
      .insert({
        razorpay_payment_id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        reason,
        payment_data: payment,
        requires_manual_review: true,
        created_at: new Date().toISOString()
      })
  } catch (error) {
    console.error('Error logging payment for reconciliation:', error)
  }
}

async function sendPaymentNotification(supabaseClient: any, notification: NotificationEmail) {
  try {
    // In production, integrate with email service (SendGrid, etc.)
    // For now, just log the notification
    console.log('Email notification:', {
      to: notification.to,
      subject: notification.subject,
      template: notification.template,
      data: notification.data
    })

    // You could also store in a notifications table for later processing
    await supabaseClient
      .from('notification_queue')
      .insert({
        type: 'email',
        recipient: notification.to,
        subject: notification.subject,
        template: notification.template,
        data: notification.data,
        status: 'queued',
        created_at: new Date().toISOString()
      })

  } catch (error) {
    console.error('Error sending payment notification:', error)
  }
}

async function createSystemAlert(supabaseClient: any, alert: {
  type: string
  severity: string
  title: string
  message: string
  metadata?: Record<string, any>
}) {
  try {
    await supabaseClient
      .from('alerts')
      .insert({
        type: alert.type,
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        source_type: 'payment_system',
        metadata: alert.metadata || {},
        created_at: new Date().toISOString()
      })
  } catch (error) {
    console.error('Error creating system alert:', error)
  }
}

async function countRecentPaymentFailures(supabaseClient: any, userId: string): Promise<number> {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    
    const { count } = await supabaseClient
      .from('payment_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'failed')
      .gte('created_at', thirtyDaysAgo)

    return count || 0
  } catch (error) {
    console.error('Error counting recent payment failures:', error)
    return 0
  }
}