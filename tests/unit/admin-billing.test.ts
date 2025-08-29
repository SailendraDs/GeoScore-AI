import { assertEquals, assertExists, assertGreater } from "https://deno.land/std@0.192.0/testing/asserts.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321'
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || 'test-key'
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'test-service-key'

class AdminBillingTestHelper {
  private supabase: any
  private serviceSupabase: any
  
  constructor() {
    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    this.serviceSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  }

  async createTestUser(isAdmin = false): Promise<{ id: string, accessToken: string }> {
    const email = `admin-test-${Date.now()}@example.com`
    const password = 'testpassword123'

    const { data } = await this.supabase.auth.signUp({ email, password })
    const { data: sessionData } = await this.supabase.auth.signInWithPassword({ email, password })

    const userId = data.user.id

    if (isAdmin) {
      // Create admin record
      await this.serviceSupabase
        .from('admins')
        .insert({
          user_id: userId,
          role: 'admin',
          permissions: { users: true, brands: true, system: true },
          is_active: true
        })
    }

    return {
      id: userId,
      accessToken: sessionData.session.access_token
    }
  }

  async createTestBrand(userId: string): Promise<any> {
    const { data } = await this.serviceSupabase
      .from('brands')
      .insert({
        owner_id: userId,
        name: `Admin Test Brand ${Date.now()}`,
        domain: `admin-test-${Date.now()}.com`,
        industry: 'technology'
      })
      .select()
      .single()

    return data
  }

  async createTestSubscription(userId: string): Promise<any> {
    // Create plan first
    const { data: plan } = await this.serviceSupabase
      .from('plans')
      .upsert({
        name: 'test_plan',
        display_name: 'Test Plan',
        features: { maxBrands: 5, maxLLMs: 3 },
        limits: { maxBrands: 5, maxLLMs: 3, maxReportsPerMonth: 100 },
        monthly_price: 29.99,
        is_active: true
      })
      .select()
      .single()

    // Create user plan
    const { data } = await this.serviceSupabase
      .from('user_plans')
      .insert({
        user_id: userId,
        plan_id: plan.id,
        stripe_subscription_id: `sub_test_${Date.now()}`,
        status: 'active',
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      })
      .select()
      .single()

    return data
  }

  async makeRequest(path: string, options: RequestInit = {}, token?: string): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string>
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    return fetch(`${SUPABASE_URL}/functions/v1${path}`, {
      ...options,
      headers
    })
  }

  async cleanup() {
    try {
      await this.serviceSupabase.from('admin_logs').delete().like('action', '%')
      await this.serviceSupabase.from('user_plans').delete().like('stripe_subscription_id', 'sub_test_%')
      await this.serviceSupabase.from('plans').delete().eq('name', 'test_plan')
      await this.serviceSupabase.from('usage_tracking').delete().like('user_id', '%')
      await this.serviceSupabase.from('live_alerts').delete().like('brand_id', '%')
      await this.serviceSupabase.from('visitor_queries').delete().like('brand_id', '%')
      await this.serviceSupabase.from('monitoring_configs').delete().like('brand_id', '%')
      await this.serviceSupabase.from('admins').delete().like('user_id', '%')
      await this.serviceSupabase.from('brands').delete().like('name', 'Admin Test Brand %')
      await this.serviceSupabase.from('users').delete().like('email', 'admin-test-%@example.com')
    } catch (error) {
      console.warn('Admin/Billing test cleanup warning:', error)
    }
  }
}

const adminBillingTestHelper = new AdminBillingTestHelper()

// Admin Panel Tests
Deno.test("Admin Panel - Get admin dashboard", async () => {
  const testAdmin = await adminBillingTestHelper.createTestUser(true)
  
  const response = await adminBillingTestHelper.makeRequest('/admin-panel', {
    method: 'GET'
  }, testAdmin.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.overview)
  assertExists(result.adminInfo)
  assertExists(result.quickActions)
  assertEquals(Array.isArray(result.quickActions), true)
})

Deno.test("Admin Panel - Non-admin access denied", async () => {
  const regularUser = await adminBillingTestHelper.createTestUser(false)
  
  const response = await adminBillingTestHelper.makeRequest('/admin-panel', {
    method: 'GET'
  }, regularUser.accessToken)

  assertEquals(response.status, 403)
  
  const result = await response.json()
  assertEquals(result.error, 'Admin access required')
})

Deno.test("Admin Panel - Get users list", async () => {
  const testAdmin = await adminBillingTestHelper.createTestUser(true)
  const testUser = await adminBillingTestHelper.createTestUser(false)
  
  const response = await adminBillingTestHelper.makeRequest('/admin-panel/users?page=1&limit=10', {
    method: 'GET'
  }, testAdmin.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.users)
  assertExists(result.pagination)
  assertEquals(Array.isArray(result.users), true)
  assertGreater(result.users.length, 0)
})

Deno.test("Admin Panel - Get brands list", async () => {
  const testAdmin = await adminBillingTestHelper.createTestUser(true)
  const testUser = await adminBillingTestHelper.createTestUser(false)
  await adminBillingTestHelper.createTestBrand(testUser.id)
  
  const response = await adminBillingTestHelper.makeRequest('/admin-panel/brands', {
    method: 'GET'
  }, testAdmin.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.brands)
  assertEquals(Array.isArray(result.brands), true)
  assertGreater(result.brands.length, 0)
})

Deno.test("Admin Panel - Get system health", async () => {
  const testAdmin = await adminBillingTestHelper.createTestUser(true)
  
  const response = await adminBillingTestHelper.makeRequest('/admin-panel/system', {
    method: 'GET'
  }, testAdmin.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.status)
  assertExists(result.services)
  assertExists(result.metrics)
  assertEquals(Array.isArray(result.services), true)
})

Deno.test("Admin Panel - Update user", async () => {
  const testAdmin = await adminBillingTestHelper.createTestUser(true)
  const testUser = await adminBillingTestHelper.createTestUser(false)
  
  const response = await adminBillingTestHelper.makeRequest('/admin-panel/update-user', {
    method: 'POST',
    body: JSON.stringify({
      userId: testUser.id,
      role: 'premium_user',
      status: 'active',
      notes: 'Updated by admin test'
    })
  }, testAdmin.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.user)
  assertEquals(result.message, 'User updated successfully')
})

Deno.test("Admin Panel - Generate schema for brand", async () => {
  const testAdmin = await adminBillingTestHelper.createTestUser(true)
  const testUser = await adminBillingTestHelper.createTestUser(false)
  const testBrand = await adminBillingTestHelper.createTestBrand(testUser.id)
  
  const response = await adminBillingTestHelper.makeRequest('/admin-panel/generate-schema', {
    method: 'POST',
    body: JSON.stringify({
      brandId: testBrand.id,
      schemaType: 'organization',
      overrideData: { customField: 'test value' },
      model: 'gpt-4',
      forceRegenerate: true
    })
  }, testAdmin.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.schema)
  assertExists(result.validation)
})

// Billing System Tests
Deno.test("Billing System - Get plans", async () => {
  const testUser = await adminBillingTestHelper.createTestUser()
  
  const response = await adminBillingTestHelper.makeRequest('/billing-system/plans', {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.plans)
  assertEquals(Array.isArray(result.plans), true)
  assertGreater(result.plans.length, 0)
  
  // Check plan structure
  const plan = result.plans[0]
  assertExists(plan.id)
  assertExists(plan.name)
  assertExists(plan.monthlyPrice)
  assertExists(plan.features)
})

Deno.test("Billing System - Get subscription", async () => {
  const testUser = await adminBillingTestHelper.createTestUser()
  await adminBillingTestHelper.createTestSubscription(testUser.id)
  
  const response = await adminBillingTestHelper.makeRequest('/billing-system/subscription', {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.plan)
  assertEquals(result.isActive, true)
  assertExists(result.currentPeriodEnd)
})

Deno.test("Billing System - Track usage", async () => {
  const testUser = await adminBillingTestHelper.createTestUser()
  await adminBillingTestHelper.createTestSubscription(testUser.id)
  
  const response = await adminBillingTestHelper.makeRequest('/billing-system/track-usage', {
    method: 'POST',
    body: JSON.stringify({
      resourceType: 'llm_reports',
      usageCount: 15
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.usageRecord)
  assertExists(result.limits)
  assertEquals(result.message, 'Usage tracked successfully')
})

Deno.test("Billing System - Get usage", async () => {
  const testUser = await adminBillingTestHelper.createTestUser()
  await adminBillingTestHelper.createTestSubscription(testUser.id)
  
  // Track some usage first
  await adminBillingTestHelper.makeRequest('/billing-system/track-usage', {
    method: 'POST',
    body: JSON.stringify({
      resourceType: 'llm_reports',
      usageCount: 25
    })
  }, testUser.accessToken)
  
  const response = await adminBillingTestHelper.makeRequest('/billing-system/usage', {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.usage)
  assertExists(result.planLimits)
  assertExists(result.month)
})

Deno.test("Billing System - Get billing dashboard", async () => {
  const testUser = await adminBillingTestHelper.createTestUser()
  await adminBillingTestHelper.createTestSubscription(testUser.id)
  
  const response = await adminBillingTestHelper.makeRequest('/billing-system', {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.subscription)
  assertExists(result.usage)
  assertExists(result.billing)
  assertEquals(Array.isArray(result.usage), true)
})

// Live Monitoring Tests
Deno.test("Live Monitoring - Track event", async () => {
  const testUser = await adminBillingTestHelper.createTestUser()
  const testBrand = await adminBillingTestHelper.createTestBrand(testUser.id)
  
  const response = await adminBillingTestHelper.makeRequest('/live-monitoring/track', {
    method: 'POST',
    body: JSON.stringify({
      brandId: testBrand.id,
      event: {
        type: 'query',
        data: {
          query: 'What can you tell me about this technology company?',
          url: 'https://example.com',
          ip: '127.0.0.1'
        },
        source: 'website'
      },
      sessionId: 'test-session-123'
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertEquals(result.tracked, true)
  assertExists(result.insights)
  assertExists(result.insights.intent)
  assertExists(result.insights.sentiment)
})

Deno.test("Live Monitoring - Configure monitoring", async () => {
  const testUser = await adminBillingTestHelper.createTestUser()
  const testBrand = await adminBillingTestHelper.createTestBrand(testUser.id)
  
  const response = await adminBillingTestHelper.makeRequest('/live-monitoring/configure', {
    method: 'POST',
    body: JSON.stringify({
      brandId: testBrand.id,
      configName: 'Test Monitoring Config',
      keywords: ['technology', 'AI', 'software'],
      sources: ['website', 'social', 'chatbot'],
      alertThresholds: {
        mentionSpike: 10,
        negativeSentiment: 0.3,
        competitorActivity: 5
      },
      notificationSettings: {
        email: true,
        slack: false,
        webhook: 'https://example.com/webhook'
      }
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.config)
  assertEquals(result.message, 'Monitoring configuration saved successfully')
})

Deno.test("Live Monitoring - Get alerts", async () => {
  const testUser = await adminBillingTestHelper.createTestUser()
  const testBrand = await adminBillingTestHelper.createTestBrand(testUser.id)
  
  // Create test alert
  await adminBillingTestHelper.serviceSupabase
    .from('live_alerts')
    .insert({
      brand_id: testBrand.id,
      alert_type: 'negative_sentiment',
      message: 'Test alert message',
      urgency: 'medium'
    })
  
  const response = await adminBillingTestHelper.makeRequest(`/live-monitoring/alerts?brandId=${testBrand.id}`, {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.active)
  assertExists(result.summary)
  assertEquals(Array.isArray(result.active), true)
  assertGreater(result.active.length, 0)
})

Deno.test("Live Monitoring - Get trends", async () => {
  const testUser = await adminBillingTestHelper.createTestUser()
  const testBrand = await adminBillingTestHelper.createTestBrand(testUser.id)
  
  // Create test visitor queries
  await adminBillingTestHelper.serviceSupabase
    .from('visitor_queries')
    .insert([
      {
        brand_id: testBrand.id,
        query_text: 'Test query 1',
        source: 'website',
        sentiment_score: 0.7,
        inferred_intent: 'research'
      },
      {
        brand_id: testBrand.id,
        query_text: 'Test query 2',
        source: 'chatbot',
        sentiment_score: 0.3,
        inferred_intent: 'support'
      }
    ])
  
  const response = await adminBillingTestHelper.makeRequest(`/live-monitoring/trends?brandId=${testBrand.id}&timeRange=7d`, {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.daily)
  assertExists(result.summary)
  assertEquals(Array.isArray(result.daily), true)
})

Deno.test("Live Monitoring - Get realtime data", async () => {
  const testUser = await adminBillingTestHelper.createTestUser()
  const testBrand = await adminBillingTestHelper.createTestBrand(testUser.id)
  
  const response = await adminBillingTestHelper.makeRequest(`/live-monitoring/realtime?brandId=${testBrand.id}`, {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.recentActivity)
  assertExists(result.activeAlerts)
  assertExists(result.stats)
  assertExists(result.timestamp)
  assertEquals(Array.isArray(result.recentActivity), true)
  assertEquals(Array.isArray(result.activeAlerts), true)
})

Deno.test("Live Monitoring - Get monitoring dashboard", async () => {
  const testUser = await adminBillingTestHelper.createTestUser()
  const testBrand = await adminBillingTestHelper.createTestBrand(testUser.id)
  
  const response = await adminBillingTestHelper.makeRequest(`/live-monitoring?brandId=${testBrand.id}`, {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.isActive)
  assertExists(result.last24Hours)
  assertExists(result.status)
})

// Error Handling Tests
Deno.test("Admin Panel - Insufficient permissions", async () => {
  const testAdmin = await adminBillingTestHelper.createTestUser(true)
  
  // Try to impersonate (requires super_admin)
  const response = await adminBillingTestHelper.makeRequest('/admin-panel/impersonate', {
    method: 'POST',
    body: JSON.stringify({
      targetUserId: 'test-user-id',
      duration: 60
    })
  }, testAdmin.accessToken)

  assertEquals(response.status, 403)
  
  const result = await response.json()
  assertEquals(result.error, 'Insufficient permissions')
})

Deno.test("Billing System - Track usage without subscription", async () => {
  const testUser = await adminBillingTestHelper.createTestUser()
  
  const response = await adminBillingTestHelper.makeRequest('/billing-system/track-usage', {
    method: 'POST',
    body: JSON.stringify({
      resourceType: 'llm_reports',
      usageCount: 10
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  // Should still track usage even without subscription
  assertExists(result.usageRecord)
})

Deno.test("Live Monitoring - Invalid brand ID", async () => {
  const testUser = await adminBillingTestHelper.createTestUser()
  
  const response = await adminBillingTestHelper.makeRequest('/live-monitoring/track', {
    method: 'POST',
    body: JSON.stringify({
      brandId: 'invalid-brand-id',
      event: {
        type: 'query',
        data: { query: 'test' },
        source: 'website'
      }
    })
  }, testUser.accessToken)

  assertEquals(response.status, 404)
  
  const result = await response.json()
  assertEquals(result.error, 'Brand not found')
})

// Security Tests
Deno.test("Security - Admin activity logging", async () => {
  const testAdmin = await adminBillingTestHelper.createTestUser(true)
  
  // Perform an admin action
  await adminBillingTestHelper.makeRequest('/admin-panel/users', {
    method: 'GET'
  }, testAdmin.accessToken)
  
  // Check if activity was logged
  const { data: logs } = await adminBillingTestHelper.serviceSupabase
    .from('admin_logs')
    .select('*')
    .eq('admin_id', testAdmin.id)
    .order('created_at', { ascending: false })
    .limit(1)
  
  assertExists(logs)
  assertGreater(logs.length, 0)
  assertEquals(logs[0].action.includes('GET'), true)
})

Deno.test("Security - Data isolation between users", async () => {
  const testUser1 = await adminBillingTestHelper.createTestUser()
  const testUser2 = await adminBillingTestHelper.createTestUser()
  const testBrand1 = await adminBillingTestHelper.createTestBrand(testUser1.id)
  
  // User 2 tries to access User 1's monitoring data
  const response = await adminBillingTestHelper.makeRequest(`/live-monitoring?brandId=${testBrand1.id}`, {
    method: 'GET'
  }, testUser2.accessToken)

  assertEquals(response.status, 404) // Should not find brand due to RLS
})

// Performance Tests
Deno.test("Performance - Admin dashboard load time", async () => {
  const testAdmin = await adminBillingTestHelper.createTestUser(true)
  
  const startTime = Date.now()
  const response = await adminBillingTestHelper.makeRequest('/admin-panel', {
    method: 'GET'
  }, testAdmin.accessToken)
  const endTime = Date.now()
  
  assertEquals(response.status, 200)
  
  // Should load within 2 seconds
  assertEquals(endTime - startTime < 2000, true)
  
  console.log(`Admin dashboard loaded in ${endTime - startTime}ms`)
})

Deno.test("Performance - Concurrent monitoring events", async () => {
  const testUser = await adminBillingTestHelper.createTestUser()
  const testBrand = await adminBillingTestHelper.createTestBrand(testUser.id)
  
  const promises = Array.from({ length: 5 }, (_, i) =>
    adminBillingTestHelper.makeRequest('/live-monitoring/track', {
      method: 'POST',
      body: JSON.stringify({
        brandId: testBrand.id,
        event: {
          type: 'query',
          data: { query: `Performance test query ${i}` },
          source: 'website'
        },
        sessionId: `perf-test-${i}`
      })
    }, testUser.accessToken)
  )
  
  const startTime = Date.now()
  const responses = await Promise.all(promises)
  const endTime = Date.now()
  
  // All should succeed
  responses.forEach(response => {
    assertEquals(response.status, 200)
  })
  
  // Should complete within 10 seconds
  assertEquals(endTime - startTime < 10000, true)
  
  console.log(`Concurrent monitoring events completed in ${endTime - startTime}ms`)
})

// Cleanup
Deno.test("Admin/Billing Tests - Cleanup", async () => {
  await adminBillingTestHelper.cleanup()
  console.log("Admin/Billing test cleanup completed")
})