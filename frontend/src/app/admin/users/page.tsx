'use client'
export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { supabase, getCurrentUser } from '@/lib/supabase'
import { 
  Users, 
  Search, 
  Edit, 
  Trash2, 
  Shield, 
  Key,
  Mail,
  RotateCcw,
  Ban,
  CheckCircle,
  AlertCircle,
  Plus,
  Eye,
  Settings
} from 'lucide-react'

interface User {
  id: string
  email: string
  role: 'brand_user' | 'admin' | 'super_admin'
  created_at: string
  last_sign_in_at?: string
  email_confirmed_at?: string
  profile?: {
    full_name?: string
    company_name?: string
    industry?: string
  }
  subscription?: {
    plan: string
    status: string
    expires_at?: string
  }
  brands_count: number
  reports_count: number
  api_calls_count: number
  status: 'active' | 'suspended' | 'pending_verification'
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRole, setSelectedRole] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<string>('all')
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [showPasswordReset, setShowPasswordReset] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [currentAdmin, setCurrentAdmin] = useState<any>(null)
  const router = useRouter()

  const roles = ['brand_user', 'admin', 'super_admin']
  const statuses = ['active', 'suspended', 'pending_verification']

  useEffect(() => {
    const checkAdminAuth = async () => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          router.push('/auth/login')
          return
        }

        // Check admin privileges
        const { data: profile } = await supabase
          .from('users')
          .select('role')
          .eq('id', user.id)
          .single()

        if (!profile || !['admin', 'super_admin'].includes(profile.role)) {
          router.push('/dashboard')
          return
        }

        setCurrentAdmin(user)
        await loadUsers()
      } catch (error) {
        console.error('Admin auth error:', error)
        router.push('/dashboard')
      } finally {
        setIsLoading(false)
      }
    }

    checkAdminAuth()
  }, [router])

  const loadUsers = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('admin-management', {
        body: { 
          action: 'getAllUsers',
          include_stats: true 
        }
      })

      if (error) throw error

      if (data?.success) {
        setUsers(data.data.users || [])
      }
    } catch (error: any) {
      setError('Failed to load users: ' + (error.message || 'Unknown error'))
    }
  }

  const handleUpdateUser = async (userId: string, updates: Partial<User>) => {
    try {
      const { data, error } = await supabase.functions.invoke('admin-management', {
        body: {
          action: 'updateUser',
          userId,
          updates
        }
      })

      if (error) throw error

      if (data?.success) {
        setUsers(prev => prev.map(user => 
          user.id === userId ? { ...user, ...updates } : user
        ))
        setEditingUser(null)
        setSuccessMessage('User updated successfully')
        setTimeout(() => setSuccessMessage(''), 3000)
      }
    } catch (error: any) {
      setError('Failed to update user: ' + (error.message || 'Unknown error'))
    }
  }

  const handleSuspendUser = async (userId: string, suspend: boolean) => {
    if (!confirm(`Are you sure you want to ${suspend ? 'suspend' : 'reactivate'} this user?`)) return

    try {
      const { data, error } = await supabase.functions.invoke('admin-management', {
        body: {
          action: 'suspendUser',
          userId,
          suspend
        }
      })

      if (error) throw error

      if (data?.success) {
        setUsers(prev => prev.map(user => 
          user.id === userId 
            ? { ...user, status: suspend ? 'suspended' : 'active' } 
            : user
        ))
        setSuccessMessage(`User ${suspend ? 'suspended' : 'reactivated'} successfully`)
        setTimeout(() => setSuccessMessage(''), 3000)
      }
    } catch (error: any) {
      setError(`Failed to ${suspend ? 'suspend' : 'reactivate'} user: ` + (error.message || 'Unknown error'))
    }
  }

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) return

    try {
      const { data, error } = await supabase.functions.invoke('admin-management', {
        body: {
          action: 'deleteUser',
          userId
        }
      })

      if (error) throw error

      if (data?.success) {
        setUsers(prev => prev.filter(user => user.id !== userId))
        setSuccessMessage('User deleted successfully')
        setTimeout(() => setSuccessMessage(''), 3000)
      }
    } catch (error: any) {
      setError('Failed to delete user: ' + (error.message || 'Unknown error'))
    }
  }

  const handlePasswordReset = async (userId: string, email: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('admin-management', {
        body: {
          action: 'resetUserPassword',
          userId,
          email,
          sendEmail: true
        }
      })

      if (error) throw error

      if (data?.success) {
        setShowPasswordReset(null)
        setSuccessMessage('Password reset email sent successfully')
        setTimeout(() => setSuccessMessage(''), 3000)
      }
    } catch (error: any) {
      setError('Failed to send password reset: ' + (error.message || 'Unknown error'))
    }
  }

  const handleResendVerification = async (userId: string, email: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('admin-management', {
        body: {
          action: 'resendVerificationEmail',
          userId,
          email
        }
      })

      if (error) throw error

      if (data?.success) {
        setSuccessMessage('Verification email sent successfully')
        setTimeout(() => setSuccessMessage(''), 3000)
      }
    } catch (error: any) {
      setError('Failed to send verification email: ' + (error.message || 'Unknown error'))
    }
  }

  const handleImpersonateUser = async (userId: string) => {
    if (!confirm('Are you sure you want to impersonate this user? This will log you in as them.')) return

    try {
      const { data, error } = await supabase.functions.invoke('admin-management', {
        body: {
          action: 'impersonateUser',
          userId,
          adminId: currentAdmin.id
        }
      })

      if (error) throw error

      if (data?.success) {
        // Store impersonation state in localStorage
        localStorage.setItem('admin_impersonation', JSON.stringify({
          adminId: currentAdmin.id,
          impersonatedUserId: userId,
          timestamp: new Date().toISOString()
        }))

        // Redirect to user's dashboard
        router.push('/dashboard')
      }
    } catch (error: any) {
      setError('Failed to impersonate user: ' + (error.message || 'Unknown error'))
    }
  }

  const filteredUsers = users.filter(user => {
    const matchesSearch = 
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.profile?.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.profile?.company_name?.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesRole = selectedRole === 'all' || user.role === selectedRole
    const matchesStatus = selectedStatus === 'all' || user.status === selectedStatus

    return matchesSearch && matchesRole && matchesStatus
  })

  const getRoleBadge = (role: string) => {
    const variants: Record<string, any> = {
      super_admin: 'destructive',
      admin: 'default',
      brand_user: 'secondary'
    }
    return variants[role] || 'secondary'
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      active: 'success',
      suspended: 'destructive',
      pending_verification: 'warning'
    }
    return variants[status] || 'secondary'
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return <CheckCircle className="h-4 w-4" />
      case 'suspended': return <Ban className="h-4 w-4" />
      case 'pending_verification': return <AlertCircle className="h-4 w-4" />
      default: return <AlertCircle className="h-4 w-4" />
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading users...</p>
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
              <div className="flex items-center space-x-2">
                <Button variant="outline" onClick={() => router.push('/admin')}>
                  ← Back to Admin
                </Button>
                <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
              </div>
              <p className="text-gray-600">Manage users, roles, and permissions</p>
            </div>
            <Button onClick={() => router.push('/admin/users/invite')}>
              <Plus className="h-4 w-4 mr-2" />
              Invite User
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Filters */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Filters & Search</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Search Users</Label>
                <div className="relative">
                  <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
                  <Input
                    placeholder="Search by email, name, company..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Filter by Role</Label>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Roles</option>
                  {roles.map(role => (
                    <option key={role} value={role}>
                      {role.replace('_', ' ').split(' ').map(word => 
                        word.charAt(0).toUpperCase() + word.slice(1)
                      ).join(' ')}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label>Filter by Status</Label>
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Statuses</option>
                  {statuses.map(status => (
                    <option key={status} value={status}>
                      {status.replace('_', ' ').split(' ').map(word => 
                        word.charAt(0).toUpperCase() + word.slice(1)
                      ).join(' ')}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label>Quick Actions</Label>
                <Button variant="outline" onClick={loadUsers} className="w-full">
                  Refresh Data
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Messages */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md flex items-center">
            <AlertCircle className="h-4 w-4 mr-2" />
            {error}
            <Button variant="ghost" onClick={() => setError('')} className="ml-auto p-1">
              ×
            </Button>
          </div>
        )}

        {successMessage && (
          <div className="mb-4 bg-green-50 border border-green-200 text-green-600 px-4 py-3 rounded-md flex items-center">
            <CheckCircle className="h-4 w-4 mr-2" />
            {successMessage}
            <Button variant="ghost" onClick={() => setSuccessMessage('')} className="ml-auto p-1">
              ×
            </Button>
          </div>
        )}

        {/* Users Table */}
        <Card>
          <CardHeader>
            <CardTitle>
              Users ({filteredUsers.length})
            </CardTitle>
            <CardDescription>
              Showing {filteredUsers.length} of {users.length} users
            </CardDescription>
          </CardHeader>
          <CardContent>
            {filteredUsers.length === 0 ? (
              <div className="text-center py-8">
                <Users className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">No users found matching your criteria</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredUsers.map((user) => (
                  <div key={user.id} className="border rounded-lg p-4 hover:shadow-lg transition-shadow">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-2">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2">
                              <h3 className="font-medium text-gray-900">
                                {user.profile?.full_name || user.email}
                              </h3>
                              <Badge variant={getRoleBadge(user.role)}>
                                {user.role.replace('_', ' ')}
                              </Badge>
                              <Badge variant={getStatusBadge(user.status)}>
                                {getStatusIcon(user.status)}
                                {user.status.replace('_', ' ')}
                              </Badge>
                            </div>
                            <p className="text-sm text-gray-600">{user.email}</p>
                            {user.profile?.company_name && (
                              <p className="text-sm text-gray-500">{user.profile.company_name}</p>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3 text-sm">
                          <div>
                            <span className="font-medium">Brands:</span> {user.brands_count}
                          </div>
                          <div>
                            <span className="font-medium">Reports:</span> {user.reports_count}
                          </div>
                          <div>
                            <span className="font-medium">API Calls:</span> {user.api_calls_count}
                          </div>
                          <div>
                            <span className="font-medium">Joined:</span> {new Date(user.created_at).toLocaleDateString()}
                          </div>
                        </div>

                        {user.subscription && (
                          <div className="mt-2 text-sm">
                            <span className="font-medium">Plan:</span> {user.subscription.plan} 
                            <Badge variant="outline" className="ml-2">
                              {user.subscription.status}
                            </Badge>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center space-x-2">
                        {user.status === 'pending_verification' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleResendVerification(user.id, user.email)}
                          >
                            <Mail className="h-4 w-4 mr-1" />
                            Resend Verification
                          </Button>
                        )}
                        
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowPasswordReset(user.id)}
                        >
                          <RotateCcw className="h-4 w-4 mr-1" />
                          Reset Password
                        </Button>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleImpersonateUser(user.id)}
                          disabled={user.role === 'super_admin'}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          Impersonate
                        </Button>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingUser(user)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSuspendUser(user.id, user.status !== 'suspended')}
                          disabled={user.role === 'super_admin'}
                        >
                          {user.status === 'suspended' ? (
                            <CheckCircle className="h-4 w-4" />
                          ) : (
                            <Ban className="h-4 w-4" />
                          )}
                        </Button>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteUser(user.id)}
                          disabled={user.role === 'super_admin'}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Edit User Modal */}
        {editingUser && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <Card className="max-w-md w-full">
              <CardHeader>
                <CardTitle>Edit User</CardTitle>
                <CardDescription>Update user role and permissions</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={editingUser.email} disabled />
                </div>

                <div className="space-y-2">
                  <Label>Role</Label>
                  <select
                    value={editingUser.role}
                    onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {roles.map(role => (
                      <option key={role} value={role}>
                        {role.replace('_', ' ').split(' ').map(word => 
                          word.charAt(0).toUpperCase() + word.slice(1)
                        ).join(' ')}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label>Status</Label>
                  <select
                    value={editingUser.status}
                    onChange={(e) => setEditingUser({ ...editingUser, status: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {statuses.map(status => (
                      <option key={status} value={status}>
                        {status.replace('_', ' ').split(' ').map(word => 
                          word.charAt(0).toUpperCase() + word.slice(1)
                        ).join(' ')}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button variant="outline" onClick={() => setEditingUser(null)} className="flex-1">
                    Cancel
                  </Button>
                  <Button 
                    onClick={() => handleUpdateUser(editingUser.id, {
                      role: editingUser.role,
                      status: editingUser.status
                    })}
                    className="flex-1"
                  >
                    Update User
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Password Reset Modal */}
        {showPasswordReset && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <Card className="max-w-md w-full">
              <CardHeader>
                <CardTitle>Reset User Password</CardTitle>
                <CardDescription>Send password reset email to user</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    This will send a password reset email to the user. They will receive a secure link
                    to create a new password.
                  </p>
                  
                  <div className="flex gap-3 pt-4">
                    <Button variant="outline" onClick={() => setShowPasswordReset(null)} className="flex-1">
                      Cancel
                    </Button>
                    <Button 
                      onClick={() => {
                        const user = users.find(u => u.id === showPasswordReset)
                        if (user) handlePasswordReset(user.id, user.email)
                      }}
                      className="flex-1"
                    >
                      Send Reset Email
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}