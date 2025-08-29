'use client'
export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { supabase, callEdgeFunction } from '@/lib/supabase'
import { AlertCircle, Plus, X, MapPin, Globe, Users, ArrowRight, Loader2 } from 'lucide-react'

interface BrandFormData {
  name: string
  domain: string
  location: string
  description: string
  industry: string
  competitors: string[]
}

export default function BrandOnboardingPage() {
  const [currentStep, setCurrentStep] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [user, setUser] = useState<any>(null)
  const router = useRouter()

  // Form data
  const [formData, setFormData] = useState<BrandFormData>({
    name: '',
    domain: '',
    location: '',
    description: '',
    industry: '',
    competitors: []
  })

  // Step 2 data
  const [generatedTopics, setGeneratedTopics] = useState<string[]>([])
  const [generatedPrompts, setGeneratedPrompts] = useState<any[]>([])
  const [selectedPrompts, setSelectedPrompts] = useState<string[]>([])

  // Step 3 data
  const [brandId, setBrandId] = useState<string>('')
  const [onboardingProgress, setOnboardingProgress] = useState<any>(null)

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/auth/login')
        return
      }
      setUser(user)
    }
    checkAuth()
  }, [router])

  const handleInputChange = (field: keyof BrandFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    setError('')
  }

  const addCompetitor = (competitor: string) => {
    if (competitor.trim() && !formData.competitors.includes(competitor.trim())) {
      setFormData(prev => ({
        ...prev,
        competitors: [...prev.competitors, competitor.trim()]
      }))
    }
  }

  const removeCompetitor = (competitor: string) => {
    setFormData(prev => ({
      ...prev,
      competitors: prev.competitors.filter(c => c !== competitor)
    }))
  }

  const validateStep1 = () => {
    if (!formData.name.trim()) {
      setError('Brand name is required')
      return false
    }
    if (!formData.domain.trim()) {
      setError('Brand domain is required')
      return false
    }
    
    // Basic domain validation
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.([a-zA-Z]{2,}(\.[a-zA-Z]{2,})?)$/
    if (!domainRegex.test(formData.domain)) {
      setError('Please enter a valid domain (e.g., example.com)')
      return false
    }

    return true
  }

  const handleStep1Next = async () => {
    if (!validateStep1()) return

    setIsLoading(true)
    try {
      // Create brand
      const { data, error } = await supabase
        .from('brands')
        .insert({
          name: formData.name,
          domain: formData.domain,
          description: formData.description,
          location: formData.location,
          competitors: formData.competitors,
          owner_id: user.id,
          metadata: {
            industry: formData.industry,
            onboarding_step: 1
          }
        })
        .select()
        .single()

      if (error) throw error

      setBrandId(data.id)

      // Start analysis step
      const analysisResult = await callEdgeFunction('brand-onboarding', {
        brandId: data.id,
        step: 'analyze',
        options: {
          connectors: ['serpapi'],
          llmModels: ['claude-opus', 'gpt-4o'],
          competitorAnalysis: true
        }
      })

      setGeneratedTopics(analysisResult.generatedData?.topics || [])
      setCurrentStep(2)
    } catch (error: any) {
      setError(error.message || 'Failed to create brand')
    } finally {
      setIsLoading(false)
    }
  }

  const handleStep2Next = async () => {
    setIsLoading(true)
    try {
      // Generate prompts
      const promptResult = await callEdgeFunction('brand-onboarding', {
        brandId: brandId,
        step: 'generate_prompts',
        options: {
          promptCount: 10,
          llmModels: ['claude-opus']
        }
      })

      setGeneratedPrompts(promptResult.generatedData?.prompts || [])
      setSelectedPrompts(promptResult.generatedData?.prompts?.slice(0, 5).map((p: any) => p.id) || [])
      setCurrentStep(3)
    } catch (error: any) {
      setError(error.message || 'Failed to generate prompts')
    } finally {
      setIsLoading(false)
    }
  }

  const handleFinalize = async () => {
    setIsLoading(true)
    try {
      const finalizeResult = await callEdgeFunction('brand-onboarding', {
        brandId: brandId,
        step: 'finalize',
        options: {
          selectedPrompts
        }
      })

      setOnboardingProgress(finalizeResult)
      
      // Redirect to dashboard after completion
      setTimeout(() => {
        router.push('/dashboard')
      }, 3000)
    } catch (error: any) {
      setError(error.message || 'Failed to finalize onboarding')
    } finally {
      setIsLoading(false)
    }
  }

  const renderStep1 = () => (
    <Card className="max-w-2xl w-full">
      <CardHeader>
        <CardTitle className="flex items-center">
          <Globe className="h-6 w-6 mr-2 text-blue-600" />
          Brand Overview
        </CardTitle>
        <CardDescription>
          Tell us about your brand to get started with AI visibility tracking
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="brandName">Brand Name *</Label>
            <Input
              id="brandName"
              placeholder="Your Brand Name"
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="domain">Domain *</Label>
            <Input
              id="domain"
              placeholder="example.com"
              value={formData.domain}
              onChange={(e) => handleInputChange('domain', e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              placeholder="San Francisco, CA"
              value={formData.location}
              onChange={(e) => handleInputChange('location', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="industry">Industry</Label>
            <Input
              id="industry"
              placeholder="Technology, Healthcare, etc."
              value={formData.industry}
              onChange={(e) => handleInputChange('industry', e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            placeholder="Brief description of your brand or product"
            value={formData.description}
            onChange={(e) => handleInputChange('description', e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Competitors</Label>
          <CompetitorInput 
            competitors={formData.competitors}
            onAdd={addCompetitor}
            onRemove={removeCompetitor}
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm flex items-center">
            <AlertCircle className="h-4 w-4 mr-2" />
            {error}
          </div>
        )}

        <div className="flex justify-end pt-4">
          <Button onClick={handleStep1Next} disabled={isLoading}>
            {isLoading ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analyzing...</>
            ) : (
              <>Next <ArrowRight className="h-4 w-4 ml-2" /></>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )

  const renderStep2 = () => (
    <Card className="max-w-2xl w-full">
      <CardHeader>
        <CardTitle>Topics & Analysis Preview</CardTitle>
        <CardDescription>
          Review the topics we discovered about your industry and brand
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h3 className="font-medium text-gray-900 mb-3">Discovered Topics</h3>
          <div className="flex flex-wrap gap-2">
            {generatedTopics.map((topic, index) => (
              <Badge key={index} variant="secondary">
                {topic}
              </Badge>
            ))}
          </div>
        </div>

        <div className="text-center">
          <p className="text-gray-600 mb-4">
            We're analyzing your brand and generating AI prompts to test visibility across different models.
          </p>
          <Button onClick={handleStep2Next} disabled={isLoading}>
            {isLoading ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating Prompts...</>
            ) : (
              'Generate Prompts'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )

  const renderStep3 = () => (
    <Card className="max-w-2xl w-full">
      <CardHeader>
        <CardTitle>Finalize & Start Tracking</CardTitle>
        <CardDescription>
          Review your generated prompts and start your AI visibility tracking
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h3 className="font-medium text-gray-900 mb-3">Generated Prompts</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {generatedPrompts.map((prompt: any, index) => (
              <div key={prompt.id} className="p-3 border rounded-md">
                <p className="text-sm text-gray-700">{prompt.prompt}</p>
                <Badge variant="outline" className="mt-1">
                  {prompt.intent_type}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        {onboardingProgress ? (
          <div className="text-center space-y-4">
            <div className="text-green-600">
              <div className="flex justify-center mb-4">
                <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center">
                  ✓
                </div>
              </div>
              <h3 className="text-xl font-semibold">Setup Complete!</h3>
              <p className="text-gray-600">Your brand is now being tracked across AI engines.</p>
              <p className="text-sm text-gray-500">Redirecting to dashboard...</p>
            </div>
          </div>
        ) : (
          <div className="flex justify-between pt-4">
            <Button variant="outline" onClick={() => setCurrentStep(2)}>
              Back
            </Button>
            <Button onClick={handleFinalize} disabled={isLoading}>
              {isLoading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Finalizing...</>
              ) : (
                'Complete Setup'
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Progress indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-center space-x-4 mb-6">
            {[1, 2, 3].map((step) => (
              <div key={step} className="flex items-center">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${
                    currentStep >= step
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {step}
                </div>
                {step < 3 && (
                  <div
                    className={`w-16 h-1 mx-2 ${
                      currentStep > step ? 'bg-blue-600' : 'bg-gray-200'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Brand Onboarding
            </h1>
            <p className="text-gray-600">
              Step {currentStep} of 3: {
                currentStep === 1 ? 'Brand Information' :
                currentStep === 2 ? 'Analysis Preview' :
                'Setup Completion'
              }
            </p>
          </div>
        </div>

        {/* Step content */}
        <div className="flex justify-center">
          {currentStep === 1 && renderStep1()}
          {currentStep === 2 && renderStep2()}
          {currentStep === 3 && renderStep3()}
        </div>
      </div>
    </div>
  )
}

function CompetitorInput({ competitors, onAdd, onRemove }: {
  competitors: string[]
  onAdd: (competitor: string) => void
  onRemove: (competitor: string) => void
}) {
  const [inputValue, setInputValue] = useState('')

  const handleAdd = () => {
    if (inputValue.trim()) {
      onAdd(inputValue)
      setInputValue('')
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAdd()
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="Enter competitor domain"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={handleKeyPress}
        />
        <Button type="button" variant="outline" onClick={handleAdd}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      
      {competitors.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {competitors.map((competitor) => (
            <Badge key={competitor} variant="secondary" className="flex items-center gap-1">
              {competitor}
              <button
                type="button"
                onClick={() => onRemove(competitor)}
                className="ml-1 hover:bg-gray-300 rounded-full p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}