'use client'
export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getCurrentUser, supabase } from '@/lib/supabase'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { 
  Users, 
  Activity, 
  DollarSign, 
  TrendingUp, 
  Shield, 
  AlertTriangle,
  CheckCircle,
  Server,
  Database,
  Zap,
  RefreshCw
} from 'lucide-react'

interface SystemStats {
  users: { total: number; growth: number }
  brands: { active: number; growth: number }
  reports: { total: number; recent: number }
  plans: Record<string, number>
  system: { uptime: string; error_rate: number; avg_response_time: string }
}

interface UserStat {
  id: string
  email: string
  role: string
  created_at: string
  last_active: string
  plan: string
  activity_count: number
  api_calls: number
  status: string
}

export default function AdminDashboard() {
  const [user, setUser] = useState<any>(null)
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null)
  const [userStats, setUserStats] = useState<UserStat[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'usage' | 'health'>('overview')
  const router = useRouter()

  useEffect(() => {
    initializeAdmin()
  }, [])

  const initializeAdmin = async () => {
    try {
      const currentUser = await getCurrentUser()
      if (!currentUser) {
        router.push('/auth/login')
        return
      }

      // Check if user has admin role
      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', currentUser.id)
        .single()

      if (!profile || profile.role !== 'admin') {
        router.push('/dashboard')
        return
      }

      setUser(currentUser)
      setIsAuthorized(true)
      await loadSystemStats()
      await loadUserStats()
    } catch (error) {
      console.error('Admin initialization error:', error)
      router.push('/dashboard')
    } finally {
      setIsLoading(false)
    }
  }

  const loadSystemStats = async () => {
    try {
      const { data } = await supabase.functions.invoke('admin-management', {
        body: { action: 'getSystemStats' }
      })
      
      if (data?.success) {
        setSystemStats(data.data)
      }
    } catch (error) {
      console.error('Error loading system stats:', error)
    }
  }

  const loadUserStats = async () => {
    try {
      const { data } = await supabase.functions.invoke('admin-management', {
        body: { 
          action: 'getUserStats',
          date_range: {
            from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            to: new Date().toISOString()
          }
        }
      })
      
      if (data?.success) {
        setUserStats(data.data.users || [])
      }
    } catch (error) {
      console.error('Error loading user stats:', error)
    }
  }

  const handleRefresh = async () => {
    setIsLoading(true)
    await Promise.all([loadSystemStats(), loadUserStats()])
    setIsLoading(false)
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading admin dashboard...</p>
        </div>
      </div>
    )
  }

  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Shield className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-600">You don't have admin privileges.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h1 className="text-2xl font-bold text-gray-900">
                <Shield className="h-6 w-6 inline mr-2 text-blue-600" />
                Admin Dashboard
              </h1>
              <Badge variant="secondary">GeoScore AI</Badge>
            </div>
            
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">
                Welcome, {user?.email}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              {[
                { id: 'overview', label: 'Overview', icon: Activity },
                { id: 'users', label: 'Users', icon: Users },
                { id: 'usage', label: 'Usage', icon: TrendingUp },
                { id: 'health', label: 'System Health', icon: Server }
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id as any)}
                  className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm ${
                    activeTab === id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && systemStats && (
          <div className="space-y-6">
            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{systemStats.users.total}</div>
                  <p className={`text-xs ${systemStats.users.growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {systemStats.users.growth >= 0 ? '+' : ''}{systemStats.users.growth}% from last month
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Brands</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{systemStats.brands.active}</div>
                  <p className={`text-xs ${systemStats.brands.growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {systemStats.brands.growth >= 0 ? '+' : ''}{systemStats.brands.growth}% from last month
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Reports</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{systemStats.reports.total}</div>
                  <p className="text-xs text-muted-foreground">
                    {systemStats.reports.recent} generated this week
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">System Health</CardTitle>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">{systemStats.system.uptime}</div>
                  <p className="text-xs text-muted-foreground">
                    {systemStats.system.avg_response_time} avg response
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Plan Distribution */}
            <Card>
              <CardHeader>
                <CardTitle>Plan Distribution</CardTitle>
                <CardDescription>Current user subscription breakdown</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {Object.entries(systemStats.plans).map(([planName, count]) => {
                    const total = Object.values(systemStats.plans).reduce((a, b) => a + b, 0)
                    const percentage = total > 0 ? (count / total) * 100 : 0
                    return (
                      <div key={planName} className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="font-medium">{planName}</div>
                          <Badge variant="outline">{count} users</Badge>
                        </div>
                        <div className="flex items-center space-x-2">
                          <div className="w-32">
                            <Progress value={percentage} className="h-2" />
                          </div>
                          <span className="text-sm text-gray-500 w-12">
                            {Math.round(percentage)}%
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>User Management</CardTitle>
                <CardDescription>Manage users, plans, and access levels</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {userStats.slice(0, 20).map((user) => (
                    <div key={user.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3">
                          <div>
                            <div className="font-medium">{user.email}</div>
                            <div className="text-sm text-gray-500">
                              ID: {user.id.slice(0, 8)}... • 
                              Role: {user.role} • 
                              Plan: {user.plan}
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-4">
                        <div className="text-right text-sm">
                          <div className="font-medium">{user.activity_count} activities</div>
                          <div className="text-gray-500">{user.api_calls} API calls</div>
                        </div>
                        <Badge 
                          variant={user.status === 'active' ? 'success' : 'secondary'}
                        >
                          {user.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'usage' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>API Usage</CardTitle>
                  <CardDescription>Last 30 days</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="text-3xl font-bold">12,450</div>
                    <div className="text-sm text-gray-500">Total API calls</div>
                    <Progress value={75} className="h-2" />
                    <div className="text-xs text-gray-500">75% of monthly limit</div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>LLM Costs</CardTitle>
                  <CardDescription>Monthly spending breakdown</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="text-3xl font-bold">$2,847</div>
                    <div className="text-sm text-gray-500">This month</div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>OpenAI GPT-4</span>
                        <span>$1,245</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Claude Opus</span>
                        <span>$987</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Gemini Pro</span>
                        <span>$615</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {activeTab === 'health' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Database className="h-5 w-5" />
                    <span>Database</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center space-x-2">
                    <CheckCircle className="h-5 w-5 text-green-500" />
                    <span className="font-medium text-green-600">Healthy</span>
                  </div>
                  <div className="text-sm text-gray-500 mt-2">
                    Response time: 12ms
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Zap className="h-5 w-5" />
                    <span>Edge Functions</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center space-x-2">
                    <CheckCircle className="h-5 w-5 text-green-500" />
                    <span className="font-medium text-green-600">Active</span>
                  </div>
                  <div className="text-sm text-gray-500 mt-2">
                    12 functions deployed
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Server className="h-5 w-5" />
                    <span>External APIs</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center space-x-2">
                    <AlertTriangle className="h-5 w-5 text-yellow-500" />
                    <span className="font-medium text-yellow-600">Warning</span>
                  </div>
                  <div className="text-sm text-gray-500 mt-2">
                    1 service degraded
                  </div>
                </CardContent>
              </Card>
            </div>

            {systemStats && systemStats.system.error_rate > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-red-600">Recent Errors</CardTitle>
                  <CardDescription>Issues requiring attention</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-gray-600">
                    {systemStats.system.error_rate} errors in the last 24 hours
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  )
}