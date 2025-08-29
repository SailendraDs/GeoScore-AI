import { assertEquals, assertExists, assertGreater } from "https://deno.land/std@0.192.0/testing/asserts.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321'
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || 'test-key'
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'test-service-key'

class AnalyticsTestHelper {
  private supabase: any
  private serviceSupabase: any
  
  constructor() {
    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    this.serviceSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  }

  async createTestUser(): Promise<{ id: string, accessToken: string }> {
    const email = `analytics-test-${Date.now()}@example.com`
    const password = 'testpassword123'

    const { data } = await this.supabase.auth.signUp({ email, password })
    const { data: sessionData } = await this.supabase.auth.signInWithPassword({ email, password })

    return {
      id: data.user.id,
      accessToken: sessionData.session.access_token
    }
  }

  async createTestBrand(userId: string): Promise<any> {
    const { data } = await this.serviceSupabase
      .from('brands')
      .insert({
        owner_id: userId,
        name: `Analytics Test Brand ${Date.now()}`,
        domain: `analytics-test-${Date.now()}.com`,
        industry: 'technology'
      })
      .select()
      .single()

    return data
  }

  async createTestCompetitor(brandId: string): Promise<any> {
    const { data } = await this.serviceSupabase
      .from('competitor_meta')
      .insert({
        brand_id: brandId,
        domain: `competitor-${Date.now()}.com`,
        name: `Test Competitor ${Date.now()}`,
        relationship_type: 'direct',
        priority_level: 3,
        added_by: 'test'
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
      await this.serviceSupabase.from('schemas').delete().like('brand_id', '%')
      await this.serviceSupabase.from('script_configs').delete().like('brand_id', '%')
      await this.serviceSupabase.from('competitor_scores').delete().like('brand_id', '%')
      await this.serviceSupabase.from('competitor_meta').delete().like('name', 'Test Competitor %')
      await this.serviceSupabase.from('brands').delete().like('name', 'Analytics Test Brand %')
      await this.serviceSupabase.from('users').delete().like('email', 'analytics-test-%@example.com')
    } catch (error) {
      console.warn('Analytics test cleanup warning:', error)
    }
  }
}

const analyticsTestHelper = new AnalyticsTestHelper()

// Competitor Tracking Tests
Deno.test("Competitor Tracking - Add new competitor", async () => {
  const testUser = await analyticsTestHelper.createTestUser()
  const testBrand = await analyticsTestHelper.createTestBrand(testUser.id)
  
  const response = await analyticsTestHelper.makeRequest('/competitor-tracking/track', {
    method: 'POST',
    body: JSON.stringify({
      brandId: testBrand.id,
      competitorDomain: 'newcompetitor.com',
      relationshipType: 'direct',
      priorityLevel: 4
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.competitor)
  assertEquals(result.competitor.domain, 'newcompetitor.com')
  assertEquals(result.competitor.relationship_type, 'direct')
  assertEquals(result.competitor.priority_level, 4)
  assertEquals(result.trackingSchedule, 'weekly')
})

Deno.test("Competitor Tracking - Analyze competitors", async () => {
  const testUser = await analyticsTestHelper.createTestUser()
  const testBrand = await analyticsTestHelper.createTestBrand(testUser.id)
  const testCompetitor = await analyticsTestHelper.createTestCompetitor(testBrand.id)
  
  // Add some test competitor scores
  await analyticsTestHelper.serviceSupabase
    .from('competitor_scores')
    .insert([
      {
        brand_id: testBrand.id,
        competitor_id: testCompetitor.id,
        model_name: 'claude-opus',
        score_type: 'visibility',
        brand_score: 75.0,
        competitor_score: 68.5,
        score_difference: 6.5
      }
    ])
  
  const response = await analyticsTestHelper.makeRequest('/competitor-tracking/analyze', {
    method: 'POST',
    body: JSON.stringify({
      brandId: testBrand.id,
      timeRange: '30d',
      models: ['claude-opus'],
      includeAlerts: false
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.summary)
  assertExists(result.competitors)
  assertEquals(Array.isArray(result.competitors), true)
  assertExists(result.summary.brandRank)
  assertExists(result.summary.totalCompetitors)
})

Deno.test("Competitor Tracking - Score competitors", async () => {
  const testUser = await analyticsTestHelper.createTestUser()
  const testBrand = await analyticsTestHelper.createTestBrand(testUser.id)
  await analyticsTestHelper.createTestCompetitor(testBrand.id)
  
  const response = await analyticsTestHelper.makeRequest('/competitor-tracking/score', {
    method: 'POST',
    body: JSON.stringify({
      brandId: testBrand.id
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.scoringResults)
  assertEquals(Array.isArray(result.scoringResults), true)
  assertEquals(result.message, 'Competitor scoring completed')
})

Deno.test("Competitor Tracking - Get competitive alerts", async () => {
  const testUser = await analyticsTestHelper.createTestUser()
  const testBrand = await analyticsTestHelper.createTestBrand(testUser.id)
  
  // Create test alert
  await analyticsTestHelper.serviceSupabase
    .from('competitive_alerts')
    .insert({
      brand_id: testBrand.id,
      alert_type: 'competitor_surge',
      competitor_domain: 'test-competitor.com',
      message: 'Test competitive alert',
      severity: 'medium'
    })
  
  const response = await analyticsTestHelper.makeRequest(`/competitor-tracking/alerts?brandId=${testBrand.id}`, {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.alerts)
  assertEquals(Array.isArray(result.alerts), true)
  assertGreater(result.alerts.length, 0)
})

Deno.test("Competitor Tracking - List competitors", async () => {
  const testUser = await analyticsTestHelper.createTestUser()
  const testBrand = await analyticsTestHelper.createTestBrand(testUser.id)
  await analyticsTestHelper.createTestCompetitor(testBrand.id)
  
  const response = await analyticsTestHelper.makeRequest(`/competitor-tracking?brandId=${testBrand.id}`, {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.competitors)
  assertEquals(Array.isArray(result.competitors), true)
  assertGreater(result.competitors.length, 0)
})

// Schema Builder Tests
Deno.test("Schema Builder - Generate organization schema", async () => {
  const testUser = await analyticsTestHelper.createTestUser()
  const testBrand = await analyticsTestHelper.createTestBrand(testUser.id)
  
  const response = await analyticsTestHelper.makeRequest('/schema-builder/generate', {
    method: 'POST',
    body: JSON.stringify({
      brandId: testBrand.id,
      schemaType: 'organization',
      includeFields: ['name', 'url', 'description', 'logo', 'address'],
      customData: {
        foundingYear: '2020',
        employees: '50-100'
      },
      model: 'gpt-4'
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.schema)
  assertExists(result.validation)
  assertExists(result.suggestions)
  assertExists(result.estimatedImpact)
  assertExists(result.schemaId)
  
  // Check schema structure
  assertEquals(result.schema['@context'], 'https://schema.org')
  assertEquals(result.schema['@type'], 'Organization')
  assertExists(result.schema.name)
  assertExists(result.schema.url)
})

Deno.test("Schema Builder - Generate product schema", async () => {
  const testUser = await analyticsTestHelper.createTestUser()
  const testBrand = await analyticsTestHelper.createTestBrand(testUser.id)
  
  const response = await analyticsTestHelper.makeRequest('/schema-builder/generate', {
    method: 'POST',
    body: JSON.stringify({
      brandId: testBrand.id,
      schemaType: 'product',
      includeFields: ['name', 'description', 'brand', 'offers'],
      customData: {
        productName: 'Test Product',
        price: '$99.99'
      }
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertEquals(result.schema['@type'], 'Product')
  assertExists(result.schema.name)
  assertExists(result.schema.description)
})

Deno.test("Schema Builder - Validate schema", async () => {
  const testUser = await analyticsTestHelper.createTestUser()
  
  const testSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Test Company",
    "url": "https://test.com",
    "description": "A test company"
  }
  
  const response = await analyticsTestHelper.makeRequest('/schema-builder/validate', {
    method: 'POST',
    body: JSON.stringify({
      schema: testSchema,
      schemaType: 'organization'
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertEquals(result.isValid, true)
  assertExists(result.errors)
  assertExists(result.warnings)
  assertExists(result.suggestions)
  assertExists(result.compliance)
})

Deno.test("Schema Builder - Validate invalid schema", async () => {
  const testUser = await analyticsTestHelper.createTestUser()
  
  const invalidSchema = {
    "name": "Test Company"
    // Missing @context and @type
  }
  
  const response = await analyticsTestHelper.makeRequest('/schema-builder/validate', {
    method: 'POST',
    body: JSON.stringify({
      schema: invalidSchema,
      schemaType: 'organization'
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertEquals(result.isValid, false)
  assertGreater(result.errors.length, 0)
})

Deno.test("Schema Builder - Get brand schemas", async () => {
  const testUser = await analyticsTestHelper.createTestUser()
  const testBrand = await analyticsTestHelper.createTestBrand(testUser.id)
  
  // Create a test schema first
  await analyticsTestHelper.serviceSupabase
    .from('schemas')
    .insert({
      brand_id: testBrand.id,
      schema_type: 'organization',
      json_schema: {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "Test Company"
      },
      generated_by: 'test',
      validation_status: 'valid'
    })
  
  const response = await analyticsTestHelper.makeRequest(`/schema-builder/${testBrand.id}`, {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.schemas)
  assertEquals(Array.isArray(result.schemas), true)
  assertGreater(result.schemas.length, 0)
})

// Script Serving Tests
Deno.test("Script Serving - Get script for brand domain", async () => {
  const testUser = await analyticsTestHelper.createTestUser()
  const testBrand = await analyticsTestHelper.createTestBrand(testUser.id)
  
  const response = await analyticsTestHelper.makeRequest(`/script-serving/geoscore.js?brand=${testBrand.domain}&type=combined&debug=true`, {
    method: 'GET'
  })

  assertEquals(response.status, 200)
  assertEquals(response.headers.get('Content-Type'), 'application/javascript; charset=utf-8')
  
  const script = await response.text()
  assertGreater(script.length, 100)
  
  // Check script contains expected elements
  assertEquals(script.includes('GeoScore'), true)
  assertEquals(script.includes(testBrand.id), true)
  assertEquals(script.includes(testBrand.domain), true)
})

Deno.test("Script Serving - Get script with brand ID", async () => {
  const testUser = await analyticsTestHelper.createTestUser()
  const testBrand = await analyticsTestHelper.createTestBrand(testUser.id)
  
  const response = await analyticsTestHelper.makeRequest(`/script-serving/geoscore.js?brand=${testBrand.id}&type=analytics`, {
    method: 'GET'
  })

  assertEquals(response.status, 200)
  
  const script = await response.text()
  assertEquals(script.includes('analyticsEnabled: true'), true)
  assertEquals(script.includes('schemaEnabled: false'), true)
})

Deno.test("Script Serving - Configure script", async () => {
  const testUser = await analyticsTestHelper.createTestUser()
  const testBrand = await analyticsTestHelper.createTestBrand(testUser.id)
  
  const response = await analyticsTestHelper.makeRequest('/script-serving', {
    method: 'POST',
    body: JSON.stringify({
      brandId: testBrand.id,
      scriptType: 'combined',
      config: {
        version: '2.0.0',
        customInit: 'console.log("Custom init");',
        cacheDuration: 7200
      },
      version: '2.0.0'
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.scriptConfig)
  assertExists(result.scriptUrl)
  assertEquals(result.message, 'Script configuration saved successfully')
})

Deno.test("Script Serving - Get script configuration", async () => {
  const testUser = await analyticsTestHelper.createTestUser()
  const testBrand = await analyticsTestHelper.createTestBrand(testUser.id)
  
  // Create configuration first
  await analyticsTestHelper.serviceSupabase
    .from('script_configs')
    .insert({
      brand_id: testBrand.id,
      script_type: 'analytics',
      config: { version: '1.0.0' },
      is_active: true,
      version: '1.0.0'
    })
  
  const response = await analyticsTestHelper.makeRequest(`/script-serving?brandId=${testBrand.id}`, {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.configs)
  assertEquals(Array.isArray(result.configs), true)
  assertGreater(result.configs.length, 0)
})

Deno.test("Script Serving - Invalid brand parameter", async () => {
  const response = await analyticsTestHelper.makeRequest('/script-serving/geoscore.js', {
    method: 'GET'
  })

  assertEquals(response.status, 400)
  assertEquals(response.headers.get('Content-Type'), 'application/javascript')
  
  const script = await response.text()
  assertEquals(script.includes('Brand parameter required'), true)
})

Deno.test("Script Serving - Non-existent brand", async () => {
  const response = await analyticsTestHelper.makeRequest('/script-serving/geoscore.js?brand=nonexistent.com', {
    method: 'GET'
  })

  assertEquals(response.status, 404)
  
  const script = await response.text()
  assertEquals(script.includes('Brand not found'), true)
})

// Dashboard API Tests (Integration with Analytics)
Deno.test("Dashboard API - Get brand dashboard", async () => {
  const testUser = await analyticsTestHelper.createTestUser()
  const testBrand = await analyticsTestHelper.createTestBrand(testUser.id)
  
  const response = await analyticsTestHelper.makeRequest(`/dashboard-api/dashboard/${testBrand.id}`, {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.brand)
  assertExists(result.overview)
  assertExists(result.recentReports)
  assertExists(result.upcomingTasks)
  assertEquals(Array.isArray(result.recentReports), true)
  assertEquals(Array.isArray(result.upcomingTasks), true)
})

Deno.test("Dashboard API - Get visibility metrics", async () => {
  const testUser = await analyticsTestHelper.createTestUser()
  const testBrand = await analyticsTestHelper.createTestBrand(testUser.id)
  
  const response = await analyticsTestHelper.makeRequest(`/dashboard-api/dashboard/${testBrand.id}/visibility?timeRange=30d`, {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.timeSeries)
  assertExists(result.byModel)
  assertExists(result.benchmarks)
  assertEquals(Array.isArray(result.timeSeries), true)
})

Deno.test("Dashboard API - Get performance metrics", async () => {
  const testUser = await analyticsTestHelper.createTestUser()
  const testBrand = await analyticsTestHelper.createTestBrand(testUser.id)
  
  const response = await analyticsTestHelper.makeRequest(`/dashboard-api/dashboard/${testBrand.id}/performance`, {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.brandHealth)
  assertExists(result.alerts)
  assertExists(result.recommendations)
  assertEquals(Array.isArray(result.alerts), true)
  assertEquals(Array.isArray(result.recommendations), true)
})

// Error Handling Tests
Deno.test("Analytics - Unauthorized access", async () => {
  const response = await analyticsTestHelper.makeRequest('/competitor-tracking/analyze', {
    method: 'POST',
    body: JSON.stringify({
      brandId: 'test-brand-id',
      timeRange: '30d'
    })
  })

  assertEquals(response.status, 401)
})

Deno.test("Schema Builder - Invalid schema type", async () => {
  const testUser = await analyticsTestHelper.createTestUser()
  const testBrand = await analyticsTestHelper.createTestBrand(testUser.id)
  
  const response = await analyticsTestHelper.makeRequest('/schema-builder/generate', {
    method: 'POST',
    body: JSON.stringify({
      brandId: testBrand.id,
      schemaType: 'invalid_type',
      includeFields: ['name']
    })
  }, testUser.accessToken)

  assertEquals(response.status, 400)
  
  const result = await response.json()
  assertEquals(result.error, 'Invalid schema type')
})

// Performance Tests
Deno.test("Analytics Performance - Multiple concurrent requests", async () => {
  const testUser = await analyticsTestHelper.createTestUser()
  const testBrand = await analyticsTestHelper.createTestBrand(testUser.id)
  
  const promises = [
    analyticsTestHelper.makeRequest(`/dashboard-api/dashboard/${testBrand.id}`, { method: 'GET' }, testUser.accessToken),
    analyticsTestHelper.makeRequest(`/dashboard-api/dashboard/${testBrand.id}/visibility`, { method: 'GET' }, testUser.accessToken),
    analyticsTestHelper.makeRequest(`/competitor-tracking?brandId=${testBrand.id}`, { method: 'GET' }, testUser.accessToken),
    analyticsTestHelper.makeRequest(`/schema-builder/${testBrand.id}`, { method: 'GET' }, testUser.accessToken)
  ]
  
  const startTime = Date.now()
  const responses = await Promise.all(promises)
  const endTime = Date.now()
  
  // All requests should succeed
  responses.forEach(response => {
    assertEquals(response.status, 200)
  })
  
  // Should complete within reasonable time (10 seconds)
  assertEquals(endTime - startTime < 10000, true)
  
  console.log(`Analytics performance test completed in ${endTime - startTime}ms`)
})

// Cleanup
Deno.test("Analytics Tests - Cleanup", async () => {
  await analyticsTestHelper.cleanup()
  console.log("Analytics test cleanup completed")
})