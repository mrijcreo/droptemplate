'use client'

import { useState } from 'react'

interface APITesterProps {
  accessToken?: string
}

export default function APITester({ accessToken }: APITesterProps) {
  const [testResults, setTestResults] = useState<any>({})
  const [isRunning, setIsRunning] = useState(false)
  const [manualGeminiKey, setManualGeminiKey] = useState('')
  const [manualDropboxToken, setManualDropboxToken] = useState('')

  const runTests = async () => {
    setIsRunning(true)
    setTestResults({})

    const tests = [
      { name: 'Gemini API', endpoint: '/api/test/gemini', key: 'gemini' },
      { name: 'Dropbox API', endpoint: '/api/test/dropbox', key: 'dropbox' }
    ]

    for (const test of tests) {
      try {
        const payload: any = {}
        
        if (test.key === 'gemini' && manualGeminiKey) {
          payload.apiKey = manualGeminiKey
        }
        
        if (test.key === 'dropbox') {
          payload.accessToken = accessToken || manualDropboxToken
        }

        const response = await fetch(test.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })

        const data = await response.json()
        
        setTestResults((prev: any) => ({
          ...prev,
          [test.key]: {
            success: response.ok && data.success,
            data: data,
            status: response.status
          }
        }))
      } catch (error) {
        setTestResults((prev: any) => ({
          ...prev,
          [test.key]: {
            success: false,
            data: { error: error instanceof Error ? error.message : 'Unknown error' },
            status: 0
          }
        }))
      }
    }

    setIsRunning(false)
  }

  const getStatusIcon = (result: any) => {
    if (!result) return '⏳'
    return result.success ? '✅' : '❌'
  }

  const getStatusColor = (result: any) => {
    if (!result) return 'text-gray-500'
    return result.success ? 'text-green-600' : 'text-red-600'
  }

  return (
    <div className="space-y-6">
      {/* API Keys Input */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Gemini API Key (optioneel)
          </label>
          <input
            type="password"
            value={manualGeminiKey}
            onChange={(e) => setManualGeminiKey(e.target.value)}
            placeholder="Laat leeg om .env.local te gebruiken"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        
        {!accessToken && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Dropbox Access Token
            </label>
            <input
              type="password"
              value={manualDropboxToken}
              onChange={(e) => setManualDropboxToken(e.target.value)}
              placeholder="Voer je Dropbox token in"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        )}
      </div>

      {/* Test Button */}
      <div className="flex justify-center">
        <button
          onClick={runTests}
          disabled={isRunning}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
        >
          {isRunning ? (
            <>
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
              Tests uitvoeren...
            </>
          ) : (
            <>
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Start API Tests
            </>
          )}
        </button>
      </div>

      {/* Test Results */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Gemini API Test */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800">🤖 Gemini API Test</h3>
            <span className={`text-2xl ${getStatusColor(testResults.gemini)}`}>
              {getStatusIcon(testResults.gemini)}
            </span>
          </div>
          
          {testResults.gemini && (
            <div className="space-y-2">
              <div className="text-sm">
                <span className="font-medium">Status:</span>
                <span className={`ml-2 ${getStatusColor(testResults.gemini)}`}>
                  {testResults.gemini.success ? 'Succesvol' : 'Gefaald'}
                </span>
              </div>
              
              {testResults.gemini.data.model && (
                <div className="text-sm">
                  <span className="font-medium">Model:</span>
                  <span className="ml-2 text-gray-600">{testResults.gemini.data.model}</span>
                </div>
              )}
              
              {testResults.gemini.data.response && (
                <div className="text-sm">
                  <span className="font-medium">Test Response:</span>
                  <div className="mt-1 p-2 bg-white rounded border text-gray-600">
                    {testResults.gemini.data.response}
                  </div>
                </div>
              )}
              
              {testResults.gemini.data.error && (
                <div className="text-sm">
                  <span className="font-medium text-red-600">Error:</span>
                  <div className="mt-1 p-2 bg-red-50 rounded border border-red-200 text-red-700">
                    {testResults.gemini.data.error}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Dropbox API Test */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800">📁 Dropbox API Test</h3>
            <span className={`text-2xl ${getStatusColor(testResults.dropbox)}`}>
              {getStatusIcon(testResults.dropbox)}
            </span>
          </div>
          
          {testResults.dropbox && (
            <div className="space-y-2">
              <div className="text-sm">
                <span className="font-medium">Status:</span>
                <span className={`ml-2 ${getStatusColor(testResults.dropbox)}`}>
                  {testResults.dropbox.success ? 'Succesvol' : 'Gefaald'}
                </span>
              </div>
              
              {testResults.dropbox.data.account && (
                <div className="text-sm">
                  <span className="font-medium">Account:</span>
                  <span className="ml-2 text-gray-600">{testResults.dropbox.data.account.name}</span>
                </div>
              )}
              
              {testResults.dropbox.data.account && (
                <div className="text-sm">
                  <span className="font-medium">Email:</span>
                  <span className="ml-2 text-gray-600">{testResults.dropbox.data.account.email}</span>
                </div>
              )}
              
              {testResults.dropbox.data.usage && (
                <div className="text-sm">
                  <span className="font-medium">Storage:</span>
                  <span className="ml-2 text-gray-600">
                    {(testResults.dropbox.data.usage.used / 1024 / 1024 / 1024).toFixed(2)} GB gebruikt
                  </span>
                </div>
              )}
              
              {testResults.dropbox.data.error && (
                <div className="text-sm">
                  <span className="font-medium text-red-600">Error:</span>
                  <div className="mt-1 p-2 bg-red-50 rounded border border-red-200 text-red-700">
                    {testResults.dropbox.data.error}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Diagnostic Info */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h4 className="font-medium text-yellow-800 mb-2">🔧 Diagnostische Informatie</h4>
        <div className="text-sm text-yellow-700 space-y-1">
          <p><strong>Environment Variables:</strong></p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li>GEMINI_API_KEY: {process.env.NEXT_PUBLIC_HAS_GEMINI_KEY ? '✅ Ingesteld' : '❌ Niet gevonden'}</li>
            <li>Dropbox Token: {accessToken ? '✅ Aanwezig' : '❌ Niet ingelogd'}</li>
          </ul>
          <p className="mt-2"><strong>Troubleshooting:</strong></p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li>Gemini API fout? Controleer je API key in .env.local</li>
            <li>Dropbox API fout? Controleer je access token en permissions</li>
            <li>Network errors? Controleer je internetverbinding</li>
          </ul>
        </div>
      </div>
    </div>
  )
}