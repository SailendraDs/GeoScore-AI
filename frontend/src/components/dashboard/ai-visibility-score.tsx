'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { formatScore, getScoreColor, getScoreBgColor } from "@/lib/utils"
import { AIVisibilityScore } from "@/lib/supabase"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"

interface AIVisibilityScoreProps {
  score: AIVisibilityScore
  previousScore?: number
  className?: string
}

export function AIVisibilityScoreDisplay({ score, previousScore, className }: AIVisibilityScoreProps) {
  const trend = previousScore ? score.total_score - previousScore : 0
  const trendColor = trend > 0 ? "text-green-600" : trend < 0 ? "text-red-600" : "text-gray-600"
  
  const TrendIcon = trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : Minus

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          AI Visibility Score™
          <div className="flex items-center space-x-2">
            <TrendIcon className={`h-4 w-4 ${trendColor}`} />
            <span className={`text-sm font-medium ${trendColor}`}>
              {trend > 0 ? '+' : ''}{formatScore(trend)}
            </span>
          </div>
        </CardTitle>
        <CardDescription>
          Your brand's visibility across AI engines ({score.engine})
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Main Score */}
          <div className="text-center">
            <div className={`inline-flex items-center justify-center w-24 h-24 rounded-full ${getScoreBgColor(score.total_score)} border-4 border-white shadow-lg`}>
              <span className={`text-2xl font-bold ${getScoreColor(score.total_score)}`}>
                {formatScore(score.total_score)}
              </span>
            </div>
            <p className="mt-2 text-sm text-gray-600">Overall AI Visibility Score</p>
          </div>

          {/* Component Breakdown */}
          <div className="space-y-4">
            <h4 className="font-medium text-gray-900">Score Components</h4>
            
            <ScoreComponent
              label="Prompt Share of Voice"
              value={score.prompt_sov}
              weight={30}
              description="Brand mentions vs competitors"
            />
            
            <ScoreComponent
              label="Generative Appearance"
              value={score.generative_appearance}
              weight={20}
              description="Appearance rate in AI responses"
            />
            
            <ScoreComponent
              label="Citation Authority"
              value={score.citation_authority}
              weight={15}
              description="Quality of cited sources"
            />
            
            <ScoreComponent
              label="Answer Quality"
              value={score.answer_quality}
              weight={10}
              description="Response quality metrics"
            />
            
            <ScoreComponent
              label="Voice Presence"
              value={score.voice_presence}
              weight={5}
              description="Voice assistant mentions"
            />
            
            <ScoreComponent
              label="AI Traffic"
              value={score.ai_traffic}
              weight={10}
              description="Traffic from AI referrals"
            />
            
            <ScoreComponent
              label="AI Conversions"
              value={score.ai_conversions}
              weight={10}
              description="Conversions from AI traffic"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

interface ScoreComponentProps {
  label: string
  value: number
  weight: number
  description: string
}

function ScoreComponent({ label, value, weight, description }: ScoreComponentProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center space-x-2">
          <span className="font-medium">{label}</span>
          <span className="text-gray-500">({weight}%)</span>
        </div>
        <span className={`font-medium ${getScoreColor(value)}`}>
          {formatScore(value)}/100
        </span>
      </div>
      <Progress value={value} className="h-2" />
      <p className="text-xs text-gray-500">{description}</p>
    </div>
  )
}

interface MultiEngineScoresProps {
  scores: AIVisibilityScore[]
  className?: string
}

export function MultiEngineScores({ scores, className }: MultiEngineScoresProps) {
  const engines = ['gpt-4o', 'claude-opus', 'gemini-pro', 'perplexity-online']
  
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Multi-Engine Performance</CardTitle>
        <CardDescription>
          Your AI Visibility Score across different AI engines
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {engines.map((engine) => {
            const score = scores.find(s => s.engine === engine)
            const displayScore = score?.total_score || 0
            
            return (
              <div key={engine} className="p-4 border rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <EngineIcon engine={engine} />
                    <span className="font-medium capitalize">
                      {engine.replace('-', ' ')}
                    </span>
                  </div>
                  <span className={`text-lg font-bold ${getScoreColor(displayScore)}`}>
                    {formatScore(displayScore)}
                  </span>
                </div>
                <Progress value={displayScore} className="h-2" />
                <p className="text-xs text-gray-500 mt-1">
                  {score ? `Last updated: ${new Date(score.created_at).toLocaleDateString()}` : 'No data'}
                </p>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function EngineIcon({ engine }: { engine: string }) {
  const iconMap: Record<string, string> = {
    'gpt-4o': '🤖',
    'claude-opus': '🎭', 
    'gemini-pro': '♊',
    'perplexity-online': '🔍'
  }
  
  return (
    <span className="text-lg">
      {iconMap[engine] || '🧠'}
    </span>
  )
}