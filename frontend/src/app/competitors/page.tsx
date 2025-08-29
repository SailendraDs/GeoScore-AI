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
  TrendingUp, 
  TrendingDown, 
  Users, 
  Globe, 
  BarChart3,
  Eye,
  Edit,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle
} from 'lucide-react'

interface Competitor {
  id: string
  brand_id: string
  name: string
  domain?: string
  category?: string
  mention_count: number
  last_mentioned?: string
  visibility_score?: number
  trend?: number
  notes?: string
  created_at: string
}

interface Brand {
  id: string
  name: string
  competitors: string[]
}

function CompetitorsPageWithSearchParams() {
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [selectedBrand, setSelectedBrand] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingCompetitor, setEditingCompetitor] = useState<Competitor | null>(null)
  const [newCompetitor, setNewCompetitor] = useState({
    name: '',
    domain: '',
    category: '',
    notes: ''
  })
  const [error, setError] = useState('')
  const [user, setUser] = useState<any>(null)
  const router = useRouter()
  const searchParams = useSearchParams()

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
          .select('id, name, competitors')
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
      loadCompetitors(selectedBrand)
    }
  }, [selectedBrand])

  const loadCompetitors = async (brandId: string) => {
    try {
      const { data, error } = await supabase
        .from('competitors')
        .select('*')
        .eq('brand_id', brandId)
        .order('mention_count', { ascending: false })

      if (error) throw error

      setCompetitors(data || [])
    } catch (error) {
      console.error('Error loading competitors:', error)
    }
  }

  const handleAddCompetitor = async () => {
    if (!selectedBrand || !newCompetitor.name.trim()) {
      setError('Please enter a competitor name')
      return
    }

    try {
      const { data, error } = await supabase
        .from('competitors')
        .insert({
          brand_id: selectedBrand,
          name: newCompetitor.name,
          domain: newCompetitor.domain || null,
          category: newCompetitor.category || null,
          notes: newCompetitor.notes || null,
          mention_count: 0
        })
        .select()
        .single()

      if (error) throw error

      setCompetitors(prev => [data, ...prev])
      setNewCompetitor({ name: '', domain: '', category: '', notes: '' })
      setShowAddForm(false)
      setError('')

      // Update brand's competitors array
      const currentBrand = brands.find(b => b.id === selectedBrand)
      if (currentBrand && newCompetitor.domain) {
        const updatedCompetitors = [...currentBrand.competitors, newCompetitor.domain]
        await supabase
          .from('brands')
          .update({ competitors: updatedCompetitors })
          .eq('id', selectedBrand)

        setBrands(prev => prev.map(b => 
          b.id === selectedBrand 
            ? { ...b, competitors: updatedCompetitors }
            : b
        ))
      }

    } catch (error: any) {
      setError(error.message || 'Failed to add competitor')
    }
  }

  const handleUpdateCompetitor = async (competitor: Competitor) => {
    try {
      const { error } = await supabase
        .from('competitors')
        .update({
          name: competitor.name,
          domain: competitor.domain,
          category: competitor.category,
          notes: competitor.notes
        })
        .eq('id', competitor.id)

      if (error) throw error

      setCompetitors(prev => prev.map(c => 
        c.id === competitor.id ? competitor : c
      ))
      setEditingCompetitor(null)
      setError('')

    } catch (error: any) {
      setError(error.message || 'Failed to update competitor')
    }
  }

  const handleDeleteCompetitor = async (competitorId: string) => {
    if (!confirm('Are you sure you want to delete this competitor?')) return

    try {
      const { error } = await supabase
        .from('competitors')
        .delete()
        .eq('id', competitorId)

      if (error) throw error

      setCompetitors(prev => prev.filter(c => c.id !== competitorId))

    } catch (error: any) {
      setError(error.message || 'Failed to delete competitor')
    }
  }

  const runCompetitorAnalysis = async () => {
    if (!selectedBrand) return

    setIsAnalyzing(true)
    try {
      const result = await callEdgeFunction('competitor-tracking', {
        brandId: selectedBrand,
        analysisType: 'full_competitive_analysis',
        includeVisibilityScores: true
      })

      // Reload competitors to show updated data
      await loadCompetitors(selectedBrand)
      
      alert('Competitor analysis completed successfully!')

    } catch (error: any) {
      setError(error.message || 'Failed to run competitor analysis')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const filteredCompetitors = competitors.filter(competitor =>
    competitor.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    competitor.domain?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    competitor.category?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const getScoreColor = (score?: number) => {
    if (!score) return 'text-gray-500'
    if (score >= 80) return 'text-green-600'
    if (score >= 60) return 'text-yellow-600'
    return 'text-red-600'
  }

  const getTrendIcon = (trend?: number) => {
    if (!trend || trend === 0) return null
    return trend > 0 ? <TrendingUp className="h-4 w-4 text-green-500" /> : <TrendingDown className="h-4 w-4 text-red-500" />
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading competitors...</p>
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
              <h1 className="text-2xl font-bold text-gray-900">Competitor Analysis</h1>
              <p className="text-gray-600">Track and analyze your competitive landscape</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={runCompetitorAnalysis} disabled={isAnalyzing}>
                {isAnalyzing ? (
                  <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Analyzing...</>
                ) : (
                  <><BarChart3 className="h-4 w-4 mr-2" />Run Analysis</>
                )}
              </Button>
              <Button onClick={() => setShowAddForm(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Competitor
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Controls */}
        <div className="mb-6 flex flex-col sm:flex-row gap-4">
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
            <Label htmlFor="search">Search Competitors</Label>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
              <Input
                id="search"
                placeholder="Search by name, domain, or category..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
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
              <Users className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Select a Brand</h3>
              <p className="text-gray-600 mb-4">
                Choose a brand to view and manage its competitors
              </p>
              {brands.length === 0 && (
                <Button onClick={() => router.push('/onboard')}>
                  Create Your First Brand
                </Button>
              )}
            </CardContent>
          </Card>
        ) : filteredCompetitors.length === 0 ? (
          <Card>
            <CardContent className="text-center py-16">
              <Users className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No Competitors Found</h3>
              <p className="text-gray-600 mb-4">
                {competitors.length === 0 
                  ? "You haven't added any competitors yet. Start by adding your first competitor."
                  : "No competitors match your search criteria."
                }
              </p>
              <Button onClick={() => setShowAddForm(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Competitor
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCompetitors.map((competitor) => (
              <Card key={competitor.id} className="hover:shadow-lg transition-shadow">
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg mb-1">{competitor.name}</CardTitle>
                      {competitor.domain && (
                        <CardDescription className="flex items-center">
                          <Globe className="h-4 w-4 mr-1" />
                          {competitor.domain}
                        </CardDescription>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingCompetitor(competitor)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteCompetitor(competitor.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Category */}
                    {competitor.category && (
                      <Badge variant="secondary">{competitor.category}</Badge>
                    )}

                    {/* Metrics */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">
                          {competitor.mention_count}
                        </div>
                        <div className="text-xs text-gray-600">Mentions</div>
                      </div>
                      <div className="text-center">
                        <div className={`text-2xl font-bold ${getScoreColor(competitor.visibility_score)}`}>
                          {competitor.visibility_score ? Math.round(competitor.visibility_score) : '--'}
                        </div>
                        <div className="text-xs text-gray-600 flex items-center justify-center">
                          Visibility
                          {getTrendIcon(competitor.trend)}
                        </div>
                      </div>
                    </div>

                    {/* Last Mentioned */}
                    {competitor.last_mentioned && (
                      <div className="text-xs text-gray-500 text-center">
                        Last mentioned: {new Date(competitor.last_mentioned).toLocaleDateString()}
                      </div>
                    )}

                    {/* Notes */}
                    {competitor.notes && (
                      <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded">
                        {competitor.notes}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="pt-2 border-t">
                      <Button variant="outline" size="sm" className="w-full">
                        <Eye className="h-4 w-4 mr-2" />
                        View Details
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Summary Stats */}
        {selectedBrand && filteredCompetitors.length > 0 && (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle>Competitive Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {filteredCompetitors.length}
                  </div>
                  <div className="text-sm text-gray-600">Total Competitors</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {Math.round(
                      filteredCompetitors
                        .filter(c => c.visibility_score)
                        .reduce((sum, c) => sum + (c.visibility_score || 0), 0) / 
                      filteredCompetitors.filter(c => c.visibility_score).length || 0
                    )}%
                  </div>
                  <div className="text-sm text-gray-600">Avg. Visibility</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">
                    {filteredCompetitors.reduce((sum, c) => sum + c.mention_count, 0)}
                  </div>
                  <div className="text-sm text-gray-600">Total Mentions</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">
                    {new Set(filteredCompetitors.map(c => c.category).filter(Boolean)).size}
                  </div>
                  <div className="text-sm text-gray-600">Categories</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add/Edit Competitor Modal */}
      {(showAddForm || editingCompetitor) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <Card className="max-w-md w-full">
            <CardHeader>
              <CardTitle>
                {editingCompetitor ? 'Edit Competitor' : 'Add New Competitor'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="comp-name">Competitor Name *</Label>
                <Input
                  id="comp-name"
                  placeholder="Competitor name"
                  value={editingCompetitor ? editingCompetitor.name : newCompetitor.name}
                  onChange={(e) => {
                    if (editingCompetitor) {
                      setEditingCompetitor({ ...editingCompetitor, name: e.target.value })
                    } else {
                      setNewCompetitor(prev => ({ ...prev, name: e.target.value }))
                    }
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="comp-domain">Domain</Label>
                <Input
                  id="comp-domain"
                  placeholder="competitor.com"
                  value={editingCompetitor ? editingCompetitor.domain || '' : newCompetitor.domain}
                  onChange={(e) => {
                    if (editingCompetitor) {
                      setEditingCompetitor({ ...editingCompetitor, domain: e.target.value })
                    } else {
                      setNewCompetitor(prev => ({ ...prev, domain: e.target.value }))
                    }
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="comp-category">Category</Label>
                <Input
                  id="comp-category"
                  placeholder="e.g., Direct, Indirect, Alternative"
                  value={editingCompetitor ? editingCompetitor.category || '' : newCompetitor.category}
                  onChange={(e) => {
                    if (editingCompetitor) {
                      setEditingCompetitor({ ...editingCompetitor, category: e.target.value })
                    } else {
                      setNewCompetitor(prev => ({ ...prev, category: e.target.value }))
                    }
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="comp-notes">Notes</Label>
                <Input
                  id="comp-notes"
                  placeholder="Additional notes about this competitor"
                  value={editingCompetitor ? editingCompetitor.notes || '' : newCompetitor.notes}
                  onChange={(e) => {
                    if (editingCompetitor) {
                      setEditingCompetitor({ ...editingCompetitor, notes: e.target.value })
                    } else {
                      setNewCompetitor(prev => ({ ...prev, notes: e.target.value }))
                    }
                  }}
                />
              </div>

              <div className="flex gap-3 pt-4">
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setShowAddForm(false)
                    setEditingCompetitor(null)
                    setNewCompetitor({ name: '', domain: '', category: '', notes: '' })
                    setError('')
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button 
                  onClick={() => {
                    if (editingCompetitor) {
                      handleUpdateCompetitor(editingCompetitor)
                    } else {
                      handleAddCompetitor()
                    }
                  }}
                  className="flex-1"
                >
                  {editingCompetitor ? 'Update' : 'Add'} Competitor
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

export default function CompetitorsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading competitors...</p>
        </div>
      </div>
    }>
      <CompetitorsPageWithSearchParams />
    </Suspense>
  )
}