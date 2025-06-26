'use client'

import { useState, useRef } from 'react'
import MarkdownRenderer from './MarkdownRenderer'
import ResponseActions from './ResponseActions'

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

interface ChatMessage {
  id: string
  type: 'user' | 'ai'
  content: string
  timestamp: Date
  pdfContext?: string[]
}

interface PDFChatInterfaceProps {
  pdfFiles: PDFFile[]
  accessToken: string
}

export default function PDFChatInterface({ pdfFiles, accessToken }: PDFChatInterfaceProps) {
  const [query, setQuery] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [selectedPDFs, setSelectedPDFs] = useState<string[]>([]) // Empty = all PDFs
  const [showPDFSelector, setShowPDFSelector] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Get available PDFs (only loaded ones)
  const availablePDFs = pdfFiles.filter(pdf => pdf.isLoaded && pdf.content && pdf.content.length > 50)
  
  // Get PDFs to use for query (selected or all)
  const pdfsToUse = selectedPDFs.length > 0 
    ? availablePDFs.filter(pdf => selectedPDFs.includes(pdf.id))
    : availablePDFs

  const addMessage = (type: 'user' | 'ai', content: string, pdfContext?: string[]) => {
    const message: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      content,
      timestamp: new Date(),
      pdfContext
    }
    setChatHistory(prev => [...prev, message])
    return message
  }

  const clearChat = () => {
    setChatHistory([])
  }

  const togglePDFSelection = (pdfId: string) => {
    setSelectedPDFs(prev => 
      prev.includes(pdfId) 
        ? prev.filter(id => id !== pdfId)
        : [...prev, pdfId]
    )
  }

  const selectAllPDFs = () => {
    setSelectedPDFs(availablePDFs.map(pdf => pdf.id))
  }

  const deselectAllPDFs = () => {
    setSelectedPDFs([])
  }

  const askAI = async () => {
    if (!query.trim() || pdfsToUse.length === 0) return

    // Add user message
    const userMessage = addMessage('user', query, pdfsToUse.map(pdf => pdf.name))
    
    setIsProcessing(true)
    setIsStreaming(false)

    // Create abort controller for this request
    abortControllerRef.current = new AbortController()

    try {
      // Prepare context from selected PDFs
      const pdfContext = pdfsToUse.map((pdf, index) => {
        const content = pdf.content || ''
        // Limit content per PDF to prevent overwhelming the AI
        const limitedContent = content.length > 5000 
          ? content.substring(0, 5000) + '...[PDF ingekort voor context]'
          : content
          
        return `[PDF ${index + 1}: ${pdf.name}]
Pad: ${pdf.path}
Grootte: ${(pdf.size / 1024).toFixed(1)} KB
Laatst gewijzigd: ${new Date(pdf.modified).toLocaleDateString('nl-NL')}

Inhoud:
${limitedContent}

---`
      }).join('\n\n')

      const prompt = `Beantwoord de vraag "${query}" op basis van de volgende PDF bestanden uit de Dropbox van de gebruiker.

PDF BESTANDEN (${pdfsToUse.length} van ${availablePDFs.length} beschikbaar):
${pdfContext}

INSTRUCTIES:
- Geef een duidelijk en uitgebreid antwoord gebaseerd op de inhoud van deze PDF bestanden
- Verwijs specifiek naar PDF bestandsnamen waar relevant
- Citeer relevante passages uit de PDF's
- Als informatie ontbreekt in de PDF's, geef dat duidelijk aan
- Structureer je antwoord logisch met kopjes waar nuttig
- Geef praktische tips of vervolgstappen waar mogelijk
- Focus op de specifieke vraag en gebruik de PDF inhoud als basis

Antwoord:`

      // Start AI message
      const aiMessage = addMessage('ai', '', pdfsToUse.map(pdf => pdf.name))
      
      setIsStreaming(true)

      const response = await fetch('/api/ai-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: abortControllerRef.current.signal
      })

      if (!response.ok) {
        throw new Error('AI response fout')
      }

      await handleStreamingResponse(response, aiMessage.id)

    } catch (error: any) {
      console.error('AI response error:', error)
      
      if (error.name === 'AbortError') {
        addMessage('ai', 'AI response gestopt door gebruiker.')
      } else {
        addMessage('ai', 'Fout bij genereren AI antwoord: ' + (error instanceof Error ? error.message : 'Onbekende fout'))
      }
    } finally {
      setIsProcessing(false)
      setIsStreaming(false)
      abortControllerRef.current = null
      setQuery('') // Clear query after sending
    }
  }

  const handleStreamingResponse = async (response: Response, messageId: string) => {
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
              // Update the AI message in chat history
              setChatHistory(prev => 
                prev.map(msg => 
                  msg.id === messageId 
                    ? { ...msg, content: fullResponse }
                    : msg
                )
              )
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
      askAI()
    }
  }

  if (availablePDFs.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center">
          <span className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center mr-3">
            🤖
          </span>
          PDF Chat Interface
        </h2>
        
        <div className="text-center py-8">
          <div className="text-6xl mb-4">📄</div>
          <h3 className="text-lg font-medium text-gray-800 mb-2">Geen PDF bestanden beschikbaar</h3>
          <p className="text-gray-600">
            Laad eerst je PDF bestanden om vragen te kunnen stellen.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-purple-800 flex items-center">
          <span className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center mr-3">
            🤖
          </span>
          PDF Chat Interface
        </h2>

        <div className="flex items-center space-x-2">
          {/* PDF Selector Toggle */}
          <button
            onClick={() => setShowPDFSelector(!showPDFSelector)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center space-x-1 ${
              showPDFSelector
                ? 'bg-purple-100 text-purple-700 border border-purple-200'
                : 'bg-gray-100 hover:bg-purple-100 text-gray-700 hover:text-purple-700 border border-gray-200'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>PDF's ({pdfsToUse.length}/{availablePDFs.length})</span>
          </button>

          {/* Clear Chat */}
          {chatHistory.length > 0 && (
            <button
              onClick={clearChat}
              className="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-medium transition-all duration-200 flex items-center space-x-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>Wis Chat</span>
            </button>
          )}
        </div>
      </div>

      {/* PDF Selector Panel */}
      {showPDFSelector && (
        <div className="mb-6 bg-purple-50 border border-purple-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-purple-800">Selecteer PDF Bestanden</h3>
            <div className="flex items-center space-x-2">
              <button
                onClick={selectAllPDFs}
                className="text-xs text-purple-600 hover:text-purple-800 px-2 py-1 rounded"
              >
                Alles
              </button>
              <button
                onClick={deselectAllPDFs}
                className="text-xs text-purple-600 hover:text-purple-800 px-2 py-1 rounded"
              >
                Niets
              </button>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-60 overflow-y-auto">
            {availablePDFs.map((pdf) => (
              <div
                key={pdf.id}
                className={`border rounded-lg p-3 cursor-pointer transition-all ${
                  selectedPDFs.includes(pdf.id) || selectedPDFs.length === 0
                    ? 'border-purple-500 bg-purple-100' 
                    : 'border-gray-200 hover:border-purple-300 bg-white'
                }`}
                onClick={() => togglePDFSelection(pdf.id)}
              >
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={selectedPDFs.includes(pdf.id) || selectedPDFs.length === 0}
                    onChange={() => togglePDFSelection(pdf.id)}
                    className="rounded text-purple-600"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="text-lg">📄</span>
                </div>
                
                <div className="text-xs mt-2">
                  <p className="font-medium truncate text-gray-800" title={pdf.name}>
                    {pdf.name}
                  </p>
                  <p className="text-gray-600">
                    {(pdf.size / 1024).toFixed(1)} KB • {pdf.content?.length || 0} chars
                  </p>
                </div>
              </div>
            ))}
          </div>
          
          <p className="text-xs text-purple-700 mt-3">
            {selectedPDFs.length === 0 
              ? `Alle ${availablePDFs.length} PDF bestanden worden gebruikt voor AI vragen`
              : `${selectedPDFs.length} van ${availablePDFs.length} PDF bestanden geselecteerd`
            }
          </p>
        </div>
      )}

      {/* Chat History */}
      {chatHistory.length > 0 && (
        <div className="mb-6 space-y-4 max-h-96 overflow-y-auto border border-gray-200 rounded-lg p-4">
          {chatHistory.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-3xl rounded-lg p-4 ${
                  message.type === 'user'
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                {message.type === 'user' ? (
                  <div>
                    <p className="font-medium">{message.content}</p>
                    {message.pdfContext && message.pdfContext.length > 0 && (
                      <p className="text-xs text-purple-200 mt-2">
                        📄 Context: {message.pdfContext.join(', ')}
                      </p>
                    )}
                  </div>
                ) : (
                  <div>
                    <MarkdownRenderer content={message.content} className="text-gray-800" />
                    {message.content && (
                      <ResponseActions 
                        content={message.content}
                        isMarkdown={true}
                        isStreaming={false}
                        className="mt-3"
                      />
                    )}
                    {message.pdfContext && message.pdfContext.length > 0 && (
                      <p className="text-xs text-gray-500 mt-3 border-t pt-2">
                        📄 Gebaseerd op: {message.pdfContext.join(', ')}
                      </p>
                    )}
                  </div>
                )}
                <p className="text-xs opacity-70 mt-2">
                  {message.timestamp.toLocaleTimeString('nl-NL')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div className="space-y-4">
        {/* Status Info */}
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <p className="text-sm text-purple-700">
            🤖 <strong>AI Chat met {pdfsToUse.length} PDF bestanden</strong> • 
            Stel vragen over de inhoud van je PDF documenten
          </p>
          <p className="text-xs text-purple-600 mt-1">
            Voorbeelden: "Wat staat er over rubrieken?", "Vat de belangrijkste punten samen", "Welke criteria worden gebruikt?"
          </p>
        </div>

        {/* Input */}
        <div className="flex items-end space-x-4">
          <div className="flex-1">
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Stel een vraag over je PDF bestanden..."
              className="w-full px-4 py-3 border-2 border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none"
              rows={3}
              disabled={isProcessing}
            />
          </div>
          
          <div className="flex flex-col space-y-2">
            <button
              onClick={askAI}
              disabled={isProcessing || !query.trim() || pdfsToUse.length === 0}
              className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center font-semibold"
            >
              {isProcessing ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                  {isStreaming ? 'AI denkt...' : 'Verwerken...'}
                </>
              ) : (
                <>
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Vraag AI
                </>
              )}
            </button>

            {isStreaming && (
              <button
                onClick={stopAIResponse}
                className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors text-sm"
              >
                Stop
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Usage Tips */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="text-sm font-medium text-blue-800 mb-2">💡 Tips voor betere AI antwoorden:</h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• <strong>Specifiek zijn:</strong> "Wat staat er over rubrieken in Canvas 4?" in plaats van "Vertel over rubrieken"</li>
          <li>• <strong>Context vragen:</strong> "Vergelijk de evaluatiecriteria in verschillende documenten"</li>
          <li>• <strong>Samenvatten:</strong> "Vat de belangrijkste punten samen uit alle PDF's"</li>
          <li>• <strong>Zoeken:</strong> "Zoek alle informatie over beoordeling en feedback"</li>
          <li>• <strong>Analyseren:</strong> "Welke stappen worden beschreven voor peer-evaluatie?"</li>
        </ul>
      </div>
    </div>
  )
}