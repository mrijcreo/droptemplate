import { NextRequest, NextResponse } from 'next/server'
import { Dropbox } from 'dropbox'
import fetch from 'node-fetch'

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
        // Robuuste PDF parsing met meerdere fallback strategieën
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

          // Strategy 1: Try with pdf-parse but with safe options
          try {
            // Configure pdfjs-dist to prevent file system access
            const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js')
            pdfjsLib.GlobalWorkerOptions.workerSrc = ''
            
            const pdfParse = await import('pdf-parse').then(module => module.default)
            
            // Use safe options to prevent test file access
            const options = {
              // Disable any file system access
              max: 0, // No page limit
              version: 'default'
            }
            
            const pdfData = await pdfParse(pdfBuffer, options)
            content = pdfData.text || ''
            
            // Add comprehensive metadata
            if (pdfData.info) {
              const metadata = []
              if (pdfData.info.Title && pdfData.info.Title.trim()) metadata.push(`Titel: ${pdfData.info.Title.trim()}`)
              if (pdfData.info.Author && pdfData.info.Author.trim()) metadata.push(`Auteur: ${pdfData.info.Author.trim()}`)
              if (pdfData.info.Subject && pdfData.info.Subject.trim()) metadata.push(`Onderwerp: ${pdfData.info.Subject.trim()}`)
              if (pdfData.info.Creator && pdfData.info.Creator.trim()) metadata.push(`Gemaakt met: ${pdfData.info.Creator.trim()}`)
              if (pdfData.info.Producer && pdfData.info.Producer.trim()) metadata.push(`Verwerkt met: ${pdfData.info.Producer.trim()}`)
              if (pdfData.info.CreationDate) metadata.push(`Aangemaakt: ${pdfData.info.CreationDate}`)
              if (pdfData.info.ModDate) metadata.push(`Gewijzigd: ${pdfData.info.ModDate}`)
              if (pdfData.numpages) metadata.push(`Aantal pagina's: ${pdfData.numpages}`)
              
              if (metadata.length > 0) {
                content = `[PDF Metadata]\n${metadata.join('\n')}\n\n[PDF Inhoud]\n${content}`
              }
            }

            extractionMethod = 'pdf-parse-safe'
            
          } catch (pdfParseError) {
            console.warn(`PDF-parse failed for ${filePath}, trying alternative method:`, pdfParseError)
            
            // Strategy 2: Basic PDF text extraction fallback
            const pdfText = pdfBuffer.toString('binary')
            const textMatches = pdfText.match(/\(([^)]+)\)/g)
            
            if (textMatches && textMatches.length > 0) {
              content = textMatches
                .map(match => match.slice(1, -1)) // Remove parentheses
                .filter(text => text.length > 2 && /[a-zA-Z]/.test(text)) // Filter meaningful text
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim()
              
              extractionMethod = 'pdf-regex-fallback'
            } else {
              throw pdfParseError // Re-throw if no fallback worked
            }
          }

          // If no meaningful text was extracted
          if (!content || content.trim().length < 20) {
            content = `[PDF bestand: ${filePath}]\n[Metadata: ${pdfBuffer.length} bytes, PDF versie gedetecteerd]\n\nDit PDF bestand bevat mogelijk:\n- Alleen afbeeldingen (gescande documenten)\n- Beveiligde/versleutelde tekst\n- Complexe formatting die niet geëxtraheerd kan worden\n\nOm de inhoud volledig doorzoekbaar te maken:\n1. Gebruik OCR software voor gescande PDF's\n2. Controleer of het PDF beveiligd is\n3. Probeer het PDF opnieuw op te slaan vanuit de originele applicatie`
            extractionSuccess = false
          }
          
        } catch (pdfError) {
          console.error('All PDF parsing strategies failed:', pdfError)
          
          let errorMessage = 'Onbekende fout bij PDF verwerking'
          
          if (pdfError instanceof Error) {
            if (pdfError.message.includes('ENOENT') || pdfError.message.includes('test/data')) {
              errorMessage = 'PDF parser configuratiefout - bestand wordt overgeslagen maar indexering gaat door'
            } else if (pdfError.message.includes('Invalid PDF') || pdfError.message.includes('not a valid')) {
              errorMessage = 'Ongeldig PDF formaat'
            } else if (pdfError.message.includes('encrypted') || pdfError.message.includes('password')) {
              errorMessage = 'PDF is beveiligd met een wachtwoord'
            } else if (pdfError.message.includes('corrupted')) {
              errorMessage = 'PDF bestand is beschadigd'
            } else {
              errorMessage = pdfError.message
            }
          }
          
          content = `[PDF bestand: ${filePath}]\n[Status: Fout bij verwerking - ${errorMessage}]\n\nDit PDF bestand kon niet automatisch worden verwerkt, maar andere bestanden worden wel geïndexeerd.\n\nMogelijke oplossingen:\n- Converteer PDF naar tekstformaat\n- Gebruik OCR software voor gescande PDF's\n- Controleer of het bestand beschadigd is\n- Probeer een andere PDF viewer\n\nHet zoeksysteem blijft werken voor alle andere bestanden.`
          extractionSuccess = false
          extractionMethod = 'pdf-error-fallback'
        }
        
      } else if (fileType === 'docx') {
        // Robuuste DOCX parsing met fallback
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

          // Validate DOCX buffer
          if (docxBuffer.length === 0) {
            throw new Error('DOCX bestand is leeg')
          }
          
          // Try mammoth extraction with options
          const result = await mammoth.extractRawText({ 
            buffer: docxBuffer,
            // Add options for better extraction
            includeEmbeddedStyleMap: true
          })
          
          content = result.value || ''
          
          // Process warnings and messages
          if (result.messages && result.messages.length > 0) {
            const warnings = result.messages
              .filter(msg => msg.type === 'warning')
              .map(msg => msg.message)
              .slice(0, 5) // Limit warnings
              .join('\n')
            
            const errors = result.messages
              .filter(msg => msg.type === 'error')
              .map(msg => msg.message)
              .slice(0, 3) // Limit errors
              .join('\n')
            
            let messageInfo = ''
            if (warnings) messageInfo += `[Waarschuwingen]\n${warnings}\n\n`
            if (errors) messageInfo += `[Fouten]\n${errors}\n\n`
            
            if (messageInfo) {
              content = `${messageInfo}[DOCX Inhoud]\n${content}`
            }
          }

          // If no content extracted, try alternative approach
          if (!content || content.trim().length < 10) {
            // Try to extract any text using different method
            const zipContent = docxBuffer.toString('binary')
            const textMatches = zipContent.match(/>([^<]+)</g)
            
            if (textMatches && textMatches.length > 0) {
              const extractedText = textMatches
                .map(match => match.slice(1, -1)) // Remove > and <
                .filter(text => text.length > 2 && /[a-zA-Z]/.test(text))
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim()
              
              if (extractedText.length > 20) {
                content = `[DOCX Inhoud - Alternatieve extractie]\n${extractedText}`
                extractionMethod = 'docx-regex-fallback'
              }
            }
          }

          if (!content || content.trim().length < 10) {
            content = `[DOCX bestand: ${filePath}]\n[Status: Geen tekstinhoud geëxtraheerd]\n\nDit Word document bevat mogelijk:\n- Alleen afbeeldingen of tabellen\n- Complexe formatting\n- Beveiligde inhoud\n- Lege pagina's\n\nTip: Open het bestand in Word en sla het opnieuw op als .docx of .txt voor betere compatibiliteit.`
            extractionSuccess = false
          } else {
            extractionMethod = 'mammoth-success'
          }
          
        } catch (docxError) {
          console.error('DOCX parsing error:', docxError)
          
          let errorMessage = 'Onbekende fout bij DOCX verwerking'
          if (docxError instanceof Error) {
            if (docxError.message.includes('not a valid zip file') || docxError.message.includes('zip')) {
              errorMessage = 'Bestand is geen geldig DOCX formaat (geen ZIP structuur)'
            } else if (docxError.message.includes('corrupted')) {
              errorMessage = 'DOCX bestand is beschadigd'
            } else if (docxError.message.includes('password') || docxError.message.includes('encrypted')) {
              errorMessage = 'DOCX bestand is beveiligd'
            } else {
              errorMessage = docxError.message
            }
          }
          
          content = `[DOCX bestand: ${filePath}]\n[Status: Fout bij verwerking - ${errorMessage}]\n\nDit Word document kon niet worden verwerkt, maar andere bestanden worden wel geïndexeerd.\n\nMogelijke oplossingen:\n- Open in Microsoft Word en sla opnieuw op\n- Converteer naar .txt of .pdf formaat\n- Controleer of het bestand beschadigd is\n- Verwijder eventuele wachtwoordbeveiliging\n\nHet zoeksysteem blijft werken voor alle andere bestanden.`
          extractionSuccess = false
          extractionMethod = 'docx-error-fallback'
        }
        
      } else if (fileType === 'image') {
        // Enhanced image handling met meer informatie
        const imageInfo = []
        
        // Try to get basic image info
        try {
          const fileName = filePath.split('/').pop() || 'unknown'
          const fileExt = fileName.split('.').pop()?.toLowerCase() || 'unknown'
          const fileSize = fileBlob instanceof ArrayBuffer ? fileBlob.byteLength : 
                          Buffer.isBuffer(fileBlob) ? fileBlob.length : 
                          String(fileBlob).length
          
          imageInfo.push(`Bestandsnaam: ${fileName}`)
          imageInfo.push(`Formaat: ${fileExt.toUpperCase()}`)
          imageInfo.push(`Grootte: ${(fileSize / 1024).toFixed(1)} KB`)
          
        } catch (infoError) {
          console.warn('Could not extract image info:', infoError)
        }
        
        content = `[Afbeelding: ${filePath}]\n${imageInfo.join('\n')}\n\nAfbeelding gedetecteerd. Voor volledige doorzoekbaarheid zou OCR (Optical Character Recognition) geïmplementeerd kunnen worden.\n\nDeze afbeelding kan bevatten:\n- Tekst (documenten, screenshots, presentaties)\n- Diagrammen en grafieken\n- Foto's met tekst (borden, documenten)\n\nToekomstige functionaliteit:\n- Automatische tekstherkenning (OCR)\n- Objectdetectie en beschrijving\n- Handschriftherkenning\n\nTip: Als deze afbeelding belangrijke tekst bevat, kun je:\n1. Een OCR-tool gebruiken om de tekst te extraheren\n2. De tekst handmatig transcriberen\n3. Het bestand converteren naar een tekstformaat`
        extractionMethod = 'image-placeholder'
      }

      // Enhanced content validation and cleaning
      if (content && content.length > 0) {
        // Remove problematic characters but preserve structure
        content = content
          .replace(/\0/g, '') // Remove null bytes
          .replace(/\r\n/g, '\n') // Normalize line endings
          .replace(/\r/g, '\n')
          .replace(/\f/g, '\n') // Replace form feeds with newlines
          .replace(/\v/g, '\n') // Replace vertical tabs with newlines
        
        // Remove excessive whitespace but preserve paragraph structure
        content = content
          .replace(/[ \t]+/g, ' ') // Multiple spaces/tabs to single space
          .replace(/\n[ \t]+/g, '\n') // Remove leading whitespace on lines
          .replace(/[ \t]+\n/g, '\n') // Remove trailing whitespace on lines
          .replace(/\n{4,}/g, '\n\n\n') // Max 3 consecutive newlines
          .trim()
        
        // If content is too large, truncate intelligently
        if (content.length > 200000) { // Increased limit for better coverage
          // Try to truncate at a sentence or paragraph boundary
          let truncateAt = 200000
          const sentenceEnd = content.lastIndexOf('.', truncateAt)
          const paragraphEnd = content.lastIndexOf('\n\n', truncateAt)
          
          if (sentenceEnd > truncateAt - 1000) {
            truncateAt = sentenceEnd + 1
          } else if (paragraphEnd > truncateAt - 2000) {
            truncateAt = paragraphEnd + 2
          }
          
          content = content.substring(0, truncateAt) + '\n\n[Bestand ingekort - te groot voor volledige indexering. Eerste 200.000 karakters getoond. Voor volledige inhoud, open het originele bestand.]'
        }
      }

      // Ensure we always have some content for indexing
      if (!content || content.trim().length < 3) {
        content = `[Bestand: ${filePath}]\n[Type: ${fileType}]\n[Status: Geen tekstinhoud beschikbaar]\n\nDit bestand kon niet worden gelezen of bevat geen tekstuele inhoud.\n\nMogelijke redenen:\n- Leeg bestand\n- Binair formaat zonder tekst\n- Beschadigd bestand\n- Niet-ondersteund formaat\n- Technische fout bij verwerking\n\nHet bestand wordt wel geregistreerd in de index voor bestandsnaam-gebaseerde zoekopdrachten.`
        extractionSuccess = false
      }

      // Add file processing summary
      const processingInfo = {
        success: extractionSuccess,
        method: extractionMethod,
        contentLength: content.length,
        hasContent: content.trim().length > 50,
        timestamp: new Date().toISOString()
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
        extractionSuccess: extractionSuccess,
        processingInfo: processingInfo
      })

    } catch (dropboxError: any) {
      console.error('Dropbox download error:', dropboxError)
      
      let errorMessage = 'Failed to download file content'
      if (dropboxError.error?.error_summary) {
        errorMessage = dropboxError.error.error_summary
      } else if (dropboxError.message) {
        errorMessage = dropboxError.message
      }

      // Return a fallback content even for download errors
      const fallbackContent = `[Bestand: ${filePath}]\n[Status: Download fout]\n[Fout: ${errorMessage}]\n\nDit bestand kon niet worden gedownload van Dropbox.\n\nMogelijke oorzaken:\n- Netwerkproblemen\n- Bestand is verplaatst of verwijderd\n- Toegangsrechten gewijzigd\n- Dropbox API limiet bereikt\n\nHet bestand wordt geregistreerd voor bestandsnaam-gebaseerde zoekopdrachten.`

      return NextResponse.json({
        success: true, // Still return success to continue indexing other files
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
    
    // Even for API errors, try to return something useful
    const errorContent = `[API Fout voor bestand: ${request.url}]\n[Fout: ${error instanceof Error ? error.message : 'Unknown error'}]\n\nEr is een technische fout opgetreden bij het verwerken van dit bestand.\n\nHet indexeringsproces gaat door met andere bestanden.`
    
    return NextResponse.json(
      { 
        success: true, // Continue with other files
        content: errorContent,
        filePath: 'unknown',
        fileType: 'error',
        size: errorContent.length,
        originalSize: 0,
        extractionMethod: 'api-error-fallback',
        extractionSuccess: false,
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 200 } // Return 200 to continue processing
    )
  }
}