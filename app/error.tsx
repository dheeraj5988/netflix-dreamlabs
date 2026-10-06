'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Application error:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-netflix-dark flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-netflix-card border border-netflix-border rounded-xl p-8 text-center space-y-6">
        <AlertTriangle className="w-16 h-16 text-yellow-500 mx-auto" />
        <h2 className="text-2xl font-bold text-white">Something went wrong!</h2>
        <p className="text-netflix-gray">{error.message || 'An unexpected error occurred'}</p>
        <div className="flex gap-4 justify-center">
          <Button
            onClick={reset}
            className="bg-netflix-red hover:bg-netflix-red-hover text-white"
          >
            Try again
          </Button>
          <Button
            onClick={() => window.location.href = '/'}
            variant="outline"
            className="border-netflix-border text-white hover:bg-netflix-input/50"
          >
            Go home
          </Button>
        </div>
      </div>
    </div>
  )
}


