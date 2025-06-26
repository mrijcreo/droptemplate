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
    successfulPdfs: 0,
    failedPdfs: 0,
    skippedFiles: 0,
    errors: 0
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
      // KRITISCH: Volledig wissen van alle oude data
      console.log('🗑️ VOLLEDIGE RESET: Alle oude data wordt gewist...')
      
      // 1. Wis localStorage volledig
      localStorage.removeItem('dropbox_file_index')
      localStorage.removeItem('dropbox_last_indexed')
      
      // 2. Wis parent state onmiddellijk
      onIndexComplete([])
      
      // 3. Reset alle lokale state
      setIndexingStats({
        totalFiles: 0,
        processedFiles: 0,
        successfulPdfs: 0,
        failedPdfs: 0,
        skippedFiles: 0,
        errors: 0
      })
      setProcessingDetails([])
      setIndexingError('')
      setIndexingStatus('🗑️ Alle oude data gewist. Starten met volledige PDF herindexering...')
      
      // 4. Korte delay om UI te laten updaten
      setTimeout(() => {
        startIndexing(true)
      }, 500)
    } else {
      startIndexing(false)
    }
  }

  const startIndexing = async (resetFromZero: boolean = false) => {
    setIsIndexing(true)
    setIndexingError('')
    
    if (resetFromZero) {
      setIndexingStatus('🔄 VOLLEDIGE PDF HERINDEXERING: Alle PDF bestanden worden grondig opnieuw verwerkt...')
      setProcessingDetails(['🗑️ Alle oude data gewist', '🔄 Starten met volledige PDF herindexering...'])
    } else {
      setIndexingStatus('🔍 PDF bestanden ophalen van Dropbox...')
      setProcessingDetails([])
    }
    
    setIndexingStats({
      totalFiles: 0,
      processedFiles: 0,
      successfulPdfs: 0,
      failedPdfs: 0,
      skippedFiles: 0,
      errors: 0
    })

    // Create abort controller for cancellation
    abortControllerRef.current = new AbortController()

    try {
      // First, get all PDF files from Dropbox
      const filesResponse = await fetch('/api/dropbox/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken }),
        signal: abortControllerRef.current.signal
      })

      if (!filesResponse.ok) {
        throw new Error('Fout bij ophalen PDF bestanden van Dropbox')
      }

      const filesData = await filesResponse.json()
      const allPdfFiles = filesData.files || []
      
      setIndexingStats(prev => ({ ...prev, totalFiles: allPdfFiles.length }))
      onIndexProgress(0, allPdfFiles.length)

      // Determine which files to process
      let filesToProcess = allPdfFiles
      let existingFileMap = new Map<string, FileIndex>()

      if (!resetFromZero && existingIndex.length > 0) {
        // Create map of existing files for quick lookup
        existingIndex.forEach(file => {
          existingFileMap.set(file.path, file)
        })

        // Filter out files that haven't changed
        filesToProcess = allPdfFiles.filter((file: any) => {
          const existing = existingFileMap.get(file.path_display)
          if (!existing) return true // New file
          
          // Check if file was modified
          const fileModified = new Date(file.server_modified)
          const existingModified = new Date(existing.modified)
          return fileModified > existingModified
        })

        setIndexingStatus(`📊 ${allPdfFiles.length} PDF bestanden gevonden. ${filesToProcess.length} nieuwe/gewijzigde PDF's te verwerken...`)
      } else {
        setIndexingStatus(`📊 ${allPdfFiles.length} PDF bestanden gevonden. ALLE PDF's worden grondig geïndexeerd...`)
        setProcessingDetails(prev => [...prev, `📊 Totaal te verwerken: ${allPdfFiles.length} PDF bestanden`])
      }

      // KRITISCH: Bij volledige reset start met lege array
      const fileIndex: FileIndex[] = resetFromZero ? [] : [...existingIndex]
      let processed = 0

      // If no new files to process (only for incremental updates)
      if (!resetFromZero && filesToProcess.length === 0) {
        setIndexingStatus(`✅ Geen nieuwe PDF bestanden gevonden. Index is up-to-date met ${existingIndex.length} bestanden.`)
        onIndexComplete(existingIndex)
        setIsIndexing(false)
        return
      }

      // Process PDF files one by one for maximum reliability
      for (let i = 0; i < filesToProcess.length; i++) {
        if (abortControllerRef.current?.signal.aborted) {
          throw new Error('Indexering geannuleerd')
        }

        const file = filesToProcess[i]
        
        try {
          setProcessingDetails(prev => [...prev, `🔄 Verwerken: ${file.name} (${(file.size / 1024).toFixed(1)}KB)`])

          // Get PDF content with enhanced retry mechanism
          let contentResponse
          let retryCount = 0
          const maxRetries = 3

          while (retryCount <= maxRetries) {
            try {
              contentResponse = await fetch('/api/dropbox/content', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  accessToken, 
                  filePath: file.path_lower,
                  fileType: 'pdf'
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
            setProcessingDetails(prev => [...prev, `❌ Download fout: ${file.name} (HTTP ${contentResponse?.status})`])
            
            // Create error entry to maintain file record
            const errorFileIndex = {
              id: file.id,
              name: file.name,
              path: file.path_display,
              content: `[PDF Download Fout: ${file.name}]\nHTTP Status: ${contentResponse?.status}\nPDF kon niet worden gedownload maar is geregistreerd voor bestandsnaam-zoekopdrachten.`,
              size: file.size,
              modified: file.server_modified,
              type: 'pdf' as const
            }
            
            // Add error entry to index
            if (resetFromZero) {
              fileIndex.push(errorFileIndex)
            } else {
              const existingIndex = fileIndex.findIndex(f => f.path === file.path_display)
              if (existingIndex !== -1) {
                fileIndex[existingIndex] = errorFileIndex
              } else {
                fileIndex.push(errorFileIndex)
              }
            }
            continue
          }

          const contentData = await contentResponse.json()
          
          if (contentData.success && contentData.content) {
            // Update stats based on extraction success
            const isSuccessful = contentData.extractionSuccess !== false
            
            setIndexingStats(prev => ({
              ...prev,
              successfulPdfs: isSuccessful ? prev.successfulPdfs + 1 : prev.successfulPdfs,
              failedPdfs: !isSuccessful ? prev.failedPdfs + 1 : prev.failedPdfs
            }))
            
            const statusIcon = isSuccessful ? '✅' : '⚠️'
            const extractionInfo = contentData.extractionMethod ? ` (${contentData.extractionMethod})` : ''
            setProcessingDetails(prev => [...prev, `${statusIcon} PDF geïndexeerd: ${file.name} - ${contentData.content.length} chars${extractionInfo}`])
            
            const newFileIndex = {
              id: file.id,
              name: file.name,
              path: file.path_display,
              content: contentData.content,
              size: file.size,
              modified: file.server_modified,
              type: 'pdf' as const
            }

            // KRITISCH: Bij volledige reset GEEN duplicaat controle
            if (resetFromZero) {
              fileIndex.push(newFileIndex)
            } else {
              // Bij incrementele update: vervang bestaand bestand
              const existingIndex = fileIndex.findIndex(f => f.path === file.path_display)
              if (existingIndex !== -1) {
                fileIndex[existingIndex] = newFileIndex
              } else {
                fileIndex.push(newFileIndex)
              }
            }
          } else {
            setIndexingStats(prev => ({ ...prev, failedPdfs: prev.failedPdfs + 1 }))
            setProcessingDetails(prev => [...prev, `⏭️ Geen inhoud: ${file.name}`])
          }
          
        } catch (error) {
          console.error(`Error processing PDF ${file.name}:`, error)
          setIndexingStats(prev => ({ ...prev, errors: prev.errors + 1 }))
          setProcessingDetails(prev => [...prev, `❌ Fout: ${file.name} - ${error instanceof Error ? error.message : 'Onbekende fout'}`])
          
          // Create error entry to maintain file record
          const errorFileIndex = {
            id: file.id || `error_${Date.now()}`,
            name: file.name,
            path: file.path_display,
            content: `[PDF Verwerkingsfout: ${file.name}]\nFout: ${error instanceof Error ? error.message : 'Onbekende fout'}\nPDF is geregistreerd voor bestandsnaam-zoekopdrachten.`,
            size: file.size,
            modified: file.server_modified,
            type: 'pdf' as const
          }
          
          // Add error entry to index
          if (resetFromZero) {
            fileIndex.push(errorFileIndex)
          } else {
            const existingIndex = fileIndex.findIndex(f => f.path === file.path_display)
            if (existingIndex !== -1) {
              fileIndex[existingIndex] = errorFileIndex
            } else {
              fileIndex.push(errorFileIndex)
            }
          }
        }

        processed++
        setIndexingStats(prev => ({ ...prev, processedFiles: processed }))
        onIndexProgress(processed, filesToProcess.length)
        
        const totalIndexed = fileIndex.length
        
        if (resetFromZero) {
          setIndexingStatus(`🔄 VOLLEDIGE PDF HERINDEXERING: ${processed}/${filesToProcess.length} PDF's verwerkt (${totalIndexed} totaal geïndexeerd)`)
        } else {
          setIndexingStatus(`🔄 Verwerkt: ${processed}/${filesToProcess.length} nieuwe PDF's (${totalIndexed} totaal geïndexeerd)`)
        }

        // Short delay between files
        await new Promise(resolve => setTimeout(resolve, 300))
      }

      const successMessage = resetFromZero 
        ? `🎉 VOLLEDIGE PDF HERINDEXERING VOLTOOID! ${fileIndex.length} PDF bestanden grondig geïndexeerd van ${allPdfFiles.length} totaal. Alle oude data vervangen.`
        : `🎉 Incrementele PDF update voltooid! ${processed} nieuwe/gewijzigde PDF's verwerkt. Totaal: ${fileIndex.length} PDF bestanden.`
      
      setIndexingStatus(successMessage)
      
      // Add final summary to processing details
      setProcessingDetails(prev => [
        ...prev,
        '',
        resetFromZero ? '📊 VOLLEDIGE PDF HERINDEXERING SAMENVATTING:' : '📊 INCREMENTELE PDF UPDATE SAMENVATTING:',
        `✅ Succesvol: ${indexingStats.successfulPdfs} PDF's`,
        `⚠️ Gedeeltelijk: ${indexingStats.failedPdfs} PDF's`,
        `❌ Fouten: ${indexingStats.errors} PDF's`,
        `📁 Totaal geïndexeerd: ${fileIndex.length} PDF bestanden`,
        resetFromZero ? '🗑️ Alle oude data vervangen door nieuwe PDF index' : '🔄 Bestaande PDF data bijgewerkt'
      ])
      
      console.log(successMessage)
      
      // KRITISCH: Sla nieuwe index op en update parent state
      onIndexComplete(fileIndex)

    } catch (error: any) {
      console.error('PDF Indexing error:', error)
      if (error.name === 'AbortError' || error.message.includes('geannuleerd')) {
        setIndexingError('PDF indexering geannuleerd door gebruiker')
        setIndexingStatus('Geannuleerd')
      } else {
        setIndexingError(error.message || 'Onbekende fout bij PDF indexeren')
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

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8">
      <h2 className="text-2xl font-bold text-blue-800 mb-6 flex items-center">
        <span className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
          📄
        </span>
        PDF Bestanden Indexering
      </h2>

      <div className="space-y-6">
        {/* Current Status with Enhanced Reset Options */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">
              {existingIndex.length > 0 ? 'Bestaande PDF Index' : 'Eerste PDF Indexering'}
            </h3>
            <p className="text-sm text-gray-600">
              {existingIndex.length > 0 
                ? `Huidige index: ${existingIndex.length} PDF bestanden` 
                : 'Nog geen PDF bestanden geïndexeerd'
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
                  title={existingIndex.length > 0 ? "Zoek alleen naar nieuwe en gewijzigde PDF bestanden" : "Start eerste PDF indexering"}
                >
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {existingIndex.length > 0 ? 'Update PDF Index' : 'Start PDF Indexering'}
                </button>

                {/* Reset Button */}
                <button
                  onClick={handleResetClick}
                  className="px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors flex items-center"
                  title="Reset en herindexeer alle PDF bestanden grondig"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Volledige PDF Reset
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
                Stop PDF Indexering
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
                PDF Indexering Opties
              </h3>
              
              <p className="text-gray-600 mb-6">
                Je hebt al {existingIndex.length} PDF bestanden geïndexeerd. Hoe wil je doorgaan?
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
                    <strong>WIS ALLE BESTAANDE PDF DATA</strong> en indexeer alle PDF bestanden grondig opnieuw. 
                    Dit duurt langer maar zorgt voor maximale PDF tekstextractie kwaliteit.
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
                    <span className="font-semibold text-green-800">Slimme PDF Update (Aanbevolen)</span>
                  </div>
                  <p className="text-sm text-green-700 ml-9">
                    Behoud bestaande PDF data en voeg alleen nieuwe of gewijzigde PDF bestanden toe. 
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
                className="bg-gradient-to-r from-red-500 to-orange-500 h-full transition-all duration-300 ease-out"
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

        {/* Enhanced PDF Indexing Stats */}
        {isIndexing && indexingStats.totalFiles > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-blue-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-blue-600">{indexingStats.totalFiles}</div>
              <div className="text-xs text-blue-700">Totaal PDF's</div>
            </div>
            <div className="bg-green-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-green-600">{indexingStats.processedFiles}</div>
              <div className="text-xs text-green-700">Verwerkt</div>
            </div>
            <div className="bg-emerald-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-emerald-600">{indexingStats.successfulPdfs}</div>
              <div className="text-xs text-emerald-700">Succesvol</div>
            </div>
            <div className="bg-amber-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-amber-600">{indexingStats.failedPdfs}</div>
              <div className="text-xs text-amber-700">Gedeeltelijk</div>
            </div>
            <div className="bg-red-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-red-600">{indexingStats.errors}</div>
              <div className="text-xs text-red-700">Fouten</div>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg text-center">
              <div className="text-xl font-bold text-gray-600">{indexingStats.skippedFiles}</div>
              <div className="text-xs text-gray-700">Overgeslagen</div>
            </div>
          </div>
        )}

        {/* Real-time Processing Details */}
        {isIndexing && processingDetails.length > 0 && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h4 className="text-sm font-medium text-gray-800 mb-3">🔄 Live PDF Verwerkingsdetails:</h4>
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

        {/* Enhanced Info with PDF Focus */}
        <div className="bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-lg p-6">
          <h4 className="text-lg font-bold text-red-800 mb-4">📄 INDEXERING SYSTEEM: PDF Bestanden Permanent Opslaan</h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="bg-white border border-green-200 rounded-lg p-4">
              <h5 className="text-sm font-semibold text-green-800 mb-3">✅ Hoe Indexering Werkt:</h5>
              <ul className="text-xs text-green-700 space-y-1">
                <li>• <strong>Permanente opslag:</strong> PDF inhoud wordt lokaal opgeslagen in browser</li>
                <li>• <strong>Eenmalig proces:</strong> Na indexering kun je direct zoeken zonder herlaad</li>
                <li>• <strong>Slimme updates:</strong> Alleen nieuwe/gewijzigde PDF's worden opnieuw verwerkt</li>
                <li>• <strong>Volledige reset:</strong> Optie om alle data te wissen en opnieuw te beginnen</li>
                <li>• <strong>Offline zoeken:</strong> Na indexering werkt zoeken zonder internetverbinding</li>
                <li>• <strong>Snelle toegang:</strong> Geïndexeerde PDF's zijn onmiddellijk doorzoekbaar</li>
              </ul>
            </div>
            
            <div className="bg-white border border-orange-200 rounded-lg p-4">
              <h5 className="text-sm font-semibold text-orange-800 mb-3">🔄 Reset Opties:</h5>
              <ul className="text-xs text-orange-700 space-y-1">
                <li>• <strong>Slimme Update:</strong> Voegt alleen nieuwe PDF's toe aan bestaande index</li>
                <li>• <strong>Volledige Reset:</strong> Wist alle data en herindexeert alle PDF's grondig</li>
                <li>• <strong>Incrementeel:</strong> Detecteert automatisch gewijzigde bestanden</li>
                <li>• <strong>Betrouwbaar:</strong> Retry mechanisme voor gefaalde downloads</li>
                <li>• <strong>Transparant:</strong> Live voortgang en gedetailleerde logging</li>
                <li>• <strong>Flexibel:</strong> Kies zelf wanneer je wilt updaten of resetten</li>
              </ul>
            </div>
          </div>

          <div className="bg-white border border-blue-200 rounded-lg p-4">
            <h5 className="text-sm font-semibold text-blue-800 mb-3">🎯 Voordelen van Indexering:</h5>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ul className="text-xs text-blue-700 space-y-1">
                <li>• <strong>Snelle zoekopdrachten:</strong> Onmiddellijke resultaten zonder API calls</li>
                <li>• <strong>Offline functionaliteit:</strong> Zoeken werkt zonder internetverbinding</li>
                <li>• <strong>Geavanceerde zoekfuncties:</strong> Synoniemen, relevantie scoring</li>
                <li>• <strong>Persistente data:</strong> Eenmaal geïndexeerd, altijd beschikbaar</li>
              </ul>
              <ul className="text-xs text-blue-700 space-y-1">
                <li>• <strong>Efficiënt:</strong> Geen herhaalde PDF downloads</li>
                <li>• <strong>Betrouwbaar:</strong> Lokale opslag voorkomt dataverlies</li>
                <li>• <strong>Schaalbaar:</strong> Werkt met honderden PDF bestanden</li>
                <li>• <strong>Privacy:</strong> Alle data blijft lokaal in je browser</li>
              </ul>
            </div>
          </div>

          <div className="mt-4 p-3 bg-green-50 rounded border border-green-200">
            <p className="text-xs text-green-800 font-medium">✅ SYSTEEM HERSTELD:</p>
            <p className="text-xs text-green-700 mt-1">
              Het indexering systeem is volledig hersteld! Na indexering kun je direct zoeken in je PDF bestanden. 
              De volgende keer dat je de app opent, zijn je geïndexeerde PDF's onmiddellijk beschikbaar voor zoeken 
              zonder opnieuw te hoeven laden.
            </p>
          </div>

          <div className="mt-4 p-3 bg-blue-50 rounded border border-blue-200">
            <p className="text-xs text-blue-800 font-medium">🔍 ZOEKEN VERBETERD:</p>
            <p className="text-xs text-blue-700 mt-1">
              Met de verbeterde PDF parsing en indexering systeem zal zoeken naar educatieve termen 
              zoals "rubrieken", "evaluatie", "beoordeling" perfect werken omdat de werkelijke tekstinhoud 
              van PDF's wordt geëxtraheerd en permanent opgeslagen voor snelle zoekopdrachten.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}