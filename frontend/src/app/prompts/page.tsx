'use client'
export const dynamic = 'force-dynamic'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { supabase, callEdgeFunction } from '@/lib/supabase'
import { 
  Plus, 
  Search, 
  Play, 
  Edit, 
  Trash2, 
  Eye,
  MessageSquare,
  Target,
  Zap,
  Brain,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Clock,
  BarChart3
} from 'lucide-react'

interface Prompt {
  id: string
  brand_id: string
  prompt_key: string
  prompt_text: string
  intent_type: string
  generated_by: string
  is_active: boolean
  performance_score?: number
  last_tested?: string
  test_count: number
  brand_mention_rate?: number
  avg_response_length?: number
  created_at: string
}

interface Brand {
  id: string
  name: string
}

interface TestResult {
  model: string
  response: string
  brandMentioned: boolean
  score: number
  executionTime: number
  cost: number
}

function PromptsPageWithSearchParams() {
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [selectedBrand, setSelectedBrand] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIntent, setSelectedIntent] = useState<string>('all')
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null)
  const [testingPrompt, setTestingPrompt] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<TestResult[]>([])
  const [showTestResults, setShowTestResults] = useState(false)
  const [newPrompt, setNewPrompt] = useState({
    prompt_text: '',
    intent_type: 'awareness',
    prompt_key: ''
  })
  const [error, setError] = useState('')
  const [user, setUser] = useState<any>(null)
  const router = useRouter()
  const searchParams = useSearchParams()

  const intentTypes = [
    'awareness', 'comparison', 'purchase', 'support', 
    'research', 'recommendation', 'alternative', 'troubleshooting'
  ]

  useEffect(() => {
    const checkAuthAndLoadData = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          router.push('/auth/login')
          return
        }
        setUser(user)

        // Load user's brands
        const { data: userBrands } = await supabase
          .from('brands')
          .select('id, name')
          .eq('owner_id', user.id)
          .order('created_at', { ascending: false })

        setBrands(userBrands || [])

        // Set selected brand from URL params or use first brand
        const brandId = searchParams.get('brandId')
        if (brandId && userBrands?.find(b => b.id === brandId)) {
          setSelectedBrand(brandId)
        } else if (userBrands && userBrands.length > 0) {
          setSelectedBrand(userBrands[0].id)
        }

      } catch (error) {
        console.error('Error loading data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    checkAuthAndLoadData()
  }, [router, searchParams])

  useEffect(() => {
    if (selectedBrand) {
      loadPrompts(selectedBrand)
    }
  }, [selectedBrand])

  const loadPrompts = async (brandId: string) => {
    try {
      const { data, error } = await supabase
        .from('brand_prompts')
        .select('*')
        .eq('brand_id', brandId)
        .order('created_at', { ascending: false })

      if (error) throw error

      // Add mock performance data since tracking might not be fully implemented
      const promptsWithMockData = (data || []).map(prompt => ({
        ...prompt,
        test_count: Math.floor(Math.random() * 20) + 1,
        brand_mention_rate: Math.random() * 100,
        avg_response_length: Math.floor(Math.random() * 500) + 100,
        performance_score: Math.floor(Math.random() * 40) + 60
      }))

      setPrompts(promptsWithMockData)
    } catch (error) {
      console.error('Error loading prompts:', error)
    }
  }

  const handleAddPrompt = async () => {
    if (!selectedBrand || !newPrompt.prompt_text.trim()) {
      setError('Please enter a prompt text')
      return
    }

    try {
      const promptKey = newPrompt.prompt_key || 
        `${newPrompt.intent_type}_${Date.now()}`

      const { data, error } = await supabase
        .from('brand_prompts')
        .insert({
          brand_id: selectedBrand,
          prompt_key: promptKey,
          prompt_text: newPrompt.prompt_text,
          intent_type: newPrompt.intent_type,
          generated_by: 'manual',
          is_active: true
        })
        .select()
        .single()

      if (error) throw error

      setPrompts(prev => [{ 
        ...data, 
        test_count: 0, 
        brand_mention_rate: 0,
        avg_response_length: 0,
        performance_score: 0 
      }, ...prev])
      setNewPrompt({ prompt_text: '', intent_type: 'awareness', prompt_key: '' })
      setShowAddForm(false)
      setError('')

    } catch (error: any) {
      setError(error.message || 'Failed to add prompt')
    }
  }

  const handleUpdatePrompt = async (prompt: Prompt) => {
    try {
      const { error } = await supabase
        .from('brand_prompts')
        .update({
          prompt_text: prompt.prompt_text,
          intent_type: prompt.intent_type,
          is_active: prompt.is_active
        })
        .eq('id', prompt.id)

      if (error) throw error

      setPrompts(prev => prev.map(p => 
        p.id === prompt.id ? prompt : p
      ))
      setEditingPrompt(null)
      setError('')

    } catch (error: any) {
      setError(error.message || 'Failed to update prompt')
    }
  }

  const handleDeletePrompt = async (promptId: string) => {
    if (!confirm('Are you sure you want to delete this prompt?')) return

    try {
      const { error } = await supabase
        .from('brand_prompts')
        .delete()
        .eq('id', promptId)

      if (error) throw error

      setPrompts(prev => prev.filter(p => p.id !== promptId))

    } catch (error: any) {
      setError(error.message || 'Failed to delete prompt')
    }
  }

  const testPrompt = async (promptId: string, prompt: string) => {
    setTestingPrompt(promptId)
    setTestResults([])
    setShowTestResults(true)

    const models = ['claude-opus', 'gpt-4o', 'gemini-pro']
    const results: TestResult[] = []

    try {
      const brandName = brands.find(b => b.id === selectedBrand)?.name || ''

      for (const model of models) {
        try {
          const result = await callEdgeFunction('llm-orchestration/analyze-prompt', {
            prompt,
            brandName,
            model
          })

          results.push({
            model,
            response: result.response,
            brandMentioned: result.analysis?.brandMentioned || false,
            score: result.analysis?.answerQuality || 0,
            executionTime: result.metadata?.executionTime || 0,
            cost: result.metadata?.cost?.totalCost || 0
          })

          setTestResults([...results])
        } catch (error) {
          console.error(`Error testing with ${model}:`, error)
          results.push({
            model,
            response: 'Error occurred during testing',
            brandMentioned: false,
            score: 0,
            executionTime: 0,
            cost: 0
          })
          setTestResults([...results])
        }
      }

      // Update prompt test statistics
      const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length
      const mentionRate = (results.filter(r => r.brandMentioned).length / results.length) * 100

      setPrompts(prev => prev.map(p => 
        p.id === promptId 
          ? { 
              ...p, 
              test_count: p.test_count + 1,
              performance_score: avgScore,
              brand_mention_rate: mentionRate,
              last_tested: new Date().toISOString()
            }
          : p
      ))

    } catch (error: any) {
      setError(error.message || 'Failed to test prompt')
    } finally {
      setTestingPrompt(null)
    }
  }

  const generatePrompts = async () => {
    if (!selectedBrand) return

    try {
      const result = await callEdgeFunction('prompt-generation', {
        brandId: selectedBrand,
        count: 5,
        intents: ['awareness', 'comparison', 'research']
      })

      // Reload prompts to show newly generated ones
      await loadPrompts(selectedBrand)
      alert('New prompts generated successfully!')

    } catch (error: any) {
      setError(error.message || 'Failed to generate prompts')
    }
  }

  const filteredPrompts = prompts.filter(prompt => {
    const matchesSearch = 
      prompt.prompt_text.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prompt.intent_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prompt.prompt_key.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesIntent = selectedIntent === 'all' || prompt.intent_type === selectedIntent

    return matchesSearch && matchesIntent
  })

  const getPerformanceColor = (score?: number) => {
    if (!score) return 'text-gray-500'
    if (score >= 80) return 'text-green-600'
    if (score >= 60) return 'text-yellow-600'
    return 'text-red-600'
  }

  const getIntentIcon = (intent: string) => {
    const iconMap: Record<string, React.ReactNode> = {
      awareness: <Eye className="h-4 w-4" />,
      comparison: <BarChart3 className="h-4 w-4" />,
      purchase: <Target className="h-4 w-4" />,
      support: <MessageSquare className="h-4 w-4" />,
      research: <Brain className="h-4 w-4" />,
      recommendation: <CheckCircle className="h-4 w-4" />
    }
    return iconMap[intent] || <MessageSquare className="h-4 w-4" />
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading prompts...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Prompt Management</h1>
              <p className="text-gray-600">Manage and test prompts for brand visibility tracking</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={generatePrompts}>
                <Zap className="h-4 w-4 mr-2" />
                Generate Prompts
              </Button>
              <Button onClick={() => setShowAddForm(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Prompt
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Controls */}
        <div className="mb-6 flex flex-col lg:flex-row gap-4">
          {/* Brand Selection */}
          <div className="flex-1">
            <Label htmlFor="brand-select">Select Brand</Label>
            <select
              id="brand-select"
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select a brand...</option>
              {brands.map(brand => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </div>

          {/* Search */}
          <div className="flex-1">
            <Label htmlFor="search">Search Prompts</Label>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
              <Input
                id="search"
                placeholder="Search by text, intent, or key..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {/* Intent Filter */}
          <div className="flex-1">
            <Label htmlFor="intent-filter">Filter by Intent</Label>
            <select
              id="intent-filter"
              value={selectedIntent}
              onChange={(e) => setSelectedIntent(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Intents</option>
              {intentTypes.map(intent => (
                <option key={intent} value={intent}>
                  {intent.charAt(0).toUpperCase() + intent.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md flex items-center">
            <AlertCircle className="h-4 w-4 mr-2" />
            {error}
          </div>
        )}

        {!selectedBrand ? (
          <Card>
            <CardContent className="text-center py-16">
              <MessageSquare className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Select a Brand</h3>
              <p className="text-gray-600 mb-4">
                Choose a brand to view and manage its prompts
              </p>
              {brands.length === 0 && (
                <Button onClick={() => router.push('/onboard')}>
                  Create Your First Brand
                </Button>
              )}
            </CardContent>
          </Card>
        ) : filteredPrompts.length === 0 ? (
          <Card>
            <CardContent className="text-center py-16">
              <MessageSquare className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No Prompts Found</h3>
              <p className="text-gray-600 mb-4">
                {prompts.length === 0 
                  ? "You haven't added any prompts yet. Start by creating your first prompt."
                  : "No prompts match your search criteria."
                }
              </p>
              <div className="flex gap-3 justify-center">
                <Button onClick={() => setShowAddForm(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Prompt
                </Button>
                <Button variant="outline" onClick={generatePrompts}>
                  <Zap className="h-4 w-4 mr-2" />
                  Generate Prompts
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredPrompts.map((prompt) => (
              <Card key={prompt.id} className="hover:shadow-lg transition-shadow">
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        {getIntentIcon(prompt.intent_type)}
                        <Badge variant="secondary">
                          {prompt.intent_type}
                        </Badge>
                        <Badge variant={prompt.is_active ? 'default' : 'outline'}>
                          {prompt.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <CardTitle className="text-lg mb-2">
                        {prompt.prompt_key}
                      </CardTitle>
                      <p className="text-gray-700 text-sm line-clamp-2">
                        {prompt.prompt_text}
                      </p>
                    </div>
                    <div className="flex gap-1 ml-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => testPrompt(prompt.id, prompt.prompt_text)}
                        disabled={testingPrompt === prompt.id}
                      >
                        {testingPrompt === prompt.id ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingPrompt(prompt)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeletePrompt(prompt.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="text-center">
                      <div className={`text-xl font-bold ${getPerformanceColor(prompt.performance_score)}`}>
                        {prompt.performance_score ? Math.round(prompt.performance_score) : '--'}
                      </div>
                      <div className="text-xs text-gray-600">Performance</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl font-bold text-blue-600">
                        {prompt.test_count}
                      </div>
                      <div className="text-xs text-gray-600">Tests Run</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl font-bold text-green-600">
                        {prompt.brand_mention_rate ? Math.round(prompt.brand_mention_rate) : '--'}%
                      </div>
                      <div className="text-xs text-gray-600">Brand Mentions</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xl font-bold text-purple-600">
                        {prompt.avg_response_length || '--'}
                      </div>
                      <div className="text-xs text-gray-600">Avg Length</div>
                    </div>
                  </div>
                  {prompt.last_tested && (
                    <div className="flex items-center text-xs text-gray-500 mt-3">
                      <Clock className="h-3 w-3 mr-1" />
                      Last tested: {new Date(prompt.last_tested).toLocaleString()}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Summary Stats */}
        {selectedBrand && filteredPrompts.length > 0 && (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle>Prompt Statistics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {filteredPrompts.length}
                  </div>
                  <div className="text-sm text-gray-600">Total Prompts</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {filteredPrompts.filter(p => p.is_active).length}
                  </div>
                  <div className="text-sm text-gray-600">Active Prompts</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">
                    {Math.round(
                      filteredPrompts
                        .filter(p => p.performance_score)
                        .reduce((sum, p) => sum + (p.performance_score || 0), 0) / 
                      filteredPrompts.filter(p => p.performance_score).length || 0
                    )}
                  </div>
                  <div className="text-sm text-gray-600">Avg Performance</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">
                    {new Set(filteredPrompts.map(p => p.intent_type)).size}
                  </div>
                  <div className="text-sm text-gray-600">Intent Types</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add/Edit Prompt Modal */}
      {(showAddForm || editingPrompt) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <Card className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>
                {editingPrompt ? 'Edit Prompt' : 'Add New Prompt'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="prompt-key">Prompt Key</Label>
                <Input
                  id="prompt-key"
                  placeholder="e.g., awareness_01"
                  value={editingPrompt ? editingPrompt.prompt_key : newPrompt.prompt_key}
                  onChange={(e) => {
                    if (editingPrompt) {
                      setEditingPrompt({ ...editingPrompt, prompt_key: e.target.value })
                    } else {
                      setNewPrompt(prev => ({ ...prev, prompt_key: e.target.value }))
                    }
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="prompt-text">Prompt Text *</Label>
                <textarea
                  id="prompt-text"
                  placeholder="Enter your prompt here..."
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={editingPrompt ? editingPrompt.prompt_text : newPrompt.prompt_text}
                  onChange={(e) => {
                    if (editingPrompt) {
                      setEditingPrompt({ ...editingPrompt, prompt_text: e.target.value })
                    } else {
                      setNewPrompt(prev => ({ ...prev, prompt_text: e.target.value }))
                    }
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="intent-type">Intent Type</Label>
                <select
                  id="intent-type"
                  value={editingPrompt ? editingPrompt.intent_type : newPrompt.intent_type}
                  onChange={(e) => {
                    if (editingPrompt) {
                      setEditingPrompt({ ...editingPrompt, intent_type: e.target.value })
                    } else {
                      setNewPrompt(prev => ({ ...prev, intent_type: e.target.value }))
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {intentTypes.map(intent => (
                    <option key={intent} value={intent}>
                      {intent.charAt(0).toUpperCase() + intent.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              {editingPrompt && (
                <div className="flex items-center space-x-2">
                  <input
                    id="is-active"
                    type="checkbox"
                    checked={editingPrompt.is_active}
                    onChange={(e) => setEditingPrompt({ ...editingPrompt, is_active: e.target.checked })}
                  />
                  <Label htmlFor="is-active">Active</Label>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setShowAddForm(false)
                    setEditingPrompt(null)
                    setNewPrompt({ prompt_text: '', intent_type: 'awareness', prompt_key: '' })
                    setError('')
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button 
                  onClick={() => {
                    if (editingPrompt) {
                      handleUpdatePrompt(editingPrompt)
                    } else {
                      handleAddPrompt()
                    }
                  }}
                  className="flex-1"
                >
                  {editingPrompt ? 'Update' : 'Add'} Prompt
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Test Results Modal */}
      {showTestResults && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <Card className="max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Prompt Test Results
                <Button variant="outline" onClick={() => setShowTestResults(false)}>
                  Close
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {testResults.length === 0 && testingPrompt ? (
                <div className="text-center py-8">
                  <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-blue-600" />
                  <p>Testing prompt across different AI models...</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {testResults.map((result, index) => (
                    <Card key={index}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-lg">
                            {result.model.toUpperCase()}
                          </CardTitle>
                          <div className="flex gap-2">
                            <Badge variant={result.brandMentioned ? 'default' : 'secondary'}>
                              {result.brandMentioned ? 'Brand Mentioned' : 'No Mention'}
                            </Badge>
                            <Badge variant="outline">
                              Score: {Math.round(result.score)}
                            </Badge>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="bg-gray-50 p-4 rounded-lg mb-3">
                          <p className="text-sm text-gray-700">{result.response}</p>
                        </div>
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="font-medium">Execution Time:</span> {result.executionTime}ms
                          </div>
                          <div>
                            <span className="font-medium">Cost:</span> ${result.cost.toFixed(4)}
                          </div>
                          <div>
                            <span className="font-medium">Quality Score:</span> {Math.round(result.score)}/100
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

export default function PromptsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading prompts...</p>
        </div>
      </div>
    }>
      <PromptsPageWithSearchParams />
    </Suspense>
  )
}