'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    const checkUser = async () => {
      const user = await getCurrentUser()
      if (user) {
        router.push('/dashboard')
      }
    }
    checkUser()
  }, [router])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center max-w-4xl mx-auto">
          {/* Hero Section */}
          <div className="mb-12">
            <h1 className="text-6xl font-bold text-gray-900 mb-6">
              GeoScore <span className="text-blue-600">AI</span>
            </h1>
            <h2 className="text-2xl text-gray-600 mb-8">
              AI-Powered Brand Visibility Platform
            </h2>
            <p className="text-xl text-gray-700 mb-8 leading-relaxed">
              Track your brand's visibility across AI engines like ChatGPT, Claude, Gemini, and Perplexity. 
              Get actionable insights to improve your AI SEO and dominate the future of search.
            </p>
          </div>

          {/* Key Features */}
          <div className="grid md:grid-cols-3 gap-8 mb-12">
            <div className="p-6 bg-white rounded-lg shadow-sm border">
              <div className="text-3xl mb-4">🎯</div>
              <h3 className="text-xl font-semibold mb-2">AI Visibility Score™</h3>
              <p className="text-gray-600">
                Industry-first algorithm measuring your brand presence across 5+ AI engines
              </p>
            </div>
            <div className="p-6 bg-white rounded-lg shadow-sm border">
              <div className="text-3xl mb-4">🤖</div>
              <h3 className="text-xl font-semibold mb-2">Multi-LLM Analysis</h3>
              <p className="text-gray-600">
                Track mentions across ChatGPT, Claude, Gemini, Perplexity, and more
              </p>
            </div>
            <div className="p-6 bg-white rounded-lg shadow-sm border">
              <div className="text-3xl mb-4">📈</div>
              <h3 className="text-xl font-semibold mb-2">Competitive Intelligence</h3>
              <p className="text-gray-600">
                Discover how you compare to competitors in AI responses
              </p>
            </div>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <Button asChild size="lg" className="text-lg px-8 py-6">
              <Link href="/auth/signup">Start Free Analysis</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="text-lg px-8 py-6">
              <Link href="/auth/login">Login to Dashboard</Link>
            </Button>
          </div>

          {/* Social Proof */}
          <div className="bg-white p-8 rounded-lg shadow-sm border">
            <h3 className="text-lg font-semibold mb-4">Trusted by Brands Worldwide</h3>
            <div className="flex flex-wrap justify-center items-center gap-8 opacity-60">
              <div className="text-2xl font-bold">TechCorp</div>
              <div className="text-2xl font-bold">InnovateLabs</div>
              <div className="text-2xl font-bold">GrowthCo</div>
              <div className="text-2xl font-bold">ScaleUp</div>
            </div>
          </div>

          {/* Features List */}
          <div className="mt-16 grid md:grid-cols-2 gap-8 text-left">
            <div>
              <h3 className="text-xl font-semibold mb-4">Advanced Analytics</h3>
              <ul className="space-y-2 text-gray-700">
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  Real-time brand mention tracking
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  Citation authority analysis
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  Prompt performance insights
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  Historical trend analysis
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-xl font-semibold mb-4">Enterprise Features</h3>
              <ul className="space-y-2 text-gray-700">
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  Multi-brand management
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  Team collaboration tools
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  Custom reporting dashboards
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  API access for integrations
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}