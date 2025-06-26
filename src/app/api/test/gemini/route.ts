import { GoogleGenerativeAI } from '@google/generative-ai'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { apiKey } = await request.json()
    
    // Use provided API key or environment variable
    const geminiApiKey = apiKey || process.env.GEMINI_API_KEY

    if (!geminiApiKey) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Geen Gemini API key gevonden. Voeg GEMINI_API_KEY toe aan .env.local of voer handmatig in.' 
        },
        { status: 400 }
      )
    }

    // Initialize Gemini AI client
    const genAI = new GoogleGenerativeAI(geminiApiKey)

    try {
      // Test with Gemini 2.5 Flash model
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
      
      const result = await model.generateContent({
        contents: [{ 
          role: 'user', 
          parts: [{ text: 'Zeg "Hallo! Gemini API test succesvol." in het Nederlands.' }] 
        }]
      })

      const response = await result.response
      const text = response.text()

      return NextResponse.json({
        success: true,
        model: 'gemini-2.5-flash',
        response: text,
        message: 'Gemini API test successful'
      })

    } catch (geminiError: any) {
      console.error('Gemini API error:', geminiError)
      
      let errorMessage = 'Unknown Gemini API error'
      if (geminiError.message) {
        errorMessage = geminiError.message
      } else if (geminiError.error) {
        errorMessage = geminiError.error.message || 'Gemini API error'
      }

      return NextResponse.json(
        { 
          success: false, 
          error: errorMessage,
          details: geminiError.status ? `HTTP ${geminiError.status}` : 'API error'
        },
        { status: 400 }
      )
    }

  } catch (error) {
    console.error('Test API error:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}