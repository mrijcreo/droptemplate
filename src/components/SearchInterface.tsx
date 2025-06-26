'use client'

import { useState, useRef } from 'react'
import MarkdownRenderer from './MarkdownRenderer'

interface FileIndex {
  id: string
  name: string
  path: string
  content: string
  size: number
  modified: string
  type: 'text' | 'pdf' | 'docx' | 'image' | 'other'
}

interface SearchResult {
  file: FileIndex
  relevanceScore: number
  matchedContent: string
}

interface SearchHistory {
  id: string
  query: string
  mode: 'search' | 'ask'
  timestamp: Date
  resultsCount: number
  response: string
}

interface SearchInterfaceProps {
  fileIndex: FileIndex[]
  accessToken: string
}

export default function SearchInterface({ fileIndex, accessToken }: SearchInterfaceProps) {
  const [query, setQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [aiResponse, setAiResponse] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [searchStats, setSearchStats] = useState({ filesSearched: 0, totalFiles: 0, searchTime: 0 })
  const [searchMode, setSearchMode] = useState<'search' | 'ask'>('search')
  const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [isExportingPDF, setIsExportingPDF] = useState(false)
  const [showSearchResults, setShowSearchResults] = useState(false) // NIEUWE STATE: Controleert of zoekresultaten getoond worden
  const abortControllerRef = useRef<AbortController | null>(null)

  // Reset all search data
  const resetSearch = () => {
    setQuery('')
    setSearchResults([])
    setAiResponse('')
    setIsStreaming(false)
    setSearchStats({ filesSearched: 0, totalFiles: 0, searchTime: 0 })
    setShowSearchResults(false) // Reset search results visibility
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }

  // Clear search history
  const clearHistory = () => {
    setSearchHistory([])
    setShowHistory(false)
  }

  // Add search to history
  const addToHistory = (query: string, mode: 'search' | 'ask', resultsCount: number, response: string) => {
    const historyItem: SearchHistory = {
      id: `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      query,
      mode,
      timestamp: new Date(),
      resultsCount,
      response
    }
    setSearchHistory(prev => [historyItem, ...prev.slice(0, 19)]) // Keep last 20 searches
  }

  // Load search from history
  const loadFromHistory = (historyItem: SearchHistory) => {
    setQuery(historyItem.query)
    setSearchMode(historyItem.mode)
    setAiResponse(historyItem.response)
    if (historyItem.mode === 'search') {
      setSearchResults([])
      setSearchStats({ filesSearched: fileIndex.length, totalFiles: fileIndex.length, searchTime: 0 })
      setShowSearchResults(false) // Don't show search results from history
    }
    setShowHistory(false)
  }

  // Export current response to PDF
  const exportToPDF = async () => {
    if (!aiResponse.trim()) {
      alert('Geen response om te exporteren!')
      return
    }

    setIsExportingPDF(true)
    
    try {
      const jsPDF = (await import('jspdf')).default
      const doc = new jsPDF()
      
      doc.setFont('helvetica')
      doc.setFontSize(16)
      doc.setFont('helvetica', 'bold')
      doc.text('AI Zoekresultaat', 20, 20)
      
      doc.setFontSize(12)
      doc.setFont('helvetica', 'normal')
      doc.text(`Query: ${query}`, 20, 35)
      doc.text(`Modus: ${searchMode === 'search' ? 'Zoeken in bestanden' : 'Directe AI vraag'}`, 20, 45)
      doc.text(`Datum: ${new Date().toLocaleString('nl-NL')}`, 20, 55)
      
      if (searchMode === 'search' && searchResults.length > 0) {
        doc.text(`Gevonden bestanden: ${searchResults.length}`, 20, 65)
      }

      doc.line(20, 75, 190, 75)

      const plainTextResponse = convertMarkdownToPlainText(aiResponse)
      
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      
      const pageWidth = 170
      const lineHeight = 6
      let yPosition = 85
      
      const lines = doc.splitTextToSize(plainTextResponse, pageWidth)
      
      for (let i = 0; i < lines.length; i++) {
        if (yPosition > 280) {
          doc.addPage()
          yPosition = 20
        }
        
        doc.text(lines[i], 20, yPosition)
        yPosition += lineHeight
      }

      const pageCount = doc.getNumberOfPages()
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i)
        doc.setFontSize(8)
        doc.setFont('helvetica', 'italic')
        doc.text(`Gegenereerd door Dropbox AI Search - Pagina ${i} van ${pageCount}`, 20, 290)
      }

      const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-')
      const filename = `AI_Zoekresultaat_${timestamp}.pdf`
      
      doc.save(filename)
      
    } catch (error) {
      console.error('PDF export error:', error)
      alert('Fout bij PDF export: ' + (error instanceof Error ? error.message : 'Onbekende fout'))
    } finally {
      setIsExportingPDF(false)
    }
  }

  // Convert markdown to plain text
  const convertMarkdownToPlainText = (markdown: string): string => {
    return markdown
      .replace(/#{1,6}\s+/g, '') // Headers
      .replace(/\*\*([^*]+)\*\*/g, '$1') // Bold
      .replace(/\*([^*]+)\*/g, '$1') // Italic
      .replace(/`([^`]+)`/g, '$1') // Inline code
      .replace(/```[\s\S]*?```/g, '[Code]') // Code blocks
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
      .replace(/^\s*[-*+]\s+/gm, '• ') // Lists
      .replace(/^\s*\d+\.\s+/gm, '') // Numbered lists
      .replace(/^\s*>\s+/gm, '') // Quotes
      .replace(/\n{2,}/g, '\n\n') // Multiple newlines
      .replace(/\s+/g, ' ') // Multiple spaces
      .trim()
  }

  const performSearch = async () => {
    if (!query.trim()) return

    setIsSearching(true)
    setSearchResults([])
    setAiResponse('')
    setIsStreaming(false)
    setShowSearchResults(false) // BELANGRIJK: Verberg zoekresultaten tijdens nieuwe zoekopdracht

    const startTime = Date.now()

    try {
      // First, perform semantic search through the file index
      const searchResponse = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          fileIndex: fileIndex,
          maxResults: 10
        })
      })

      if (!searchResponse.ok) {
        throw new Error('Zoekfout opgetreden')
      }

      const searchData = await searchResponse.json()
      const results: SearchResult[] = searchData.results || []
      
      setSearchResults(results)
      setSearchStats({
        filesSearched: fileIndex.length,
        totalFiles: fileIndex.length,
        searchTime: Date.now() - startTime
      })

      // KRITIEKE WIJZIGING: Genereer ALTIJD AI response, toon NOOIT zoekresultaten onderaan
      if (results.length > 0) {
        const response = await generateAIResponse(query, results)
        addToHistory(query, 'search', results.length, response)
        // setShowSearchResults(false) blijft false - zoekresultaten worden NOOIT getoond
      } else {
        const noResultsResponse = 'Geen relevante bestanden gevonden voor je zoekopdracht. Probeer andere zoektermen of controleer of je bestanden correct zijn geïndexeerd.'
        setAiResponse(noResultsResponse)
        addToHistory(query, 'search', 0, noResultsResponse)
      }

    } catch (error) {
      console.error('Search error:', error)
      const errorResponse = 'Er is een fout opgetreden bij het zoeken: ' + (error instanceof Error ? error.message : 'Onbekende fout')
      setAiResponse(errorResponse)
      addToHistory(query, 'search', 0, errorResponse)
    } finally {
      setIsSearching(false)
    }
  }

  const askAI = async () => {
    if (!query.trim()) return

    setIsSearching(true)
    setSearchResults([])
    setAiResponse('')
    setIsStreaming(false)
    setSearchStats({ filesSearched: 0, totalFiles: 0, searchTime: 0 })
    setShowSearchResults(false) // Ensure search results are hidden for direct AI questions

    try {
      const response = await generateDirectAIResponse(query)
      addToHistory(query, 'ask', 0, response)
    } catch (error) {
      console.error('AI ask error:', error)
      const errorResponse = 'Er is een fout opgetreden bij het stellen van je vraag: ' + (error instanceof Error ? error.message : 'Onbekende fout')
      setAiResponse(errorResponse)
      addToHistory(query, 'ask', 0, errorResponse)
    } finally {
      setIsSearching(false)
    }
  }

  const generateAIResponse = async (query: string, results: SearchResult[]): Promise<string> => {
    setIsStreaming(true)
    setAiResponse('')

    // Create abort controller for this request
    abortControllerRef.current = new AbortController()

    try {
      // VERBETERDE CONTEXT PREPARATIE: Alleen de beste en meest relevante content
      const topResults = results.slice(0, 5) // Limiteer tot top 5 resultaten voor betere focus
      
      const context = topResults.map((result, index) => {
        // Verkort de matched content voor betere AI processing
        const shortContent = result.matchedContent.length > 800 
          ? result.matchedContent.substring(0, 800) + '...' 
          : result.matchedContent
          
        return `[Bestand ${index + 1}: ${result.file.name}]
Pad: ${result.file.path}
Relevantie: ${Math.round(result.relevanceScore * 100)}%
Inhoud: ${shortContent}

---`
      }).join('\n')

      const prompt = `Beantwoord de vraag "${query}" op basis van de gevonden bestanden uit de Dropbox van de gebruiker.

GEVONDEN BESTANDEN:
${context}

INSTRUCTIES:
- Geef een duidelijk en uitgebreid antwoord gebaseerd op de inhoud van deze bestanden
- Verwijs specifiek naar bestandsnamen waar relevant
- Als informatie ontbreekt, geef dat duidelijk aan
- Structureer je antwoord logisch met kopjes waar nuttig
- Citeer relevante passages uit de bestanden
- Geef praktische tips of vervolgstappen waar mogelijk

Antwoord:`

      const response = await fetch('/api/ai-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: abortControllerRef.current.signal
      })

      if (!response.ok) {
        throw new Error('AI response fout')
      }

      const finalResponse = await handleStreamingResponse(response)
      return finalResponse

    } catch (error: any) {
      console.error('AI response error:', error)
      
      if (error.name === 'AbortError') {
        const abortedResponse = aiResponse || 'AI response gestopt door gebruiker.'
        setAiResponse(abortedResponse)
        return abortedResponse
      } else {
        const errorResponse = 'Fout bij genereren AI antwoord: ' + (error instanceof Error ? error.message : 'Onbekende fout')
        setAiResponse(errorResponse)
        return errorResponse
      }
    } finally {
      setIsStreaming(false)
      abortControllerRef.current = null
    }
  }

  const generateDirectAIResponse = async (query: string): Promise<string> => {
    setIsStreaming(true)
    setAiResponse('')

    // Create abort controller for this request
    abortControllerRef.current = new AbortController()

    try {
      const prompt = `Beantwoord de volgende vraag op een behulpzame en informatieve manier: "${query}"

Geef een duidelijk en uitgebreid antwoord. Als je aanvullende context of verduidelijking nodig hebt, geef dat dan aan.`

      const response = await fetch('/api/ai-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: abortControllerRef.current.signal
      })

      if (!response.ok) {
        throw new Error('AI response fout')
      }

      const finalResponse = await handleStreamingResponse(response)
      return finalResponse

    } catch (error: any) {
      console.error('Direct AI response error:', error)
      
      if (error.name === 'AbortError') {
        const abortedResponse = aiResponse || 'AI response gestopt door gebruiker.'
        setAiResponse(abortedResponse)
        return abortedResponse
      } else {
        const errorResponse = 'Fout bij genereren AI antwoord: ' + (error instanceof Error ? error.message : 'Onbekende fout')
        setAiResponse(errorResponse)
        return errorResponse
      }
    } finally {
      setIsStreaming(false)
      abortControllerRef.current = null
    }
  }

  const handleStreamingResponse = async (response: Response): Promise<string> => {
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()

    if (!reader) {
      throw new Error('No readable stream available')
    }

    let buffer = ''
    let fullResponse = ''

    while (true) {
      const { done, value } = await reader.read()
      
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            
            if (data.error) {
              throw new Error(data.message || 'AI streaming error')
            }
            
            if (data.done) {
              setIsStreaming(false)
              return fullResponse
            }
            
            if (data.token) {
              fullResponse += data.token
              setAiResponse(fullResponse)
            }
          } catch (parseError) {
            console.error('Error parsing streaming data:', parseError)
          }
        }
      }
    }

    return fullResponse
  }

  const stopAIResponse = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (searchMode === 'search') {
        performSearch()
      } else {
        askAI()
      }
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8">
      {/* Header with action buttons */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-blue-800 flex items-center">
          <span className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
            {searchMode === 'search' ? '🔍' : '🤖'}
          </span>
          {searchMode === 'search' ? 'AI Zoeken in je Dropbox' : 'Vraag het aan AI'}
        </h2>

        {/* Action buttons */}
        <div className="flex items-center space-x-2">
          {/* History button */}
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center space-x-1 ${
              showHistory
                ? 'bg-purple-100 text-purple-700 border border-purple-200'
                : 'bg-gray-100 hover:bg-purple-100 text-gray-700 hover:text-purple-700 border border-gray-200'
            }`}
            title="Zoekgeschiedenis"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Geschiedenis ({searchHistory.length})</span>
          </button>

          {/* Export PDF button */}
          {aiResponse && (
            <button
              onClick={exportToPDF}
              disabled={isExportingPDF}
              className="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-medium transition-all duration-200 flex items-center space-x-1 disabled:opacity-50"
              title="Exporteer naar PDF"
            >
              {isExportingPDF ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600"></div>
                  <span>Exporteren...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span>PDF</span>
                </>
              )}
            </button>
          )}

          {/* Reset button */}
          <button
            onClick={resetSearch}
            className="px-3 py-2 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-lg text-sm font-medium transition-all duration-200 flex items-center space-x-1"
            title="Herbegin zoeken"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Herbegin</span>
          </button>

          {/* Clear history button */}
          {searchHistory.length > 0 && (
            <button
              onClick={clearHistory}
              className="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-medium transition-all duration-200 flex items-center space-x-1"
              title="Wis zoekgeschiedenis"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>Wis</span>
            </button>
          )}
        </div>
      </div>

      {/* Search History Panel */}
      {showHistory && (
        <div className="mb-6 bg-gray-50 border border-gray-200 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-gray-800 mb-3">Zoekgeschiedenis</h3>
          {searchHistory.length === 0 ? (
            <p className="text-gray-600 text-sm">Nog geen zoekopdrachten uitgevoerd.</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {searchHistory.map((item) => (
                <div
                  key={item.id}
                  className="bg-white border border-gray-200 rounded-lg p-3 hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => loadFromHistory(item)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-800 truncate flex-1">
                      {item.mode === 'search' ? '🔍' : '🤖'} {item.query}
                    </span>
                    <span className="text-xs text-gray-500 ml-2">
                      {item.timestamp.toLocaleString('nl-NL')}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600">
                    {item.mode === 'search' ? `${item.resultsCount} resultaten` : 'Directe AI vraag'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-6">
        {/* Mode Toggle */}
        <div className="flex items-center justify-center">
          <div className="bg-gray-100 rounded-xl p-1 flex shadow-inner">
            <button
              onClick={() => setSearchMode('search')}
              className={`px-6 py-3 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center space-x-2 ${
                searchMode === 'search'
                  ? 'bg-blue-600 text-white shadow-lg transform scale-105'
                  : 'text-gray-600 hover:text-blue-600 hover:bg-blue-50'
              }`}
            >
              <span className="text-lg">🔍</span>
              <span>Zoek in Bestanden</span>
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                {fileIndex.length} bestanden
              </span>
            </button>
            <button
              onClick={() => setSearchMode('ask')}
              className={`px-6 py-3 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center space-x-2 ${
                searchMode === 'ask'
                  ? 'bg-purple-600 text-white shadow-lg transform scale-105'
                  : 'text-gray-600 hover:text-purple-600 hover:bg-purple-50'
              }`}
            >
              <span className="text-lg">🤖</span>
              <span>Vraag AI</span>
              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full">
                Direct
              </span>
            </button>
          </div>
        </div>

        {/* Mode Explanation */}
        <div className={`text-center p-4 rounded-lg ${
          searchMode === 'search' 
            ? 'bg-blue-50 border border-blue-200' 
            : 'bg-purple-50 border border-purple-200'
        }`}>
          <p className={`text-sm ${
            searchMode === 'search' ? 'text-blue-700' : 'text-purple-700'
          }`}>
            {searchMode === 'search' 
              ? `🔍 Zoek door je ${fileIndex.length} geïndexeerde Dropbox bestanden en krijg AI-antwoorden gebaseerd op de gevonden inhoud`
              : '🤖 Stel directe vragen aan Gemini AI zonder door je bestanden te zoeken'
            }
          </p>
        </div>

        {/* Search Input */}
        <div className="flex items-center space-x-4">
          <div className="flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={
                searchMode === 'search' 
                  ? "Stel een vraag over je bestanden... (bijv. 'Wat staat er over rubrieken in mijn documenten?')"
                  : "Stel een vraag aan Gemini AI... (bijv. 'Leg uit hoe machine learning werkt')"
              }
              className={`w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-offset-2 transition-all ${
                searchMode === 'search'
                  ? 'border-blue-300 focus:border-blue-500 focus:ring-blue-500'
                  : 'border-purple-300 focus:border-purple-500 focus:ring-purple-500'
              }`}
              disabled={isSearching}
            />
          </div>
          
          <button
            onClick={searchMode === 'search' ? performSearch : askAI}
            disabled={isSearching || !query.trim()}
            className={`px-8 py-3 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center font-semibold ${
              searchMode === 'search'
                ? 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500 shadow-lg hover:shadow-xl'
                : 'bg-purple-600 hover:bg-purple-700 focus:ring-purple-500 shadow-lg hover:shadow-xl'
            }`}
          >
            {isSearching ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                {searchMode === 'search' ? 'Zoeken...' : 'AI denkt na...'}
              </>
            ) : (
              <>
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {searchMode === 'search' ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  )}
                </svg>
                {searchMode === 'search' ? 'Zoek in Bestanden' : 'Vraag AI'}
              </>
            )}
          </button>
        </div>

        {/* Search Stats - only show in search mode and only when there are results */}
        {searchMode === 'search' && searchStats.totalFiles > 0 && searchResults.length > 0 && (
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>
                {searchResults.length} relevante bestanden gevonden in {searchStats.filesSearched} bestanden
              </span>
              <span>
                Zoektijd: {searchStats.searchTime}ms
              </span>
            </div>
          </div>
        )}

        {/* AI Response - ALTIJD TONEN ALS BESCHIKBAAR */}
        {(aiResponse || isStreaming) && (
          <div className={`border rounded-lg p-6 ${
            searchMode === 'search' 
              ? 'bg-green-50 border-green-200' 
              : 'bg-purple-50 border-purple-200'
          }`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-lg font-semibold flex items-center ${
                searchMode === 'search' ? 'text-green-800' : 'text-purple-800'
              }`}>
                <span className={`w-3 h-3 rounded-full mr-2 ${
                  isStreaming 
                    ? 'bg-blue-600 animate-pulse' 
                    : searchMode === 'search' 
                      ? 'bg-green-600' 
                      : 'bg-purple-600'
                }`}></span>
                {isStreaming ? '🤖 AI denkt na...' : '🤖 AI Antwoord'}
              </h3>
              
              {isStreaming && (
                <button
                  onClick={stopAIResponse}
                  className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                >
                  Stop
                </button>
              )}
            </div>
            
            <div className="bg-white p-4 rounded border">
              <MarkdownRenderer 
                content={aiResponse} 
                className="text-gray-700"
              />
              {isStreaming && (
                <span className="inline-block w-2 h-4 bg-blue-600 animate-pulse ml-1 align-text-bottom"></span>
              )}
            </div>
          </div>
        )}

        {/* VERWIJDERD: Search Results sectie - deze wordt NOOIT meer getoond */}
        {/* De zoekresultaten worden alleen gebruikt voor AI context, niet voor weergave */}

        {/* No Results - only show in search mode when no AI response yet */}
        {searchMode === 'search' && !isSearching && query && searchResults.length === 0 && !aiResponse && (
          <div className="text-center py-8">
            <div className="text-6xl mb-4">🔍</div>
            <h3 className="text-lg font-medium text-gray-800 mb-2">Geen bestanden gevonden</h3>
            <p className="text-gray-600">
              Probeer een andere zoekopdracht of controleer of je bestanden correct zijn geïndexeerd.
            </p>
          </div>
        )}

        {/* Usage Tips */}
        <div className={`border rounded-lg p-4 ${
          searchMode === 'search' 
            ? 'bg-blue-50 border-blue-200' 
            : 'bg-purple-50 border-purple-200'
        }`}>
          <h4 className={`text-sm font-medium mb-2 ${
            searchMode === 'search' ? 'text-blue-800' : 'text-purple-800'
          }`}>
            💡 {searchMode === 'search' ? 'Zoektips:' : 'AI Tips:'}
          </h4>
          <ul className={`text-sm space-y-1 ${
            searchMode === 'search' ? 'text-blue-700' : 'text-purple-700'
          }`}>
            {searchMode === 'search' ? (
              <>
                <li>• Stel specifieke vragen: "Wat staat er over rubrieken in mijn documenten?"</li>
                <li>• Zoek op onderwerp: "Alle informatie over evaluatie en beoordeling"</li>
                <li>• Vraag om samenvattingen: "Vat de belangrijkste punten samen uit mijn Canvas bestanden"</li>
                <li>• Zoek naar specifieke informatie: "Welke criteria worden gebruikt voor beoordeling?"</li>
              </>
            ) : (
              <>
                <li>• Stel algemene vragen: "Leg uit hoe machine learning werkt"</li>
                <li>• Vraag om uitleg: "Wat is het verschil tussen React en Vue?"</li>
                <li>• Krijg hulp: "Hoe schrijf ik een goede presentatie?"</li>
                <li>• Brainstorm: "Geef me ideeën voor een marketingcampagne"</li>
              </>
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}