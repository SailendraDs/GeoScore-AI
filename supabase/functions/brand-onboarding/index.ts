import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface OnboardingRequest {
  brandId: string
  step: 'analyze' | 'generate_prompts' | 'finalize'
  options?: {
    connectors?: string[]
    llmModels?: string[]
    promptCount?: number
    competitorAnalysis?: boolean
  }
}

interface OnboardingStep {
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  data?: any
  error?: string
  startTime?: string
  endTime?: string
}

interface OnboardingResult {
  brandId: string
  currentStep: string
  steps: OnboardingStep[]
  overallProgress: number
  isComplete: boolean
  generatedData: {
    topics: number
    prompts: number
    competitors: number
    keywordsAnalyzed: number
  }
  nextSteps: string[]
  estimatedCompletion?: string
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

    const { brandId, step, options = {} }: OnboardingRequest = await req.json()

    if (!brandId) {
      return new Response(
        JSON.stringify({ error: 'Missing brandId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify brand ownership
    const { data: brand, error: brandError } = await supabaseClient
      .from('brands')
      .select('*')
      .eq('id', brandId)
      .eq('owner_id', user.id)
      .single()

    if (brandError || !brand) {
      return new Response(
        JSON.stringify({ error: 'Brand not found or access denied' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let result: OnboardingResult

    switch (step) {
      case 'analyze':
        result = await runAnalysisStep(supabaseClient, brand, options)
        break
      case 'generate_prompts':
        result = await runPromptGenerationStep(supabaseClient, brand, options)
        break
      case 'finalize':
        result = await runFinalizationStep(supabaseClient, brand, options)
        break
      default:
        return new Response(
          JSON.stringify({ error: 'Invalid step' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Onboarding flow error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function runAnalysisStep(supabaseClient: any, brand: any, options: any): Promise<OnboardingResult> {\n  const steps: OnboardingStep[] = [\n    { name: 'data_collection', status: 'running', progress: 0, startTime: new Date().toISOString() },\n    { name: 'competitor_discovery', status: 'pending', progress: 0 },\n    { name: 'topic_extraction', status: 'pending', progress: 0 },\n    { name: 'market_analysis', status: 'pending', progress: 0 }\n  ]\n\n  const result: OnboardingResult = {\n    brandId: brand.id,\n    currentStep: 'analyze',\n    steps,\n    overallProgress: 0,\n    isComplete: false,\n    generatedData: { topics: 0, prompts: 0, competitors: 0, keywordsAnalyzed: 0 },\n    nextSteps: []\n  }\n\n  try {\n    // Step 1: Data Collection via Connectors\n    steps[0].status = 'running'\n    steps[0].progress = 25\n    \n    const connectorResponse = await fetch('https://alaxjkbdistiwvckfysi.supabase.co/functions/v1/connector-orchestration', {\n      method: 'POST',\n      headers: {\n        'Content-Type': 'application/json',\n        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`\n      },\n      body: JSON.stringify({\n        brandId: brand.id,\n        domain: brand.domain,\n        connectors: options.connectors || ['semrush', 'serpapi'],\n        competitors: brand.competitors || []\n      })\n    })\n\n    if (!connectorResponse.ok) {\n      throw new Error(`Connector orchestration failed: ${connectorResponse.status}`)\n    }\n\n    const connectorData = await connectorResponse.json()\n    steps[0].status = 'completed'\n    steps[0].progress = 100\n    steps[0].endTime = new Date().toISOString()\n    steps[0].data = connectorData.summary\n\n    result.generatedData.keywordsAnalyzed = connectorData.processedData.keywordsAnalyzed || 0\n\n    // Step 2: Competitor Discovery\n    steps[1].status = 'running'\n    steps[1].startTime = new Date().toISOString()\n    \n    const competitorAnalysis = await analyzeCompetitors(supabaseClient, brand, connectorData)\n    \n    steps[1].status = 'completed'\n    steps[1].progress = 100\n    steps[1].endTime = new Date().toISOString()\n    steps[1].data = competitorAnalysis\n\n    result.generatedData.competitors = competitorAnalysis.competitorsFound || 0\n\n    // Step 3: Topic Extraction\n    steps[2].status = 'running'\n    steps[2].startTime = new Date().toISOString()\n    \n    const topicAnalysis = await extractTopics(supabaseClient, brand.id)\n    \n    steps[2].status = 'completed'\n    steps[2].progress = 100\n    steps[2].endTime = new Date().toISOString()\n    steps[2].data = topicAnalysis\n\n    result.generatedData.topics = topicAnalysis.topicsExtracted || 0\n\n    // Step 4: Market Analysis with LLM\n    steps[3].status = 'running'\n    steps[3].startTime = new Date().toISOString()\n    \n    const marketAnalysis = await performMarketAnalysis(supabaseClient, brand, connectorData)\n    \n    steps[3].status = 'completed'\n    steps[3].progress = 100\n    steps[3].endTime = new Date().toISOString()\n    steps[3].data = marketAnalysis\n\n    // Update setup state\n    await supabaseClient\n      .from('brand_setup_state')\n      .update({\n        completed_steps: ['basic_info', 'competitors', 'topics'],\n        current_step: 'prompts',\n        setup_data: {\n          analysis_data: {\n            connectorData: connectorData.summary,\n            competitorAnalysis,\n            topicAnalysis,\n            marketAnalysis\n          }\n        }\n      })\n      .eq('brand_id', brand.id)\n\n    result.overallProgress = 75\n    result.currentStep = 'generate_prompts'\n    result.nextSteps = ['Generate AI prompts based on analysis', 'Test prompt effectiveness']\n    result.estimatedCompletion = new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes\n\n  } catch (error) {\n    const failedStepIndex = steps.findIndex(s => s.status === 'running')\n    if (failedStepIndex >= 0) {\n      steps[failedStepIndex].status = 'failed'\n      steps[failedStepIndex].error = error.message\n      steps[failedStepIndex].endTime = new Date().toISOString()\n    }\n    \n    result.nextSteps = ['Retry analysis', 'Check API configurations']\n  }\n\n  return result\n}\n\nasync function runPromptGenerationStep(supabaseClient: any, brand: any, options: any): Promise<OnboardingResult> {\n  const steps: OnboardingStep[] = [\n    { name: 'prompt_strategy', status: 'running', progress: 0, startTime: new Date().toISOString() },\n    { name: 'generate_prompts', status: 'pending', progress: 0 },\n    { name: 'test_prompts', status: 'pending', progress: 0 },\n    { name: 'optimize_prompts', status: 'pending', progress: 0 }\n  ]\n\n  const result: OnboardingResult = {\n    brandId: brand.id,\n    currentStep: 'generate_prompts',\n    steps,\n    overallProgress: 75,\n    isComplete: false,\n    generatedData: { topics: 0, prompts: 0, competitors: 0, keywordsAnalyzed: 0 },\n    nextSteps: []\n  }\n\n  try {\n    // Get existing analysis data\n    const { data: setupData } = await supabaseClient\n      .from('brand_setup_state')\n      .select('setup_data')\n      .eq('brand_id', brand.id)\n      .single()\n\n    const analysisData = setupData?.setup_data?.analysis_data || {}\n\n    // Step 1: Define Prompt Strategy\n    steps[0].status = 'running'\n    const promptStrategy = await definePromptStrategy(brand, analysisData)\n    steps[0].status = 'completed'\n    steps[0].progress = 100\n    steps[0].endTime = new Date().toISOString()\n    steps[0].data = promptStrategy\n\n    // Step 2: Generate Prompts using LLM\n    steps[1].status = 'running'\n    steps[1].startTime = new Date().toISOString()\n    \n    const generatedPrompts = await generatePrompts(supabaseClient, brand, promptStrategy, options.promptCount || 10)\n    \n    steps[1].status = 'completed'\n    steps[1].progress = 100\n    steps[1].endTime = new Date().toISOString()\n    steps[1].data = { promptCount: generatedPrompts.length }\n\n    result.generatedData.prompts = generatedPrompts.length\n\n    // Step 3: Test Prompts\n    steps[2].status = 'running'\n    steps[2].startTime = new Date().toISOString()\n    \n    const promptTests = await testPrompts(supabaseClient, brand.id, generatedPrompts.slice(0, 3))\n    \n    steps[2].status = 'completed'\n    steps[2].progress = 100\n    steps[2].endTime = new Date().toISOString()\n    steps[2].data = promptTests\n\n    // Step 4: Optimize Based on Tests\n    steps[3].status = 'running'\n    steps[3].startTime = new Date().toISOString()\n    \n    const optimizedPrompts = await optimizePrompts(supabaseClient, brand.id, promptTests)\n    \n    steps[3].status = 'completed'\n    steps[3].progress = 100\n    steps[3].endTime = new Date().toISOString()\n    steps[3].data = optimizedPrompts\n\n    // Update setup state\n    await supabaseClient\n      .from('brand_setup_state')\n      .update({\n        completed_steps: ['basic_info', 'competitors', 'topics', 'prompts'],\n        current_step: 'verification',\n        setup_data: {\n          ...setupData?.setup_data,\n          prompt_data: {\n            strategy: promptStrategy,\n            generated: generatedPrompts.length,\n            tested: promptTests.results.length,\n            optimized: optimizedPrompts.optimizedCount\n          }\n        }\n      })\n      .eq('brand_id', brand.id)\n\n    result.overallProgress = 90\n    result.currentStep = 'finalize'\n    result.nextSteps = ['Finalize brand setup', 'Generate initial reports']\n\n  } catch (error) {\n    const failedStepIndex = steps.findIndex(s => s.status === 'running')\n    if (failedStepIndex >= 0) {\n      steps[failedStepIndex].status = 'failed'\n      steps[failedStepIndex].error = error.message\n      steps[failedStepIndex].endTime = new Date().toISOString()\n    }\n  }\n\n  return result\n}\n\nasync function runFinalizationStep(supabaseClient: any, brand: any, options: any): Promise<OnboardingResult> {\n  const steps: OnboardingStep[] = [\n    { name: 'create_baseline', status: 'running', progress: 0, startTime: new Date().toISOString() },\n    { name: 'setup_monitoring', status: 'pending', progress: 0 },\n    { name: 'generate_first_report', status: 'pending', progress: 0 },\n    { name: 'complete_onboarding', status: 'pending', progress: 0 }\n  ]\n\n  const result: OnboardingResult = {\n    brandId: brand.id,\n    currentStep: 'finalize',\n    steps,\n    overallProgress: 90,\n    isComplete: false,\n    generatedData: { topics: 0, prompts: 0, competitors: 0, keywordsAnalyzed: 0 },\n    nextSteps: []\n  }\n\n  try {\n    // Step 1: Create Baseline Visibility Snapshot\n    steps[0].status = 'running'\n    const baseline = await createBaselineSnapshot(supabaseClient, brand.id)\n    steps[0].status = 'completed'\n    steps[0].progress = 100\n    steps[0].endTime = new Date().toISOString()\n    steps[0].data = baseline\n\n    // Step 2: Setup Monitoring\n    steps[1].status = 'running'\n    steps[1].startTime = new Date().toISOString()\n    const monitoring = await setupMonitoring(supabaseClient, brand.id)\n    steps[1].status = 'completed'\n    steps[1].progress = 100\n    steps[1].endTime = new Date().toISOString()\n    steps[1].data = monitoring\n\n    // Step 3: Generate First Report\n    steps[2].status = 'running'\n    steps[2].startTime = new Date().toISOString()\n    const firstReport = await generateFirstReport(supabaseClient, brand.id)\n    steps[2].status = 'completed'\n    steps[2].progress = 100\n    steps[2].endTime = new Date().toISOString()\n    steps[2].data = firstReport\n\n    // Step 4: Complete Onboarding\n    steps[3].status = 'running'\n    steps[3].startTime = new Date().toISOString()\n    \n    await supabaseClient\n      .from('brand_setup_state')\n      .update({\n        completed_steps: ['basic_info', 'competitors', 'topics', 'prompts', 'verification'],\n        current_step: null,\n        is_complete: true,\n        setup_data: {\n          completed_at: new Date().toISOString(),\n          baseline_snapshot: baseline,\n          monitoring_config: monitoring,\n          first_report: firstReport\n        }\n      })\n      .eq('brand_id', brand.id)\n    \n    steps[3].status = 'completed'\n    steps[3].progress = 100\n    steps[3].endTime = new Date().toISOString()\n\n    result.overallProgress = 100\n    result.isComplete = true\n    result.nextSteps = [\n      'Explore your brand dashboard',\n      'Review generated prompts',\n      'Set up competitor tracking',\n      'Schedule regular reports'\n    ]\n\n  } catch (error) {\n    const failedStepIndex = steps.findIndex(s => s.status === 'running')\n    if (failedStepIndex >= 0) {\n      steps[failedStepIndex].status = 'failed'\n      steps[failedStepIndex].error = error.message\n      steps[failedStepIndex].endTime = new Date().toISOString()\n    }\n  }\n\n  return result\n}\n\n// Helper functions\nasync function analyzeCompetitors(supabaseClient: any, brand: any, connectorData: any) {\n  // Extract competitors from connector data and analyze\n  const competitors = connectorData.results\n    .filter((r: any) => r.success && r.data?.competitors)\n    .flatMap((r: any) => r.data.competitors)\n  \n  return {\n    competitorsFound: competitors.length,\n    topCompetitors: competitors.slice(0, 5),\n    competitionLevel: 'medium' // Would be calculated based on data\n  }\n}\n\nasync function extractTopics(supabaseClient: any, brandId: string) {\n  const { data: topics } = await supabaseClient\n    .from('brand_topics')\n    .select('*')\n    .eq('brand_id', brandId)\n  \n  return {\n    topicsExtracted: topics?.length || 0,\n    topTopics: topics?.slice(0, 10) || [],\n    sources: [...new Set(topics?.map((t: any) => t.source) || [])]\n  }\n}\n\nasync function performMarketAnalysis(supabaseClient: any, brand: any, connectorData: any) {\n  // Use LLM to analyze market position\n  const analysisPrompt = `\n    Analyze the market position for the brand \"${brand.name}\" in the ${brand.industry || 'technology'} industry.\n    \n    Brand Domain: ${brand.domain}\n    Description: ${brand.description || 'Not provided'}\n    \n    Based on the following data:\n    ${JSON.stringify(connectorData.summary, null, 2)}\n    \n    Provide insights on:\n    1. Market positioning\n    2. Competitive landscape\n    3. Opportunities for improvement\n    4. Key challenges\n    \n    Keep the analysis concise and actionable.\n  `\n\n  try {\n    const llmResponse = await fetch('https://alaxjkbdistiwvckfysi.supabase.co/functions/v1/llm-orchestration/generate', {\n      method: 'POST',\n      headers: {\n        'Content-Type': 'application/json',\n        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`\n      },\n      body: JSON.stringify({\n        model: 'claude-opus',\n        prompt: analysisPrompt,\n        brandId: brand.id,\n        metadata: { scoreType: 'market_analysis' }\n      })\n    })\n\n    if (llmResponse.ok) {\n      const analysis = await llmResponse.json()\n      return {\n        analysis: analysis.response.content,\n        model: analysis.model,\n        cost: analysis.response.cost.totalCost\n      }\n    }\n  } catch (error) {\n    console.warn('Market analysis failed:', error)\n  }\n\n  return {\n    analysis: 'Market analysis could not be completed at this time.',\n    model: 'none',\n    cost: 0\n  }\n}\n\nasync function definePromptStrategy(brand: any, analysisData: any) {\n  return {\n    intents: ['awareness', 'comparison', 'purchase', 'support'],\n    targetModels: ['claude-opus', 'gpt-4', 'gemini-pro'],\n    promptTypes: ['direct_mention', 'category_search', 'competitor_comparison', 'problem_solving'],\n    focus: brand.industry || 'technology'\n  }\n}\n\nasync function generatePrompts(supabaseClient: any, brand: any, strategy: any, count: number) {\n  const prompts = []\n  \n  for (let i = 0; i < count; i++) {\n    const intent = strategy.intents[i % strategy.intents.length]\n    const promptType = strategy.promptTypes[i % strategy.promptTypes.length]\n    \n    // Generate prompt using LLM\n    const promptGenerationPrompt = `\n      Generate a realistic user prompt that would test brand visibility for \"${brand.name}\".\n      \n      Intent: ${intent}\n      Type: ${promptType}\n      Industry: ${brand.industry || 'technology'}\n      \n      The prompt should be natural and something a real user might ask.\n      Return only the prompt text, no explanations.\n    `\n\n    try {\n      const response = await fetch('https://alaxjkbdistiwvckfysi.supabase.co/functions/v1/llm-orchestration/generate', {\n        method: 'POST',\n        headers: {\n          'Content-Type': 'application/json',\n          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`\n        },\n        body: JSON.stringify({\n          model: 'gpt-4',\n          prompt: promptGenerationPrompt,\n          temperature: 0.8\n        })\n      })\n\n      if (response.ok) {\n        const result = await response.json()\n        const promptText = result.response.content.trim()\n        \n        // Store in database\n        const { data: promptRecord } = await supabaseClient\n          .from('brand_prompts')\n          .insert({\n            brand_id: brand.id,\n            prompt: promptText,\n            intent_type: intent,\n            generated_by: 'gpt-4',\n            is_active: true\n          })\n          .select()\n          .single()\n        \n        prompts.push(promptRecord)\n      }\n    } catch (error) {\n      console.warn(`Failed to generate prompt ${i + 1}:`, error)\n    }\n  }\n  \n  return prompts\n}\n\nasync function testPrompts(supabaseClient: any, brandId: string, prompts: any[]) {\n  const results = []\n  \n  for (const prompt of prompts) {\n    try {\n      // Test with a quick LLM call\n      const response = await fetch('https://alaxjkbdistiwvckfysi.supabase.co/functions/v1/llm-orchestration/generate', {\n        method: 'POST',\n        headers: {\n          'Content-Type': 'application/json',\n          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`\n        },\n        body: JSON.stringify({\n          model: 'claude-opus',\n          prompt: prompt.prompt,\n          brandId,\n          metadata: { \n            scoreType: 'visibility',\n            promptId: prompt.id,\n            testRun: true\n          }\n        })\n      })\n      \n      if (response.ok) {\n        const result = await response.json()\n        const brandMentioned = result.response.content.toLowerCase().includes(prompt.brand_name?.toLowerCase() || '')\n        \n        results.push({\n          promptId: prompt.id,\n          prompt: prompt.prompt,\n          brandMentioned,\n          responseLength: result.response.content.length,\n          cost: result.response.cost.totalCost\n        })\n      }\n    } catch (error) {\n      console.warn(`Failed to test prompt ${prompt.id}:`, error)\n    }\n  }\n  \n  return {\n    results,\n    summary: {\n      tested: results.length,\n      brandMentioned: results.filter(r => r.brandMentioned).length,\n      averageResponseLength: results.reduce((sum, r) => sum + r.responseLength, 0) / results.length,\n      totalCost: results.reduce((sum, r) => sum + r.cost, 0)\n    }\n  }\n}\n\nasync function optimizePrompts(supabaseClient: any, brandId: string, testResults: any) {\n  // Update performance scores based on test results\n  let optimizedCount = 0\n  \n  for (const result of testResults.results) {\n    const score = result.brandMentioned ? 0.8 : 0.2\n    \n    await supabaseClient\n      .from('brand_prompts')\n      .update({ performance_score: score })\n      .eq('id', result.promptId)\n    \n    optimizedCount++\n  }\n  \n  return {\n    optimizedCount,\n    averageScore: testResults.summary.brandMentioned / testResults.summary.tested\n  }\n}\n\nasync function createBaselineSnapshot(supabaseClient: any, brandId: string) {\n  const snapshot = {\n    visibility_pct: 15, // Starting baseline\n    positioning_pct: 10,\n    freshness_score: 50,\n    robustness_score: 25\n  }\n  \n  await supabaseClient\n    .from('visibility_snapshots')\n    .insert({\n      brand_id: brandId,\n      ...snapshot\n    })\n  \n  return snapshot\n}\n\nasync function setupMonitoring(supabaseClient: any, brandId: string) {\n  // Setup basic monitoring configuration\n  return {\n    enabled: true,\n    frequency: 'weekly',\n    alertThresholds: {\n      visibilityDrop: 10,\n      competitorSurge: 20\n    }\n  }\n}\n\nasync function generateFirstReport(supabaseClient: any, brandId: string) {\n  // Create initial report entry\n  const { data: report } = await supabaseClient\n    .from('monthly_reports')\n    .insert({\n      brand_id: brandId,\n      month: new Date().toISOString().slice(0, 7) + '-01',\n      model_name: 'initial_setup',\n      delta_scores: { initial: true },\n      top_queries: [],\n      recommendation_snapshot: 'Initial brand setup completed. Begin regular monitoring.'\n    })\n    .select()\n    .single()\n  \n  return {\n    reportId: report?.id,\n    type: 'initial_setup',\n    generated: true\n  }\n}