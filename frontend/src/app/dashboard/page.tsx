'use client'

// Force dynamic rendering for authentication-required pages
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getCurrentUser, supabase } from '@/lib/supabase'
import { AIVisibilityScoreDisplay, MultiEngineScores } from '@/components/dashboard/ai-visibility-score'
import { MetricsOverview, TopSources, CompetitorRankings } from '@/components/dashboard/metrics-overview'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Plus, BarChart, Users, Settings, LogOut } from 'lucide-react'

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null)
  const [brands, setBrands] = useState<any[]>([])
  const [selectedBrand, setSelectedBrand] = useState<any>(null)
  const [dashboardData, setDashboardData] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const initializeDashboard = async () => {
      try {
        const currentUser = await getCurrentUser()
        if (!currentUser) {
          router.push('/auth/login')
          return
        }

        setUser(currentUser)

        // Get user's brands
        const { data: userBrands } = await supabase
          .from('brands')
          .select('*')
          .eq('owner_id', currentUser.id)
          .order('created_at', { ascending: false })

        setBrands(userBrands || [])

        if (userBrands && userBrands.length > 0) {
          setSelectedBrand(userBrands[0])
          await loadDashboardData(userBrands[0].id)
        }
      } catch (error) {
        console.error('Dashboard initialization error:', error)
      } finally {
        setIsLoading(false)
      }
    }

    initializeDashboard()
  }, [router])

  const loadDashboardData = async (brandId: string) => {
    setIsLoading(true)
    try {
      // Load dashboard data in parallel
      const [
        aiScores,
        llmReports,
        competitors,
        brandPrompts
      ] = await Promise.allSettled([
        supabase
          .from('ai_visibility_scores')
          .select('*')
          .eq('brand_id', brandId)
          .order('created_at', { ascending: false })
          .limit(10),
        
        supabase
          .from('llm_reports')
          .select('*')
          .eq('brand_id', brandId)
          .order('created_at', { ascending: false })
          .limit(100),
        
        supabase
          .from('competitors')
          .select('*')
          .eq('brand_id', brandId)
          .order('mention_count', { ascending: false }),
        
        supabase
          .from('brand_prompts')
          .select('*')
          .eq('brand_id', brandId)
          .order('created_at', { ascending: false })
          .limit(50)
      ])

      const scoresData = aiScores.status === 'fulfilled' ? aiScores.value.data || [] : []
      const reportsData = llmReports.status === 'fulfilled' ? llmReports.value.data || [] : []
      const competitorsData = competitors.status === 'fulfilled' ? competitors.value.data || [] : []
      const promptsData = brandPrompts.status === 'fulfilled' ? brandPrompts.value.data || [] : []

      // Calculate metrics
      const totalPrompts = promptsData.length
      const brandMentions = reportsData.filter(r => 
        r.response_text && r.response_text.toLowerCase().includes(selectedBrand?.name?.toLowerCase() || '')
      ).length
      const brandMentionRate = totalPrompts > 0 ? (brandMentions / totalPrompts) * 100 : 0

      // Extract top sources from reports
      const sourceMap = new Map()
      reportsData.forEach(report => {
        if (report.response_text) {
          const urls = report.response_text.match(/https?:\/\/[^\s\]]+/g) || []
          urls.forEach((url: string) => {
            try {
              const domain = new URL(url).hostname.replace('www.', '')
              sourceMap.set(domain, (sourceMap.get(domain) || 0) + 1)
            } catch (e) {
              // Invalid URL, skip
            }
          })
        }
      })

      const topSources = Array.from(sourceMap.entries())
        .map(([domain, count]) => ({ domain, count }))
        .sort((a, b) => b.count - a.count)

      const competitorRankings = competitorsData.map(comp => ({
        name: comp.name,
        mentionCount: comp.mention_count || 0,
        visibilityScore: 50 + Math.random() * 40, // Placeholder - would calculate from actual data
        trend: Math.random() * 20 - 10 // Placeholder trend
      }))

      setDashboardData({
        aiScores: scoresData,
        totalScore: scoresData[0]?.total_score || 0,
        brandMentionRate,
        competitorCount: competitorsData.length,
        promptsAnalyzed: totalPrompts,
        topSources: topSources.slice(0, 10),
        competitorRankings,
        trends: [
          { period: 'weekly', change: Math.random() * 10 - 5 },
          { period: 'monthly', change: Math.random() * 15 - 7.5 }
        ]
      })
    } catch (error) {
      console.error('Error loading dashboard data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your dashboard...</p>
        </div>
      </div>
    )
  }

  if (!selectedBrand) {
    return (
      <div className="min-h-screen bg-gray-50">
        <DashboardHeader user={user} onSignOut={handleSignOut} />
        <div className="max-w-4xl mx-auto px-4 py-16">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Welcome to GeoScore AI
            </h2>
            <p className="text-gray-600 mb-8">
              Get started by adding your first brand for AI visibility tracking
            </p>
            <Button onClick={() => router.push('/dashboard/brand/new')}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Brand
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardHeader 
        user={user} 
        selectedBrand={selectedBrand}
        brands={brands}
        onBrandChange={(brand) => {
          setSelectedBrand(brand)
          loadDashboardData(brand.id)
        }}
        onSignOut={handleSignOut}
      />

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {dashboardData && (
          <>
            {/* Metrics Overview */}
            <MetricsOverview data={dashboardData} />

            {/* Main Dashboard Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* AI Visibility Score */}
              {dashboardData.aiScores[0] && (
                <AIVisibilityScoreDisplay
                  score={dashboardData.aiScores[0]}
                  previousScore={dashboardData.aiScores[1]?.total_score}
                />
              )}

              {/* Multi-Engine Performance */}
              <MultiEngineScores scores={dashboardData.aiScores} />
            </div>

            {/* Secondary Dashboard Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Top Sources */}
              <TopSources sources={dashboardData.topSources} />

              {/* Competitor Rankings */}
              <CompetitorRankings
                competitors={dashboardData.competitorRankings}
                brandName={selectedBrand.name}
              />
            </div>

            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
                <CardDescription>
                  Manage your brand analysis and generate reports
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Button
                    variant="outline"
                    onClick={() => router.push(`/dashboard/reports/${selectedBrand.id}`)}
                    className="flex items-center justify-center space-x-2"
                  >
                    <BarChart className="h-4 w-4" />
                    <span>Generate Report</span>
                  </Button>
                  
                  <Button
                    variant="outline"
                    onClick={() => router.push(`/dashboard/competitors/${selectedBrand.id}`)}
                    className="flex items-center justify-center space-x-2"
                  >
                    <Users className="h-4 w-4" />
                    <span>Manage Competitors</span>
                  </Button>
                  
                  <Button
                    variant="outline"
                    onClick={() => router.push(`/dashboard/settings`)}
                    className="flex items-center justify-center space-x-2"
                  >
                    <Settings className="h-4 w-4" />
                    <span>Settings</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  )
}

interface DashboardHeaderProps {
  user: any
  selectedBrand?: any
  brands?: any[]
  onBrandChange?: (brand: any) => void
  onSignOut: () => void
}

function DashboardHeader({ user, selectedBrand, brands = [], onBrandChange, onSignOut }: DashboardHeaderProps) {
  return (
    <header className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-bold text-gray-900">
              GeoScore <span className="text-blue-600">AI</span>
            </h1>
            
            {selectedBrand && (
              <div className="flex items-center space-x-2">
                <span className="text-gray-400">|</span>
                <select
                  value={selectedBrand.id}
                  onChange={(e) => {
                    const brand = brands.find(b => b.id === e.target.value)
                    if (brand && onBrandChange) {
                      onBrandChange(brand)
                    }
                  }}
                  className="bg-gray-50 border border-gray-200 rounded-md px-3 py-1 text-sm font-medium"
                >
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-600">
              Welcome, {user?.email}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onSignOut}
              className="flex items-center space-x-2"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}