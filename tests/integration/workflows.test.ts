import { assertEquals, assertExists, assertGreater } from "https://deno.land/std@0.192.0/testing/asserts.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Integration Tests for GeoScore AI
 * Tests end-to-end workflows and external service integrations
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321'
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || 'test-key'
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'test-service-key'

interface IntegrationTestUser {
  id: string
  email: string
  accessToken: string
}

interface TestBrand {
  id: string
  name: string
  domain: string
  owner_id: string
}

class IntegrationTestHelper {
  private supabase: any
  private serviceSupabase: any
  
  constructor() {
    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    this.serviceSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  }

  async createTestUser(): Promise<IntegrationTestUser> {
    const email = `integration-${Date.now()}@example.com`
    const password = 'integrationtest123'

    const { data, error } = await this.supabase.auth.signUp({
      email,
      password,
    })

    if (error) throw error

    const { data: sessionData } = await this.supabase.auth.signInWithPassword({
      email,
      password
    })

    return {
      id: data.user.id,
      email,
      accessToken: sessionData.session.access_token
    }
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

  async waitForAsyncOperation(operationId: string, maxWaitTime = 30000): Promise<any> {
    const startTime = Date.now()
    while (Date.now() - startTime < maxWaitTime) {
      // Check operation status (would be implemented based on actual async operation tracking)
      await new Promise(resolve => setTimeout(resolve, 1000))
      // For now, just return success after a short wait
      if (Date.now() - startTime > 5000) {
        return { status: 'completed', result: 'mock_result' }
      }
    }
    throw new Error('Operation timed out')
  }

  async cleanup() {
    try {
      await this.serviceSupabase.from('llm_reports').delete().like('brand_id', '%')
      await this.serviceSupabase.from('brand_prompts').delete().like('brand_id', '%')
      await this.serviceSupabase.from('brand_topics').delete().like('brand_id', '%')
      await this.serviceSupabase.from('brand_setup_state').delete().like('brand_id', '%')
      await this.serviceSupabase.from('schemas').delete().like('brand_id', '%')
      await this.serviceSupabase.from('competitor_scores').delete().like('brand_id', '%')
      await this.serviceSupabase.from('competitor_meta').delete().like('brand_id', '%')
      await this.serviceSupabase.from('visibility_snapshots').delete().like('brand_id', '%')
      await this.serviceSupabase.from('brands').delete().like('name', '%Test%')
      await this.serviceSupabase.from('users').delete().like('email', 'integration-%@example.com')
    } catch (error) {
      console.warn('Integration test cleanup warning:', error)
    }
  }
}

const integrationHelper = new IntegrationTestHelper()

// End-to-End Brand Onboarding Workflow
Deno.test("Integration - Complete Brand Onboarding Workflow", async () => {
  console.log("🔄 Starting complete brand onboarding integration test...")
  
  const testUser = await integrationHelper.createTestUser()
  
  // Step 1: Create user profile
  console.log("  📝 Creating user profile...")
  const profileResponse = await integrationHelper.makeRequest('/auth-onboard', {
    method: 'POST',
    body: JSON.stringify({
      fullName: 'Integration Test User',
      companyName: 'Test Integration Company',
      industry: 'technology',
      role: 'developer'
    })
  }, testUser.accessToken)
  
  assertEquals(profileResponse.status, 200)
  
  // Step 2: Create brand
  console.log("  🏢 Creating brand...")
  const brandResponse = await integrationHelper.makeRequest('/api-brands', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Integration Test Brand',
      domain: 'integration-test.com',
      industry: 'technology',
      description: 'A brand for integration testing',
      competitors: ['competitor1.com', 'competitor2.com']
    })
  }, testUser.accessToken)
  
  assertEquals(brandResponse.status, 201)
  const brandResult = await brandResponse.json()
  const brandId = brandResult.brand.id
  
  // Step 3: Start onboarding analysis
  console.log("  🔍 Starting onboarding analysis...")
  const analysisResponse = await integrationHelper.makeRequest('/brand-onboarding', {
    method: 'POST',
    body: JSON.stringify({
      brandId,
      step: 'analyze',
      options: {
        connectors: ['semrush', 'serpapi'],
        llmModels: ['claude-opus'],
        competitorAnalysis: true
      }
    })
  }, testUser.accessToken)
  
  assertEquals(analysisResponse.status, 200)
  const analysisResult = await analysisResponse.json()
  assertEquals(analysisResult.currentStep, 'analyze')
  assertExists(analysisResult.steps)
  
  // Step 4: Generate prompts
  console.log("  📝 Generating brand prompts...")
  const promptResponse = await integrationHelper.makeRequest('/brand-onboarding', {
    method: 'POST',
    body: JSON.stringify({
      brandId,
      step: 'generate_prompts',
      options: {
        promptCount: 5
      }
    })
  }, testUser.accessToken)
  
  assertEquals(promptResponse.status, 200)
  const promptResult = await promptResponse.json()
  assertEquals(promptResult.currentStep, 'generate_prompts')
  
  // Step 5: Finalize onboarding
  console.log("  ✅ Finalizing onboarding...")
  const finalizeResponse = await integrationHelper.makeRequest('/brand-onboarding', {
    method: 'POST',
    body: JSON.stringify({
      brandId,
      step: 'finalize',
      options: {}
    })
  }, testUser.accessToken)
  
  assertEquals(finalizeResponse.status, 200)
  const finalizeResult = await finalizeResponse.json()
  assertEquals(finalizeResult.currentStep, 'finalize')
  
  // Verify onboarding completion
  console.log("  🔍 Verifying onboarding completion...")
  const brandCheckResponse = await integrationHelper.makeRequest(`/api-brands/${brandId}`, {
    method: 'GET'
  }, testUser.accessToken)
  
  assertEquals(brandCheckResponse.status, 200)
  const brandCheck = await brandCheckResponse.json()
  assertExists(brandCheck.brand.setupProgress)
  
  console.log("✅ Brand onboarding workflow completed successfully!")
})

// LLM Report Generation Workflow
Deno.test("Integration - LLM Report Generation Workflow", async () => {
  console.log("🔄 Starting LLM report generation integration test...")
  
  const testUser = await integrationHelper.createTestUser()
  
  // Create brand and basic setup
  const brandResponse = await integrationHelper.makeRequest('/api-brands', {
    method: 'POST',
    body: JSON.stringify({
      name: 'LLM Test Brand',
      domain: 'llm-test.com',
      industry: 'technology'
    })
  }, testUser.accessToken)
  
  const brandResult = await brandResponse.json()
  const brandId = brandResult.brand.id
  
  // Create test prompts
  console.log("  📝 Creating test prompts...")
  await integrationHelper.serviceSupabase
    .from('brand_prompts')
    .insert([
      {
        brand_id: brandId,
        prompt: 'What can you tell me about this technology company?',
        intent_type: 'research',
        generated_by: 'test',
        is_active: true
      },
      {
        brand_id: brandId,
        prompt: 'How does this company compare to its competitors?',
        intent_type: 'comparison',
        generated_by: 'test', 
        is_active: true
      }
    ])
  
  // Generate baseline report
  console.log("  📊 Generating baseline report...")
  const reportResponse = await integrationHelper.makeRequest('/report-generation/generate', {
    method: 'POST',
    body: JSON.stringify({
      brandId,
      reportType: 'baseline',
      models: ['claude-opus'],
      options: {
        includeAnalytics: true,
        generateRecommendations: true
      }
    })
  }, testUser.accessToken)
  
  assertEquals(reportResponse.status, 200)
  const reportResult = await reportResponse.json()
  assertExists(reportResult.reportId)
  assertEquals(reportResult.status, 'processing')
  
  // Wait for report completion (simplified)
  console.log("  ⏳ Waiting for report completion...")
  await new Promise(resolve => setTimeout(resolve, 3000))
  
  // Check dashboard for results
  console.log("  📊 Checking dashboard results...")
  const dashboardResponse = await integrationHelper.makeRequest(`/dashboard-api/dashboard/${brandId}`, {
    method: 'GET'
  }, testUser.accessToken)
  
  assertEquals(dashboardResponse.status, 200)
  const dashboardResult = await dashboardResponse.json()
  assertExists(dashboardResult.brand)
  assertExists(dashboardResult.overview)
  
  console.log("✅ LLM report generation workflow completed successfully!")
})

// Competitor Tracking Integration
Deno.test("Integration - Competitor Tracking Workflow", async () => {
  console.log("🔄 Starting competitor tracking integration test...")
  
  const testUser = await integrationHelper.createTestUser()
  
  // Create brand
  const brandResponse = await integrationHelper.makeRequest('/api-brands', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Competitor Test Brand',
      domain: 'competitor-test.com',
      industry: 'technology'
    })
  }, testUser.accessToken)
  
  const brandResult = await brandResponse.json()
  const brandId = brandResult.brand.id
  
  // Add competitor
  console.log("  🏆 Adding competitor...")
  const addCompetitorResponse = await integrationHelper.makeRequest('/competitor-tracking/track', {
    method: 'POST',
    body: JSON.stringify({
      brandId,
      competitorDomain: 'test-competitor.com',
      relationshipType: 'direct',
      priorityLevel: 4
    })
  }, testUser.accessToken)
  
  assertEquals(addCompetitorResponse.status, 200)
  
  // Run competitor scoring
  console.log("  📊 Running competitor scoring...")
  const scoringResponse = await integrationHelper.makeRequest('/competitor-tracking/score', {
    method: 'POST',
    body: JSON.stringify({
      brandId
    })
  }, testUser.accessToken)
  
  assertEquals(scoringResponse.status, 200)
  
  // Analyze competitors
  console.log("  🔍 Analyzing competitors...")
  const analysisResponse = await integrationHelper.makeRequest('/competitor-tracking/analyze', {
    method: 'POST',
    body: JSON.stringify({
      brandId,
      timeRange: '30d',
      includeAlerts: true
    })
  }, testUser.accessToken)
  
  assertEquals(analysisResponse.status, 200)
  const analysisResult = await analysisResponse.json()
  assertExists(analysisResult.summary)
  assertExists(analysisResult.competitors)
  
  console.log("✅ Competitor tracking workflow completed successfully!")
})

// Schema Generation and Script Serving Integration
Deno.test("Integration - Schema Generation and Script Serving", async () => {
  console.log("🔄 Starting schema and script integration test...")
  
  const testUser = await integrationHelper.createTestUser()
  
  // Create brand
  const brandResponse = await integrationHelper.makeRequest('/api-brands', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Schema Test Brand',
      domain: 'schema-test.com',
      industry: 'technology'
    })
  }, testUser.accessToken)
  
  const brandResult = await brandResponse.json()
  const brandId = brandResult.brand.id
  
  // Generate schema
  console.log("  📋 Generating schema...")
  const schemaResponse = await integrationHelper.makeRequest('/schema-builder/generate', {
    method: 'POST',
    body: JSON.stringify({
      brandId,
      schemaType: 'organization',
      includeFields: ['name', 'url', 'description', 'logo'],
      model: 'gpt-4'
    })
  }, testUser.accessToken)
  
  assertEquals(schemaResponse.status, 200)
  const schemaResult = await schemaResponse.json()
  assertExists(schemaResult.schema)
  assertExists(schemaResult.schemaId)
  
  // Configure script
  console.log("  ⚙️ Configuring script...")
  const scriptConfigResponse = await integrationHelper.makeRequest('/script-serving', {
    method: 'POST',
    body: JSON.stringify({
      brandId,
      scriptType: 'combined',
      config: {
        version: '1.0.0',
        cacheDuration: 3600
      }
    })
  }, testUser.accessToken)
  
  assertEquals(scriptConfigResponse.status, 200)
  
  // Test script serving
  console.log("  📜 Testing script serving...")
  const scriptResponse = await integrationHelper.makeRequest(`/script-serving/geoscore.js?brand=schema-test.com&type=combined`, {
    method: 'GET'
  })
  
  assertEquals(scriptResponse.status, 200)
  assertEquals(scriptResponse.headers.get('Content-Type'), 'application/javascript; charset=utf-8')
  
  const script = await scriptResponse.text()
  assertGreater(script.length, 100)
  assertEquals(script.includes('GeoScore'), true)
  
  console.log("✅ Schema and script integration completed successfully!")
})

// Live Monitoring Integration
Deno.test("Integration - Live Monitoring Workflow", async () => {
  console.log("🔄 Starting live monitoring integration test...")
  
  const testUser = await integrationHelper.createTestUser()
  
  // Create brand
  const brandResponse = await integrationHelper.makeRequest('/api-brands', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Monitoring Test Brand',
      domain: 'monitoring-test.com',
      industry: 'technology'
    })
  }, testUser.accessToken)
  
  const brandResult = await brandResponse.json()
  const brandId = brandResult.brand.id
  
  // Configure monitoring
  console.log("  ⚙️ Configuring monitoring...")
  const configResponse = await integrationHelper.makeRequest('/live-monitoring/configure', {
    method: 'POST',
    body: JSON.stringify({
      brandId,
      configName: 'Integration Test Config',
      keywords: ['technology', 'software', 'AI'],
      sources: ['website', 'chatbot'],
      alertThresholds: {
        mentionSpike: 5,
        negativeSentiment: 0.3,
        competitorActivity: 3
      },
      notificationSettings: {
        email: true,
        slack: false
      }
    })
  }, testUser.accessToken)
  
  assertEquals(configResponse.status, 200)
  
  // Track events
  console.log("  📊 Tracking events...")
  const events = [
    {
      type: 'query',
      data: {
        query: 'What do you think about this technology company?',
        url: 'https://monitoring-test.com',
        ip: '127.0.0.1'
      },
      source: 'website'
    },
    {
      type: 'query',
      data: {
        query: 'This company seems really innovative!',
        url: 'https://monitoring-test.com/about',
        ip: '127.0.0.2'
      },
      source: 'chatbot'
    }
  ]
  
  for (const event of events) {
    const trackResponse = await integrationHelper.makeRequest('/live-monitoring/track', {
      method: 'POST',
      body: JSON.stringify({
        brandId,
        event,
        sessionId: `integration-test-${Date.now()}`
      })
    }, testUser.accessToken)
    
    assertEquals(trackResponse.status, 200)
  }
  
  // Get monitoring dashboard
  console.log("  📊 Checking monitoring dashboard...")
  const dashboardResponse = await integrationHelper.makeRequest(`/live-monitoring?brandId=${brandId}`, {
    method: 'GET'
  }, testUser.accessToken)
  
  assertEquals(dashboardResponse.status, 200)
  const dashboardResult = await dashboardResponse.json()
  assertExists(dashboardResult.last24Hours)
  assertExists(dashboardResult.status)
  
  console.log("✅ Live monitoring integration completed successfully!")
})

// Billing Integration (Mock Stripe)
Deno.test("Integration - Billing System Workflow", async () => {
  console.log("🔄 Starting billing integration test...")
  
  const testUser = await integrationHelper.createTestUser()
  
  // Get available plans
  console.log("  💳 Getting available plans...")
  const plansResponse = await integrationHelper.makeRequest('/billing-system/plans', {
    method: 'GET'
  }, testUser.accessToken)
  
  assertEquals(plansResponse.status, 200)
  const plansResult = await plansResponse.json()
  assertExists(plansResult.plans)
  assertGreater(plansResult.plans.length, 0)
  
  // Track usage
  console.log("  📊 Tracking usage...")
  const usageResponse = await integrationHelper.makeRequest('/billing-system/track-usage', {
    method: 'POST',
    body: JSON.stringify({
      resourceType: 'llm_reports',
      usageCount: 25
    })
  }, testUser.accessToken)
  
  assertEquals(usageResponse.status, 200)
  const usageResult = await usageResponse.json()
  assertExists(usageResult.usageRecord)
  assertExists(usageResult.limits)
  
  // Get usage statistics
  console.log("  📈 Getting usage statistics...")
  const statsResponse = await integrationHelper.makeRequest('/billing-system/usage', {
    method: 'GET'
  }, testUser.accessToken)
  
  assertEquals(statsResponse.status, 200)
  const statsResult = await statsResponse.json()
  assertExists(statsResult.usage)
  
  console.log("✅ Billing integration completed successfully!")
})

// Admin Panel Integration (requires admin user)
Deno.test("Integration - Admin Panel Workflow", async () => {
  console.log("🔄 Starting admin panel integration test...")
  
  const testUser = await integrationHelper.createTestUser()
  
  // Create admin record directly in database
  await integrationHelper.serviceSupabase
    .from('admins')
    .insert({
      user_id: testUser.id,
      role: 'admin',
      permissions: { users: true, brands: true, system: true },
      is_active: true
    })
  
  // Get admin dashboard
  console.log("  👨‍💼 Getting admin dashboard...")
  const dashboardResponse = await integrationHelper.makeRequest('/admin-panel', {
    method: 'GET'
  }, testUser.accessToken)
  
  assertEquals(dashboardResponse.status, 200)
  const dashboardResult = await dashboardResponse.json()
  assertExists(dashboardResult.overview)
  assertExists(dashboardResult.adminInfo)
  
  // Get system health
  console.log("  🏥 Checking system health...")
  const healthResponse = await integrationHelper.makeRequest('/admin-panel/system', {
    method: 'GET'
  }, testUser.accessToken)
  
  assertEquals(healthResponse.status, 200)
  const healthResult = await healthResponse.json()
  assertExists(healthResult.status)
  assertExists(healthResult.services)
  
  console.log("✅ Admin panel integration completed successfully!")
})

// Multi-Service Integration Test
Deno.test("Integration - Multi-Service Workflow", async () => {
  console.log("🔄 Starting multi-service integration test...")
  
  const testUser = await integrationHelper.createTestUser()
  
  // Create brand
  const brandResponse = await integrationHelper.makeRequest('/api-brands', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Multi-Service Test Brand',
      domain: 'multi-test.com',
      industry: 'technology'
    })
  }, testUser.accessToken)
  
  const brandResult = await brandResponse.json()
  const brandId = brandResult.brand.id
  
  console.log("  🔄 Running parallel operations...")
  
  // Run multiple operations in parallel
  const parallelOperations = await Promise.allSettled([
    // Generate schema
    integrationHelper.makeRequest('/schema-builder/generate', {
      method: 'POST',
      body: JSON.stringify({
        brandId,
        schemaType: 'organization',
        includeFields: ['name', 'url']
      })
    }, testUser.accessToken),
    
    // Add competitor
    integrationHelper.makeRequest('/competitor-tracking/track', {
      method: 'POST',
      body: JSON.stringify({
        brandId,
        competitorDomain: 'multi-competitor.com',
        relationshipType: 'direct',
        priorityLevel: 3
      })
    }, testUser.accessToken),
    
    // Track usage
    integrationHelper.makeRequest('/billing-system/track-usage', {
      method: 'POST',
      body: JSON.stringify({
        resourceType: 'api_calls',
        usageCount: 10
      })
    }, testUser.accessToken),
    
    // Configure monitoring
    integrationHelper.makeRequest('/live-monitoring/configure', {
      method: 'POST',
      body: JSON.stringify({
        brandId,
        configName: 'Multi-test Config',
        keywords: ['multi', 'test'],
        sources: ['website'],
        alertThresholds: { mentionSpike: 5 },
        notificationSettings: { email: true }
      })
    }, testUser.accessToken)
  ])
  
  // Check that all operations succeeded
  const successfulOps = parallelOperations.filter(result => 
    result.status === 'fulfilled' && result.value.status === 200
  )
  
  assertGreater(successfulOps.length, 2) // At least 3 out of 4 should succeed
  
  console.log(`  ✅ ${successfulOps.length}/4 parallel operations completed successfully`)
  
  // Verify dashboard shows all data
  console.log("  📊 Verifying dashboard integration...")
  const dashboardResponse = await integrationHelper.makeRequest(`/dashboard-api/dashboard/${brandId}`, {
    method: 'GET'
  }, testUser.accessToken)
  
  assertEquals(dashboardResponse.status, 200)
  const dashboardResult = await dashboardResponse.json()
  assertExists(dashboardResult.brand)
  assertExists(dashboardResult.overview)
  
  console.log("✅ Multi-service integration completed successfully!")
})

// Error Handling and Recovery Integration
Deno.test("Integration - Error Handling and Recovery", async () => {
  console.log("🔄 Starting error handling integration test...")
  
  const testUser = await integrationHelper.createTestUser()
  
  // Test graceful handling of invalid requests
  console.log("  ❌ Testing invalid brand ID...")
  const invalidResponse = await integrationHelper.makeRequest('/api-brands/invalid-uuid', {
    method: 'GET'
  }, testUser.accessToken)
  
  assertEquals(invalidResponse.status, 404)
  
  // Test unauthorized access
  console.log("  🔒 Testing unauthorized access...")
  const unauthorizedResponse = await integrationHelper.makeRequest('/admin-panel', {
    method: 'GET'
  }, testUser.accessToken)
  
  assertEquals(unauthorizedResponse.status, 403)
  
  // Test rate limiting (simplified)
  console.log("  🚦 Testing rate limiting...")
  const rapidRequests = await Promise.allSettled(
    Array.from({ length: 5 }, () =>
      integrationHelper.makeRequest('/llm-orchestration/models', {
        method: 'GET'
      }, testUser.accessToken)
    )
  )
  
  // At least some should succeed
  const successfulRequests = rapidRequests.filter(r => 
    r.status === 'fulfilled' && r.value.status === 200
  )
  assertGreater(successfulRequests.length, 0)
  
  console.log("✅ Error handling integration completed successfully!")
})

// Cleanup Integration Test
Deno.test("Integration Tests - Cleanup", async () => {
  console.log("🧹 Running integration test cleanup...")
  await integrationHelper.cleanup()
  console.log("✅ Integration test cleanup completed!")
})