'use client'
export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'
import { 
  Search, 
  Filter, 
  BarChart3, 
  Calendar, 
  TrendingUp, 
  TrendingDown, 
  Eye,
  Download,
  RefreshCw,
  Plus
} from 'lucide-react'

interface Report {
  id: string
  brand_id: string
  brand_name: string
  model_name: string
  report_type: string
  raw_score: number
  generated_at: string
  analysis_text: string
}

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([])
  const [brands, setBrands] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedBrand, setSelectedBrand] = useState<string>('all')
  const [selectedModel, setSelectedModel] = useState<string>('all')
  const [user, setUser] = useState<any>(null)
  const router = useRouter()

  const models = [
    'claude-opus', 'gpt-4o', 'gemini-pro', 'grok-beta', 
    'mistral-large', 'llama-3-70b', 'perplexity-online'
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
          .select('*')
          .eq('owner_id', user.id)
          .order('created_at', { ascending: false })

        setBrands(userBrands || [])

        // Load reports
        await loadReports(user.id)
      } catch (error) {
        console.error('Error loading data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    checkAuthAndLoadData()
  }, [router])

  const loadReports = async (userId: string) => {
    try {
      let query = supabase
        .from('llm_reports')
        .select(`
          id,
          brand_id,
          model_name,
          report_type,
          raw_score,
          generated_at,
          analysis_text,
          brands!inner(name, owner_id)
        `)
        .eq('brands.owner_id', userId)
        .order('generated_at', { ascending: false })
        .limit(100)

      const { data, error } = await query

      if (error) throw error

      const formattedReports = data?.map((report: any) => ({
        ...report,
        brand_name: report.brands?.name || 'Unknown Brand'
      })) || []

      setReports(formattedReports)
    } catch (error) {
      console.error('Error loading reports:', error)
    }
  }

  const filteredReports = reports.filter(report => {
    const matchesSearch = 
      report.brand_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      report.model_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      report.report_type.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesBrand = selectedBrand === 'all' || report.brand_id === selectedBrand
    const matchesModel = selectedModel === 'all' || report.model_name === selectedModel

    return matchesSearch && matchesBrand && matchesModel
  })

  const generateNewReport = async () => {
    if (brands.length === 0) {
      router.push('/onboard')
      return
    }
    
    // For now, redirect to brand selection or use first brand
    const brandId = brands[0].id
    router.push(`/reports/generate?brandId=${brandId}`)
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600'
    if (score >= 60) return 'text-yellow-600'
    return 'text-red-600'
  }

  const getScoreBadge = (score: number) => {
    if (score >= 80) return 'success'
    if (score >= 60) return 'warning'
    return 'destructive'
  }

  const formatModelName = (model: string) => {
    return model.split('-').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ')
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your reports...</p>
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
              <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
              <p className="text-gray-600">AI visibility reports across all models</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => window.location.reload()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              <Button onClick={generateNewReport}>
                <Plus className="h-4 w-4 mr-2" />
                Generate Report
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Filters */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Search</label>
                <div className="relative">
                  <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
                  <Input
                    placeholder="Search reports..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Brand</label>
                <select
                  value={selectedBrand}
                  onChange={(e) => setSelectedBrand(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Brands</option>
                  {brands.map(brand => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Model</label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Models</option>
                  {models.map(model => (
                    <option key={model} value={model}>
                      {formatModelName(model)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Actions</label>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm">
                    <Filter className="h-4 w-4 mr-2" />
                    More Filters
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Reports Grid */}
        {filteredReports.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <BarChart3 className="h-16 w-16 text-gray-400 mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No reports found</h3>
              <p className="text-gray-600 text-center mb-6">
                {reports.length === 0 
                  ? "You haven't generated any reports yet. Create your first brand to get started."
                  : "No reports match your current filters. Try adjusting your search criteria."
                }
              </p>
              {reports.length === 0 && (
                <Button onClick={() => router.push('/onboard')}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Your First Brand
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredReports.map((report) => (
              <Card key={report.id} className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg mb-1">
                        {report.brand_name}
                      </CardTitle>
                      <CardDescription>
                        {formatModelName(report.model_name)} • {report.report_type}
                      </CardDescription>
                    </div>
                    <Badge 
                      variant={getScoreBadge(report.raw_score)} 
                      className="ml-2"
                    >
                      {Math.round(report.raw_score)}/100
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Score visualization */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-gray-600">Visibility Score</span>
                        <span className={`font-semibold ${getScoreColor(report.raw_score)}`}>
                          {Math.round(report.raw_score)}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full ${
                            report.raw_score >= 80 ? 'bg-green-500' :
                            report.raw_score >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${report.raw_score}%` }}
                        />
                      </div>
                    </div>

                    {/* Analysis preview */}
                    {report.analysis_text && (
                      <div>
                        <p className="text-sm text-gray-600 line-clamp-3">
                          {report.analysis_text}
                        </p>
                      </div>
                    )}

                    {/* Date */}
                    <div className="flex items-center text-sm text-gray-500">
                      <Calendar className="h-4 w-4 mr-1" />
                      {new Date(report.generated_at).toLocaleDateString()}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between pt-2 border-t">
                      <Link href={`/reports/${report.id}`}>
                        <Button variant="outline" size="sm">
                          <Eye className="h-4 w-4 mr-2" />
                          View Details
                        </Button>
                      </Link>
                      <Button variant="ghost" size="sm">
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Summary Stats */}
        {filteredReports.length > 0 && (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle>Report Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {filteredReports.length}
                  </div>
                  <div className="text-sm text-gray-600">Total Reports</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {Math.round(
                      filteredReports.reduce((sum, r) => sum + r.raw_score, 0) / filteredReports.length
                    )}%
                  </div>
                  <div className="text-sm text-gray-600">Average Score</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">
                    {new Set(filteredReports.map(r => r.model_name)).size}
                  </div>
                  <div className="text-sm text-gray-600">Models Tested</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">
                    {new Set(filteredReports.map(r => r.brand_id)).size}
                  </div>
                  <div className="text-sm text-gray-600">Brands Tracked</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}