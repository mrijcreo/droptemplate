'use client'

import { useState, useEffect, useRef } from 'react'
import DropboxAuth from './DropboxAuth'
import FileIndexer from './FileIndexer'
import SearchInterface from './SearchInterface'
import APITester from './APITester'

interface FileIndex {
  id: string
  name: string
  path: string
  content: string
  size: number
  modified: string
  type: 'text' | 'pdf' | 'docx' | 'image' | 'other'
}

export default function DropboxAISearch() {
  const [accessToken, setAccessToken] = useState<string>('')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [fileIndex, setFileIndex] = useState<FileIndex[]>([])
  const [isIndexing, setIsIndexing] = useState(false)
  const [indexingProgress, setIndexingProgress] = useState({ current: 0, total: 0 })
  const [showTester, setShowTester] = useState(false)
  const [lastIndexed, setLastIndexed] = useState<Date | null>(null)

  // Check for stored access token on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('dropbox_access_token')
    const storedIndex = localStorage.getItem('dropbox_file_index')
    const storedLastIndexed = localStorage.getItem('dropbox_last_indexed')
    
    if (storedToken) {
      setAccessToken(storedToken)
      setIsAuthenticated(true)
    }
    
    if (storedIndex) {
      try {
        const parsedIndex = JSON.parse(storedIndex)
        setFileIndex(parsedIndex)
      } catch (error) {
        console.error('Error parsing stored file index:', error)
      }
    }
    
    if (storedLastIndexed) {
      setLastIndexed(new Date(storedLastIndexed))
    }
  }, [])

  const handleAuthSuccess = (token: string) => {
    setAccessToken(token)
    setIsAuthenticated(true)
    localStorage.setItem('dropbox_access_token', token)
  }

  const handleLogout = () => {
    setAccessToken('')
    setIsAuthenticated(false)
    setFileIndex([])
    setLastIndexed(null)
    localStorage.removeItem('dropbox_access_token')
    localStorage.removeItem('dropbox_file_index')
    localStorage.removeItem('dropbox_last_indexed')
  }

  const handleIndexComplete = (index: FileIndex[]) => {
    setFileIndex(index)
    const now = new Date()
    setLastIndexed(now)
    localStorage.setItem('dropbox_file_index', JSON.stringify(index))
    localStorage.setItem('dropbox_last_indexed', now.toISOString())
  }

  const handleIndexProgress = (current: number, total: number) => {
    setIndexingProgress({ current, total })
  }

  if (!isAuthenticated) {
    return (
      <div className="space-y-8">
        {/* API Tester */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-blue-800 flex items-center">
              <span className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
                🧪
              </span>
              API Tester
            </h2>
            <button
              onClick={() => setShowTester(!showTester)}
              className={`px-4 py-2 rounded-lg transition-colors ${
                showTester 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
              }`}
            >
              {showTester ? 'Verberg Tester' : 'Toon API Tester'}
            </button>
          </div>
          
          {showTester && <APITester />}
        </div>

        {/* Authentication */}
        <DropboxAuth onAuthSuccess={handleAuthSuccess} />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header with user info */}
      <div className="bg-white rounded-2xl shadow-xl p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-800">Dropbox Verbonden</h3>
              <p className="text-sm text-gray-600">
                {fileIndex.length > 0 ? `${fileIndex.length} bestanden geïndexeerd` : 'Klaar om bestanden te indexeren'}
              </p>
              {lastIndexed && (
                <p className="text-xs text-gray-500">
                  Laatst geïndexeerd: {lastIndexed.toLocaleString('nl-NL')}
                </p>
              )}
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowTester(!showTester)}
              className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              🧪 API Tester
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
            >
              Uitloggen
            </button>
          </div>
        </div>
      </div>

      {/* API Tester (when authenticated) */}
      {showTester && (
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h2 className="text-2xl font-bold text-blue-800 mb-6 flex items-center">
            <span className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
              🧪
            </span>
            API Diagnostics
          </h2>
          <APITester accessToken={accessToken} />
        </div>
      )}

      {/* File Indexer */}
      <FileIndexer
        accessToken={accessToken}
        onIndexComplete={handleIndexComplete}
        onIndexProgress={handleIndexProgress}
        isIndexing={isIndexing}
        setIsIndexing={setIsIndexing}
        indexingProgress={indexingProgress}
        existingIndex={fileIndex}
      />

      {/* Search Interface */}
      {fileIndex.length > 0 && (
        <SearchInterface
          fileIndex={fileIndex}
          accessToken={accessToken}
        />
      )}
    </div>
  )
}