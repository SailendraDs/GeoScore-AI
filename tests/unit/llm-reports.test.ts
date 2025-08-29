import { assertEquals, assertExists, assertGreater } from "https://deno.land/std@0.192.0/testing/asserts.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321'
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || 'test-key'
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'test-service-key'

class LLMTestHelper {
  private supabase: any
  private serviceSupabase: any
  
  constructor() {
    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    this.serviceSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  }

  async createTestUser(): Promise<{ id: string, accessToken: string }> {
    const email = `llm-test-${Date.now()}@example.com`
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
        name: `LLM Test Brand ${Date.now()}`,
        domain: `llm-test-${Date.now()}.com`,
        industry: 'technology'
      })
      .select()
      .single()

    return data
  }

  async createTestPrompt(brandId: string): Promise<any> {
    const { data } = await this.serviceSupabase
      .from('brand_prompts')
      .insert({
        brand_id: brandId,
        prompt: 'What can you tell me about this technology company?',
        intent_type: 'research',
        generated_by: 'test',
        is_active: true
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
      await this.serviceSupabase.from('llm_reports').delete().like('brand_id', '%')
      await this.serviceSupabase.from('brand_prompts').delete().like('prompt', '%Test%')
      await this.serviceSupabase.from('brands').delete().like('name', 'LLM Test Brand %')
      await this.serviceSupabase.from('users').delete().like('email', 'llm-test-%@example.com')
    } catch (error) {
      console.warn('LLM test cleanup warning:', error)
    }
  }
}

const llmTestHelper = new LLMTestHelper()

// LLM Orchestration Tests
Deno.test("LLM Orchestration - Generate text with Claude", async () => {
  const testUser = await llmTestHelper.createTestUser()
  const testBrand = await llmTestHelper.createTestBrand(testUser.id)
  
  const response = await llmTestHelper.makeRequest('/llm-orchestration', {
    method: 'POST',
    body: JSON.stringify({
      model: 'claude-opus',
      prompt: 'Write a brief description of AI technology.',
      brandId: testBrand.id,
      metadata: {
        scoreType: 'test',
        testRun: true
      }
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.response)
  assertExists(result.response.content)
  assertExists(result.response.cost)
  assertEquals(result.model, 'claude-opus')
  assertGreater(result.response.content.length, 10)
})

Deno.test("LLM Orchestration - Generate with invalid model", async () => {
  const testUser = await llmTestHelper.createTestUser()
  const testBrand = await llmTestHelper.createTestBrand(testUser.id)
  
  const response = await llmTestHelper.makeRequest('/llm-orchestration', {
    method: 'POST',
    body: JSON.stringify({
      model: 'invalid-model',
      prompt: 'Test prompt',
      brandId: testBrand.id
    })
  }, testUser.accessToken)

  assertEquals(response.status, 400)
  
  const result = await response.json()
  assertEquals(result.error, 'Unsupported model')
})

Deno.test("LLM Orchestration - Cost tracking", async () => {
  const testUser = await llmTestHelper.createTestUser()
  const testBrand = await llmTestHelper.createTestBrand(testUser.id)
  
  const response = await llmTestHelper.makeRequest('/llm-orchestration', {
    method: 'POST',
    body: JSON.stringify({
      model: 'gpt-4',
      prompt: 'Short test prompt for cost tracking.',
      brandId: testBrand.id,
      metadata: { scoreType: 'cost_test' }
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.response.cost)
  assertExists(result.response.cost.inputTokens)
  assertExists(result.response.cost.outputTokens)
  assertExists(result.response.cost.totalCost)
  assertGreater(result.response.cost.totalCost, 0)
})

Deno.test("LLM Orchestration - Rate limiting", async () => {
  const testUser = await llmTestHelper.createTestUser()
  const testBrand = await llmTestHelper.createTestBrand(testUser.id)
  
  // Make multiple rapid requests
  const promises = Array.from({ length: 3 }, () =>
    llmTestHelper.makeRequest('/llm-orchestration', {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-4',
        prompt: 'Rate limiting test prompt.',
        brandId: testBrand.id
      })
    }, testUser.accessToken)
  )
  
  const responses = await Promise.all(promises.map(p => p.catch(e => e)))
  
  // At least one should succeed
  const successfulResponses = responses.filter(r => r.status === 200)
  assertGreater(successfulResponses.length, 0)
})

Deno.test("LLM Orchestration - Get available models", async () => {
  const testUser = await llmTestHelper.createTestUser()
  
  const response = await llmTestHelper.makeRequest('/llm-orchestration/models', {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.models)
  assertEquals(Array.isArray(result.models), true)
  assertGreater(result.models.length, 0)
  
  // Check model structure
  const model = result.models[0]
  assertExists(model.name)
  assertExists(model.provider)
  assertExists(model.costPerToken)
})

// Report Generation Tests
Deno.test("Report Generation - Generate single report", async () => {
  const testUser = await llmTestHelper.createTestUser()
  const testBrand = await llmTestHelper.createTestBrand(testUser.id)
  const testPrompt = await llmTestHelper.createTestPrompt(testBrand.id)
  
  const response = await llmTestHelper.makeRequest('/report-generation/generate', {
    method: 'POST',
    body: JSON.stringify({
      brandId: testBrand.id,
      promptIds: [testPrompt.id],
      models: ['claude-opus'],
      reportType: 'single'
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.reportId)
  assertEquals(result.status, 'processing')
  assertExists(result.steps)
  assertEquals(Array.isArray(result.steps), true)
  assertGreater(result.steps.length, 0)
})

Deno.test("Report Generation - Baseline report", async () => {
  const testUser = await llmTestHelper.createTestUser()
  const testBrand = await llmTestHelper.createTestBrand(testUser.id)
  
  const response = await llmTestHelper.makeRequest('/report-generation/generate', {
    method: 'POST',
    body: JSON.stringify({
      brandId: testBrand.id,
      reportType: 'baseline',
      options: {
        includeAnalytics: true,
        generateRecommendations: true
      }
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertEquals(result.reportType, 'baseline')
  assertExists(result.estimatedCompletion)
})

Deno.test("Report Generation - Analyze reports", async () => {
  const testUser = await llmTestHelper.createTestUser()
  const testBrand = await llmTestHelper.createTestBrand(testUser.id)
  
  // First create some test report data
  await llmTestHelper.serviceSupabase
    .from('llm_reports')
    .insert([
      {
        brand_id: testBrand.id,
        model_name: 'claude-opus',
        score_type: 'visibility',
        score_value: 75.5,
        response_text: 'Test response for analysis',
        cost_estimate: 0.05
      },
      {
        brand_id: testBrand.id,
        model_name: 'gpt-4',
        score_type: 'visibility',
        score_value: 68.2,
        response_text: 'Another test response',
        cost_estimate: 0.08
      }
    ])
  
  const response = await llmTestHelper.makeRequest('/report-generation/analyze', {
    method: 'POST',
    body: JSON.stringify({
      brandId: testBrand.id,
      timeRange: '30d',
      models: ['claude-opus', 'gpt-4']
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.summary)
  assertExists(result.summary.averageVisibility)
  assertExists(result.modelComparison)
  assertEquals(Array.isArray(result.modelComparison), true)
})

Deno.test("Report Generation - Compare models", async () => {
  const testUser = await llmTestHelper.createTestUser()
  const testBrand1 = await llmTestHelper.createTestBrand(testUser.id)
  const testBrand2 = await llmTestHelper.createTestBrand(testUser.id)
  
  const response = await llmTestHelper.makeRequest('/report-generation/compare', {
    method: 'POST',
    body: JSON.stringify({
      brandIds: [testBrand1.id, testBrand2.id],
      models: ['claude-opus', 'gpt-4'],
      timeRange: '30d'
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.brands)
  assertEquals(Array.isArray(result.brands), true)
  assertEquals(result.brands.length, 2)
  assertExists(result.summary)
})

Deno.test("Report Generation - List reports", async () => {
  const testUser = await llmTestHelper.createTestUser()
  const testBrand = await llmTestHelper.createTestBrand(testUser.id)
  
  const response = await llmTestHelper.makeRequest(`/report-generation?brandId=${testBrand.id}&limit=10`, {
    method: 'GET'
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.reports)
  assertEquals(Array.isArray(result.reports), true)
})

// Brand Onboarding Tests
Deno.test("Brand Onboarding - Analyze step", async () => {
  const testUser = await llmTestHelper.createTestUser()
  const testBrand = await llmTestHelper.createTestBrand(testUser.id)
  
  const response = await llmTestHelper.makeRequest('/brand-onboarding', {
    method: 'POST',
    body: JSON.stringify({
      brandId: testBrand.id,
      step: 'analyze',
      options: {
        connectors: ['semrush'],
        llmModels: ['claude-opus'],
        competitorAnalysis: true
      }
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertEquals(result.currentStep, 'analyze')
  assertExists(result.steps)
  assertEquals(Array.isArray(result.steps), true)
  assertExists(result.generatedData)
})

Deno.test("Brand Onboarding - Generate prompts step", async () => {
  const testUser = await llmTestHelper.createTestUser()
  const testBrand = await llmTestHelper.createTestBrand(testUser.id)
  
  // Set up analysis data first
  await llmTestHelper.serviceSupabase
    .from('brand_setup_state')
    .upsert({
      brand_id: testBrand.id,
      completed_steps: ['basic_info', 'competitors', 'topics'],
      current_step: 'prompts',
      setup_data: {
        analysis_data: {
          connectorData: { summary: 'test data' },
          competitorAnalysis: { competitorsFound: 3 },
          topicAnalysis: { topicsExtracted: 5 }
        }
      }
    })
  
  const response = await llmTestHelper.makeRequest('/brand-onboarding', {
    method: 'POST',
    body: JSON.stringify({
      brandId: testBrand.id,
      step: 'generate_prompts',
      options: {
        promptCount: 5
      }
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertEquals(result.currentStep, 'generate_prompts')
  assertExists(result.generatedData)
  assertExists(result.generatedData.prompts)
})

Deno.test("Brand Onboarding - Finalize step", async () => {
  const testUser = await llmTestHelper.createTestUser()
  const testBrand = await llmTestHelper.createTestBrand(testUser.id)
  
  const response = await llmTestHelper.makeRequest('/brand-onboarding', {
    method: 'POST',
    body: JSON.stringify({
      brandId: testBrand.id,
      step: 'finalize',
      options: {}
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertEquals(result.currentStep, 'finalize')
  assertExists(result.nextSteps)
  assertEquals(Array.isArray(result.nextSteps), true)
})

// Connector Integration Tests
Deno.test("Connector Orchestration - Multiple connectors", async () => {
  const testUser = await llmTestHelper.createTestUser()
  const testBrand = await llmTestHelper.createTestBrand(testUser.id)
  
  const response = await llmTestHelper.makeRequest('/connector-orchestration', {
    method: 'POST',
    body: JSON.stringify({
      brandId: testBrand.id,
      domain: testBrand.domain,
      connectors: ['semrush', 'serpapi'],
      competitors: ['competitor1.com', 'competitor2.com']
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.results)
  assertEquals(Array.isArray(result.results), true)
  assertExists(result.summary)
  assertExists(result.processedData)
})

Deno.test("Connector Orchestration - Single connector", async () => {
  const testUser = await llmTestHelper.createTestUser()
  const testBrand = await llmTestHelper.createTestBrand(testUser.id)
  
  const response = await llmTestHelper.makeRequest('/connector-orchestration', {
    method: 'POST',
    body: JSON.stringify({
      brandId: testBrand.id,
      domain: testBrand.domain,
      connectors: ['serpapi'],
      competitors: []
    })
  }, testUser.accessToken)

  assertEquals(response.status, 200)
  
  const result = await response.json()
  assertExists(result.results)
  assertGreater(result.results.length, 0)
})

// Error Handling and Edge Cases
Deno.test("LLM - Invalid brand ID", async () => {
  const testUser = await llmTestHelper.createTestUser()
  
  const response = await llmTestHelper.makeRequest('/llm-orchestration', {
    method: 'POST',
    body: JSON.stringify({
      model: 'claude-opus',
      prompt: 'Test prompt',
      brandId: 'invalid-uuid'
    })
  }, testUser.accessToken)

  assertEquals(response.status, 400)
})

Deno.test("Report Generation - Empty prompt list", async () => {
  const testUser = await llmTestHelper.createTestUser()
  const testBrand = await llmTestHelper.createTestBrand(testUser.id)
  
  const response = await llmTestHelper.makeRequest('/report-generation/generate', {
    method: 'POST',
    body: JSON.stringify({
      brandId: testBrand.id,
      promptIds: [],
      models: ['claude-opus'],
      reportType: 'single'
    })
  }, testUser.accessToken)

  // Should handle gracefully by using default prompts
  assertEquals(response.status, 200)
})

Deno.test("Brand Onboarding - Invalid step", async () => {
  const testUser = await llmTestHelper.createTestUser()
  const testBrand = await llmTestHelper.createTestBrand(testUser.id)
  
  const response = await llmTestHelper.makeRequest('/brand-onboarding', {
    method: 'POST',
    body: JSON.stringify({
      brandId: testBrand.id,
      step: 'invalid_step'
    })
  }, testUser.accessToken)

  assertEquals(response.status, 400)
  
  const result = await response.json()
  assertEquals(result.error, 'Invalid step')
})

// Performance and Load Tests
Deno.test("Performance - Multiple LLM requests", async () => {
  const testUser = await llmTestHelper.createTestUser()
  const testBrand = await llmTestHelper.createTestBrand(testUser.id)
  
  const startTime = Date.now()
  
  const promises = Array.from({ length: 3 }, (_, i) =>
    llmTestHelper.makeRequest('/llm-orchestration', {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-4',
        prompt: `Performance test prompt ${i}`,
        brandId: testBrand.id,
        metadata: { testRun: true }
      })
    }, testUser.accessToken)
  )
  
  const responses = await Promise.all(promises)
  const endTime = Date.now()
  
  // All should succeed
  responses.forEach(response => {
    assertEquals(response.status, 200)
  })
  
  // Should complete within reasonable time (30 seconds)
  assertEquals(endTime - startTime < 30000, true)
  
  console.log(`LLM performance test completed in ${endTime - startTime}ms`)
})

// Cleanup
Deno.test("LLM Tests - Cleanup", async () => {
  await llmTestHelper.cleanup()
  console.log("LLM test cleanup completed")
})