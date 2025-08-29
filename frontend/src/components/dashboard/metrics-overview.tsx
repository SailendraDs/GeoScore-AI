'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { TrendingUp, TrendingDown, Eye, Target, Users, Award } from "lucide-react"
import { formatScore, getScoreColor } from "@/lib/utils"

interface MetricsOverviewProps {
  data: {
    totalScore: number
    brandMentionRate: number
    competitorCount: number
    promptsAnalyzed: number
    topSources: { domain: string; count: number }[]
    trends: { period: string; change: number }[]
  }
  className?: string
}

export function MetricsOverview({ data, className }: MetricsOverviewProps) {
  const {
    totalScore,
    brandMentionRate,
    competitorCount,
    promptsAnalyzed,
    topSources,
    trends
  } = data

  const weeklyTrend = trends.find(t => t.period === 'weekly')?.change || 0
  const monthlyTrend = trends.find(t => t.period === 'monthly')?.change || 0

  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 ${className}`}>
      {/* AI Visibility Score */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">AI Visibility Score</CardTitle>
          <Award className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatScore(totalScore)}</div>
          <div className="flex items-center space-x-1 text-xs text-muted-foreground">
            {weeklyTrend >= 0 ? (
              <TrendingUp className="h-3 w-3 text-green-500" />
            ) : (
              <TrendingDown className="h-3 w-3 text-red-500" />
            )}
            <span>{weeklyTrend >= 0 ? '+' : ''}{formatScore(weeklyTrend)} this week</span>
          </div>
        </CardContent>
      </Card>

      {/* Brand Mention Rate */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Brand Mention Rate</CardTitle>
          <Target className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatScore(brandMentionRate)}%</div>
          <Progress value={brandMentionRate} className="mt-2 h-2" />
          <p className="text-xs text-muted-foreground mt-1">
            Of analyzed prompts mention your brand
          </p>
        </CardContent>
      </Card>

      {/* Competitor Tracking */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Competitors Tracked</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{competitorCount}</div>
          <p className="text-xs text-muted-foreground">
            Active competitor monitoring
          </p>
        </CardContent>
      </Card>

      {/* Prompts Analyzed */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Prompts Analyzed</CardTitle>
          <Eye className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{promptsAnalyzed.toLocaleString()}</div>
          <div className="flex items-center space-x-1 text-xs text-muted-foreground">
            <TrendingUp className="h-3 w-3 text-green-500" />
            <span>+{Math.round(promptsAnalyzed * 0.15)} this month</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

interface TopSourcesProps {
  sources: { domain: string; count: number; authority?: number }[]
  className?: string
}

export function TopSources({ sources, className }: TopSourcesProps) {
  const maxCount = Math.max(...sources.map(s => s.count))

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Top Citation Sources</CardTitle>
        <CardDescription>
          Domains most frequently cited when your brand is mentioned
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {sources.slice(0, 10).map((source, index) => (
            <div key={source.domain} className="flex items-center space-x-4">
              <div className="flex-shrink-0 text-sm text-gray-500 w-6">
                #{index + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {source.domain}
                  </p>
                  <div className="flex items-center space-x-2">
                    {source.authority && (
                      <span className={`text-xs px-2 py-1 rounded ${getScoreColor(source.authority)} bg-gray-50`}>
                        DA: {source.authority}
                      </span>
                    )}
                    <span className="text-sm text-gray-500">
                      {source.count} citations
                    </span>
                  </div>
                </div>
                <Progress 
                  value={(source.count / maxCount) * 100} 
                  className="mt-1 h-1"
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

interface CompetitorRankingsProps {
  competitors: {
    name: string
    mentionCount: number
    visibilityScore?: number
    trend: number
  }[]
  brandName: string
  className?: string
}

export function CompetitorRankings({ competitors, brandName, className }: CompetitorRankingsProps) {
  // Add brand to competitors for comparison
  const allCompetitors = [
    {
      name: brandName,
      mentionCount: competitors.reduce((sum, c) => sum + c.mentionCount, 0) / competitors.length,
      visibilityScore: 75, // This would come from actual data
      trend: 5,
      isBrand: true
    },
    ...competitors.map(c => ({ ...c, isBrand: false }))
  ].sort((a, b) => (b.visibilityScore || 0) - (a.visibilityScore || 0))

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Competitive Landscape</CardTitle>
        <CardDescription>
          How you rank against competitors in AI visibility
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {allCompetitors.slice(0, 8).map((competitor, index) => (
            <div 
              key={competitor.name} 
              className={`flex items-center space-x-4 p-3 rounded-lg ${competitor.isBrand ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'}`}
            >
              <div className="flex-shrink-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  index === 0 ? 'bg-yellow-100 text-yellow-800' :
                  index === 1 ? 'bg-gray-100 text-gray-800' :
                  index === 2 ? 'bg-orange-100 text-orange-800' :
                  'bg-gray-50 text-gray-600'
                }`}>
                  {index + 1}
                </div>
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className={`text-sm font-medium truncate ${competitor.isBrand ? 'text-blue-900' : 'text-gray-900'}`}>
                    {competitor.name}
                    {competitor.isBrand && (
                      <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                        Your Brand
                      </span>
                    )}
                  </p>
                  <div className="flex items-center space-x-2">
                    {competitor.trend >= 0 ? (
                      <TrendingUp className="h-3 w-3 text-green-500" />
                    ) : (
                      <TrendingDown className="h-3 w-3 text-red-500" />
                    )}
                    <span className={`text-sm font-medium ${getScoreColor(competitor.visibilityScore || 0)}`}>
                      {formatScore(competitor.visibilityScore || 0)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500 mt-1">
                  <span>{Math.round(competitor.mentionCount)} mentions</span>
                  <span>{competitor.trend >= 0 ? '+' : ''}{competitor.trend}% trend</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}