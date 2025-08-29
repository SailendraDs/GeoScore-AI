import { createClient } from '@supabase/supabase-js'

// Default values for build time - will be replaced at runtime
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYWNlaG9sZGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE2NDUxOTI4MDAsImV4cCI6MTk2MDU0NTYwMH0.placeholder'

// Runtime validation - only check in browser or when variables should be available
const isRuntimeValidationNeeded = typeof window !== 'undefined' || process.env.NODE_ENV === 'development'

if (isRuntimeValidationNeeded && (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
  console.warn('Missing Supabase environment variables - using placeholder values')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Types for our database
export interface Brand {
  id: string
  name: string
  domain: string
  description?: string
  owner_id: string
  created_at: string
  updated_at: string
}

export interface User {
  id: string
  email: string
  role: 'brand_user' | 'admin' | 'super_admin'
  created_at: string
}

export interface LLMReport {
  id: string
  brand_id: string
  model_name: string
  response_text: string
  score_value?: number
  cost_estimate?: number
  execution_time_ms?: number
  created_at: string
}

export interface Competitor {
  id: string
  brand_id: string
  name: string
  category?: string
  mention_count: number
  last_mentioned?: string
}

export interface AIVisibilityScore {
  id: string
  brand_id: string
  engine: string
  prompt_sov: number
  generative_appearance: number
  citation_authority: number
  answer_quality: number
  voice_presence: number
  ai_traffic: number
  ai_conversions: number
  total_score: number
  created_at: string
}

// Auth helpers
export const getCurrentUser = async () => {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export const signInWithEmail = async (email: string, password: string) => {
  return await supabase.auth.signInWithPassword({
    email,
    password,
  })
}

export const signUpWithEmail = async (email: string, password: string) => {
  return await supabase.auth.signUp({
    email,
    password,
  })
}

export const signOut = async () => {
  return await supabase.auth.signOut()
}

export const resetPassword = async (email: string) => {
  return await supabase.auth.resetPasswordForEmail(email)
}

// API helpers for Edge Functions
export const callEdgeFunction = async (functionName: string, body?: any) => {
  const { data: { session } } = await supabase.auth.getSession()
  
  if (!session) {
    throw new Error('Not authenticated')
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    throw new Error(`Edge function call failed: ${response.statusText}`)
  }

  return await response.json()
}

// Brand-specific API calls
export const analyzeBrand = async (brandName: string, brandDomain: string) => {
  return await callEdgeFunction('llm-orchestration/analyze-brand', {
    brandName,
    brandUrl: `https://${brandDomain}`,
  })
}

export const analyzePrompt = async (prompt: string, brandName?: string, model = 'gpt-4o') => {
  return await callEdgeFunction('llm-orchestration/analyze-prompt', {
    prompt,
    brandName,
    model,
    includeVariety: true,
  })
}

export const startBrandAnalysis = async (brandName: string, brandDomain: string, options = {}) => {
  return await callEdgeFunction('brand-analysis/start', {
    brandName,
    brandDomain,
    analysisTypes: ['competitor_discovery', 'prompt_generation', 'multi_llm_analysis'],
    models: ['gpt-4o', 'claude-opus', 'gemini-pro'],
    promptCount: 20,
    ...options,
  })
}

export const getAnalysisProgress = async (analysisId: string) => {
  const { data: { session } } = await supabase.auth.getSession()
  
  const response = await fetch(
    `${supabaseUrl}/functions/v1/brand-analysis/progress?analysisId=${analysisId}`,
    {
      headers: {
        'Authorization': `Bearer ${session?.access_token}`,
      },
    }
  )

  return await response.json()
}

export const calculateAIVisibilityScore = async (brandId: string, engine?: string) => {
  return await callEdgeFunction('ai-visibility-score/calculate', {
    brandId,
    engine,
  })
}

export const getScoreHistory = async (brandId: string, engine?: string) => {
  const { data: { session } } = await supabase.auth.getSession()
  
  const params = new URLSearchParams({ brandId })
  if (engine) params.set('engine', engine)

  const response = await fetch(
    `${supabaseUrl}/functions/v1/ai-visibility-score/history?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${session?.access_token}`,
      },
    }
  )

  return await response.json()
}