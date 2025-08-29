'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Mail, RefreshCw, ArrowRight } from 'lucide-react'

function CheckEmailPageWithSearchParams() {
  const [isResending, setIsResending] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const email = searchParams.get('email') || 'your email'
  const type = searchParams.get('type') || 'signup' // 'signup' | 'reset'

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [resendCooldown])

  const handleResend = async () => {
    setIsResending(true)
    setResendCooldown(60) // 1 minute cooldown
    
    try {
      // Here you would call your resend function
      // For now, just simulate the action
      await new Promise(resolve => setTimeout(resolve, 2000))
    } catch (error) {
      console.error('Failed to resend email:', error)
    } finally {
      setIsResending(false)
    }
  }

  const getTitle = () => {
    return type === 'reset' ? 'Check Your Email' : 'Verify Your Email'
  }

  const getDescription = () => {
    return type === 'reset' 
      ? 'We\'ve sent password reset instructions to your email address'
      : 'We\'ve sent a verification link to your email address'
  }

  const getInstructions = () => {
    return type === 'reset'
      ? 'Click the link in the email to reset your password'
      : 'Click the link in the email to verify your account and get started'
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-green-50 px-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-blue-100 rounded-full">
              <Mail className="h-8 w-8 text-blue-600" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold text-gray-900">
            {getTitle()}
          </CardTitle>
          <CardDescription className="text-base">
            {getDescription()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Email address display */}
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-md">
              <div className="flex items-center justify-center">
                <Mail className="h-5 w-5 text-blue-500 mr-3" />
                <div className="text-center">
                  <p className="text-sm font-medium text-blue-700">
                    Email sent to:
                  </p>
                  <p className="text-sm text-blue-600 font-semibold break-all">
                    {email}
                  </p>
                </div>
              </div>
            </div>

            {/* Instructions */}
            <div className="text-center space-y-3">
              <p className="text-sm text-gray-600">
                {getInstructions()}
              </p>
              
              <div className="text-xs text-gray-500 space-y-1">
                <p>• The link expires in 24 hours</p>
                <p>• Check your spam folder if you don't see the email</p>
                <p>• Make sure to click the link from the same device</p>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3">
              <Button 
                variant="outline"
                onClick={handleResend}
                disabled={isResending || resendCooldown > 0}
                className="w-full"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isResending ? 'animate-spin' : ''}`} />
                {isResending 
                  ? 'Resending...' 
                  : resendCooldown > 0 
                    ? `Resend in ${resendCooldown}s`
                    : 'Resend Email'
                }
              </Button>

              <Button 
                onClick={() => router.push('/auth/login')} 
                className="w-full"
              >
                Continue to Login
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>

            {/* Alternative actions */}
            <div className="text-center pt-4 border-t">
              <p className="text-sm text-gray-600 mb-3">
                Having trouble?
              </p>
              <div className="space-y-2">
                {type === 'signup' && (
                  <Link 
                    href="/auth/signup" 
                    className="text-sm text-blue-600 hover:text-blue-500 block"
                  >
                    Try signing up again
                  </Link>
                )}
                <Link 
                  href="/support" 
                  className="text-sm text-gray-500 hover:text-gray-700 block"
                >
                  Contact Support
                </Link>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function CheckEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-green-50 px-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="p-3 bg-blue-100 rounded-full">
                <RefreshCw className="h-8 w-8 text-blue-600 animate-spin" />
              </div>
            </div>
            <CardTitle className="text-2xl font-bold text-gray-900">
              Loading...
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center">
              <p className="text-gray-600">
                Loading email verification page...
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    }>
      <CheckEmailPageWithSearchParams />
    </Suspense>
  )
}