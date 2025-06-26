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
    imageFiles: 0,
    successfulExtractions: 0,
    partialExtractions: 0
  })
  const [showResetOptions, setShowResetOptions] = useState(false)
  const [processingDetails, setProcessingDetails] = useState<string[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)

  const handleResetClick = () => {
    if (existingIndex.length > 0) {
      setShowResetOptions(true)
    } else {
      startIndexing(true) // Fresh start if no existing index
    }
  }

  const handleResetChoice = (resetFromZero: boolean) => {
    setShowResetOptions(false)
    if (resetFromZero) {
      // Clear existing index and start fresh
      onIndexComplete([])
      localStorage.removeItem('dropbox_file_index')
      localStorage.removeItem('dropbox_last_indexed')
    }
    startIndexing(resetFromZero)
  }

  const startIndexing = async (resetFromZero: boolean = false) => {
    setIsIndexing(true)
    setIndexingError('')
    setIndexingStatus('🔍 Bestanden ophalen van Dropbox...')
    setProcessingDetails([])
    setIndexingStats({
      totalFiles: 0,
      processedFiles: 0,
      textFiles: 0,
      skippedFiles: 0,
      errors: 0,
      pdfFiles: 0,
      docxFiles: 0,
      imageFiles: 0,
      successfulExtractions: 0,
      partialExtractions: 0
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

      // Determine which files to process
      let filesToProcess = allFiles
      let existingFileMap = new Map<string, FileIndex>()

      if (!resetFromZero && existingIndex.length > 0) {
        // Create map of existing files for quick lookup
        existingIndex.forEach(file => {
          existingFileMap.set(file.path, file)
        })

        // Filter out files that haven't changed
        filesToProcess = allFiles.filter((file: any) => {
          const existing = existingFileMap.get(file.path_display)
          if (!existing) return true // New file
          
          // Check if file was modified
          const fileModified = new Date(file.server_modified)
          const existingModified = new Date(existing.modified)
          return fileModified > existingModified
        })

        setIndexingStatus(`📊 ${allFiles.length} bestanden gevonden. ${filesToProcess.length} nieuwe/gewijzigde bestanden te verwerken...`)
      } else {
        setIndexingStatus(`📊 ${allFiles.length} bestanden gevonden. Alle bestanden grondig indexeren...`)
      }

      const fileIndex: FileIndex[] = resetFromZero ? [] : [...existingIndex]
      let processed = 0

      // If no new files to process
      if (filesToProcess.length === 0) {
        setIndexingStatus(`✅ Geen nieuwe bestanden gevonden. Index is up-to-date met ${existingIndex.length} bestanden.`)
        onIndexComplete(existingIndex)
        setIsIndexing(false)
        return
      }

      // Process files in very small batches for maximum reliability
      const batchSize = 2 // Reduced to 2 for better error handling
      for (let i = 0; i < filesToProcess.length; i += batchSize) {
        if (abortControllerRef.current?.signal.aborted) {
          throw new Error('Indexering geannuleerd')
        }

        const batch = filesToProcess.slice(i, i + batchSize)
        const batchPromises = batch.map(async (file: any) => {
          try {
            // Determine file type with expanded detection
            const fileType = getFileType(file.name)
            
            // Skip very large files but with higher limit
            if (file.size > 50 * 1024 * 1024) { // 50MB limit
              setIndexingStats(prev => ({ ...prev, skippedFiles: prev.skippedFiles + 1 }))
              setProcessingDetails(prev => [...prev, `⏭️ Overgeslagen (te groot): ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`])
              return null
            }

            // Skip certain file types that are definitely not useful
            const skipExtensions = ['.exe', '.dll', '.zip', '.rar', '.7z', '.tar', '.gz', '.bin', '.iso', '.dmg', '.app', '.deb', '.rpm']
            const fileName = file.name.toLowerCase()
            if (skipExtensions.some(ext => fileName.endsWith(ext))) {
              setIndexingStats(prev => ({ ...prev, skippedFiles: prev.skippedFiles + 1 }))
              setProcessingDetails(prev => [...prev, `⏭️ Overgeslagen (binair): ${file.name}`])
              return null
            }

            setProcessingDetails(prev => [...prev, `🔄 Verwerken: ${file.name} (${fileType}, ${(file.size / 1024).toFixed(1)}KB)`])

            // Get file content with enhanced retry mechanism
            let contentResponse
            let retryCount = 0
            const maxRetries = 3 // Increased retries

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
                setProcessingDetails(prev => [...prev, `🔄 Retry ${retryCount}/3: ${file.name}`])
                await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)) // Exponential backoff
              }
            }

            if (!contentResponse || !contentResponse.ok) {
              setIndexingStats(prev => ({ ...prev, errors: prev.errors + 1 }))
              setProcessingDetails(prev => [...prev, `❌ Fout: ${file.name} (HTTP ${contentResponse?.status})`])
              
              // Create error entry to maintain file record
              const errorFileIndex = {
                id: file.id,
                name: file.name,
                path: file.path_display,
                content: `[Fout bij verwerken: ${file.name}]\nHTTP Status: ${contentResponse?.status}\nBestand kon niet worden gedownload maar is geregistreerd voor bestandsnaam-zoekopdrachten.`,
                size: file.size,
                modified: file.server_modified,
                type: fileType
              }
              
              return errorFileIndex
            }

            const contentData = await contentResponse.json()
            
            if (contentData.success && contentData.content) {
              // Update stats based on file type and extraction success
              const isSuccessful = contentData.extractionSuccess !== false
              
              setIndexingStats(prev => ({
                ...prev,
                textFiles: prev.textFiles + 1,
                pdfFiles: fileType === 'pdf' ? prev.pdfFiles + 1 : prev.pdfFiles,
                docxFiles: fileType === 'docx' ? prev.docxFiles + 1 : prev.docxFiles,
                imageFiles: fileType === 'image' ? prev.imageFiles + 1 : prev.imageFiles,
                successfulExtractions: isSuccessful ? prev.successfulExtractions + 1 : prev.successfulExtractions,
                partialExtractions: !isSuccessful ? prev.partialExtractions + 1 : prev.partialExtractions
              }))
              
              const statusIcon = isSuccessful ? '✅' : '⚠️'
              const extractionInfo = contentData.extractionMethod ? ` (${contentData.extractionMethod})` : ''
              setProcessingDetails(prev => [...prev, `${statusIcon} Geïndexeerd: ${file.name} - ${contentData.content.length} chars${extractionInfo}`])
              
              const newFileIndex = {
                id: file.id,
                name: file.name,
                path: file.path_display,
                content: contentData.content,
                size: file.size,
                modified: file.server_modified,
                type: fileType
              }

              // If updating existing file, remove old version
              if (!resetFromZero) {
                const existingIndex = fileIndex.findIndex(f => f.path === file.path_display)
                if (existingIndex !== -1) {
                  fileIndex[existingIndex] = newFileIndex
                  return null // Don't add duplicate
                }
              }

              return newFileIndex
            } else {
              setIndexingStats(prev => ({ ...prev, skippedFiles: prev.skippedFiles + 1 }))
              setProcessingDetails(prev => [...prev, `⏭️ Geen inhoud: ${file.name}`])
              return null
            }
          } catch (error) {
            console.error(`Error processing file ${file.name}:`, error)
            setIndexingStats(prev => ({ ...prev, errors: prev.errors + 1 }))
            setProcessingDetails(prev => [...prev, `❌ Fout: ${file.name} - ${error instanceof Error ? error.message : 'Onbekende fout'}`])
            
            // Create error entry to maintain file record
            const errorFileIndex = {
              id: file.id || `error_${Date.now()}`,
              name: file.name,
              path: file.path_display,
              content: `[Verwerkingsfout: ${file.name}]\nFout: ${error instanceof Error ? error.message : 'Onbekende fout'}\nBestand is geregistreerd voor bestandsnaam-zoekopdrachten.`,
              size: file.size,
              modified: file.server_modified,
              type: getFileType(file.name)
            }
            
            return errorFileIndex
          }
        })

        const batchResults = await Promise.all(batchPromises)
        
        // Add all results to index (including error entries)
        batchResults.forEach(result => {
          if (result) {
            fileIndex.push(result)
          }
        })

        processed += batch.length
        setIndexingStats(prev => ({ ...prev, processedFiles: processed }))
        onIndexProgress(processed, filesToProcess.length)
        
        const totalIndexed = fileIndex.length
        const newlyProcessed = resetFromZero ? totalIndexed : processed
        
        setIndexingStatus(`🔄 Verwerkt: ${processed}/${filesToProcess.length} ${resetFromZero ? 'bestanden' : 'nieuwe bestanden'} (${totalIndexed} totaal geïndexeerd)`)

        // Longer delay between batches to prevent rate limiting and allow processing
        await new Promise(resolve => setTimeout(resolve, 800))
      }

      const successMessage = resetFromZero 
        ? `🎉 Volledige herindexering voltooid! ${fileIndex.length} bestanden geïndexeerd van ${allFiles.length} totaal.`
        : `🎉 Incrementele update voltooid! ${processed} nieuwe/gewijzigde bestanden verwerkt. Totaal: ${fileIndex.length} bestanden.`
      
      setIndexingStatus(successMessage)
      
      // Add final summary to processing details
      setProcessingDetails(prev => [
        ...prev,
        '',
        '📊 SAMENVATTING:',
        `✅ Succesvol: ${indexingStats.successfulExtractions + 1} bestanden`,
        `⚠️ Gedeeltelijk: ${indexingStats.partialExtractions} bestanden`,
        `❌ Fouten: ${indexingStats.errors} bestanden`,
        `⏭️ Overgeslagen: ${indexingStats.skippedFiles} bestanden`,
        `📁 Totaal geïndexeerd: ${fileIndex.length} bestanden`
      ])
      
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
    
    // Expanded text files list for comprehensive coverage
    if ([
      // Programming and markup
      'txt', 'md', 'csv', 'json', 'js', 'ts', 'jsx', 'tsx', 'html', 'htm', 'css', 'scss', 'sass', 'less',
      'py', 'java', 'cpp', 'c', 'h', 'hpp', 'php', 'rb', 'go', 'rs', 'swift', 'kt', 'scala', 
      'sh', 'bat', 'ps1', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'log', 'sql',
      // Scientific and academic
      'r', 'matlab', 'm', 'pl', 'pm', 'tcl', 'vb', 'vbs', 'asm', 'f', 'f90', 'f95',
      'tex', 'bib', 'rtf', 'org', 'rst', 'wiki', 'adoc', 'asciidoc',
      // Data and config
      'properties', 'env', 'gitignore', 'dockerfile', 'makefile', 'cmake', 'gradle',
      'toml', 'lock', 'manifest', 'plist', 'reg', 'inf',
      // Documentation
      'readme', 'changelog', 'license', 'authors', 'contributors', 'todo',
      // Other text formats
      'srt', 'vtt', 'sub', 'ass', 'ssa', 'lrc', 'ttml'
    ].includes(ext)) {
      return 'text'
    }
    
    if (ext === 'pdf') return 'pdf'
    if (['docx', 'doc', 'odt', 'pages'].includes(ext)) return 'docx'
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'tif', 'ico', 'heic', 'heif'].includes(ext)) return 'image'
    
    return 'other'
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8">
      <h2 className="text-2xl font-bold text-blue-800 mb-6 flex items-center">
        <span className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
          📁
        </span>
        Grondige Bestanden Indexering
      </h2>

      <div className="space-y-6">
        {/* Current Status with Enhanced Reset Options */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">
              {existingIndex.length > 0 ? 'Bestaande Index' : 'Eerste Indexering'}
            </h3>
            <p className="text-sm text-gray-600">
              {existingIndex.length > 0 
                ? `Huidige index: ${existingIndex.length} bestanden` 
                : 'Nog geen bestanden geïndexeerd'
              }
            </p>
            {existingIndex.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                Laatst bijgewerkt: {localStorage.getItem('dropbox_last_indexed') 
                  ? new Date(localStorage.getItem('dropbox_last_indexed')!).toLocaleString('nl-NL')
                  : 'Onbekend'
                }
              </p>
            )}
          </div>
          
          <div className="flex items-center space-x-3">
            {!isIndexing ? (
              <>
                {/* Smart Indexing Button */}
                <button
                  onClick={() => startIndexing(false)}
                  className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center"
                  title={existingIndex.length > 0 ? "Zoek alleen naar nieuwe en gewijzigde bestanden" : "Start eerste indexering"}
                >
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {existingIndex.length > 0 ? 'Update Index' : 'Start Grondige Indexering'}
                </button>

                {/* Reset Button */}
                <button
                  onClick={handleResetClick}
                  className="px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors flex items-center"
                  title="Reset en herindexeer alle bestanden grondig"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Volledige Reset
                </button>
              </>
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

        {/* Reset Options Modal */}
        {showResetOptions && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-8 max-w-md w-full mx-4 shadow-2xl">
              <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center">
                <span className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center mr-3">
                  🔄
                </span>
                Indexering Opties
              </h3>
              
              <p className="text-gray-600 mb-6">
                Je hebt al {existingIndex.length} bestanden geïndexeerd. Hoe wil je doorgaan?
              </p>

              <div className="space-y-4">
                {/* Option 1: Fresh Start */}
                <button
                  onClick={() => handleResetChoice(true)}
                  className="w-full p-4 bg-red-50 border-2 border-red-200 rounded-lg hover:bg-red-100 transition-colors text-left"
                >
                  <div className="flex items-center mb-2">
                    <span className="w-6 h-6 bg-red-600 rounded-full flex items-center justify-center mr-3">
                      <span className="text-white text-sm">🗑️</span>
                    </span>
                    <span className="font-semibold text-red-800">Volledig Opnieuw Beginnen</span>
                  </div>
                  <p className="text-sm text-red-700 ml-9">
                    Wis alle bestaande data en indexeer alle bestanden grondig opnieuw. 
                    Dit duurt langer maar zorgt voor maximale dekking en kwaliteit.
                  </p>
                </button>

                {/* Option 2: Smart Update */}
                <button
                  onClick={() => handleResetChoice(false)}
                  className="w-full p-4 bg-green-50 border-2 border-green-200 rounded-lg hover:bg-green-100 transition-colors text-left"
                >
                  <div className="flex items-center mb-2">
                    <span className="w-6 h-6 bg-green-600 rounded-full flex items-center justify-center mr-3">
                      <span className="text-white text-sm">⚡</span>
                    </span>
                    <span className="font-semibold text-green-800">Slimme Update (Aanbevolen)</span>
                  </div>
                  <p className="text-sm text-green-700 ml-9">
                    Behoud bestaande data en voeg alleen nieuwe of gewijzigde bestanden toe. 
                    Sneller en efficiënter voor regelmatige updates.
                  </p>
                </button>
              </div>

              {/* Cancel Button */}
              <div className="mt-6 flex justify-center">
                <button
                  onClick={() => setShowResetOptions(false)}
                  className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Annuleren
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Progress Bar */}
        {isIndexing && (
          <div className="space-y-4">
            <div className="bg-gray-200 rounded-full h-4 overflow-hidden">
              <div 
                className="bg-gradient-to-r from-blue-500 to-green-500 h-full transition-all duration-300 ease-out"
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
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <div className="bg-blue-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-blue-600">{indexingStats.totalFiles}</div>
              <div className="text-xs text-blue-700">Totaal</div>
            </div>
            <div className="bg-green-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-green-600">{indexingStats.processedFiles}</div>
              <div className="text-xs text-green-700">Verwerkt</div>
            </div>
            <div className="bg-emerald-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-emerald-600">{indexingStats.successfulExtractions}</div>
              <div className="text-xs text-emerald-700">Succesvol</div>
            </div>
            <div className="bg-amber-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-amber-600">{indexingStats.partialExtractions}</div>
              <div className="text-xs text-amber-700">Gedeeltelijk</div>
            </div>
            <div className="bg-red-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-red-600">{indexingStats.pdfFiles}</div>
              <div className="text-xs text-red-700">PDF's</div>
            </div>
            <div className="bg-indigo-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-indigo-600">{indexingStats.docxFiles}</div>
              <div className="text-xs text-indigo-700">Word</div>
            </div>
            <div className="bg-purple-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-purple-600">{indexingStats.imageFiles}</div>
              <div className="text-xs text-purple-700">Afbeeldingen</div>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-gray-600">{indexingStats.errors}</div>
              <div className="text-xs text-gray-700">Fouten</div>
            </div>
          </div>
        )}

        {/* Real-time Processing Details */}
        {isIndexing && processingDetails.length > 0 && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h4 className="text-sm font-medium text-gray-800 mb-3">🔄 Live Verwerkingsdetails:</h4>
            <div className="max-h-40 overflow-y-auto text-xs text-gray-600 space-y-1 font-mono">
              {processingDetails.slice(-20).map((detail, index) => (
                <div key={index} className="whitespace-nowrap">
                  {detail}
                </div>
              ))}
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

        {/* Enhanced Info with Comprehensive Coverage Details */}
        <div className="bg-gradient-to-r from-blue-50 to-green-50 border border-blue-200 rounded-lg p-6">
          <h4 className="text-lg font-bold text-blue-800 mb-4">🚀 Grondige Indexering - Maximale Dekking</h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="bg-white border border-green-200 rounded-lg p-4">
              <h5 className="text-sm font-semibold text-green-800 mb-3">✅ Wat wordt VOLLEDIG geïndexeerd:</h5>
              <ul className="text-xs text-green-700 space-y-1">
                <li>• <strong>Alle tekstbestanden:</strong> .txt, .md, .csv, .json, .js, .ts, .html, .css, .py, .java, .cpp, .php, .rb, .go, .rs, .swift, .kt, .scala, .sh, .bat, .xml, .yaml, .ini, .log, .sql en 50+ andere formaten</li>
                <li>• <strong>PDF documenten:</strong> Tekst extractie met metadata (titel, auteur, pagina's)</li>
                <li>• <strong>Word documenten:</strong> .docx, .doc met volledige tekstinhoud</li>
                <li>• <strong>Afbeeldingen:</strong> Bestandsinfo (voorbereid voor OCR)</li>
                <li>• <strong>Configuratiebestanden:</strong> .env, .config, .properties, .ini</li>
                <li>• <strong>Data bestanden:</strong> .csv, .json, .xml met structuur</li>
              </ul>
            </div>
            
            <div className="bg-white border border-orange-200 rounded-lg p-4">
              <h5 className="text-sm font-semibold text-orange-800 mb-3">🛡️ Robuuste Foutafhandeling:</h5>
              <ul className="text-xs text-orange-700 space-y-1">
                <li>• <strong>PDF fouten:</strong> Automatische fallback naar alternatieve extractie</li>
                <li>• <strong>Beschadigde bestanden:</strong> Worden geregistreerd voor bestandsnaam-zoeken</li>
                <li>• <strong>Netwerkfouten:</strong> Automatische retry met exponential backoff</li>
                <li>• <strong>Grote bestanden:</strong> Intelligente truncatie op zinsgrenzen</li>
                <li>• <strong>Encoding problemen:</strong> Meerdere encoding pogingen (UTF-8, Latin1)</li>
                <li>• <strong>API limieten:</strong> Respectvolle rate limiting</li>
              </ul>
            </div>
          </div>

          <div className="bg-white border border-blue-200 rounded-lg p-4">
            <h5 className="text-sm font-semibold text-blue-800 mb-3">🔧 Technische Verbeteringen:</h5>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ul className="text-xs text-blue-700 space-y-1">
                <li>• <strong>Incrementele updates:</strong> Alleen nieuwe/gewijzigde bestanden</li>
                <li>• <strong>Robuuste PDF parsing:</strong> Voorkomt testbestand-fouten</li>
                <li>• <strong>Uitgebreide metadata:</strong> Titel, auteur, datum, pagina's</li>
                <li>• <strong>Slimme content cleaning:</strong> Verwijdert problematische karakters</li>
              </ul>
              <ul className="text-xs text-blue-700 space-y-1">
                <li>• <strong>Verhoogde limieten:</strong> Tot 50MB bestanden, 200KB tekst</li>
                <li>• <strong>Retry mechanisme:</strong> 3 pogingen met exponential backoff</li>
                <li>• <strong>Live monitoring:</strong> Real-time voortgang en details</li>
                <li>• <strong>Fout continuïteit:</strong> Eén fout stopt niet de hele indexering</li>
              </ul>
            </div>
          </div>

          <div className="mt-4 p-3 bg-yellow-50 rounded border border-yellow-200">
            <p className="text-xs text-yellow-800 font-medium">💡 Pro Tip:</p>
            <p className="text-xs text-yellow-700 mt-1">
              Deze verbeterde indexering zorgt ervoor dat ALLE tekstuele inhoud in je bestanden doorzoekbaar wordt, 
              inclusief metadata en gedeeltelijke inhoud van problematische bestanden. Zelfs als een bestand niet 
              volledig kan worden gelezen, wordt het geregistreerd voor bestandsnaam-gebaseerde zoekopdrachten.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}