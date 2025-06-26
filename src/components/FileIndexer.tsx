'use client'

import { useState, useRef } from 'react'

interface FileIndex {
  id: string
  name: string
  path: string
  content: string
  size: number
  modified: string
  type: 'text' | 'pdf' | 'docx' | 'image' | 'other'
}

interface FileIndexerProps {
  accessToken: string
  onIndexComplete: (index: FileIndex[]) => void
  onIndexProgress: (current: number, total: number) => void
  isIndexing: boolean
  setIsIndexing: (indexing: boolean) => void
  indexingProgress: { current: number, total: number }
  existingIndex: FileIndex[]
}

export default function FileIndexer({
  accessToken,
  onIndexComplete,
  onIndexProgress,
  isIndexing,
  setIsIndexing,
  indexingProgress,
  existingIndex
}: FileIndexerProps) {
  const [indexingStatus, setIndexingStatus] = useState('')
  const [indexingError, setIndexingError] = useState('')
  const [indexingStats, setIndexingStats] = useState({
    totalFiles: 0,
    processedFiles: 0,
    textFiles: 0,
    skippedFiles: 0,
    errors: 0
  })
  const abortControllerRef = useRef<AbortController | null>(null)

  const startIndexing = async () => {
    setIsIndexing(true)
    setIndexingError('')
    setIndexingStatus('Bestanden ophalen van Dropbox...')
    setIndexingStats({
      totalFiles: 0,
      processedFiles: 0,
      textFiles: 0,
      skippedFiles: 0,
      errors: 0
    })

    // Create abort controller for cancellation
    abortControllerRef.current = new AbortController()

    try {
      // First, get all files from Dropbox
      const filesResponse = await fetch('/api/dropbox/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken }),
        signal: abortControllerRef.current.signal
      })

      if (!filesResponse.ok) {
        throw new Error('Fout bij ophalen bestanden van Dropbox')
      }

      const filesData = await filesResponse.json()
      const allFiles = filesData.files || []
      
      setIndexingStats(prev => ({ ...prev, totalFiles: allFiles.length }))
      onIndexProgress(0, allFiles.length)
      setIndexingStatus(`${allFiles.length} bestanden gevonden. Inhoud indexeren...`)

      const fileIndex: FileIndex[] = []
      let processed = 0

      // Process files in batches to avoid overwhelming the API
      const batchSize = 5
      for (let i = 0; i < allFiles.length; i += batchSize) {
        if (abortControllerRef.current?.signal.aborted) {
          throw new Error('Indexering geannuleerd')
        }

        const batch = allFiles.slice(i, i + batchSize)
        const batchPromises = batch.map(async (file: any) => {
          try {
            // Determine file type
            const fileType = getFileType(file.name)
            
            if (fileType === 'other' || file.size > 10 * 1024 * 1024) { // Skip files > 10MB
              setIndexingStats(prev => ({ ...prev, skippedFiles: prev.skippedFiles + 1 }))
              return null
            }

            // Get file content
            const contentResponse = await fetch('/api/dropbox/content', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                accessToken, 
                filePath: file.path_lower,
                fileType 
              }),
              signal: abortControllerRef.current?.signal
            })

            if (!contentResponse.ok) {
              console.warn(`Failed to get content for ${file.name}`)
              setIndexingStats(prev => ({ ...prev, errors: prev.errors + 1 }))
              return null
            }

            const contentData = await contentResponse.json()
            
            if (contentData.success && contentData.content) {
              setIndexingStats(prev => ({ ...prev, textFiles: prev.textFiles + 1 }))
              
              return {
                id: file.id,
                name: file.name,
                path: file.path_display,
                content: contentData.content,
                size: file.size,
                modified: file.server_modified,
                type: fileType
              }
            } else {
              setIndexingStats(prev => ({ ...prev, skippedFiles: prev.skippedFiles + 1 }))
              return null
            }
          } catch (error) {
            console.error(`Error processing file ${file.name}:`, error)
            setIndexingStats(prev => ({ ...prev, errors: prev.errors + 1 }))
            return null
          }
        })

        const batchResults = await Promise.all(batchPromises)
        
        // Add successful results to index
        batchResults.forEach(result => {
          if (result) {
            fileIndex.push(result)
          }
        })

        processed += batch.length
        setIndexingStats(prev => ({ ...prev, processedFiles: processed }))
        onIndexProgress(processed, allFiles.length)
        setIndexingStatus(`Verwerkt: ${processed}/${allFiles.length} bestanden (${fileIndex.length} geïndexeerd)`)

        // Small delay to prevent rate limiting
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      setIndexingStatus(`Indexering voltooid! ${fileIndex.length} bestanden geïndexeerd.`)
      onIndexComplete(fileIndex)

    } catch (error: any) {
      console.error('Indexing error:', error)
      if (error.name === 'AbortError' || error.message.includes('geannuleerd')) {
        setIndexingError('Indexering geannuleerd door gebruiker')
        setIndexingStatus('Geannuleerd')
      } else {
        setIndexingError(error.message || 'Onbekende fout bij indexeren')
        setIndexingStatus('Fout opgetreden')
      }
    } finally {
      setIsIndexing(false)
      abortControllerRef.current = null
    }
  }

  const stopIndexing = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }

  const getFileType = (filename: string): 'text' | 'pdf' | 'docx' | 'image' | 'other' => {
    const ext = filename.toLowerCase().split('.').pop() || ''
    
    if (['txt', 'md', 'csv', 'json', 'js', 'ts', 'html', 'css', 'py', 'java', 'cpp', 'c', 'php', 'rb', 'go', 'rs', 'swift', 'kt', 'scala', 'sh', 'bat', 'ps1', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'log'].includes(ext)) {
      return 'text'
    }
    if (ext === 'pdf') return 'pdf'
    if (['docx', 'doc'].includes(ext)) return 'docx'
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) return 'image'
    
    return 'other'
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8">
      <h2 className="text-2xl font-bold text-blue-800 mb-6 flex items-center">
        <span className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
          📁
        </span>
        Bestanden Indexeren
      </h2>

      <div className="space-y-6">
        {/* Current Status */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">
              {existingIndex.length > 0 ? 'Herindexeren' : 'Eerste Indexering'}
            </h3>
            <p className="text-sm text-gray-600">
              {existingIndex.length > 0 
                ? `Huidige index: ${existingIndex.length} bestanden` 
                : 'Nog geen bestanden geïndexeerd'
              }
            </p>
          </div>
          
          <div className="flex items-center space-x-3">
            {!isIndexing ? (
              <button
                onClick={startIndexing}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {existingIndex.length > 0 ? 'Herindexeren' : 'Start Indexering'}
              </button>
            ) : (
              <button
                onClick={stopIndexing}
                className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                </svg>
                Stop Indexering
              </button>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        {isIndexing && (
          <div className="space-y-4">
            <div className="bg-gray-200 rounded-full h-3 overflow-hidden">
              <div 
                className="bg-blue-600 h-full transition-all duration-300 ease-out"
                style={{ 
                  width: indexingProgress.total > 0 
                    ? `${(indexingProgress.current / indexingProgress.total) * 100}%` 
                    : '0%' 
                }}
              />
            </div>
            
            <div className="flex justify-between text-sm text-gray-600">
              <span>{indexingStatus}</span>
              <span>
                {indexingProgress.current} / {indexingProgress.total}
                {indexingProgress.total > 0 && (
                  <span className="ml-2">
                    ({Math.round((indexingProgress.current / indexingProgress.total) * 100)}%)
                  </span>
                )}
              </span>
            </div>
          </div>
        )}

        {/* Indexing Stats */}
        {isIndexing && indexingStats.totalFiles > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-blue-50 p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-blue-600">{indexingStats.totalFiles}</div>
              <div className="text-xs text-blue-700">Totaal</div>
            </div>
            <div className="bg-green-50 p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-green-600">{indexingStats.processedFiles}</div>
              <div className="text-xs text-green-700">Verwerkt</div>
            </div>
            <div className="bg-purple-50 p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-purple-600">{indexingStats.textFiles}</div>
              <div className="text-xs text-purple-700">Geïndexeerd</div>
            </div>
            <div className="bg-yellow-50 p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-yellow-600">{indexingStats.skippedFiles}</div>
              <div className="text-xs text-yellow-700">Overgeslagen</div>
            </div>
            <div className="bg-red-50 p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-red-600">{indexingStats.errors}</div>
              <div className="text-xs text-red-700">Fouten</div>
            </div>
          </div>
        )}

        {/* Error Display */}
        {indexingError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-red-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span className="text-red-700">{indexingError}</span>
            </div>
          </div>
        )}

        {/* Info */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-800 mb-2">Ondersteunde bestandstypen:</h4>
          <div className="text-sm text-gray-600 space-y-1">
            <p><strong>Tekst:</strong> .txt, .md, .csv, .json, .js, .ts, .html, .css, .py, .java, .cpp, .php, .rb, .go, .rs, .swift, .kt, .scala, .sh, .bat, .xml, .yaml, .ini, .log</p>
            <p><strong>Documenten:</strong> .pdf, .docx, .doc</p>
            <p><strong>Afbeeldingen:</strong> .jpg, .jpeg, .png, .gif, .bmp, .webp, .svg (OCR)</p>
            <p className="text-xs text-gray-500 mt-2">
              Bestanden groter dan 10MB worden overgeslagen. Binaire bestanden zonder tekst worden genegeerd.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}