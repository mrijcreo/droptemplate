import { NextRequest, NextResponse } from 'next/server'
import { Dropbox } from 'dropbox'
import fetch from 'node-fetch'

// Enhanced PDF parsing with multiple strategies
let pdfParse: any = null
let pdfParseInitialized = false

async function initializePdfParse() {
  if (!pdfParseInitialized) {
    try {
      // Import pdf-parse directly without pdfjs configuration
      pdfParse = (await import('pdf-parse')).default
      pdfParseInitialized = true
      console.log('✅ PDF-parse initialized successfully')
    } catch (error) {
      console.error('❌ Failed to initialize pdf-parse:', error)
      pdfParseInitialized = false
      pdfParse = null
    }
  }
  return pdfParse
}

// Advanced text cleaning function specifically for PDF content
function cleanPdfText(text: string): string {
  if (!text) return ''
  
  return text
    // Remove null bytes and problematic control characters
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
    // Fix common PDF encoding issues
    .replace(/\uFFFD/g, '') // Remove replacement characters
    .replace(/\u00A0/g, ' ') // Non-breaking space to regular space
    // Fix common PDF text extraction artifacts
    .replace(/([a-z])([A-Z])/g, '$1 $2') // Add space between camelCase
    .replace(/([.!?])([A-Z])/g, '$1 $2') // Add space after sentence endings
    .replace(/([a-zA-Z])(\d)/g, '$1 $2') // Add space between letters and numbers
    .replace(/(\d)([a-zA-Z])/g, '$1 $2') // Add space between numbers and letters
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim()
}

// Function to detect if text contains meaningful content
function hasReadableContent(text: string): boolean {
  if (!text || text.length < 20) return false
  
  // Count Dutch/English words and readable patterns
  const words = text.match(/\b[a-zA-ZàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿĀāĂăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĦħĨĩĪīĬĭĮįİıĲĳĴĵĶķĸĹĺĻļĽľĿŀŁłŃńŅņŇňŉŊŋŌōŎŏŐőŒœŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŦŧŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽž]{2,}\b/g) || []
  const readableChars = text.match(/[a-zA-Z0-9\s.,!?;:()\-]/g) || []
  
  // Check if we have enough words and readable characters
  const wordRatio = words.length / (text.split(/\s+/).length || 1)
  const readableRatio = readableChars.length / text.length
  
  return words.length >= 5 && wordRatio > 0.3 && readableRatio > 0.7
}

// Enhanced PDF text extraction with focus on readable content
async function extractPdfTextAdvanced(pdfBuffer: Buffer, filePath: string): Promise<{ content: string, method: string, success: boolean }> {
  let content = ''
  let method = 'unknown'
  let success = false

  // Validate PDF buffer
  if (pdfBuffer.length === 0) {
    throw new Error('PDF bestand is leeg')
  }

  // Check if it's actually a PDF file
  const pdfHeader = pdfBuffer.slice(0, 5).toString('ascii')
  if (!pdfHeader.startsWith('%PDF')) {
    throw new Error('Bestand is geen geldig PDF formaat')
  }

  console.log(`🔍 Processing PDF: ${filePath} (${(pdfBuffer.length / 1024).toFixed(1)} KB)`)

  // Strategy 1: Enhanced pdf-parse with optimal settings
  try {
    const pdfParseLib = await initializePdfParse()
    
    if (pdfParseLib) {
      console.log(`📖 Trying enhanced pdf-parse for ${filePath}`)
      
      // Try with different options for better text extraction
      const options = {
        max: 0, // Process all pages
        version: 'default',
        normalizeWhitespace: true,
        disableCombineTextItems: false
      }
      
      const pdfData = await pdfParseLib(pdfBuffer, options)
      let extractedText = pdfData.text || ''
      
      if (extractedText && extractedText.trim().length > 50) {
        extractedText = cleanPdfText(extractedText)
        
        if (hasReadableContent(extractedText)) {
          content = extractedText
          
          // Add useful metadata
          const metadata = []
          if (pdfData.info) {
            if (pdfData.info.Title && pdfData.info.Title.trim() && hasReadableContent(pdfData.info.Title)) {
              metadata.push(`Titel: ${cleanPdfText(pdfData.info.Title)}`)
            }
            if (pdfData.info.Author && pdfData.info.Author.trim() && hasReadableContent(pdfData.info.Author)) {
              metadata.push(`Auteur: ${cleanPdfText(pdfData.info.Author)}`)
            }
            if (pdfData.info.Subject && pdfData.info.Subject.trim() && hasReadableContent(pdfData.info.Subject)) {
              metadata.push(`Onderwerp: ${cleanPdfText(pdfData.info.Subject)}`)
            }
            if (pdfData.numpages) {
              metadata.push(`Aantal pagina's: ${pdfData.numpages}`)
            }
          }
          
          if (metadata.length > 0) {
            content = `${metadata.join(' | ')}\n\n${content}`
          }
          
          method = 'pdf-parse-enhanced'
          success = true
          
          console.log(`✅ PDF-parse successful for ${filePath}: ${content.length} chars, readable content detected`)
          return { content, method, success }
        }
      }
    }
    
    throw new Error('PDF-parse produced no readable content')
    
  } catch (pdfParseError) {
    console.warn(`⚠️ PDF-parse failed for ${filePath}:`, pdfParseError.message)
  }

  // Strategy 2: Direct text stream extraction
  try {
    console.log(`🔄 Trying direct stream extraction for ${filePath}`)
    
    // Convert to different encodings to find readable text
    const encodings = ['utf8', 'latin1', 'ascii']
    let bestContent = ''
    let bestScore = 0
    
    for (const encoding of encodings) {
      try {
        const pdfText = pdfBuffer.toString(encoding as BufferEncoding)
        
        // Look for text streams and content
        const textPatterns = [
          // Text in parentheses (most common in PDF)
          /\(([^)]{10,})\)/g,
          // Text in brackets
          /\[([^\]]{10,})\]/g,
          // BT...ET text blocks
          /BT\s+(.*?)\s+ET/gs,
          // Stream content
          /stream\s+(.*?)\s+endstream/gs
        ]
        
        let extractedTexts: string[] = []
        
        for (const pattern of textPatterns) {
          const matches = [...pdfText.matchAll(pattern)]
          for (const match of matches) {
            let text = match[1] || match[0]
            text = text.replace(/^BT\s*|\s*ET$/g, '').trim()
            
            if (text.length > 10 && /[a-zA-Z]/.test(text)) {
              extractedTexts.push(text)
            }
          }
        }
        
        if (extractedTexts.length > 0) {
          const combinedText = extractedTexts.join(' ')
          const cleanedText = cleanPdfText(combinedText)
          
          if (hasReadableContent(cleanedText)) {
            const score = cleanedText.length * (cleanedText.match(/\b[a-zA-Z]{3,}\b/g) || []).length
            if (score > bestScore) {
              bestContent = cleanedText
              bestScore = score
            }
          }
        }
      } catch (encodingError) {
        console.warn(`Encoding ${encoding} failed for ${filePath}`)
      }
    }
    
    if (bestContent && bestScore > 100) {
      content = bestContent.substring(0, 50000) // Limit to 50KB
      method = 'stream-extraction'
      success = true
      
      console.log(`✅ Stream extraction successful for ${filePath}: ${content.length} chars`)
      return { content, method, success }
    }
    
    throw new Error('Stream extraction found no readable content')
    
  } catch (streamError) {
    console.warn(`⚠️ Stream extraction failed for ${filePath}:`, streamError.message)
  }

  // Strategy 3: OCR-style character detection
  try {
    console.log(`🔄 Trying character detection for ${filePath}`)
    
    const pdfText = pdfBuffer.toString('binary')
    
    // Look for readable character sequences
    const readableSequences = []
    let currentSequence = ''
    
    for (let i = 0; i < Math.min(pdfText.length, 50000); i++) {
      const char = pdfText[i]
      const charCode = char.charCodeAt(0)
      
      // Check if character is readable (letters, numbers, common punctuation)
      if ((charCode >= 32 && charCode <= 126) || (charCode >= 160 && charCode <= 255)) {
        if (/[a-zA-Z0-9\s.,!?;:()\-]/.test(char)) {
          currentSequence += char
        } else if (currentSequence.length > 0) {
          if (currentSequence.trim().length > 10 && /[a-zA-Z]/.test(currentSequence)) {
            readableSequences.push(currentSequence.trim())
          }
          currentSequence = ''
        }
      } else {
        if (currentSequence.length > 0) {
          if (currentSequence.trim().length > 10 && /[a-zA-Z]/.test(currentSequence)) {
            readableSequences.push(currentSequence.trim())
          }
          currentSequence = ''
        }
      }
    }
    
    // Add final sequence
    if (currentSequence.trim().length > 10 && /[a-zA-Z]/.test(currentSequence)) {
      readableSequences.push(currentSequence.trim())
    }
    
    if (readableSequences.length > 0) {
      const combinedText = readableSequences.join(' ')
      const cleanedText = cleanPdfText(combinedText)
      
      if (hasReadableContent(cleanedText)) {
        content = cleanedText.substring(0, 30000) // Limit to 30KB
        method = 'character-detection'
        success = true
        
        console.log(`✅ Character detection found readable content for ${filePath}: ${content.length} chars`)
        return { content, method, success }
      }
    }
    
    throw new Error('Character detection found no readable sequences')
    
  } catch (charError) {
    console.warn(`⚠️ Character detection failed for ${filePath}:`, charError.message)
  }

  // If all strategies fail, provide informative error
  throw new Error(`Alle PDF tekstextractie strategieën faalden voor ${filePath}. Dit kan een gescand document, beveiligd PDF, of beschadigd bestand zijn.`)
}

export async function POST(request: NextRequest) {
  try {
    const { accessToken, filePath, fileType } = await request.json()

    if (!accessToken || !filePath) {
      return NextResponse.json(
        { success: false, error: 'Access token and file path are required' },
        { status: 400 }
      )
    }

    // KRITIEKE WIJZIGING: Alleen PDF bestanden verwerken
    if (fileType !== 'pdf') {
      return NextResponse.json(
        { success: false, error: 'Only PDF files are supported' },
        { status: 400 }
      )
    }

    const dbx = new Dropbox({ accessToken, fetch: fetch as any })

    try {
      // Download file content
      console.log(`📥 Downloading PDF: ${filePath}`)
      const response = await dbx.filesDownload({ path: filePath })
      const fileBlob = (response.result as any).fileBinary

      let content = ''
      let extractionMethod = 'unknown'
      let extractionSuccess = false

      // FOCUS: Alleen PDF verwerking
      try {
        let pdfBuffer: Buffer
        
        if (fileBlob instanceof ArrayBuffer) {
          pdfBuffer = Buffer.from(fileBlob)
        } else if (Buffer.isBuffer(fileBlob)) {
          pdfBuffer = fileBlob
        } else {
          pdfBuffer = Buffer.from(fileBlob)
        }

        console.log(`🔍 Processing PDF: ${filePath} (${(pdfBuffer.length / 1024).toFixed(1)} KB)`)
        
        const result = await extractPdfTextAdvanced(pdfBuffer, filePath)
        content = result.content
        extractionMethod = result.method
        extractionSuccess = result.success
        
        console.log(`✅ PDF processed successfully: ${filePath} using ${extractionMethod}`)
        
      } catch (pdfError) {
        console.error(`❌ PDF extraction failed for ${filePath}:`, pdfError)
        
        let errorMessage = 'Onbekende fout bij PDF verwerking'
        
        if (pdfError instanceof Error) {
          if (pdfError.message.includes('Invalid PDF') || pdfError.message.includes('not a valid')) {
            errorMessage = 'Ongeldig PDF formaat'
          } else if (pdfError.message.includes('encrypted') || pdfError.message.includes('password')) {
            errorMessage = 'PDF is beveiligd met een wachtwoord'
          } else if (pdfError.message.includes('corrupted')) {
            errorMessage = 'PDF bestand is beschadigd'
          } else {
            errorMessage = pdfError.message
          }
        }
        
        content = `[PDF: ${filePath}]
[Status: Extractie gefaald - ${errorMessage}]

Dit PDF bestand kon niet automatisch worden gelezen.

Mogelijke oorzaken:
- Gescand document (alleen afbeeldingen, geen tekst)
- Beveiligd/versleuteld PDF
- Beschadigd bestand
- Complexe formatting of speciale encoding

Het bestand is wel geregistreerd voor bestandsnaam-zoekopdrachten.`
        
        extractionSuccess = false
        extractionMethod = 'pdf-error-fallback'
      }

      // Final content validation
      if (content && content.length > 0) {
        // Final cleanup for PDF content
        content = content
          .replace(/\0/g, '') // Remove null bytes
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
          .replace(/\r\n/g, '\n') // Normalize line endings
          .replace(/\r/g, '\n')
          .replace(/\f/g, '\n') // Replace form feeds
          .replace(/\v/g, '\n') // Replace vertical tabs
          .replace(/[ \t]+/g, ' ') // Multiple spaces to single space
          .replace(/\n[ \t]+/g, '\n') // Remove leading whitespace
          .replace(/[ \t]+\n/g, '\n') // Remove trailing whitespace
          .replace(/\n{4,}/g, '\n\n\n') // Max 3 consecutive newlines
          .trim()
        
        // Intelligent truncation for very large PDFs
        if (content.length > 100000) {
          let truncateAt = 100000
          const sentenceEnd = content.lastIndexOf('.', truncateAt)
          const paragraphEnd = content.lastIndexOf('\n\n', truncateAt)
          
          if (sentenceEnd > truncateAt - 1000) {
            truncateAt = sentenceEnd + 1
          } else if (paragraphEnd > truncateAt - 2000) {
            truncateAt = paragraphEnd + 2
          }
          
          content = content.substring(0, truncateAt) + '\n\n[PDF ingekort - eerste 100.000 karakters getoond voor indexering]'
        }
      }

      // Ensure we always have indexable content
      if (!content || content.trim().length < 10) {
        content = `[PDF: ${filePath}]
[Status: Geen leesbare tekst gevonden]

Dit PDF bestand bevat mogelijk:
- Alleen afbeeldingen (gescand document)
- Beveiligde/versleutelde inhoud
- Complexe formatting

Voor gescande PDF's is OCR (Optical Character Recognition) nodig.
Het bestand wordt geregistreerd voor bestandsnaam-zoekopdrachten.`
        extractionSuccess = false
      }

      console.log(`✅ PDF processed: ${filePath} -> ${content.length} chars (${extractionMethod}, success: ${extractionSuccess})`)

      return NextResponse.json({
        success: true,
        content: content,
        filePath: filePath,
        fileType: fileType,
        size: content.length,
        originalSize: fileBlob instanceof ArrayBuffer ? fileBlob.byteLength : 
                     Buffer.isBuffer(fileBlob) ? fileBlob.length : 
                     String(fileBlob).length,
        extractionMethod: extractionMethod,
        extractionSuccess: extractionSuccess
      })

    } catch (dropboxError: any) {
      console.error('Dropbox download error:', dropboxError)
      
      let errorMessage = 'Failed to download PDF from Dropbox'
      if (dropboxError.error?.error_summary) {
        errorMessage = dropboxError.error.error_summary
      } else if (dropboxError.message) {
        errorMessage = dropboxError.message
      }

      // Return fallback content for download errors
      const fallbackContent = `[PDF: ${filePath}]
[Status: Download fout - ${errorMessage}]

Dit PDF bestand kon niet worden gedownload van Dropbox.
Het bestand wordt geregistreerd voor bestandsnaam-zoekopdrachten.`

      return NextResponse.json({
        success: true,
        content: fallbackContent,
        filePath: filePath,
        fileType: fileType,
        size: fallbackContent.length,
        originalSize: 0,
        extractionMethod: 'download-error-fallback',
        extractionSuccess: false,
        error: errorMessage
      })
    }

  } catch (error) {
    console.error('Content API error:', error)
    
    const errorContent = `[PDF API Fout]
[Fout: ${error instanceof Error ? error.message : 'Unknown error'}]

Technische fout bij PDF verwerking.`
    
    return NextResponse.json(
      { 
        success: true,
        content: errorContent,
        filePath: 'unknown',
        fileType: 'pdf',
        size: errorContent.length,
        originalSize: 0,
        extractionMethod: 'api-error-fallback',
        extractionSuccess: false,
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 200 }
    )
  }
}