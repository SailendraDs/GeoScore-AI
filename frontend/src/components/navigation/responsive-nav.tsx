'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'
import { 
  Menu, 
  X, 
  Home, 
  BarChart3, 
  Users, 
  MessageSquare, 
  FileText,
  Settings,
  LogOut,
  Shield,
  ChevronDown,
  Plus
} from 'lucide-react'

interface User {
  id: string
  email: string
  role?: string
}

interface Brand {
  id: string
  name: string
}

export function ResponsiveNav() {
  const [isOpen, setIsOpen] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [brands, setBrands] = useState<Brand[]>([])
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null)
  const [showBrandMenu, setShowBrandMenu] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) return

      // Get user role
      const { data: userProfile } = await supabase
        .from('users')
        .select('role')
        .eq('id', authUser.id)
        .single()

      setUser({
        id: authUser.id,
        email: authUser.email || '',
        role: userProfile?.role || 'brand_user'
      })

      // Load user's brands
      const { data: userBrands } = await supabase
        .from('brands')
        .select('id, name')
        .eq('owner_id', authUser.id)
        .order('created_at', { ascending: false })

      setBrands(userBrands || [])
      if (userBrands && userBrands.length > 0 && !selectedBrand) {
        setSelectedBrand(userBrands[0])
      }
    }

    checkAuth()
  }, [selectedBrand])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const navigationItems = [
    { name: 'Dashboard', href: '/dashboard', icon: Home, adminOnly: false },
    { name: 'Reports', href: '/reports', icon: FileText, adminOnly: false },
    { name: 'Competitors', href: '/competitors', icon: Users, adminOnly: false },
    { name: 'Prompts', href: '/prompts', icon: MessageSquare, adminOnly: false },
    { name: 'Admin Panel', href: '/admin', icon: Shield, adminOnly: true }
  ]

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard' || pathname === '/'
    }
    return pathname?.startsWith(href)
  }

  const canAccessAdmin = user?.role && ['admin', 'super_admin'].includes(user.role)

  // Don't render navigation on auth pages
  if (pathname?.startsWith('/auth') || pathname?.startsWith('/onboard')) {
    return null
  }

  return (
    <>
      {/* Mobile Navigation */}
      <div className="lg:hidden">
        {/* Mobile Header */}
        <div className="bg-white shadow-sm border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setIsOpen(!isOpen)}
                className="p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100"
              >
                {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </button>
              <Link href="/dashboard" className="text-xl font-bold text-gray-900">
                GeoScore <span className="text-blue-600">AI</span>
              </Link>
            </div>
            
            {user && (
              <div className="flex items-center space-x-2">
                {canAccessAdmin && (
                  <Link href="/admin">
                    <Badge variant="destructive" className="text-xs">
                      <Shield className="h-3 w-3 mr-1" />
                      Admin
                    </Badge>
                  </Link>
                )}
                <button
                  onClick={() => setShowBrandMenu(!showBrandMenu)}
                  className="flex items-center space-x-1 px-2 py-1 text-sm bg-gray-100 rounded-md"
                >
                  <span className="truncate max-w-[100px]">
                    {selectedBrand?.name || 'No Brand'}
                  </span>
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>

          {/* Brand Selector Menu */}
          {showBrandMenu && (
            <div className="absolute top-16 right-4 z-50 bg-white border rounded-lg shadow-lg p-2 min-w-[200px]">
              <div className="space-y-1">
                {brands.map((brand) => (
                  <button
                    key={brand.id}
                    onClick={() => {
                      setSelectedBrand(brand)
                      setShowBrandMenu(false)
                    }}
                    className={`w-full text-left px-3 py-2 rounded text-sm hover:bg-gray-100 ${
                      selectedBrand?.id === brand.id ? 'bg-blue-50 text-blue-700' : ''
                    }`}
                  >
                    {brand.name}
                  </button>
                ))}
                <hr className="my-2" />
                <Link
                  href="/onboard"
                  onClick={() => setShowBrandMenu(false)}
                  className="flex items-center px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Brand
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Mobile Menu Overlay */}
        {isOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setIsOpen(false)} />
            <div className="fixed top-0 left-0 bottom-0 w-64 bg-white shadow-xl">
              <div className="px-4 py-6">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-lg font-semibold text-gray-900">Navigation</h2>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <nav className="space-y-2">
                  {navigationItems
                    .filter(item => !item.adminOnly || canAccessAdmin)
                    .map((item) => {
                      const Icon = item.icon
                      return (
                        <Link
                          key={item.name}
                          href={item.href}
                          onClick={() => setIsOpen(false)}
                          className={`flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                            isActive(item.href)
                              ? 'bg-blue-50 text-blue-700 border-r-4 border-blue-600'
                              : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                          }`}
                        >
                          <Icon className="mr-3 h-5 w-5" />
                          {item.name}
                        </Link>
                      )
                    })}
                </nav>

                {user && (
                  <div className="absolute bottom-0 left-0 right-0 p-4 border-t">
                    <div className="mb-3">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {user.email}
                      </p>
                      <Badge variant="secondary" className="mt-1 text-xs">
                        {user.role?.replace('_', ' ')}
                      </Badge>
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleSignOut}
                      className="w-full justify-start"
                      size="sm"
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      Sign Out
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Desktop Navigation */}
      <div className="hidden lg:flex">
        <div className="fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-lg border-r">
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center px-6 py-4 border-b">
              <Link href="/dashboard" className="text-xl font-bold text-gray-900">
                GeoScore <span className="text-blue-600">AI</span>
              </Link>
            </div>

            {/* Brand Selector */}
            {user && (
              <div className="px-6 py-4 border-b">
                <div className="relative">
                  <button
                    onClick={() => setShowBrandMenu(!showBrandMenu)}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm bg-gray-50 rounded-md hover:bg-gray-100 transition-colors"
                  >
                    <span className="truncate">
                      {selectedBrand?.name || 'Select Brand'}
                    </span>
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  
                  {showBrandMenu && (
                    <div className="absolute top-12 left-0 right-0 z-10 bg-white border rounded-lg shadow-lg p-2">
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {brands.map((brand) => (
                          <button
                            key={brand.id}
                            onClick={() => {
                              setSelectedBrand(brand)
                              setShowBrandMenu(false)
                            }}
                            className={`w-full text-left px-3 py-2 rounded text-sm hover:bg-gray-100 ${
                              selectedBrand?.id === brand.id ? 'bg-blue-50 text-blue-700' : ''
                            }`}
                          >
                            {brand.name}
                          </button>
                        ))}
                        <hr className="my-2" />
                        <Link
                          href="/onboard"
                          onClick={() => setShowBrandMenu(false)}
                          className="flex items-center px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Add New Brand
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Navigation Items */}
            <nav className="flex-1 px-6 py-4">
              <div className="space-y-2">
                {navigationItems
                  .filter(item => !item.adminOnly || canAccessAdmin)
                  .map((item) => {
                    const Icon = item.icon
                    return (
                      <Link
                        key={item.name}
                        href={item.href}
                        className={`flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                          isActive(item.href)
                            ? 'bg-blue-50 text-blue-700 border-r-4 border-blue-600'
                            : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                        }`}
                      >
                        <Icon className="mr-3 h-5 w-5" />
                        {item.name}
                        {item.adminOnly && (
                          <Shield className="ml-auto h-4 w-4 text-red-500" />
                        )}
                      </Link>
                    )
                  })}
              </div>
            </nav>

            {/* User Section */}
            {user && (
              <div className="px-6 py-4 border-t">
                <div className="mb-4">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {user.email}
                  </p>
                  <div className="flex items-center space-x-2 mt-1">
                    <Badge variant="secondary" className="text-xs">
                      {user.role?.replace('_', ' ')}
                    </Badge>
                    {canAccessAdmin && (
                      <Badge variant="destructive" className="text-xs">
                        <Shield className="h-3 w-3 mr-1" />
                        Admin
                      </Badge>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={handleSignOut}
                  className="w-full justify-start"
                  size="sm"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Main content area with left margin for sidebar */}
        <div className="pl-64 flex-1 min-h-screen">
          {/* This div provides the proper spacing for the sidebar */}
        </div>
      </div>
    </>
  )
}