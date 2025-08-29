'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TrendingUp, TrendingDown, Eye, Users, ChevronRight, Activity, Target } from "lucide-react"
import { formatScore, getScoreColor } from "@/lib/utils"
import { supabase } from '@/lib/supabase'

interface CompetitorData {
  id: string
  name: string
  domain?: string
  visibility_score: number
  mention_count: number
  sentiment_score: number
  market_share: number
  trend: number
  last_analyzed: string
  key_strengths: string[]
  threat_level: 'low' | 'medium' | 'high'
  citations: {
    domain: string
    count: number
    authority: number
  }[]
}

interface CompetitorIntelligenceProps {
  brandId: string
  className?: string
}

export function CompetitorIntelligence({ brandId, className }: CompetitorIntelligenceProps) {
  const [competitors, setCompetitors] = useState<CompetitorData[]>([])
  const [selectedCompetitor, setSelectedCompetitor] = useState<CompetitorData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [analysisRunning, setAnalysisRunning] = useState(false)

  useEffect(() => {
    loadCompetitorData()
  }, [brandId])

  const loadCompetitorData = async () => {
    try {
      const { data: competitorScores } = await supabase
        .from('competitor_scores')
        .select(`
          *,
          competitors!inner(*)
        `)
        .eq('competitors.brand_id', brandId)
        .order('visibility_score', { ascending: false })

      const processedCompetitors: CompetitorData[] = competitorScores?.map(score => ({
        id: score.competitor_id,
        name: score.competitors.name,
        domain: score.competitors.domain,
        visibility_score: score.visibility_score || 0,
        mention_count: score.mention_count || 0,
        sentiment_score: score.sentiment_score || 0,
        market_share: score.market_share || 0,
        trend: (Math.random() * 20) - 10, // Placeholder - would be calculated from historical data
        last_analyzed: score.updated_at,
        key_strengths: score.analysis_data?.key_strengths || [],
        threat_level: score.visibility_score > 70 ? 'high' : score.visibility_score > 40 ? 'medium' : 'low',
        citations: score.analysis_data?.top_citations || []
      })) || []

      setCompetitors(processedCompetitors)
      if (processedCompetitors.length > 0) {
        setSelectedCompetitor(processedCompetitors[0])
      }
    } catch (error) {
      console.error('Error loading competitor data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const runCompetitorAnalysis = async () => {
    setAnalysisRunning(true)
    try {
      // Trigger competitor analysis via Edge Function
      const { data } = await supabase.functions.invoke('brand-analysis', {
        body: { 
          brand_id: brandId, 
          analysis_type: 'competitor_intelligence'
        }
      })
      
      if (data?.success) {
        setTimeout(() => {
          loadCompetitorData()
          setAnalysisRunning(false)
        }, 3000)
      }
    } catch (error) {
      console.error('Error running competitor analysis:', error)
      setAnalysisRunning(false)
    }
  }

  const getThreatLevelColor = (level: string) => {
    switch (level) {
      case 'high': return 'text-red-600 bg-red-50'
      case 'medium': return 'text-yellow-600 bg-yellow-50'
      case 'low': return 'text-green-600 bg-green-50'
      default: return 'text-gray-600 bg-gray-50'
    }
  }

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
    <div className={`grid grid-cols-1 lg:grid-cols-2 gap-6 ${className}`}>
      {/* Competitor Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Competitor Intelligence
              </CardTitle>
              <CardDescription>
                AI-powered competitive landscape analysis
              </CardDescription>
            </div>
            <Button 
              onClick={runCompetitorAnalysis}
              disabled={analysisRunning}
              size="sm"
            >
              <Activity className={`h-4 w-4 mr-2 ${analysisRunning ? 'animate-spin' : ''}`} />
              {analysisRunning ? 'Analyzing...' : 'Refresh'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {competitors.slice(0, 5).map((competitor, index) => (
              <div 
                key={competitor.id}
                className={`flex items-center space-x-4 p-3 rounded-lg cursor-pointer transition-colors ${
                  selectedCompetitor?.id === competitor.id 
                    ? 'bg-blue-50 border border-blue-200' 
                    : 'hover:bg-gray-50'
                }`}
                onClick={() => setSelectedCompetitor(competitor)}
              >
                <div className="flex-shrink-0">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    index === 0 ? 'bg-red-100 text-red-800' :
                    index === 1 ? 'bg-orange-100 text-orange-800' :
                    index === 2 ? 'bg-yellow-100 text-yellow-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {index + 1}
                  </div>
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {competitor.name}
                    </p>
                    <div className="flex items-center space-x-2">
                      <Badge 
                        variant={competitor.threat_level === 'high' ? 'destructive' : 
                                competitor.threat_level === 'medium' ? 'warning' : 'success'}
                      >
                        {competitor.threat_level} threat
                      </Badge>
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500 mt-1">
                    <span>{competitor.mention_count} mentions</span>
                    <div className="flex items-center space-x-1">
                      {competitor.trend >= 0 ? (
                        <TrendingUp className="h-3 w-3 text-green-500" />
                      ) : (
                        <TrendingDown className="h-3 w-3 text-red-500" />
                      )}
                      <span className={getScoreColor(competitor.visibility_score)}>
                        {formatScore(competitor.visibility_score)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Detailed Competitor Analysis */}
      {selectedCompetitor && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{selectedCompetitor.name} Analysis</span>
              <Badge className={getThreatLevelColor(selectedCompetitor.threat_level)}>
                {selectedCompetitor.threat_level} threat
              </Badge>
            </CardTitle>
            <CardDescription>
              Detailed competitive intelligence and positioning
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Key Metrics */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center space-x-2 mb-2">
                  <Eye className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium">Visibility Score</span>
                </div>
                <div className="text-2xl font-bold text-blue-600">
                  {formatScore(selectedCompetitor.visibility_score)}
                </div>
                <Progress value={selectedCompetitor.visibility_score} className="mt-2 h-2" />
              </div>
              
              <div>
                <div className="flex items-center space-x-2 mb-2">
                  <Target className="h-4 w-4 text-green-500" />
                  <span className="text-sm font-medium">Market Share</span>
                </div>
                <div className="text-2xl font-bold text-green-600">
                  {formatScore(selectedCompetitor.market_share)}%
                </div>
                <Progress value={selectedCompetitor.market_share} className="mt-2 h-2" />
              </div>
            </div>

            {/* Key Strengths */}
            {selectedCompetitor.key_strengths.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-3">Key Strengths</h4>
                <div className="flex flex-wrap gap-2">
                  {selectedCompetitor.key_strengths.slice(0, 6).map((strength, index) => (
                    <Badge key={index} variant="outline">
                      {strength}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Top Citations */}
            {selectedCompetitor.citations.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-3">Top Citation Sources</h4>
                <div className="space-y-2">
                  {selectedCompetitor.citations.slice(0, 5).map((citation, index) => (
                    <div key={index} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700">{citation.domain}</span>
                      <div className="flex items-center space-x-2">
                        <span className="text-gray-500">{citation.count} cites</span>
                        <Badge variant="outline" className="text-xs">
                          DA {citation.authority}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Performance Metrics */}
            <div className="border-t pt-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-lg font-semibold text-gray-900">
                    {selectedCompetitor.mention_count}
                  </div>
                  <div className="text-xs text-gray-500">Total Mentions</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-gray-900">
                    {formatScore(selectedCompetitor.sentiment_score)}
                  </div>
                  <div className="text-xs text-gray-500">Sentiment Score</div>
                </div>
                <div>
                  <div className={`text-lg font-semibold flex items-center justify-center space-x-1 ${
                    selectedCompetitor.trend >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {selectedCompetitor.trend >= 0 ? (
                      <TrendingUp className="h-4 w-4" />
                    ) : (
                      <TrendingDown className="h-4 w-4" />
                    )}
                    <span>{selectedCompetitor.trend >= 0 ? '+' : ''}{formatScore(selectedCompetitor.trend)}%</span>
                  </div>
                  <div className="text-xs text-gray-500">30-day Trend</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}