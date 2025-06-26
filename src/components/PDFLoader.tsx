'use client'

import { useState, useRef } from 'react'

interface PDFFile {
  id: string
  name: string
  path: string
  size: number
  modified: string
  content?: string
  isLoaded: boolean
  loadError?: string
}

interface PDFLoaderProps {
  accessToken: string
  onPDFsLoaded: (pdfs: PDFFile[]) => void
  isLoading: boolean
  setIsLoading: (loading: boolean) => void
  existingPDFs: PDFFile[]
}

export default function PDFLoader({
  accessToken,
  onPDFsLoaded,
  isLoading,
  setIsLoading,
  existingPDFs
}: PDFLoaderProps) {
  const [loadingStatus, setLoadingStatus] = useState('')
  const [loadingError, setLoadingError] = useState('')
  const [loadingStats, setLoadingStats] = useState({
    totalPDFs: 0,
    loadedPDFs: 0,
    failedPDFs: 0,
    currentFile: ''
  })
  const [processingDetails, setProcessingDetails] = useState<string[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)

  const loadAllPDFs = async () => {
    setIsLoading(true)
    setLoadingError('')
    setLoadingStatus('🔍 PDF bestanden ophalen van Dropbox...')
    setProcessingDetails(['🔍 Verbinding maken met Dropbox...'])
    setLoadingStats({
      totalPDFs: 0,
      loadedPDFs: 0,
      failedPDFs: 0,
      currentFile: ''
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
      
      setLoadingStats(prev => ({ ...prev, totalPDFs: allPdfFiles.length }))
      setLoadingStatus(`📊 ${allPdfFiles.length} PDF bestanden gevonden. Inhoud laden...`)
      setProcessingDetails(prev => [...prev, `📊 ${allPdfFiles.length} PDF bestanden gevonden in Dropbox`])

      if (allPdfFiles.length === 0) {
        setLoadingStatus('ℹ️ Geen PDF bestanden gevonden in je Dropbox')
        setProcessingDetails(prev => [...prev, 'ℹ️ Geen PDF bestanden gevonden'])
        onPDFsLoaded([])
        setIsLoading(false)
        return
      }

      const loadedPDFs: PDFFile[] = []

      // Load each PDF file content
      for (let i = 0; i < allPdfFiles.length; i++) {
        if (abortControllerRef.current?.signal.aborted) {
          throw new Error('PDF laden geannuleerd')
        }

        const file = allPdfFiles[i]
        
        setLoadingStats(prev => ({ 
          ...prev, 
          currentFile: file.name 
        }))
        
        setLoadingStatus(`📄 Laden: ${file.name} (${i + 1}/${allPdfFiles.length})`)
        setProcessingDetails(prev => [...prev, `📄 Laden: ${file.name} (${(file.size / 1024).toFixed(1)}KB)`])

        try {
          // Load PDF content
          const contentResponse = await fetch('/api/dropbox/content', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              accessToken, 
              filePath: file.path_lower,
              fileType: 'pdf'
            }),
            signal: abortControllerRef.current?.signal
          })

          if (!contentResponse.ok) {
            throw new Error(`HTTP ${contentResponse.status}`)
          }

          const contentData = await contentResponse.json()
          
          const pdfFile: PDFFile = {
            id: file.id,
            name: file.name,
            path: file.path_display,
            size: file.size,
            modified: file.server_modified,
            content: contentData.content || '',
            isLoaded: contentData.success && contentData.content && contentData.content.length > 50,
            loadError: contentData.success ? undefined : 'Geen leesbare inhoud gevonden'
          }

          loadedPDFs.push(pdfFile)

          if (pdfFile.isLoaded) {
            setLoadingStats(prev => ({ ...prev, loadedPDFs: prev.loadedPDFs + 1 }))
            setProcessingDetails(prev => [...prev, `✅ Geladen: ${file.name} - ${contentData.content.length} karakters`])
          } else {
            setLoadingStats(prev => ({ ...prev, failedPDFs: prev.failedPDFs + 1 }))
            setProcessingDetails(prev => [...prev, `⚠️ Gedeeltelijk: ${file.name} - ${pdfFile.loadError}`])
          }
          
        } catch (error) {
          console.error(`Error loading PDF ${file.name}:`, error)
          
          const pdfFile: PDFFile = {
            id: file.id,
            name: file.name,
            path: file.path_display,
            size: file.size,
            modified: file.server_modified,
            content: `[PDF Laad Fout: ${file.name}]\nFout: ${error instanceof Error ? error.message : 'Onbekende fout'}\nPDF is beschikbaar voor bestandsnaam-zoekopdrachten.`,
            isLoaded: false,
            loadError: error instanceof Error ? error.message : 'Onbekende fout'
          }
          
          loadedPDFs.push(pdfFile)
          setLoadingStats(prev => ({ ...prev, failedPDFs: prev.failedPDFs + 1 }))
          setProcessingDetails(prev => [...prev, `❌ Fout: ${file.name} - ${pdfFile.loadError}`])
        }

        // Short delay between files
        await new Promise(resolve => setTimeout(resolve, 200))
      }

      const successfulLoads = loadedPDFs.filter(pdf => pdf.isLoaded).length
      const partialLoads = loadedPDFs.filter(pdf => !pdf.isLoaded && pdf.content && pdf.content.length > 50).length
      const failedLoads = loadedPDFs.length - successfulLoads - partialLoads

      setLoadingStatus(`🎉 PDF laden voltooid! ${successfulLoads} succesvol, ${partialLoads} gedeeltelijk, ${failedLoads} gefaald`)
      
      setProcessingDetails(prev => [
        ...prev,
        '',
        '📊 SAMENVATTING PDF LADEN:',
        `✅ Succesvol geladen: ${successfulLoads} PDF's`,
        `⚠️ Gedeeltelijk geladen: ${partialLoads} PDF's`,
        `❌ Gefaald: ${failedLoads} PDF's`,
        `📁 Totaal beschikbaar: ${loadedPDFs.length} PDF bestanden`,
        '🤖 Je kunt nu vragen stellen over de geladen PDF bestanden!'
      ])

      onPDFsLoaded(loadedPDFs)

    } catch (error: any) {
      console.error('PDF loading error:', error)
      if (error.name === 'AbortError' || error.message.includes('geannuleerd')) {
        setLoadingError('PDF laden geannuleerd door gebruiker')
        setLoadingStatus('Geannuleerd')
      } else {
        setLoadingError(error.message || 'Onbekende fout bij PDF laden')
        setLoadingStatus('Fout opgetreden')
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }

  const stopLoading = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8">
      <h2 className="text-2xl font-bold text-red-800 mb-6 flex items-center">
        <span className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center mr-3">
          📄
        </span>
        PDF Bestanden Laden
      </h2>

      <div className="space-y-6">
        {/* Current Status */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">
              {existingPDFs.length > 0 ? 'PDF Bestanden Beschikbaar' : 'PDF Bestanden Laden'}
            </h3>
            <p className="text-sm text-gray-600">
              {existingPDFs.length > 0 
                ? `${existingPDFs.length} PDF bestanden geladen (${existingPDFs.filter(p => p.isLoaded).length} volledig leesbaar)` 
                : 'Nog geen PDF bestanden geladen'
              }
            </p>
          </div>
          
          <div className="flex items-center space-x-3">
            {!isLoading ? (
              <button
                onClick={loadAllPDFs}
                className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {existingPDFs.length > 0 ? 'Herlaad PDF Bestanden' : 'Laad PDF Bestanden'}
              </button>
            ) : (
              <button
                onClick={stopLoading}
                className="px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors flex items-center"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                </svg>
                Stop Laden
              </button>
            )}
          </div>
        </div>

        {/* Progress Display */}
        {isLoading && (
          <div className="space-y-4">
            <div className="bg-gray-200 rounded-full h-4 overflow-hidden">
              <div 
                className="bg-gradient-to-r from-red-500 to-orange-500 h-full transition-all duration-300 ease-out"
                style={{ 
                  width: loadingStats.totalPDFs > 0 
                    ? `${((loadingStats.loadedPDFs + loadingStats.failedPDFs) / loadingStats.totalPDFs) * 100}%` 
                    : '0%' 
                }}
              />
            </div>
            
            <div className="flex justify-between text-sm text-gray-600">
              <span>{loadingStatus}</span>
              <span>
                {loadingStats.loadedPDFs + loadingStats.failedPDFs} / {loadingStats.totalPDFs}
                {loadingStats.totalPDFs > 0 && (
                  <span className="ml-2">
                    ({Math.round(((loadingStats.loadedPDFs + loadingStats.failedPDFs) / loadingStats.totalPDFs) * 100)}%)
                  </span>
                )}
              </span>
            </div>
          </div>
        )}

        {/* Loading Stats */}
        {isLoading && loadingStats.totalPDFs > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-blue-600">{loadingStats.totalPDFs}</div>
              <div className="text-xs text-blue-700">Totaal PDF's</div>
            </div>
            <div className="bg-green-50 p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-green-600">{loadingStats.loadedPDFs}</div>
              <div className="text-xs text-green-700">Geladen</div>
            </div>
            <div className="bg-red-50 p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-red-600">{loadingStats.failedPDFs}</div>
              <div className="text-xs text-red-700">Gefaald</div>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-gray-600">
                {Math.round((loadingStats.loadedPDFs / Math.max(loadingStats.totalPDFs, 1)) * 100)}%
              </div>
              <div className="text-xs text-gray-700">Succes Rate</div>
            </div>
          </div>
        )}

        {/* Real-time Processing Details */}
        {isLoading && processingDetails.length > 0 && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h4 className="text-sm font-medium text-gray-800 mb-3">🔄 Live PDF Laad Details:</h4>
            <div className="max-h-40 overflow-y-auto text-xs text-gray-600 space-y-1 font-mono">
              {processingDetails.slice(-20).map((detail, index) => (
                <div key={index} className="whitespace-nowrap">
                  {detail}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PDF Files Overview */}
        {existingPDFs.length > 0 && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h4 className="text-sm font-medium text-gray-800 mb-3">📁 Geladen PDF Bestanden:</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-60 overflow-y-auto">
              {existingPDFs.map((pdf) => (
                <div
                  key={pdf.id}
                  className={`border rounded-lg p-3 ${
                    pdf.isLoaded 
                      ? 'border-green-200 bg-green-50' 
                      : 'border-orange-200 bg-orange-50'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-lg">
                      {pdf.isLoaded ? '✅' : '⚠️'}
                    </span>
                    <span className="text-xs text-gray-500">
                      {(pdf.size / 1024).toFixed(1)} KB
                    </span>
                  </div>
                  
                  <div className="text-xs">
                    <p className="font-medium truncate text-gray-800" title={pdf.name}>
                      {pdf.name}
                    </p>
                    <p className="text-gray-600 mt-1">
                      {pdf.isLoaded 
                        ? `${pdf.content?.length || 0} karakters geladen`
                        : pdf.loadError || 'Niet volledig geladen'
                      }
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error Display */}
        {loadingError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-red-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span className="text-red-700">{loadingError}</span>
            </div>
          </div>
        )}

        {/* Info */}
        <div className="bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-lg p-6">
          <h4 className="text-lg font-bold text-red-800 mb-4">📄 Direct PDF Laden - Geen Indexering</h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="bg-white border border-green-200 rounded-lg p-4">
              <h5 className="text-sm font-semibold text-green-800 mb-3">✅ Hoe het werkt:</h5>
              <ul className="text-xs text-green-700 space-y-1">
                <li>• <strong>Direct laden:</strong> Alle PDF's worden direct uit Dropbox geladen</li>
                <li>• <strong>Geen indexering:</strong> Geen lokale opslag, altijd actuele bestanden</li>
                <li>• <strong>AI vragen:</strong> Stel direct vragen over alle geladen PDF's</li>
                <li>• <strong>Real-time:</strong> Altijd de nieuwste versie van je bestanden</li>
                <li>• <strong>Volledige inhoud:</strong> AI heeft toegang tot complete PDF tekst</li>
              </ul>
            </div>
            
            <div className="bg-white border border-blue-200 rounded-lg p-4">
              <h5 className="text-sm font-semibold text-blue-800 mb-3">🤖 AI Mogelijkheden:</h5>
              <ul className="text-xs text-blue-700 space-y-1">
                <li>• <strong>Zoeken:</strong> "Wat staat er over rubrieken in mijn PDF's?"</li>
                <li>• <strong>Samenvatten:</strong> "Vat de belangrijkste punten samen"</li>
                <li>• <strong>Vergelijken:</strong> "Vergelijk de verschillende documenten"</li>
                <li>• <strong>Analyseren:</strong> "Welke criteria worden gebruikt?"</li>
                <li>• <strong>Specifiek:</strong> "Zoek informatie over evaluatie"</li>
              </ul>
            </div>
          </div>

          <div className="bg-white border border-orange-200 rounded-lg p-4">
            <h5 className="text-sm font-semibold text-orange-800 mb-3">🚀 Voordelen van Direct Laden:</h5>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ul className="text-xs text-orange-700 space-y-1">
                <li>• <strong>Altijd actueel:</strong> Geen verouderde geïndexeerde data</li>
                <li>• <strong>Volledige toegang:</strong> AI ziet alle PDF inhoud</li>
                <li>• <strong>Geen opslag:</strong> Geen lokale bestanden, privacy-vriendelijk</li>
                <li>• <strong>Flexibel:</strong> Laad wanneer je wilt, geen vaste index</li>
              </ul>
              <ul className="text-xs text-orange-700 space-y-1">
                <li>• <strong>Eenvoudig:</strong> Geen complexe indexering processen</li>
                <li>• <strong>Betrouwbaar:</strong> Direct van Dropbox, geen tussenlagen</li>
                <li>• <strong>Snel:</strong> Onmiddellijk beschikbaar na laden</li>
                <li>• <strong>Compleet:</strong> Alle PDF's in één keer beschikbaar</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}