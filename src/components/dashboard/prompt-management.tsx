'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Wand2, Play, Pause, RefreshCw, Plus, Filter, Eye } from "lucide-react"
import { supabase } from '@/lib/supabase'

interface GeneratedPrompt {
  id: string
  prompt_text: string
  category: 'discovery' | 'comparison' | 'recommendation' | 'technical' | 'review'
  expected_mention: boolean
  priority_score: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  actual_mention?: boolean
  visibility_impact?: number
  created_at: string
  metadata?: {
    template_base?: string
    difficulty_level?: string
    industry_specific?: boolean
  }
}

interface PromptStats {
  total_prompts: number
  pending: number
  completed: number
  mention_rate: number
  avg_visibility_impact: number
}

interface PromptManagementProps {
  brandId: string
  className?: string
}

export function PromptManagement({ brandId, className }: PromptManagementProps) {
  const [prompts, setPrompts] = useState<GeneratedPrompt[]>([])
  const [stats, setStats] = useState<PromptStats>({
    total_prompts: 0,
    pending: 0,
    completed: 0,
    mention_rate: 0,
    avg_visibility_impact: 0
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isRunningBatch, setIsRunningBatch] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 })

  useEffect(() => {
    loadPrompts()
  }, [brandId])

  const loadPrompts = async () => {
    try {
      const { data: promptData } = await supabase
        .from('brand_prompts')
        .select(`
          id,
          prompt_text,
          category,
          expected_mention,
          priority_score,
          status,
          actual_mention,
          visibility_impact,
          created_at,
          metadata
        `)
        .eq('brand_id', brandId)
        .order('created_at', { ascending: false })
        .limit(100)

      const processedPrompts: GeneratedPrompt[] = promptData?.map(prompt => ({
        id: prompt.id,
        prompt_text: prompt.prompt_text,
        category: prompt.category || 'discovery',
        expected_mention: prompt.expected_mention || false,
        priority_score: prompt.priority_score || 75,
        status: prompt.status || 'pending',
        actual_mention: prompt.actual_mention,
        visibility_impact: prompt.visibility_impact,
        created_at: prompt.created_at,
        metadata: prompt.metadata || {}
      })) || []

      setPrompts(processedPrompts)

      // Calculate stats
      const totalPrompts = processedPrompts.length
      const completedPrompts = processedPrompts.filter(p => p.status === 'completed')
      const mentionedPrompts = completedPrompts.filter(p => p.actual_mention)
      const avgImpact = completedPrompts.length > 0 
        ? completedPrompts.reduce((sum, p) => sum + (p.visibility_impact || 0), 0) / completedPrompts.length
        : 0

      setStats({
        total_prompts: totalPrompts,
        pending: processedPrompts.filter(p => p.status === 'pending').length,
        completed: completedPrompts.length,
        mention_rate: completedPrompts.length > 0 ? (mentionedPrompts.length / completedPrompts.length) * 100 : 0,
        avg_visibility_impact: avgImpact
      })

    } catch (error) {
      console.error('Error loading prompts:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const generateNewPrompts = async () => {
    setIsGenerating(true)
    try {
      const { data } = await supabase.functions.invoke('prompt-generation', {
        body: {
          brand_id: brandId,
          categories: ['discovery', 'comparison', 'recommendation', 'technical', 'review'],
          count_per_category: 10,
          competitor_aware: true
        }
      })

      if (data?.success) {
        await loadPrompts()
      }
    } catch (error) {
      console.error('Error generating prompts:', error)
    } finally {
      setIsGenerating(false)
    }
  }

  const runPromptBatch = async () => {
    const pendingPrompts = prompts.filter(p => p.status === 'pending')
    if (pendingPrompts.length === 0) return

    setIsRunningBatch(true)
    setBatchProgress({ current: 0, total: pendingPrompts.length })

    try {
      for (let i = 0; i < pendingPrompts.length; i++) {
        const prompt = pendingPrompts[i]
        setBatchProgress({ current: i + 1, total: pendingPrompts.length })

        // Update prompt status to running
        await supabase
          .from('brand_prompts')
          .update({ status: 'running' })
          .eq('id', prompt.id)

        // Run the prompt through LLM orchestration
        try {
          const { data: analysisResult } = await supabase.functions.invoke('llm-orchestration', {
            body: {
              action: 'analyzePrompt',
              brand_id: brandId,
              prompt: prompt.prompt_text,
              expected_mention: prompt.expected_mention
            }
          })

          if (analysisResult?.success) {
            // Update prompt with results
            await supabase
              .from('brand_prompts')
              .update({
                status: 'completed',
                actual_mention: analysisResult.data.brand_mentioned,
                visibility_impact: analysisResult.data.visibility_score || 0
              })
              .eq('id', prompt.id)
          } else {
            // Mark as failed
            await supabase
              .from('brand_prompts')
              .update({ status: 'failed' })
              .eq('id', prompt.id)
          }
        } catch (promptError) {
          console.error(`Error running prompt ${prompt.id}:`, promptError)
          await supabase
            .from('brand_prompts')
            .update({ status: 'failed' })
            .eq('id', prompt.id)
        }

        // Small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      await loadPrompts()
    } catch (error) {
      console.error('Error running prompt batch:', error)
    } finally {
      setIsRunningBatch(false)
      setBatchProgress({ current: 0, total: 0 })
    }
  }

  const getCategoryColor = (category: string) => {
    const colors = {
      discovery: 'bg-blue-100 text-blue-800',
      comparison: 'bg-purple-100 text-purple-800',
      recommendation: 'bg-green-100 text-green-800',
      technical: 'bg-orange-100 text-orange-800',
      review: 'bg-pink-100 text-pink-800'
    }
    return colors[category as keyof typeof colors] || 'bg-gray-100 text-gray-800'
  }

  const getStatusColor = (status: string) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800',
      running: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800'
    }
    return colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800'
  }

  const filteredPrompts = selectedCategory === 'all' 
    ? prompts 
    : prompts.filter(p => p.category === selectedCategory)

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="h-4 bg-gray-200 rounded w-5/6"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Wand2 className="h-5 w-5 text-purple-500" />
              <div>
                <div className="text-2xl font-bold">{stats.total_prompts}</div>
                <div className="text-xs text-gray-500">Total Prompts</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Play className="h-5 w-5 text-blue-500" />
              <div>
                <div className="text-2xl font-bold">{stats.pending}</div>
                <div className="text-xs text-gray-500">Pending</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Eye className="h-5 w-5 text-green-500" />
              <div>
                <div className="text-2xl font-bold">{Math.round(stats.mention_rate)}%</div>
                <div className="text-xs text-gray-500">Mention Rate</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <RefreshCw className="h-5 w-5 text-orange-500" />
              <div>
                <div className="text-2xl font-bold">{Math.round(stats.avg_visibility_impact)}</div>
                <div className="text-xs text-gray-500">Avg Impact</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Batch Progress */}
      {isRunningBatch && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Running Prompt Batch</span>
              <span className="text-sm text-gray-500">
                {batchProgress.current} / {batchProgress.total}
              </span>
            </div>
            <Progress value={(batchProgress.current / batchProgress.total) * 100} className="h-2" />
          </CardContent>
        </Card>
      )}

      {/* Main Prompt Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Wand2 className="h-5 w-5" />
                Prompt Generation & Testing
              </CardTitle>
              <CardDescription>
                Generate and test AI prompts to optimize brand visibility
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="text-sm border rounded px-2 py-1"
              >
                <option value="all">All Categories</option>
                <option value="discovery">Discovery</option>
                <option value="comparison">Comparison</option>
                <option value="recommendation">Recommendation</option>
                <option value="technical">Technical</option>
                <option value="review">Review</option>
              </select>
              <Button
                onClick={generateNewPrompts}
                disabled={isGenerating}
                size="sm"
                variant="outline"
              >
                <Plus className={`h-4 w-4 mr-2 ${isGenerating ? 'animate-spin' : ''}`} />
                {isGenerating ? 'Generating...' : 'Generate'}
              </Button>
              <Button
                onClick={runPromptBatch}
                disabled={isRunningBatch || stats.pending === 0}
                size="sm"
              >
                <Play className={`h-4 w-4 mr-2 ${isRunningBatch ? 'animate-spin' : ''}`} />
                {isRunningBatch ? 'Running...' : `Run ${stats.pending} Prompts`}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {filteredPrompts.slice(0, 50).map((prompt) => (
              <div key={prompt.id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900 mb-2">
                      {prompt.prompt_text}
                    </p>
                    <div className="flex items-center space-x-2">
                      <Badge className={getCategoryColor(prompt.category)}>
                        {prompt.category}
                      </Badge>
                      <Badge className={getStatusColor(prompt.status)}>
                        {prompt.status}
                      </Badge>
                      {prompt.expected_mention && (
                        <Badge variant="outline">expects mention</Badge>
                      )}
                      {prompt.metadata?.difficulty_level && (
                        <Badge variant="secondary">
                          {prompt.metadata.difficulty_level}
                        </Badge>
                      )}
                    </div>
                  </div>
                  
                  <div className="text-right ml-4">
                    <div className="text-sm font-semibold text-gray-900">
                      Priority: {prompt.priority_score}
                    </div>
                    {prompt.status === 'completed' && (
                      <div className="mt-1">
                        <div className={`text-xs font-medium ${
                          prompt.actual_mention ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {prompt.actual_mention ? '✓ Mentioned' : '✗ Not Mentioned'}
                        </div>
                        {prompt.visibility_impact && (
                          <div className="text-xs text-gray-500">
                            Impact: {Math.round(prompt.visibility_impact)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                
                {prompt.status === 'completed' && prompt.visibility_impact && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                      <span>Visibility Impact</span>
                      <span>{Math.round(prompt.visibility_impact)}</span>
                    </div>
                    <Progress value={prompt.visibility_impact} className="h-1" />
                  </div>
                )}
              </div>
            ))}

            {filteredPrompts.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <Wand2 className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p>No prompts found</p>
                <p className="text-sm">Generate some prompts to get started with AI visibility testing</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}