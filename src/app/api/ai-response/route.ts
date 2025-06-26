import { GoogleGenerativeAI } from '@google/generative-ai'
import { NextRequest, NextResponse } from 'next/server'

// Initialize Gemini AI client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')

export async function POST(request: NextRequest) {
  try {
    // Check API key
    if (!process.env.GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY not found in environment variables')
      return NextResponse.json(
        { 
          error: 'API configuratie ontbreekt. Check Environment Variables.',
          hint: 'Voeg GEMINI_API_KEY toe aan je environment variables'
        }, 
        { status: 500 }
      )
    }

    // Parse request data
    const body = await request.json()
    const { prompt } = body

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is vereist' },
        { status: 400 }
      )
    }

    // Input validation
    if (typeof prompt !== 'string' || prompt.length > 100000) {
      return NextResponse.json(
        { error: 'Prompt moet een string zijn van maximaal 100.000 karakters' },
        { status: 400 }
      )
    }

    // Use Gemini 2.5 Flash for fast responses
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

    // Create streaming response
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = await model.generateContentStream({
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
          })

          // Stream the response token by token
          for await (const chunk of result.stream) {
            const chunkText = chunk.text()
            
            if (chunkText) {
              try {
                const data = JSON.stringify({ 
                  token: chunkText,
                  timestamp: new Date().toISOString()
                })
                
                controller.enqueue(
                  new TextEncoder().encode(`data: ${data}\n\n`)
                )
              } catch (error) {
                console.log('Controller already closed, stopping stream')
                break
              }
            }
          }

          // Send completion signal
          try {
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify({ done: true })}\n\n`)
            )
            controller.close()
          } catch (error) {
            console.log('Controller already closed during completion')
          }

        } catch (error) {
          console.error('AI streaming error:', error)
          
          const errorData = JSON.stringify({
            error: true,
            message: error instanceof Error ? error.message : 'AI streaming error occurred'
          })
          
          controller.enqueue(
            new TextEncoder().encode(`data: ${errorData}\n\n`)
          )
          
          controller.close()
        }
      }
    })

    // Return streaming response with proper headers
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })

  } catch (error) {
    console.error('AI API error:', error)
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    return NextResponse.json(
      { 
        error: 'Er is een fout opgetreden bij het genereren van het AI antwoord',
        details: errorMessage,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
}