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
    errors: 0,
    pdfFiles: 0,
    docxFiles: 0,
    imageFiles: 0
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
      errors: 0,
      pdfFiles: 0,
      docxFiles: 0,
      imageFiles: 0
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

      // Process files in smaller batches to avoid overwhelming the API
      const batchSize = 3 // Reduced from 5 to be more gentle on the API
      for (let i = 0; i < allFiles.length; i += batchSize) {
        if (abortControllerRef.current?.signal.aborted) {
          throw new Error('Indexering geannuleerd')
        }

        const batch = allFiles.slice(i, i + batchSize)
        const batchPromises = batch.map(async (file: any) => {
          try {
            // Determine file type
            const fileType = getFileType(file.name)
            
            // Skip very large files (increased limit for better coverage)
            if (file.size > 25 * 1024 * 1024) { // 25MB limit
              setIndexingStats(prev => ({ ...prev, skippedFiles: prev.skippedFiles + 1 }))
              console.log(`Skipping large file: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`)
              return null
            }

            // Skip certain file types that are definitely not useful
            const skipExtensions = ['.exe', '.dll', '.zip', '.rar', '.7z', '.tar', '.gz', '.bin', '.iso', '.dmg']
            const fileName = file.name.toLowerCase()
            if (skipExtensions.some(ext => fileName.endsWith(ext))) {
              setIndexingStats(prev => ({ ...prev, skippedFiles: prev.skippedFiles + 1 }))
              return null
            }

            console.log(`Processing file: ${file.name} (${fileType}, ${(file.size / 1024).toFixed(1)}KB)`)

            // Get file content with retry mechanism
            let contentResponse
            let retryCount = 0
            const maxRetries = 2

            while (retryCount <= maxRetries) {
              try {
                contentResponse = await fetch('/api/dropbox/content', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ 
                    accessToken, 
                    filePath: file.path_lower,
                    fileType 
                  }),
                  signal: abortControllerRef.current?.signal
                })
                break // Success, exit retry loop
              } catch (fetchError) {
                retryCount++
                if (retryCount > maxRetries) {
                  throw fetchError
                }
                console.log(`Retry ${retryCount} for file: ${file.name}`)
                await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)) // Exponential backoff
              }
            }

            if (!contentResponse || !contentResponse.ok) {
              console.warn(`Failed to get content for ${file.name}: ${contentResponse?.status}`)
              setIndexingStats(prev => ({ ...prev, errors: prev.errors + 1 }))
              return null
            }

            const contentData = await contentResponse.json()
            
            if (contentData.success && contentData.content) {
              // Update stats based on file type
              setIndexingStats(prev => ({
                ...prev,
                textFiles: prev.textFiles + 1,
                pdfFiles: fileType === 'pdf' ? prev.pdfFiles + 1 : prev.pdfFiles,
                docxFiles: fileType === 'docx' ? prev.docxFiles + 1 : prev.docxFiles,
                imageFiles: fileType === 'image' ? prev.imageFiles + 1 : prev.imageFiles
              }))
              
              console.log(`Successfully indexed: ${file.name} (${contentData.content.length} chars)`)
              
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
              console.log(`No content extracted from: ${file.name}`)
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

        // Longer delay between batches to prevent rate limiting
        await new Promise(resolve => setTimeout(resolve, 500))
      }

      const successMessage = `Indexering voltooid! ${fileIndex.length} bestanden geïndexeerd van ${allFiles.length} totaal.`
      setIndexingStatus(successMessage)
      console.log(successMessage)
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
    
    // Text files - expanded list
    if ([
      'txt', 'md', 'csv', 'json', 'js', 'ts', 'jsx', 'tsx', 'html', 'htm', 'css', 'scss', 'sass', 'less',
      'py', 'java', 'cpp', 'c', 'h', 'hpp', 'php', 'rb', 'go', 'rs', 'swift', 'kt', 'scala', 
      'sh', 'bat', 'ps1', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'log', 'sql',
      'r', 'matlab', 'm', 'pl', 'pm', 'tcl', 'vb', 'vbs', 'asm', 'f', 'f90', 'f95',
      'tex', 'bib', 'rtf', 'org', 'rst', 'wiki', 'adoc', 'asciidoc'
    ].includes(ext)) {
      return 'text'
    }
    
    if (ext === 'pdf') return 'pdf'
    if (['docx', 'doc'].includes(ext)) return 'docx'
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'tif'].includes(ext)) return 'image'
    
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

        {/* Enhanced Indexing Stats */}
        {isIndexing && indexingStats.totalFiles > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <div className="bg-blue-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-blue-600">{indexingStats.totalFiles}</div>
              <div className="text-xs text-blue-700">Totaal</div>
            </div>
            <div className="bg-green-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-green-600">{indexingStats.processedFiles}</div>
              <div className="text-xs text-green-700">Verwerkt</div>
            </div>
            <div className="bg-purple-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-purple-600">{indexingStats.textFiles}</div>
              <div className="text-xs text-purple-700">Geïndexeerd</div>
            </div>
            <div className="bg-red-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-red-600">{indexingStats.pdfFiles}</div>
              <div className="text-xs text-red-700">PDF's</div>
            </div>
            <div className="bg-indigo-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-indigo-600">{indexingStats.docxFiles}</div>
              <div className="text-xs text-indigo-700">Word</div>
            </div>
            <div className="bg-yellow-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-yellow-600">{indexingStats.skippedFiles}</div>
              <div className="text-xs text-yellow-700">Overgeslagen</div>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-gray-600">{indexingStats.errors}</div>
              <div className="text-xs text-gray-700">Fouten</div>
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

        {/* Enhanced Info */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-800 mb-2">✨ Verbeterde bestandsondersteuning:</h4>
          <div className="text-sm text-gray-600 space-y-2">
            <p><strong>📄 Tekst:</strong> .txt, .md, .csv, .json, .js, .ts, .html, .css, .py, .java, .cpp, .php, .rb, .go, .rs, .swift, .kt, .scala, .sh, .bat, .xml, .yaml, .ini, .log, .sql en veel meer</p>
            <p><strong>📕 PDF:</strong> Verbeterde PDF parsing met betere foutafhandeling en metadata extractie</p>
            <p><strong>📘 Word:</strong> .docx, .doc met uitgebreide foutdetectie</p>
            <p><strong>🖼️ Afbeeldingen:</strong> .jpg, .jpeg, .png, .gif, .bmp, .webp, .svg (voorbereid voor OCR)</p>
            <div className="mt-3 p-3 bg-blue-50 rounded border border-blue-200">
              <p className="text-xs text-blue-700 font-medium">🔧 Technische verbeteringen:</p>
              <ul className="text-xs text-blue-600 mt-1 space-y-1">
                <li>• Robuuste PDF parsing die testbestand-fouten voorkomt</li>
                <li>• Betere foutafhandeling voor beschadigde bestanden</li>
                <li>• Uitgebreide metadata extractie</li>
                <li>• Verhoogde bestandsgrootte limiet (25MB)</li>
                <li>• Retry mechanisme voor netwerkfouten</li>
                <li>• Gedetailleerde voortgangsrapportage</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}