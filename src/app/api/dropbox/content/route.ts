import { NextRequest, NextResponse } from 'next/server'
import { Dropbox } from 'dropbox'
import fetch from 'node-fetch'

// Enhanced PDF parsing with multiple strategies
let pdfParse: any = null
let pdfParseInitialized = false

async function initializePdfParse() {
  if (!pdfParseInitialized) {
    try {
      // Import pdfjs-dist and configure for serverless environment
      const pdfjs = await import('pdfjs-dist/build/pdf')
      
      // Disable worker completely to prevent file system access
      pdfjs.GlobalWorkerOptions.workerSrc = null
      
      // Import pdf-parse after configuring pdfjs
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

// Advanced text cleaning function
function cleanExtractedText(text: string): string {
  if (!text) return ''
  
  return text
    // Remove null bytes and control characters
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Normalize Unicode
    .normalize('NFKC')
    // Fix common PDF extraction issues
    .replace(/([a-z])([A-Z])/g, '$1 $2') // Add space between camelCase
    .replace(/([.!?])([A-Z])/g, '$1 $2') // Add space after sentence endings
    .replace(/([a-zA-Z])(\d)/g, '$1 $2') // Add space between letters and numbers
    .replace(/(\d)([a-zA-Z])/g, '$1 $2') // Add space between numbers and letters
    // Remove excessive whitespace
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim()
}

// Function to detect if text is mostly garbage
function isGarbageText(text: string): boolean {
  if (!text || text.length < 10) return true
  
  // Count readable characters
  const readableChars = text.match(/[a-zA-Z0-9\s.,!?;:()\-]/g) || []
  const readableRatio = readableChars.length / text.length
  
  // If less than 60% readable characters, consider it garbage
  return readableRatio < 0.6
}

// Enhanced PDF text extraction with multiple strategies
async function extractPdfText(pdfBuffer: Buffer, filePath: string): Promise<{ content: string, method: string, success: boolean }> {
  let content = ''
  let method = 'unknown'
  let success = false

  // Validate PDF buffer
  if (pdfBuffer.length === 0) {
    throw new Error('PDF bestand is leeg')
  }

  // Check if it's actually a PDF file
  const pdfHeader = pdfBuffer.slice(0, 4).toString()
  if (pdfHeader !== '%PDF') {
    throw new Error('Bestand is geen geldig PDF formaat')
  }

  // Strategy 1: Enhanced pdf-parse with better options
  try {
    const pdfParseLib = await initializePdfParse()
    
    if (pdfParseLib) {
      console.log(`🔄 Trying pdf-parse for ${filePath}`)
      
      const options = {
        max: 0, // No page limit
        version: 'default',
        normalizeWhitespace: true,
        disableCombineTextItems: false
      }
      
      const pdfData = await pdfParseLib(pdfBuffer, options)
      let extractedText = pdfData.text || ''
      
      if (extractedText && extractedText.trim().length > 20) {
        extractedText = cleanExtractedText(extractedText)
        
        // Filter out garbage lines
        const lines = extractedText.split('\n')
        const cleanLines = lines.filter(line => {
          const cleanLine = line.trim()
          return cleanLine.length >= 3 && !isGarbageText(cleanLine)
        })
        
        content = cleanLines.join('\n')
        
        // Add metadata if available
        if (pdfData.info) {
          const metadata = []
          if (pdfData.info.Title && pdfData.info.Title.trim() && !isGarbageText(pdfData.info.Title)) {
            metadata.push(`Titel: ${cleanExtractedText(pdfData.info.Title)}`)
          }
          if (pdfData.info.Author && pdfData.info.Author.trim() && !isGarbageText(pdfData.info.Author)) {
            metadata.push(`Auteur: ${cleanExtractedText(pdfData.info.Author)}`)
          }
          if (pdfData.info.Subject && pdfData.info.Subject.trim() && !isGarbageText(pdfData.info.Subject)) {
            metadata.push(`Onderwerp: ${cleanExtractedText(pdfData.info.Subject)}`)
          }
          if (pdfData.numpages) {
            metadata.push(`Aantal pagina's: ${pdfData.numpages}`)
          }
          
          if (metadata.length > 0) {
            content = `[PDF Metadata]\n${metadata.join('\n')}\n\n[PDF Inhoud]\n${content}`
          }
        }
        
        method = 'pdf-parse-enhanced'
        success = true
        
        console.log(`✅ PDF-parse successful for ${filePath}: ${content.length} chars`)
        
        // Validate content quality
        if (content.trim().length < 50 || isGarbageText(content)) {
          throw new Error('Extracted content is mostly garbage')
        }
        
        return { content, method, success }
      }
    }
    
    throw new Error('PDF-parse produced no usable content')
    
  } catch (pdfParseError) {
    console.warn(`⚠️ PDF-parse failed for ${filePath}:`, pdfParseError.message)
  }

  // Strategy 2: Direct text extraction using regex patterns
  try {
    console.log(`🔄 Trying regex extraction for ${filePath}`)
    
    const pdfText = pdfBuffer.toString('latin1')
    
    // Enhanced regex patterns for different PDF text encodings
    const patterns = [
      // Standard text objects
      /BT\s+.*?ET/gs,
      // Text in parentheses (most common)
      /\(([^)]{3,})\)/g,
      // Text in brackets
      /\[([^\]]{3,})\]/g,
      // Tj operator with text
      /Tj\s*\(([^)]{3,})\)/g,
      // TJ operator with text array
      /TJ\s*\[([^\]]{3,})\]/g,
      // Show text operators
      /'\s*\(([^)]{3,})\)/g,
      /"\s*\(([^)]{3,})\)/g
    ]
    
    let extractedTexts: string[] = []
    
    for (const pattern of patterns) {
      const matches = [...pdfText.matchAll(pattern)]
      for (const match of matches) {
        let text = match[1] || match[0]
        
        // Clean up the matched text
        text = text
          .replace(/^BT\s*|\s*ET$/g, '') // Remove BT/ET
          .replace(/^\(|\)$/g, '') // Remove parentheses
          .replace(/^\[|\]$/g, '') // Remove brackets
          .replace(/Tj\s*\(|\)/g, '') // Remove Tj operators
          .replace(/TJ\s*\[|\]/g, '') // Remove TJ operators
          .replace(/['"]\s*\(|\)/g, '') // Remove quote operators
          .trim()
        
        if (text.length > 2 && /[a-zA-Z]/.test(text) && !isGarbageText(text)) {
          extractedTexts.push(text)
        }
      }
    }
    
    if (extractedTexts.length > 0) {
      // Remove duplicates and sort by length (longer texts first)
      const uniqueTexts = [...new Set(extractedTexts)]
        .filter(text => text.length > 5)
        .sort((a, b) => b.length - a.length)
      
      content = uniqueTexts.join(' ').replace(/\s+/g, ' ').trim()
      content = cleanExtractedText(content)
      
      method = 'regex-extraction'
      success = true
      
      console.log(`✅ Regex extraction successful for ${filePath}: ${content.length} chars`)
      
      if (content.length > 30 && !isGarbageText(content)) {
        return { content, method, success }
      }
    }
    
    throw new Error('Regex extraction produced no usable content')
    
  } catch (regexError) {
    console.warn(`⚠️ Regex extraction failed for ${filePath}:`, regexError.message)
  }

  // Strategy 3: Brute force text search
  try {
    console.log(`🔄 Trying brute force extraction for ${filePath}`)
    
    const pdfText = pdfBuffer.toString('utf8', 0, Math.min(pdfBuffer.length, 100000)) // First 100KB
    
    // Look for readable text sequences
    const readableTexts = pdfText.match(/[a-zA-Z][a-zA-Z0-9\s.,!?;:()\-]{10,}/g) || []
    
    if (readableTexts.length > 0) {
      const cleanTexts = readableTexts
        .filter(text => !isGarbageText(text))
        .map(text => cleanExtractedText(text))
        .filter(text => text.length > 10)
      
      if (cleanTexts.length > 0) {
        content = cleanTexts.join(' ').substring(0, 5000) // Limit to 5KB
        method = 'brute-force'
        success = true
        
        console.log(`✅ Brute force extraction found some text for ${filePath}: ${content.length} chars`)
        return { content, method, success }
      }
    }
    
    throw new Error('Brute force extraction found no readable text')
    
  } catch (bruteError) {
    console.warn(`⚠️ Brute force extraction failed for ${filePath}:`, bruteError.message)
  }

  // If all strategies fail, return descriptive error
  throw new Error('All PDF text extraction strategies failed')
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

    const dbx = new Dropbox({ accessToken, fetch: fetch as any })

    try {
      // Download file content
      console.log(`📥 Downloading ${filePath} (${fileType})`)
      const response = await dbx.filesDownload({ path: filePath })
      const fileBlob = (response.result as any).fileBinary

      let content = ''
      let extractionMethod = 'direct'
      let extractionSuccess = true

      if (fileType === 'text' || fileType === 'other') {
        // Enhanced text file processing
        try {
          if (fileBlob instanceof ArrayBuffer) {
            content = new TextDecoder('utf-8').decode(fileBlob)
          } else if (Buffer.isBuffer(fileBlob)) {
            content = fileBlob.toString('utf-8')
          } else {
            content = String(fileBlob)
          }
          
          // If UTF-8 fails, try other encodings
          if (!content || content.includes('�')) {
            if (fileBlob instanceof ArrayBuffer) {
              content = new TextDecoder('latin1').decode(fileBlob)
            } else if (Buffer.isBuffer(fileBlob)) {
              content = fileBlob.toString('latin1')
            }
          }
          
          content = cleanExtractedText(content)
          extractionMethod = 'text-encoding'
          
        } catch (textError) {
          console.warn(`Text extraction failed for ${filePath}:`, textError)
          content = `[Tekstbestand: ${filePath}]\nFout bij tekstextractie. Bestand mogelijk beschadigd of gebruikt onbekende encoding.`
          extractionSuccess = false
        }
        
      } else if (fileType === 'pdf') {
        // KRITIEKE VERBETERING: Robuuste PDF parsing
        try {
          let pdfBuffer: Buffer
          
          if (fileBlob instanceof ArrayBuffer) {
            pdfBuffer = Buffer.from(fileBlob)
          } else if (Buffer.isBuffer(fileBlob)) {
            pdfBuffer = fileBlob
          } else {
            pdfBuffer = Buffer.from(fileBlob)
          }

          console.log(`🔍 Processing PDF: ${filePath} (${pdfBuffer.length} bytes)`)
          
          const result = await extractPdfText(pdfBuffer, filePath)
          content = result.content
          extractionMethod = result.method
          extractionSuccess = result.success
          
          console.log(`✅ PDF processed successfully: ${filePath} using ${extractionMethod}`)
          
        } catch (pdfError) {
          console.error(`❌ All PDF extraction failed for ${filePath}:`, pdfError)
          
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
          
          content = `[PDF bestand: ${filePath}]
[Status: Fout bij verwerking - ${errorMessage}]

Dit PDF bestand kon niet automatisch worden verwerkt.

Mogelijke oorzaken:
- Gescand document (alleen afbeeldingen)
- Beveiligd/versleuteld PDF
- Beschadigd bestand
- Complexe formatting

Mogelijke oplossingen:
- Converteer PDF naar tekstformaat
- Gebruik OCR software voor gescande PDF's
- Controleer of het bestand beschadigd is
- Probeer een andere PDF viewer

Bestand wordt geregistreerd voor bestandsnaam-zoekopdrachten.`
          
          extractionSuccess = false
          extractionMethod = 'pdf-error-fallback'
        }
        
      } else if (fileType === 'docx') {
        // Enhanced DOCX parsing
        try {
          const mammoth = (await import('mammoth')).default
          let docxBuffer: Buffer
          
          if (fileBlob instanceof ArrayBuffer) {
            docxBuffer = Buffer.from(fileBlob)
          } else if (Buffer.isBuffer(fileBlob)) {
            docxBuffer = fileBlob
          } else {
            docxBuffer = Buffer.from(fileBlob)
          }

          if (docxBuffer.length === 0) {
            throw new Error('DOCX bestand is leeg')
          }
          
          const result = await mammoth.extractRawText({ 
            buffer: docxBuffer,
            includeEmbeddedStyleMap: true
          })
          
          content = result.value || ''
          
          // Clean and normalize DOCX content
          if (content) {
            content = cleanExtractedText(content)
          }
          
          if (result.messages && result.messages.length > 0) {
            const warnings = result.messages
              .filter(msg => msg.type === 'warning')
              .slice(0, 3)
              .map(msg => msg.message)
              .join('\n')
            
            if (warnings) {
              content = `[DOCX Extractie Info]\n${warnings}\n\n[DOCX Inhoud]\n${content}`
            }
          }

          if (!content || content.trim().length < 10) {
            content = `[DOCX bestand: ${filePath}]\n[Status: Geen tekstinhoud geëxtraheerd]\n\nDit Word document bevat mogelijk alleen afbeeldingen, tabellen of complexe formatting.\n\nTip: Open het bestand in Word en sla het opnieuw op als .docx of .txt voor betere compatibiliteit.`
            extractionSuccess = false
          } else {
            extractionMethod = 'mammoth-success'
          }
          
        } catch (docxError) {
          console.error('DOCX parsing error:', docxError)
          
          let errorMessage = 'Onbekende fout bij DOCX verwerking'
          if (docxError instanceof Error) {
            if (docxError.message.includes('not a valid zip file')) {
              errorMessage = 'Bestand is geen geldig DOCX formaat'
            } else if (docxError.message.includes('corrupted')) {
              errorMessage = 'DOCX bestand is beschadigd'
            } else {
              errorMessage = docxError.message
            }
          }
          
          content = `[DOCX bestand: ${filePath}]\n[Status: Fout bij verwerking - ${errorMessage}]\n\nDit Word document kon niet worden verwerkt.\n\nMogelijke oplossingen:\n- Open in Microsoft Word en sla opnieuw op\n- Converteer naar .txt formaat\n- Controleer of het bestand beschadigd is\n\nBestand wordt geregistreerd voor bestandsnaam-zoekopdrachten.`
          extractionSuccess = false
          extractionMethod = 'docx-error-fallback'
        }
        
      } else if (fileType === 'image') {
        // Image handling - provide useful placeholder
        const fileName = filePath.split('/').pop() || 'unknown'
        const fileExt = fileName.split('.').pop()?.toLowerCase() || 'unknown'
        const fileSize = fileBlob instanceof ArrayBuffer ? fileBlob.byteLength : 
                        Buffer.isBuffer(fileBlob) ? fileBlob.length : 
                        String(fileBlob).length
        
        content = `[Afbeelding: ${fileName}]\nFormaat: ${fileExt.toUpperCase()}\nGrootte: ${(fileSize / 1024).toFixed(1)} KB\n\nAfbeelding gedetecteerd. Voor tekstextractie uit afbeeldingen zou OCR (Optical Character Recognition) geïmplementeerd kunnen worden.`
        extractionMethod = 'image-placeholder'
      }

      // Final content validation and cleaning
      if (content && content.length > 0) {
        // Final cleanup
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
        
        // Intelligent truncation for very large files
        if (content.length > 200000) {
          let truncateAt = 200000
          const sentenceEnd = content.lastIndexOf('.', truncateAt)
          const paragraphEnd = content.lastIndexOf('\n\n', truncateAt)
          
          if (sentenceEnd > truncateAt - 1000) {
            truncateAt = sentenceEnd + 1
          } else if (paragraphEnd > truncateAt - 2000) {
            truncateAt = paragraphEnd + 2
          }
          
          content = content.substring(0, truncateAt) + '\n\n[Bestand ingekort - eerste 200.000 karakters getoond voor indexering]'
        }
      }

      // Ensure we always have indexable content
      if (!content || content.trim().length < 3) {
        content = `[Bestand: ${filePath}]\n[Type: ${fileType}]\n[Status: Geen tekstinhoud beschikbaar]\n\nDit bestand wordt geregistreerd voor bestandsnaam-gebaseerde zoekopdrachten.`
        extractionSuccess = false
      }

      console.log(`✅ File processed: ${filePath} -> ${content.length} chars (${extractionMethod})`)

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
      
      let errorMessage = 'Failed to download file content'
      if (dropboxError.error?.error_summary) {
        errorMessage = dropboxError.error.error_summary
      } else if (dropboxError.message) {
        errorMessage = dropboxError.message
      }

      // Return fallback content for download errors
      const fallbackContent = `[Bestand: ${filePath}]\n[Status: Download fout - ${errorMessage}]\n\nDit bestand kon niet worden gedownload van Dropbox maar wordt geregistreerd voor bestandsnaam-zoekopdrachten.`

      return NextResponse.json({
        success: true,
        content: fallbackContent,
        filePath: filePath,
        fileType: fileType,
        size: fallbackContent.length,
        originalSize: 0,
        extractionMethod: 'error-fallback',
        extractionSuccess: false,
        error: errorMessage
      })
    }

  } catch (error) {
    console.error('Content API error:', error)
    
    const errorContent = `[API Fout]\n[Fout: ${error instanceof Error ? error.message : 'Unknown error'}]\n\nTechnische fout bij bestandsverwerking. Indexering gaat door met andere bestanden.`
    
    return NextResponse.json(
      { 
        success: true,
        content: errorContent,
        filePath: 'unknown',
        fileType: 'error',
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