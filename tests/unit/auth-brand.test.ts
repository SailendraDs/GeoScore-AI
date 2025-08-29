import { assertEquals, assertExists, assertRejects } from "https://deno.land/std@0.192.0/testing/asserts.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Test configuration
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321'
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || 'test-key'
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'test-service-key'

interface TestUser {
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

class TestHelper {
  private supabase: any
  private serviceSupabase: any
  
  constructor() {
    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    this.serviceSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  }

  async createTestUser(email?: string): Promise<TestUser> {
    const testEmail = email || `test-${Date.now()}@example.com`
    const password = 'testpassword123'

    const { data, error } = await this.supabase.auth.signUp({
      email: testEmail,
      password: password,
    })

    if (error) throw error
    if (!data.user) throw new Error('User creation failed')

    // Get access token
    const { data: sessionData, error: sessionError } = await this.supabase.auth.signInWithPassword({
      email: testEmail,
      password: password
    })

    if (sessionError) throw sessionError

    return {
      id: data.user.id,
      email: testEmail,
      accessToken: sessionData.session.access_token
    }
  }

  async createTestBrand(userId: string, overrides?: Partial<TestBrand>): Promise<TestBrand> {
    const brandData = {
      owner_id: userId,
      name: overrides?.name || `Test Brand ${Date.now()}`,
      domain: overrides?.domain || `test-${Date.now()}.com`,
      industry: 'technology',
      description: 'Test brand for unit testing',
      ...overrides
    }

    const { data, error } = await this.serviceSupabase
      .from('brands')
      .insert(brandData)
      .select()
      .single()

    if (error) throw error

    return data
  }

  async cleanup() {
    // Clean up test data
    try {
      await this.serviceSupabase.from('brands').delete().like('name', 'Test Brand %')
      await this.serviceSupabase.from('users').delete().like('email', 'test-%@example.com')
    } catch (error) {
      console.warn('Cleanup warning:', error)
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
}

const testHelper = new TestHelper()

// Authentication Tests
Deno.test("Auth - User onboarding with valid data", async () => {
  const testUser = await testHelper.createTestUser()
  
  const response = await testHelper.makeRequest('/auth-onboard', {
    method: 'POST',
    body: JSON.stringify({
      fullName: 'Test User',
      companyName: 'Test Company',
      industry: 'technology',
      role: 'developer'
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.profile)
  assertEquals(result.profile.full_name, 'Test User')
  assertEquals(result.profile.company_name, 'Test Company')
})

Deno.test("Auth - User onboarding without authentication", async () => {
  const response = await testHelper.makeRequest('/auth-onboard', {
    method: 'POST',
    body: JSON.stringify({
      fullName: 'Test User',
      companyName: 'Test Company'
    })
  })

  assertEquals(response.status, 401)
  
  const result = await response.json()
  assertEquals(result.error, 'Unauthorized')
})

Deno.test("Auth - Get user profile", async () => {
  const testUser = await testHelper.createTestUser()
  
  // First create profile
  await testHelper.makeRequest('/auth-onboard', {
    method: 'POST',
    body: JSON.stringify({
      fullName: 'Test User Profile',
      companyName: 'Test Company Profile',
      industry: 'technology'
    })
  }, testUser.accessToken)

  // Then get profile
  const response = await testHelper.makeRequest('/auth-profile', {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.profile)
  assertEquals(result.profile.full_name, 'Test User Profile')
})

Deno.test("Auth - Update user profile", async () => {
  const testUser = await testHelper.createTestUser()
  
  // Create initial profile
  await testHelper.makeRequest('/auth-onboard', {
    method: 'POST',
    body: JSON.stringify({
      fullName: 'Initial Name',
      companyName: 'Initial Company'
    })
  }, testUser.accessToken)

  // Update profile
  const response = await testHelper.makeRequest('/auth-profile', {
    method: 'PUT',
    body: JSON.stringify({
      fullName: 'Updated Name',
      companyName: 'Updated Company',
      industry: 'finance'
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertEquals(result.profile.full_name, 'Updated Name')
  assertEquals(result.profile.company_name, 'Updated Company')
  assertEquals(result.profile.industry, 'finance')
})

// Brand Management Tests
Deno.test("Brands - Create brand with valid data", async () => {
  const testUser = await testHelper.createTestUser()
  
  const response = await testHelper.makeRequest('/api-brands', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Test Brand API',
      domain: 'testbrandapi.com',
      industry: 'technology',
      description: 'A test brand for API testing',
      competitors: ['competitor1.com', 'competitor2.com']
    })
  }, testUser.accessToken)

  assertEquals(response.status, 201)
  
  const result = await response.json()
  assertExists(result.brand)
  assertEquals(result.brand.name, 'Test Brand API')
  assertEquals(result.brand.domain, 'testbrandapi.com')
  assertEquals(result.brand.owner_id, testUser.id)
  assertEquals(result.nextStep, 'competitors')
})

Deno.test("Brands - Create brand with invalid domain", async () => {
  const testUser = await testHelper.createTestUser()
  
  const response = await testHelper.makeRequest('/api-brands', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Test Brand',
      domain: 'invalid-domain',
      industry: 'technology'
    })
  }, testUser.accessToken)

  assertEquals(response.status, 400)
  
  const result = await response.json()
  assertEquals(result.error, 'Invalid domain format')
})

Deno.test("Brands - Create brand without required fields", async () => {
  const testUser = await testHelper.createTestUser()
  
  const response = await testHelper.makeRequest('/api-brands', {
    method: 'POST',
    body: JSON.stringify({
      description: 'Missing name and domain'
    })
  }, testUser.accessToken)

  assertEquals(response.status, 400)
  
  const result = await response.json()
  assertEquals(result.error, 'Missing required fields: name, domain')
})

Deno.test("Brands - Get user brands", async () => {
  const testUser = await testHelper.createTestUser()
  const testBrand = await testHelper.createTestBrand(testUser.id)
  
  const response = await testHelper.makeRequest('/api-brands', {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.brands)
  assertEquals(Array.isArray(result.brands), true)
  assertEquals(result.brands.length >= 1, true)
  
  const foundBrand = result.brands.find((b: any) => b.id === testBrand.id)
  assertExists(foundBrand)
  assertEquals(foundBrand.name, testBrand.name)
})

Deno.test("Brands - Get specific brand", async () => {
  const testUser = await testHelper.createTestUser()
  const testBrand = await testHelper.createTestBrand(testUser.id)
  
  const response = await testHelper.makeRequest(`/api-brands/${testBrand.id}`, {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.brand)
  assertEquals(result.brand.id, testBrand.id)
  assertEquals(result.brand.name, testBrand.name)
  assertExists(result.brand.setupProgress)
  assertExists(result.brand.analytics)
})

Deno.test("Brands - Update brand", async () => {
  const testUser = await testHelper.createTestUser()
  const testBrand = await testHelper.createTestBrand(testUser.id)
  
  const response = await testHelper.makeRequest(`/api-brands/${testBrand.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: 'Updated Brand Name',
      description: 'Updated description',
      competitors: ['newcompetitor.com']
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertEquals(result.brand.name, 'Updated Brand Name')
  assertEquals(result.brand.description, 'Updated description')
  assertEquals(result.brand.competitors.includes('newcompetitor.com'), true)
})

Deno.test("Brands - Delete brand", async () => {
  const testUser = await testHelper.createTestUser()
  const testBrand = await testHelper.createTestBrand(testUser.id)
  
  const response = await testHelper.makeRequest(`/api-brands/${testBrand.id}`, {
    method: 'DELETE'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertEquals(result.message, 'Brand deleted successfully')
  
  // Verify brand is deleted
  const getResponse = await testHelper.makeRequest(`/api-brands/${testBrand.id}`, {
    method: 'GET'
  }, testUser.accessToken)
  
  assertEquals(getResponse.status, 404)
})

Deno.test("Brands - Access control - cannot access other user's brand", async () => {
  const testUser1 = await testHelper.createTestUser()
  const testUser2 = await testHelper.createTestUser()
  const testBrand = await testHelper.createTestBrand(testUser1.id)
  
  const response = await testHelper.makeRequest(`/api-brands/${testBrand.id}`, {
    method: 'GET'
  }, testUser2.accessToken)

  assertEquals(response.status, 404)
})

// API Key Management Tests
Deno.test("API Keys - Rotate key successfully", async () => {
  const testUser = await testHelper.createTestUser()
  
  const response = await testHelper.makeRequest('/keys-rotate', {
    method: 'POST',
    body: JSON.stringify({
      serviceId: 'openai',
      newKey: 'sk-test-new-key-12345',
      gracePeriodHours: 1
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertEquals(result.success, true)
  assertExists(result.rotationId)
  assertEquals(result.message, 'API key rotation initiated successfully')
})

Deno.test("API Keys - Get key statistics", async () => {
  const testUser = await testHelper.createTestUser()
  
  const response = await testHelper.makeRequest('/keys-stats', {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.stats)
  assertEquals(Array.isArray(result.stats), true)
})

// Brand Setup Tests
Deno.test("Brand Setup - Update setup progress", async () => {
  const testUser = await testHelper.createTestUser()
  const testBrand = await testHelper.createTestBrand(testUser.id)
  
  const response = await testHelper.makeRequest('/brand-setup', {
    method: 'POST',
    body: JSON.stringify({
      brandId: testBrand.id,
      step: 'competitors',
      data: {
        competitors: ['competitor1.com', 'competitor2.com']
      }
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertEquals(result.success, true)
  assertEquals(result.setup.completedSteps.includes('competitors'), true)
  assertEquals(result.setup.currentStep, 'topics')
})

Deno.test("Brand Setup - Get setup status", async () => {
  const testUser = await testHelper.createTestUser()
  const testBrand = await testHelper.createTestBrand(testUser.id)
  
  const response = await testHelper.makeRequest(`/brand-setup?brandId=${testBrand.id}`, {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.setup)
  assertExists(result.setup.completedSteps)
  assertExists(result.setup.progress)
})

// Error Handling Tests
Deno.test("Error Handling - Invalid JSON", async () => {
  const testUser = await testHelper.createTestUser()
  
  const response = await testHelper.makeRequest('/api-brands', {
    method: 'POST',
    body: 'invalid json'
  }, testUser.accessToken)

  assertEquals(response.status, 500)
})

Deno.test("Error Handling - Missing authorization", async () => {
  const response = await testHelper.makeRequest('/api-brands', {
    method: 'GET'
  })

  assertEquals(response.status, 401)
  
  const result = await response.json()
  assertEquals(result.error, 'Unauthorized')
})

Deno.test("Error Handling - Invalid brand ID format", async () => {
  const testUser = await testHelper.createTestUser()
  
  const response = await testHelper.makeRequest('/api-brands/invalid-uuid', {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 404)
})

// Performance Tests
Deno.test("Performance - Multiple concurrent brand requests", async () => {
  const testUser = await testHelper.createTestUser()
  const testBrand = await testHelper.createTestBrand(testUser.id)
  
  const promises = Array.from({ length: 5 }, () =>
    testHelper.makeRequest(`/api-brands/${testBrand.id}`, {
      method: 'GET'
    }, testUser.accessToken)
  )
  
  const startTime = Date.now()
  const responses = await Promise.all(promises)
  const endTime = Date.now()
  
  // All requests should succeed
  responses.forEach(response => {
    assertEquals(response.status, 200)
  })
  
  // Should complete within reasonable time (5 seconds)
  assertEquals(endTime - startTime < 5000, true)
})

// Cleanup after all tests
Deno.test("Cleanup test data", async () => {
  await testHelper.cleanup()
  console.log("Test cleanup completed")
})