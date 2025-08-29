'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle, XCircle } from 'lucide-react'

type AuthStatus = 'loading' | 'success' | 'error' | 'expired'

function AuthCallbackPageWithSearchParams() {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [message, setMessage] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Handle the auth callback
        const { data, error } = await supabase.auth.getSession()

        if (error) {
          console.error('Auth callback error:', error)
          setStatus('error')
          setMessage(error.message || 'Authentication failed')
          return
        }

        // Check for specific auth events
        const type = searchParams.get('type')
        const accessToken = searchParams.get('access_token')
        const refreshToken = searchParams.get('refresh_token')

        if (type === 'recovery' && accessToken) {
          // Password recovery flow
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || ''
          })

          if (sessionError) {
            setStatus('error')
            setMessage('Invalid or expired reset link')
            return
          }

          setStatus('success')
          setMessage('Password reset link verified. Redirecting to set new password...')
          setTimeout(() => {
            router.push('/auth/update-password')
          }, 2000)
          return
        }

        if (type === 'signup' || type === 'invite') {
          // Email confirmation
          if (data.session) {
            setStatus('success')
            setMessage('Email verified successfully! Redirecting to dashboard...')
            setTimeout(() => {
              router.push('/dashboard')
            }, 2000)
          } else {
            setStatus('error')
            setMessage('Email verification failed or link has expired')
          }
          return
        }

        // OAuth callback (Google, GitHub, etc.)
        if (data.session) {
          setStatus('success')
          setMessage('Login successful! Redirecting to dashboard...')
          setTimeout(() => {
            router.push('/dashboard')
          }, 1500)
        } else {
          setStatus('error')
          setMessage('Authentication failed. Please try again.')
        }

      } catch (error: any) {
        console.error('Auth callback error:', error)
        setStatus('error')
        setMessage(error.message || 'An unexpected error occurred')
      }
    }

    handleAuthCallback()
  }, [router, searchParams])

  const getIcon = () => {
    switch (status) {
      case 'loading':
        return <Loader2 className="h-12 w-12 text-blue-500 animate-spin" />
      case 'success':
        return <CheckCircle className="h-12 w-12 text-green-500" />
      case 'error':
      case 'expired':
        return <XCircle className="h-12 w-12 text-red-500" />
    }
  }

  const getTitle = () => {
    switch (status) {
      case 'loading':
        return 'Verifying...'
      case 'success':
        return 'Success!'
      case 'error':
        return 'Authentication Error'
      case 'expired':
        return 'Link Expired'
    }
  }

  const getBackgroundColor = () => {
    switch (status) {
      case 'loading':
        return 'bg-gradient-to-br from-blue-50 via-white to-purple-50'
      case 'success':
        return 'bg-gradient-to-br from-green-50 via-white to-blue-50'
      case 'error':
      case 'expired':
        return 'bg-gradient-to-br from-red-50 via-white to-orange-50'
    }
  }

  return (
    <div className={`min-h-screen flex items-center justify-center px-4 ${getBackgroundColor()}`}>
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            {getIcon()}
          </div>
          <CardTitle className="text-2xl font-bold text-gray-900">
            {getTitle()}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center space-y-4">
            <p className="text-gray-600">
              {message || 'Processing your authentication...'}
            </p>

            {status === 'error' && (
              <div className="space-y-3 pt-4">
                <Button 
                  onClick={() => router.push('/auth/login')} 
                  className="w-full"
                >
                  Back to Login
                </Button>
                
                <div className="text-sm text-gray-500">
                  <p>If you continue to have problems:</p>
                  <ul className="mt-2 space-y-1">
                    <li>• Try requesting a new verification email</li>
                    <li>• Check if the link has expired</li>
                    <li>• Contact support if the issue persists</li>
                  </ul>
                </div>
              </div>
            )}

            {status === 'loading' && (
              <div className="pt-4">
                <div className="text-sm text-gray-500">
                  <p>This may take a few seconds...</p>
                </div>
              </div>
            )}

            {status === 'success' && (
              <div className="pt-4">
                <div className="text-sm text-gray-500">
                  <p>You will be redirected automatically.</p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-blue-50 via-white to-purple-50">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <Loader2 className="h-12 w-12 text-blue-500 animate-spin" />
            </div>
            <CardTitle className="text-2xl font-bold text-gray-900">
              Loading...
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center">
              <p className="text-gray-600">
                Processing your authentication...
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    }>
      <AuthCallbackPageWithSearchParams />
    </Suspense>
  )
}