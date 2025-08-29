'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Link, ExternalLink, TrendingUp, Award, Search, RefreshCw } from "lucide-react"
import { supabase } from '@/lib/supabase'

interface CitationData {
  id: string
  url: string
  domain: string
  title: string
  snippet: string
  authority_score: number
  relevance_score: number
  citation_context: string
  sentiment: 'positive' | 'neutral' | 'negative'
  first_seen: string
  last_verified: string
  mention_frequency: number
  traffic_estimate: number
  category: string
  ai_models: string[]
}

interface CitationExtractionProps {
  brandId: string
  className?: string
}

export function CitationExtraction({ brandId, className }: CitationExtractionProps) {
  const [citations, setCitations] = useState<CitationData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isExtracting, setIsExtracting] = useState(false)
  const [selectedTimeframe, setSelectedTimeframe] = useState<'7d' | '30d' | '90d'>('30d')
  const [stats, setStats] = useState({
    totalCitations: 0,
    avgAuthorityScore: 0,
    highAuthorityCount: 0,
    positiveSentimentRate: 0,
    topDomains: [] as { domain: string; count: number }[]
  })

  useEffect(() => {
    loadCitationData()
  }, [brandId, selectedTimeframe])

  const loadCitationData = async () => {
    try {
      // Calculate date range based on selected timeframe
      const daysAgo = selectedTimeframe === '7d' ? 7 : selectedTimeframe === '30d' ? 30 : 90
      const fromDate = new Date()
      fromDate.setDate(fromDate.getDate() - daysAgo)

      const { data: reports } = await supabase
        .from('llm_reports')
        .select('*')
        .eq('brand_id', brandId)
        .gte('created_at', fromDate.toISOString())
        .order('created_at', { ascending: false })

      // Extract citations from report responses
      const extractedCitations: CitationData[] = []
      const domainCounts = new Map<string, number>()
      let totalAuthority = 0
      let highAuthorityCount = 0
      let positiveCount = 0

      reports?.forEach((report, index) => {
        if (report.response_text) {
          // Extract URLs from response
          const urls = report.response_text.match(/https?:\/\/[^\s\]]+/g) || []
          
          urls.forEach((url: string, urlIndex: number) => {
            try {
              const urlObj = new URL(url)
              const domain = urlObj.hostname.replace('www.', '')
              
              // Increment domain count
              domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1)

              // Generate mock citation data based on real patterns
              const authorityScore = getAuthorityScore(domain)
              const sentiment = getSentimentFromContext(report.response_text, url)
              
              totalAuthority += authorityScore
              if (authorityScore >= 70) highAuthorityCount++
              if (sentiment === 'positive') positiveCount++

              extractedCitations.push({
                id: `${report.id}-${urlIndex}`,
                url,
                domain,
                title: extractTitleFromContext(report.response_text, url),
                snippet: extractSnippetFromContext(report.response_text, url),
                authority_score: authorityScore,
                relevance_score: Math.min(95, 60 + Math.random() * 35),
                citation_context: extractContextFromResponse(report.response_text, url),
                sentiment,
                first_seen: report.created_at,
                last_verified: report.created_at,
                mention_frequency: domainCounts.get(domain) || 1,
                traffic_estimate: getTrafficEstimate(domain),
                category: getCategoryForDomain(domain),
                ai_models: [report.llm_model]
              })
            } catch (e) {
              // Invalid URL, skip
            }
          })
        }
      })

      // Sort by authority score and relevance
      extractedCitations.sort((a, b) => 
        (b.authority_score * 0.7 + b.relevance_score * 0.3) - 
        (a.authority_score * 0.7 + a.relevance_score * 0.3)
      )

      setCitations(extractedCitations.slice(0, 50)) // Limit to top 50

      // Calculate stats
      const topDomains = Array.from(domainCounts.entries())
        .map(([domain, count]) => ({ domain, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)

      setStats({
        totalCitations: extractedCitations.length,
        avgAuthorityScore: extractedCitations.length > 0 ? totalAuthority / extractedCitations.length : 0,
        highAuthorityCount,
        positiveSentimentRate: extractedCitations.length > 0 ? (positiveCount / extractedCitations.length) * 100 : 0,
        topDomains
      })

    } catch (error) {
      console.error('Error loading citation data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const runCitationExtraction = async () => {
    setIsExtracting(true)
    try {
      const { data } = await supabase.functions.invoke('brand-analysis', {
        body: { 
          brand_id: brandId, 
          analysis_type: 'citation_extraction',
          timeframe: selectedTimeframe
        }
      })
      
      if (data?.success) {
        setTimeout(() => {
          loadCitationData()
          setIsExtracting(false)
        }, 3000)
      }
    } catch (error) {
      console.error('Error running citation extraction:', error)
      setIsExtracting(false)
    }
  }

  // Helper functions for realistic data generation
  const getAuthorityScore = (domain: string): number => {
    const highAuthority = ['wikipedia.org', 'forbes.com', 'techcrunch.com', 'reuters.com', 'bloomberg.com', 'wsj.com']
    const mediumAuthority = ['medium.com', 'linkedin.com', 'github.com', 'stackoverflow.com']
    
    if (highAuthority.some(d => domain.includes(d))) return 85 + Math.random() * 15
    if (mediumAuthority.some(d => domain.includes(d))) return 60 + Math.random() * 25
    return 30 + Math.random() * 40
  }

  const getSentimentFromContext = (text: string, url: string): 'positive' | 'neutral' | 'negative' => {
    const positiveWords = ['excellent', 'great', 'best', 'recommended', 'outstanding', 'innovative']
    const negativeWords = ['poor', 'bad', 'worst', 'avoid', 'terrible', 'disappointing']
    
    const contextStart = text.indexOf(url) - 100
    const contextEnd = text.indexOf(url) + 100
    const context = text.slice(Math.max(0, contextStart), contextEnd).toLowerCase()
    
    const positiveCount = positiveWords.filter(word => context.includes(word)).length
    const negativeCount = negativeWords.filter(word => context.includes(word)).length
    
    if (positiveCount > negativeCount) return 'positive'
    if (negativeCount > positiveCount) return 'negative'
    return 'neutral'
  }

  const extractTitleFromContext = (text: string, url: string): string => {
    // Extract potential title from context around URL
    const urlIndex = text.indexOf(url)
    const beforeUrl = text.slice(Math.max(0, urlIndex - 200), urlIndex)
    const afterUrl = text.slice(urlIndex, urlIndex + 200)
    
    // Look for quoted strings or capitalized phrases
    const titleMatch = (beforeUrl + afterUrl).match(/"([^"]{10,100})"|([A-Z][^.]{10,100}?)(?=\.|:|\n)/g)
    return titleMatch ? titleMatch[0].replace(/"/g, '').trim() : `Content from ${new URL(url).hostname}`
  }

  const extractSnippetFromContext = (text: string, url: string): string => {
    const urlIndex = text.indexOf(url)
    const contextStart = Math.max(0, urlIndex - 150)
    const contextEnd = Math.min(text.length, urlIndex + 150)
    return text.slice(contextStart, contextEnd).trim()
  }

  const extractContextFromResponse = (text: string, url: string): string => {
    const urlIndex = text.indexOf(url)
    const sentenceStart = text.lastIndexOf('.', urlIndex - 1) + 1
    const sentenceEnd = text.indexOf('.', urlIndex + url.length)
    return text.slice(sentenceStart, sentenceEnd > -1 ? sentenceEnd + 1 : text.length).trim()
  }

  const getTrafficEstimate = (domain: string): number => {
    // Mock traffic estimates based on domain authority
    const authorityScore = getAuthorityScore(domain)
    return Math.floor(authorityScore * 10000 + Math.random() * 50000)
  }

  const getCategoryForDomain = (domain: string): string => {
    if (domain.includes('news') || domain.includes('reuters') || domain.includes('bloomberg')) return 'News'
    if (domain.includes('tech') || domain.includes('github')) return 'Technology'
    if (domain.includes('edu') || domain.includes('wikipedia')) return 'Education'
    if (domain.includes('gov')) return 'Government'
    return 'General'
  }

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'positive': return 'text-green-700 bg-green-50'
      case 'negative': return 'text-red-700 bg-red-50'
      default: return 'text-gray-700 bg-gray-50'
    }
  }

  const getAuthorityColor = (score: number) => {
    if (score >= 80) return 'text-green-700 bg-green-50'
    if (score >= 60) return 'text-yellow-700 bg-yellow-50'
    return 'text-red-700 bg-red-50'
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
    <div className={`space-y-6 ${className}`}>
      {/* Citation Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Link className="h-5 w-5 text-blue-500" />
              <div>
                <div className="text-2xl font-bold">{stats.totalCitations}</div>
                <div className="text-xs text-gray-500">Total Citations</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Award className="h-5 w-5 text-yellow-500" />
              <div>
                <div className="text-2xl font-bold">{Math.round(stats.avgAuthorityScore)}</div>
                <div className="text-xs text-gray-500">Avg Authority</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <TrendingUp className="h-5 w-5 text-green-500" />
              <div>
                <div className="text-2xl font-bold">{stats.highAuthorityCount}</div>
                <div className="text-xs text-gray-500">High Authority</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Search className="h-5 w-5 text-purple-500" />
              <div>
                <div className="text-2xl font-bold">{Math.round(stats.positiveSentimentRate)}%</div>
                <div className="text-xs text-gray-500">Positive Rate</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Citation Analysis */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Link className="h-5 w-5" />
                Citation Analysis
              </CardTitle>
              <CardDescription>
                Sources citing your brand across AI model responses
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <select 
                value={selectedTimeframe}
                onChange={(e) => setSelectedTimeframe(e.target.value as '7d' | '30d' | '90d')}
                className="text-sm border rounded px-2 py-1"
              >
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
              </select>
              <Button 
                onClick={runCitationExtraction}
                disabled={isExtracting}
                size="sm"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isExtracting ? 'animate-spin' : ''}`} />
                {isExtracting ? 'Extracting...' : 'Refresh'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {citations.slice(0, 20).map((citation) => (
              <div key={citation.id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <a 
                        href={citation.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-blue-600 hover:text-blue-800 flex items-center space-x-1"
                      >
                        <span className="truncate max-w-md">{citation.title}</span>
                        <ExternalLink className="h-3 w-3 flex-shrink-0" />
                      </a>
                    </div>
                    
                    <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                      {citation.snippet}
                    </p>

                    <div className="flex items-center space-x-4 text-xs">
                      <span className="text-gray-500">{citation.domain}</span>
                      <Badge variant="outline" className={getAuthorityColor(citation.authority_score)}>
                        DA: {Math.round(citation.authority_score)}
                      </Badge>
                      <Badge variant="outline" className={getSentimentColor(citation.sentiment)}>
                        {citation.sentiment}
                      </Badge>
                      <Badge variant="outline">
                        {citation.category}
                      </Badge>
                      {citation.ai_models.map(model => (
                        <Badge key={model} variant="secondary" className="text-xs">
                          {model}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="text-right ml-4">
                    <div className="text-sm font-semibold text-gray-900">
                      {Math.round(citation.relevance_score)}%
                    </div>
                    <div className="text-xs text-gray-500">relevance</div>
                    <Progress value={citation.relevance_score} className="w-16 h-1 mt-1" />
                  </div>
                </div>
              </div>
            ))}

            {citations.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <Link className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p>No citations found for the selected timeframe</p>
                <p className="text-sm">Try running a new extraction or selecting a different timeframe</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Top Domains Summary */}
      {stats.topDomains.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Top Citation Domains</CardTitle>
            <CardDescription>Most frequently cited sources</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.topDomains.map((domain, index) => (
                <div key={domain.domain} className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-6 h-6 bg-blue-100 rounded flex items-center justify-center text-xs font-medium text-blue-800">
                      {index + 1}
                    </div>
                    <span className="font-medium">{domain.domain}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-600">{domain.count} citations</span>
                    <Progress 
                      value={(domain.count / stats.topDomains[0].count) * 100} 
                      className="w-16 h-2"
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}