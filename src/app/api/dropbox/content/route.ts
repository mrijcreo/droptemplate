import { NextRequest, NextResponse } from 'next/server'
import { Dropbox } from 'dropbox'
import fetch from 'node-fetch'

// Fix for pdf-parse ENOENT error in serverless environments
let pdfParse: any = null
let pdfParseInitialized = false

async function initializePdfParse() {
  if (!pdfParseInitialized) {
    try {
      // Import pdfjs-dist and disable worker to prevent file system access
      const pdfjs = await import('pdfjs-dist/build/pdf')
      pdfjs.GlobalWorkerOptions.workerSrc = null
      
      // Import pdf-parse after configuring pdfjs
      pdfParse = (await import('pdf-parse')).default
      pdfParseInitialized = true
    } catch (error) {
      console.error('Failed to initialize pdf-parse:', error)
      pdfParseInitialized = false
    }
  }
  return pdfParse
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
      const response = await dbx.filesDownload({ path: filePath })
      const fileBlob = (response.result as any).fileBinary

      let content = ''
      let extractionMethod = 'direct'
      let extractionSuccess = true

      if (fileType === 'text' || fileType === 'other') {
        // For text files, convert buffer to string with multiple encoding attempts
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
          
          extractionMethod = 'text-encoding'
        } catch (textError) {
          console.warn(`Text extraction failed for ${filePath}:`, textError)
          content = `[Tekstbestand: ${filePath}]\nFout bij tekstextractie. Bestand mogelijk beschadigd of gebruikt onbekende encoding.`
          extractionSuccess = false
        }
        
      } else if (fileType === 'pdf') {
        // VERBETERDE PDF parsing met betere tekstextractie
        try {
          let pdfBuffer: Buffer
          
          if (fileBlob instanceof ArrayBuffer) {
            pdfBuffer = Buffer.from(fileBlob)
          } else if (Buffer.isBuffer(fileBlob)) {
            pdfBuffer = fileBlob
          } else {
            pdfBuffer = Buffer.from(fileBlob)
          }

          // Validate PDF buffer
          if (pdfBuffer.length === 0) {
            throw new Error('PDF bestand is leeg')
          }

          // Check if it's actually a PDF file
          const pdfHeader = pdfBuffer.slice(0, 4).toString()
          if (pdfHeader !== '%PDF') {
            throw new Error('Bestand is geen geldig PDF formaat')
          }

          // Strategy 1: Try with pdf-parse with enhanced options
          try {
            const pdfParseLib = await initializePdfParse()
            
            if (!pdfParseLib) {
              throw new Error('PDF-parse library not available')
            }
            
            // Enhanced options for better text extraction
            const options = {
              max: 0, // No page limit
              version: 'default',
              // Disable worker to prevent issues
              normalizeWhitespace: true,
              disableCombineTextItems: false
            }
            
            const pdfData = await pdfParseLib(pdfBuffer, options)
            let extractedText = pdfData.text || ''
            
            // KRITIEKE VERBETERING: Tekst cleaning en normalisatie
            if (extractedText) {
              // Remove problematic characters and normalize text
              extractedText = extractedText
                // Remove null bytes and control characters
                .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
                // Normalize Unicode characters
                .normalize('NFKC')
                // Fix common PDF extraction issues
                .replace(/([a-z])([A-Z])/g, '$1 $2') // Add space between camelCase
                .replace(/([.!?])([A-Z])/g, '$1 $2') // Add space after sentence endings
                .replace(/([a-zA-Z])(\d)/g, '$1 $2') // Add space between letters and numbers
                .replace(/(\d)([a-zA-Z])/g, '$1 $2') // Add space between numbers and letters
                // Normalize whitespace
                .replace(/\s+/g, ' ')
                .replace(/\n\s*\n/g, '\n\n')
                .trim()
              
              // Filter out lines that are mostly garbage characters
              const lines = extractedText.split('\n')
              const cleanLines = lines.filter(line => {
                const cleanLine = line.trim()
                if (cleanLine.length < 3) return false
                
                // Check if line contains mostly readable characters
                const readableChars = cleanLine.match(/[a-zA-Z0-9\s.,!?;:()\-]/g) || []
                const readableRatio = readableChars.length / cleanLine.length
                
                return readableRatio > 0.7 // At least 70% readable characters
              })
              
              content = cleanLines.join('\n')
            }
            
            // Add comprehensive metadata if available
            if (pdfData.info) {
              const metadata = []
              if (pdfData.info.Title && pdfData.info.Title.trim()) {
                const title = pdfData.info.Title.trim().normalize('NFKC')
                metadata.push(`Titel: ${title}`)
              }
              if (pdfData.info.Author && pdfData.info.Author.trim()) {
                const author = pdfData.info.Author.trim().normalize('NFKC')
                metadata.push(`Auteur: ${author}`)
              }
              if (pdfData.info.Subject && pdfData.info.Subject.trim()) {
                const subject = pdfData.info.Subject.trim().normalize('NFKC')
                metadata.push(`Onderwerp: ${subject}`)
              }
              if (pdfData.info.Creator && pdfData.info.Creator.trim()) {
                const creator = pdfData.info.Creator.trim().normalize('NFKC')
                metadata.push(`Gemaakt met: ${creator}`)
              }
              if (pdfData.numpages) metadata.push(`Aantal pagina's: ${pdfData.numpages}`)
              
              if (metadata.length > 0) {
                content = `[PDF Metadata]\n${metadata.join('\n')}\n\n[PDF Inhoud]\n${content}`
              }
            }

            extractionMethod = 'pdf-parse-enhanced'
            
            // Validate extracted content quality
            if (!content || content.trim().length < 20) {
              throw new Error('Geen bruikbare tekst geëxtraheerd')
            }
            
          } catch (pdfParseError) {
            console.warn(`PDF-parse failed for ${filePath}, trying alternative method:`, pdfParseError)
            
            // Strategy 2: Enhanced regex-based extraction
            try {
              const pdfText = pdfBuffer.toString('latin1')
              
              // Multiple regex patterns for different PDF text encodings
              const patterns = [
                /\(([^)]+)\)/g,  // Text in parentheses
                /\[([^\]]+)\]/g, // Text in brackets
                /BT\s+([^ET]+)\s+ET/g, // Text between BT and ET operators
                /Tj\s*\(([^)]+)\)/g, // Tj operator with text
                /TJ\s*\[([^\]]+)\]/g  // TJ operator with text array
              ]
              
              let extractedTexts: string[] = []
              
              for (const pattern of patterns) {
                const matches = pdfText.match(pattern)
                if (matches) {
                  extractedTexts.push(...matches.map(match => {
                    // Clean up the matched text
                    return match
                      .replace(/^\(|\)$/g, '') // Remove parentheses
                      .replace(/^\[|\]$/g, '') // Remove brackets
                      .replace(/BT\s*|\s*ET/g, '') // Remove BT/ET
                      .replace(/Tj\s*\(|\)/g, '') // Remove Tj operators
                      .replace(/TJ\s*\[|\]/g, '') // Remove TJ operators
                      .trim()
                  }))
                }
              }
              
              if (extractedTexts.length > 0) {
                // Filter and clean extracted text
                const cleanTexts = extractedTexts
                  .filter(text => text.length > 2 && /[a-zA-Z]/.test(text))
                  .map(text => text.normalize('NFKC'))
                  .filter(text => {
                    // Filter out garbage text
                    const readableChars = text.match(/[a-zA-Z0-9\s.,!?;:()\-]/g) || []
                    return readableChars.length / text.length > 0.6
                  })
                
                content = cleanTexts.join(' ').replace(/\s+/g, ' ').trim()
                extractionMethod = 'pdf-regex-enhanced'
              }
              
              if (!content || content.length < 20) {
                throw new Error('Regex extractie leverde geen bruikbare tekst op')
              }
              
            } catch (regexError) {
              throw pdfParseError // Re-throw original error if regex also fails
            }
          }

          // Final validation and fallback
          if (!content || content.trim().length < 20) {
            content = `[PDF bestand: ${filePath}]\n[Status: Tekst extractie mislukt]\n\nDit PDF bestand bevat mogelijk:\n- Alleen afbeeldingen (gescande documenten)\n- Beveiligde/versleutelde tekst\n- Complexe formatting\n- Niet-standaard encoding\n\nVoor betere doorzoekbaarheid:\n1. Gebruik OCR software voor gescande PDF's\n2. Converteer naar tekstformaat\n3. Controleer of het PDF beveiligd is\n\nBestand wordt geregistreerd voor bestandsnaam-zoekopdrachten.`
            extractionSuccess = false
          }
          
        } catch (pdfError) {
          console.error('All PDF parsing strategies failed:', pdfError)
          
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
          
          content = `[PDF bestand: ${filePath}]\n[Status: Fout bij verwerking - ${errorMessage}]\n\nDit PDF bestand kon niet automatisch worden verwerkt.\n\nMogelijke oplossingen:\n- Converteer PDF naar tekstformaat\n- Gebruik OCR software voor gescande PDF's\n- Controleer of het bestand beschadigd is\n- Probeer een andere PDF viewer\n\nBestand wordt geregistreerd voor bestandsnaam-zoekopdrachten.`
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
            content = content
              .normalize('NFKC')
              .replace(/\r\n/g, '\n')
              .replace(/\r/g, '\n')
              .replace(/\s+/g, ' ')
              .replace(/\n\s*\n/g, '\n\n')
              .trim()
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
        // Remove any remaining problematic characters
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