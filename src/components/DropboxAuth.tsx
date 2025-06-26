'use client'

import { useState } from 'react'

interface DropboxAuthProps {
  onAuthSuccess: (accessToken: string) => void
}

export default function DropboxAuth({ onAuthSuccess }: DropboxAuthProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [manualToken, setManualToken] = useState('')

  const handleManualAuth = () => {
    if (!manualToken.trim()) {
      setError('Voer een geldige access token in')
      return
    }

    setIsLoading(true)
    setError('')

    // Test the token by making a simple API call
    fetch('/api/dropbox/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: manualToken.trim() })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        onAuthSuccess(manualToken.trim())
      } else {
        setError(data.error || 'Ongeldige access token')
      }
    })
    .catch(error => {
      console.error('Auth test error:', error)
      setError('Fout bij het testen van de access token')
    })
    .finally(() => {
      setIsLoading(false)
    })
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8">
      <h2 className="text-2xl font-bold text-blue-800 mb-6 flex items-center">
        <span className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
          🔐
        </span>
        Dropbox Authenticatie
      </h2>

      <div className="space-y-6">
        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-800 mb-3">
            Hoe krijg je een Dropbox Access Token?
          </h3>
          <ol className="list-decimal list-inside space-y-2 text-blue-700">
            <li>Ga naar <a href="https://www.dropbox.com/developers/apps" target="_blank" className="underline hover:text-blue-900">Dropbox App Console</a></li>
            <li>Klik op "Create app"</li>
            <li>Kies "Scoped access" en "Full Dropbox"</li>
            <li>Geef je app een naam (bijv. "AI Search")</li>
            <li>Ga naar de "Settings" tab van je app</li>
            <li>Scroll naar "OAuth 2" sectie</li>
            <li>Klik op "Generate access token"</li>
            <li>Kopieer de token en plak deze hieronder</li>
          </ol>
        </div>

        {/* Manual Token Input */}
        <div className="space-y-4">
          <div>
            <label htmlFor="token" className="block text-sm font-medium text-gray-700 mb-2">
              Dropbox Access Token
            </label>
            <input
              id="token"
              type="password"
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              placeholder="Plak je Dropbox access token hier..."
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={isLoading}
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-center">
                <svg className="w-5 h-5 text-red-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <span className="text-red-700">{error}</span>
              </div>
            </div>
          )}

          <button
            onClick={handleManualAuth}
            disabled={isLoading || !manualToken.trim()}
            className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                Token testen...
              </>
            ) : (
              <>
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Verbind met Dropbox
              </>
            )}
          </button>
        </div>

        {/* Security Note */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start">
            <svg className="w-5 h-5 text-yellow-500 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div>
              <h4 className="text-sm font-medium text-yellow-800">Veiligheid</h4>
              <p className="text-sm text-yellow-700 mt-1">
                Je access token wordt alleen lokaal opgeslagen in je browser en wordt gebruikt om je Dropbox bestanden te lezen. 
                Deze app heeft geen server die je gegevens opslaat.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}