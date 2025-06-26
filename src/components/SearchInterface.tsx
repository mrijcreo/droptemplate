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
  const [searchMode, setSearchMode] = useState<'search' | 'ask'>('search') // New state for mode
  const abortControllerRef = useRef<AbortController | null>(null)

  const performSearch = async () => {
    if (!query.trim()) return

    setIsSearching(true)
    setSearchResults([])
    setAiResponse('')
    setIsStreaming(false)

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

      // If we have results, generate AI response
      if (results.length > 0) {
        await generateAIResponse(query, results)
      } else {
        setAiResponse('Geen relevante bestanden gevonden voor je zoekopdracht.')
      }

    } catch (error) {
      console.error('Search error:', error)
      setAiResponse('Er is een fout opgetreden bij het zoeken: ' + (error instanceof Error ? error.message : 'Onbekende fout'))
    } finally {
      setIsSearching(false)
    }
  }

  const askAI = async () => {
    if (!query.trim()) return

    setIsSearching(true)
    setSearchResults([]) // Clear search results for direct AI mode
    setAiResponse('')
    setIsStreaming(false)
    setSearchStats({ filesSearched: 0, totalFiles: 0, searchTime: 0 }) // Clear search stats

    try {
      // Direct AI question without file search
      await generateDirectAIResponse(query)
    } catch (error) {
      console.error('AI ask error:', error)
      setAiResponse('Er is een fout opgetreden bij het stellen van je vraag: ' + (error instanceof Error ? error.message : 'Onbekende fout'))
    } finally {
      setIsSearching(false)
    }
  }

  const generateAIResponse = async (query: string, results: SearchResult[]) => {
    setIsStreaming(true)
    setAiResponse('')

    // Create abort controller for this request
    abortControllerRef.current = new AbortController()

    try {
      // Prepare context from search results
      const context = results.map((result, index) => {
        return `[Bestand ${index + 1}: ${result.file.name}]\nPad: ${result.file.path}\nInhoud:\n${result.matchedContent}\n\n---\n`
      }).join('\n')

      const prompt = `Gebaseerd op de volgende bestanden uit de Dropbox van de gebruiker, beantwoord de vraag: "${query}"

GEVONDEN BESTANDEN:
${context}

Geef een uitgebreid en nuttig antwoord gebaseerd op de inhoud van deze bestanden. Verwijs specifiek naar de bestandsnamen en paden waar relevant. Als de informatie niet volledig is, geef dan aan wat er ontbreekt.`

      const response = await fetch('/api/ai-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: abortControllerRef.current.signal
      })

      if (!response.ok) {
        throw new Error('AI response fout')
      }

      await handleStreamingResponse(response)

    } catch (error: any) {
      console.error('AI response error:', error)
      
      if (error.name === 'AbortError') {
        setAiResponse(prev => prev || 'AI response gestopt door gebruiker.')
      } else {
        setAiResponse('Fout bij genereren AI antwoord: ' + (error instanceof Error ? error.message : 'Onbekende fout'))
      }
    } finally {
      setIsStreaming(false)
      abortControllerRef.current = null
    }
  }

  const generateDirectAIResponse = async (query: string) => {
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

      await handleStreamingResponse(response)

    } catch (error: any) {
      console.error('Direct AI response error:', error)
      
      if (error.name === 'AbortError') {
        setAiResponse(prev => prev || 'AI response gestopt door gebruiker.')
      } else {
        setAiResponse('Fout bij genereren AI antwoord: ' + (error instanceof Error ? error.message : 'Onbekende fout'))
      }
    } finally {
      setIsStreaming(false)
      abortControllerRef.current = null
    }
  }

  const handleStreamingResponse = async (response: Response) => {
    // Handle streaming response
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
              return
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
      <h2 className="text-2xl font-bold text-blue-800 mb-6 flex items-center">
        <span className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
          {searchMode === 'search' ? '🔍' : '🤖'}
        </span>
        {searchMode === 'search' ? 'AI Zoeken in je Dropbox' : 'Vraag het aan AI'}
      </h2>

      <div className="space-y-6">
        {/* Mode Toggle */}
        <div className="flex items-center justify-center">
          <div className="bg-gray-100 rounded-lg p-1 flex">
            <button
              onClick={() => setSearchMode('search')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                searchMode === 'search'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-blue-600'
              }`}
            >
              🔍 Zoek in Bestanden
            </button>
            <button
              onClick={() => setSearchMode('ask')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                searchMode === 'ask'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-purple-600'
              }`}
            >
              🤖 Vraag AI
            </button>
          </div>
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
                  ? "Stel een vraag over je bestanden... (bijv. 'Wat staat er in mijn projectdocumenten?')"
                  : "Stel een vraag aan Gemini AI... (bijv. 'Leg uit hoe machine learning werkt')"
              }
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={isSearching}
            />
          </div>
          
          <button
            onClick={searchMode === 'search' ? performSearch : askAI}
            disabled={isSearching || !query.trim()}
            className={`px-6 py-3 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center ${
              searchMode === 'search'
                ? 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
                : 'bg-purple-600 hover:bg-purple-700 focus:ring-purple-500'
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
                {searchMode === 'search' ? 'Zoeken' : 'Vraag AI'}
              </>
            )}
          </button>
        </div>

        {/* Search Stats - only show in search mode */}
        {searchMode === 'search' && searchStats.totalFiles > 0 && (
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>
                {searchResults.length} resultaten gevonden in {searchStats.filesSearched} bestanden
              </span>
              <span>
                Zoektijd: {searchStats.searchTime}ms
              </span>
            </div>
          </div>
        )}

        {/* AI Response */}
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

        {/* Search Results - only show in search mode */}
        {searchMode === 'search' && searchResults.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">
              Gevonden Bestanden ({searchResults.length})
            </h3>
            
            <div className="space-y-3">
              {searchResults.map((result, index) => (
                <div key={result.file.id} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-800 flex items-center">
                        <span className="text-lg mr-2">
                          {result.file.type === 'text' ? '📄' : 
                           result.file.type === 'pdf' ? '📕' : 
                           result.file.type === 'docx' ? '📘' : 
                           result.file.type === 'image' ? '🖼️' : '📁'}
                        </span>
                        {result.file.name}
                      </h4>
                      <p className="text-sm text-gray-600">{result.file.path}</p>
                      <div className="flex items-center space-x-4 text-xs text-gray-500 mt-1">
                        <span>{(result.file.size / 1024).toFixed(1)} KB</span>
                        <span>{new Date(result.file.modified).toLocaleDateString('nl-NL')}</span>
                        <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded">
                          Relevantie: {Math.round(result.relevanceScore * 100)}%
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {result.matchedContent && (
                    <div className="mt-3 p-3 bg-white rounded border">
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">
                        {result.matchedContent.length > 300 
                          ? result.matchedContent.substring(0, 300) + '...' 
                          : result.matchedContent
                        }
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No Results - only show in search mode */}
        {searchMode === 'search' && !isSearching && query && searchResults.length === 0 && aiResponse && (
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
                <li>• Stel specifieke vragen: "Wat zijn mijn projectdeadlines?"</li>
                <li>• Zoek op onderwerp: "Alle documenten over marketing"</li>
                <li>• Vraag om samenvattingen: "Vat mijn vergadernotities samen"</li>
                <li>• Zoek naar specifieke informatie: "Contactgegevens van klanten"</li>
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