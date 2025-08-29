'use client'
export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { supabase } from '@/lib/supabase'
import { 
  ArrowLeft, 
  Download, 
  Share, 
  Calendar, 
  Clock,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Eye,
  Brain,
  Zap,
  Target,
  Globe,
  RefreshCw
} from 'lucide-react'

interface ReportDetails {
  id: string
  brand_id: string
  brand_name: string
  model_name: string
  report_type: string
  raw_score: number
  normalized_score: number
  confidence: number
  analysis_text: string
  methodology: any
  evidence_refs: any[]
  generated_at: string
  expires_at: string
}

interface BrandInfo {
  id: string
  name: string
  domain: string
  description: string
  competitors: string[]
}

export default function ReportDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [report, setReport] = useState<ReportDetails | null>(null)
  const [brand, setBrand] = useState<BrandInfo | null>(null)
  const [relatedReports, setRelatedReports] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const loadReportData = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          router.push('/auth/login')
          return
        }

        // Load report details
        const { data: reportData, error: reportError } = await supabase
          .from('llm_reports')
          .select(`
            *,
            brands!inner(id, name, domain, description, competitors, owner_id)
          `)
          .eq('id', params.id)
          .eq('brands.owner_id', user.id)
          .single()

        if (reportError) throw reportError

        const reportDetails: ReportDetails = {
          ...reportData,
          brand_name: reportData.brands.name
        }

        setReport(reportDetails)
        setBrand(reportData.brands)

        // Load related reports for the same brand
        const { data: relatedData } = await supabase
          .from('llm_reports')
          .select('id, model_name, raw_score, generated_at, report_type')
          .eq('brand_id', reportData.brand_id)
          .neq('id', params.id)
          .order('generated_at', { ascending: false })
          .limit(5)

        setRelatedReports(relatedData || [])

      } catch (error: any) {
        console.error('Error loading report:', error)
        setError(error.message || 'Failed to load report')
      } finally {
        setIsLoading(false)
      }
    }

    if (params.id) {
      loadReportData()
    }
  }, [params.id, router])

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600'
    if (score >= 60) return 'text-yellow-600'
    return 'text-red-600'
  }

  const getScoreBgColor = (score: number) => {
    if (score >= 80) return 'bg-green-100'
    if (score >= 60) return 'bg-yellow-100'
    return 'bg-red-100'
  }

  const formatModelName = (model: string) => {
    return model.split('-').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ')
  }

  const downloadReport = async () => {
    // Implement PDF/JSON download functionality
    console.log('Download report:', report?.id)
  }

  const shareReport = async () => {
    if (navigator.share) {
      await navigator.share({
        title: `${report?.brand_name} - AI Visibility Report`,
        text: `AI visibility report for ${report?.brand_name} using ${formatModelName(report?.model_name || '')}`,
        url: window.location.href
      })
    } else {
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(window.location.href)
      alert('Report link copied to clipboard!')
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading report details...</p>
        </div>
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-8">
            <div className="text-red-500 mb-4">
              <BarChart3 className="h-16 w-16 mx-auto mb-4" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Report Not Found</h3>
            <p className="text-gray-600 mb-4">
              {error || 'The report you\'re looking for doesn\'t exist or you don\'t have permission to view it.'}
            </p>
            <Button onClick={() => router.push('/reports')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Reports
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Button variant="outline" onClick={() => router.push('/reports')}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Reports
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {report.brand_name} - AI Visibility Report
                </h1>
                <p className="text-gray-600">
                  {formatModelName(report.model_name)} • {report.report_type} • 
                  {new Date(report.generated_at).toLocaleDateString()}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={shareReport}>
                <Share className="h-4 w-4 mr-2" />
                Share
              </Button>
              <Button variant="outline" onClick={downloadReport}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Score Overview */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Target className="h-6 w-6 mr-2 text-blue-600" />
                  Visibility Score
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between mb-6">
                  <div className="text-center">
                    <div className={`inline-flex items-center justify-center w-24 h-24 rounded-full ${getScoreBgColor(report.raw_score)} border-4 border-white shadow-lg`}>
                      <span className={`text-3xl font-bold ${getScoreColor(report.raw_score)}`}>
                        {Math.round(report.raw_score)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-gray-600">Raw Score</p>
                  </div>
                  
                  <div className="text-center">
                    <div className={`inline-flex items-center justify-center w-24 h-24 rounded-full ${getScoreBgColor(report.normalized_score || 0)} border-4 border-white shadow-lg`}>
                      <span className={`text-3xl font-bold ${getScoreColor(report.normalized_score || 0)}`}>
                        {Math.round(report.normalized_score || 0)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-gray-600">Normalized Score</p>
                  </div>
                  
                  <div className="text-center">
                    <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-blue-100 border-4 border-white shadow-lg">
                      <span className="text-3xl font-bold text-blue-600">
                        {Math.round((report.confidence || 0) * 100)}%
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-gray-600">Confidence</p>
                  </div>
                </div>

                {/* Score breakdown if available in methodology */}
                {report.methodology?.breakdown && (
                  <div className="space-y-4">
                    <h4 className="font-medium text-gray-900">Score Breakdown</h4>
                    {Object.entries(report.methodology.breakdown).map(([key, value]: [string, any]) => (
                      <div key={key} className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="capitalize">{key.replace('_', ' ')}</span>
                          <span>{Math.round(value * 100)}/100</span>
                        </div>
                        <Progress value={value * 100} className="h-2" />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Analysis */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Brain className="h-6 w-6 mr-2 text-purple-600" />
                  AI Analysis
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose max-w-none">
                  {report.analysis_text ? (
                    <div className="text-gray-700 leading-relaxed">
                      {report.analysis_text.split('\n').map((paragraph, index) => (
                        <p key={index} className="mb-4">
                          {paragraph}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 italic">No detailed analysis available for this report.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Evidence References */}
            {report.evidence_refs && report.evidence_refs.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Eye className="h-6 w-6 mr-2 text-green-600" />
                    Evidence & Sources
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {report.evidence_refs.map((evidence, index) => (
                      <div key={index} className="border-l-4 border-blue-500 pl-4">
                        <p className="text-sm text-gray-700">{evidence.text || evidence.content}</p>
                        {evidence.source && (
                          <p className="text-xs text-blue-600 mt-1">
                            Source: {evidence.source}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Methodology */}
            {report.methodology && Object.keys(report.methodology).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Zap className="h-6 w-6 mr-2 text-yellow-600" />
                    Methodology
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <pre className="text-sm text-gray-700 whitespace-pre-wrap">
                      {JSON.stringify(report.methodology, null, 2)}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Brand Info */}
            {brand && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Globe className="h-5 w-5 mr-2" />
                    Brand Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="font-medium text-gray-900">{brand.name}</h4>
                    <p className="text-sm text-blue-600">{brand.domain}</p>
                  </div>
                  
                  {brand.description && (
                    <div>
                      <h5 className="text-sm font-medium text-gray-700 mb-1">Description</h5>
                      <p className="text-sm text-gray-600">{brand.description}</p>
                    </div>
                  )}

                  {brand.competitors && brand.competitors.length > 0 && (
                    <div>
                      <h5 className="text-sm font-medium text-gray-700 mb-2">Competitors</h5>
                      <div className="flex flex-wrap gap-1">
                        {brand.competitors.map((competitor, index) => (
                          <Badge key={index} variant="outline" className="text-xs">
                            {competitor}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Report Metadata */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Calendar className="h-5 w-5 mr-2" />
                  Report Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Model</span>
                  <Badge>{formatModelName(report.model_name)}</Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Type</span>
                  <Badge variant="outline">{report.report_type}</Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Generated</span>
                  <span>{new Date(report.generated_at).toLocaleString()}</span>
                </div>
                {report.expires_at && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Expires</span>
                    <span>{new Date(report.expires_at).toLocaleDateString()}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Related Reports */}
            {relatedReports.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Related Reports</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {relatedReports.map((relatedReport) => (
                      <div 
                        key={relatedReport.id}
                        onClick={() => router.push(`/reports/${relatedReport.id}`)}
                        className="p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <p className="font-medium text-sm">
                              {formatModelName(relatedReport.model_name)}
                            </p>
                            <p className="text-xs text-gray-500">
                              {new Date(relatedReport.generated_at).toLocaleDateString()}
                            </p>
                          </div>
                          <Badge 
                            variant={relatedReport.raw_score >= 80 ? 'default' : 
                                   relatedReport.raw_score >= 60 ? 'secondary' : 'destructive'}
                            className="text-xs"
                          >
                            {Math.round(relatedReport.raw_score)}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Actions */}
            <Card>
              <CardHeader>
                <CardTitle>Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button 
                  onClick={() => router.push(`/reports/generate?brandId=${report.brand_id}&model=${report.model_name}`)}
                  className="w-full"
                  variant="outline"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Generate New Report
                </Button>
                <Button 
                  onClick={() => router.push(`/dashboard?brandId=${report.brand_id}`)}
                  className="w-full"
                  variant="outline"
                >
                  <BarChart3 className="h-4 w-4 mr-2" />
                  View Dashboard
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}