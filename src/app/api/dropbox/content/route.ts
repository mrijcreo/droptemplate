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

      if (fileType === 'text' || fileType === 'other') {
        // For text files, convert buffer to string
        if (fileBlob instanceof ArrayBuffer) {
          content = new TextDecoder('utf-8').decode(fileBlob)
        } else if (Buffer.isBuffer(fileBlob)) {
          content = fileBlob.toString('utf-8')
        } else {
          content = String(fileBlob)
        }
      } else if (fileType === 'pdf') {
        // Enhanced PDF parsing with better error handling
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

          // Dynamic import to avoid the test file issue
          const pdfParse = await import('pdf-parse').then(module => module.default)
          
          // Parse PDF with options to avoid test file conflicts
          const pdfData = await pdfParse(pdfBuffer, {
            // Disable any test-related functionality
            max: 0, // Parse all pages
            version: 'v1.10.100' // Specify version to avoid conflicts
          })
          
          content = pdfData.text || ''
          
          // Add metadata if available
          if (pdfData.info) {
            const metadata = []
            if (pdfData.info.Title) metadata.push(`Titel: ${pdfData.info.Title}`)
            if (pdfData.info.Author) metadata.push(`Auteur: ${pdfData.info.Author}`)
            if (pdfData.info.Subject) metadata.push(`Onderwerp: ${pdfData.info.Subject}`)
            if (pdfData.info.Creator) metadata.push(`Gemaakt met: ${pdfData.info.Creator}`)
            if (pdfData.numpages) metadata.push(`Aantal pagina's: ${pdfData.numpages}`)
            
            if (metadata.length > 0) {
              content = `[PDF Metadata]\n${metadata.join('\n')}\n\n[PDF Inhoud]\n${content}`
            }
          }

          // If no text was extracted, try alternative approach
          if (!content || content.trim().length < 10) {
            content = `[PDF bestand: ${filePath}]\nDit PDF bestand bevat mogelijk alleen afbeeldingen of is beveiligd tegen tekstextractie. Aantal pagina's: ${pdfData.numpages || 'onbekend'}\n\nOm de inhoud te kunnen doorzoeken, zou je het PDF bestand kunnen converteren naar een tekstformaat of een OCR-tool kunnen gebruiken.`
          }
          
        } catch (pdfError) {
          console.error('PDF parsing error:', pdfError)
          
          // Provide more specific error messages
          let errorMessage = 'Onbekende fout bij PDF verwerking'
          
          if (pdfError instanceof Error) {
            if (pdfError.message.includes('ENOENT')) {
              errorMessage = 'PDF parser configuratiefout - dit is een bekende issue die wordt opgelost'
            } else if (pdfError.message.includes('Invalid PDF')) {
              errorMessage = 'Ongeldig PDF formaat'
            } else if (pdfError.message.includes('encrypted') || pdfError.message.includes('password')) {
              errorMessage = 'PDF is beveiligd met een wachtwoord'
            } else if (pdfError.message.includes('corrupted')) {
              errorMessage = 'PDF bestand is beschadigd'
            } else {
              errorMessage = pdfError.message
            }
          }
          
          content = `[PDF bestand: ${filePath}]\nFout bij PDF extractie: ${errorMessage}\n\nDit PDF bestand kon niet worden gelezen. Mogelijke oorzaken:\n- Het bestand is beveiligd of versleuteld\n- Het bestand is beschadigd\n- Het bevat alleen afbeeldingen (geen tekst)\n- Er is een technische fout opgetreden\n\nTip: Probeer het PDF bestand te converteren naar een tekstformaat of gebruik een andere PDF viewer om de inhoud te controleren.`
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

          // Validate DOCX buffer
          if (docxBuffer.length === 0) {
            throw new Error('DOCX bestand is leeg')
          }
          
          const result = await mammoth.extractRawText({ buffer: docxBuffer })
          content = result.value || ''
          
          // Add warnings if any
          if (result.messages && result.messages.length > 0) {
            const warnings = result.messages
              .filter(msg => msg.type === 'warning')
              .map(msg => msg.message)
              .join('\n')
            
            if (warnings) {
              content = `[DOCX Extractie Waarschuwingen]\n${warnings}\n\n[DOCX Inhoud]\n${content}`
            }
          }

          // If no content extracted
          if (!content || content.trim().length < 10) {
            content = `[DOCX bestand: ${filePath}]\nGeen tekstuele inhoud gevonden in dit Word document. Het document kan leeg zijn of alleen afbeeldingen/tabellen bevatten.`
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
          
          content = `[DOCX bestand: ${filePath}]\nFout bij DOCX extractie: ${errorMessage}\n\nDit DOCX bestand kon niet worden gelezen. Mogelijke oorzaken:\n- Het bestand is beschadigd\n- Het is geen geldig Word document\n- Het bevat alleen afbeeldingen of complexe formatting\n\nTip: Probeer het bestand opnieuw op te slaan in Word of te converteren naar een ander formaat.`
        }
      } else if (fileType === 'image') {
        // Enhanced image handling - prepare for future OCR implementation
        content = `[Afbeelding: ${filePath}]\nAfbeelding gedetecteerd. OCR (Optical Character Recognition) voor tekstextractie uit afbeeldingen is nog niet geïmplementeerd.\n\nDit bestand zou geanalyseerd kunnen worden met computer vision voor:\n- Tekstherkenning (OCR)\n- Objectdetectie\n- Beschrijving van de inhoud\n\nTip: Als deze afbeelding tekst bevat, kun je deze handmatig transcriberen of een OCR-tool gebruiken.`
      }

      // Enhanced content validation and cleaning
      if (content && content.length > 0) {
        // Remove null bytes and other problematic characters
        content = content.replace(/\0/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        
        // Remove excessive whitespace but preserve structure
        content = content.replace(/\n{4,}/g, '\n\n\n').trim()
        
        // If content is too large, truncate but keep more content for better search
        if (content.length > 150000) { // Increased from 100000
          content = content.substring(0, 150000) + '\n\n[Bestand ingekort - te groot voor volledige indexering. Eerste 150.000 karakters getoond.]'
        }
      }

      // Ensure we have some content
      if (!content || content.length < 5) {
        content = `[Bestand: ${filePath}]\nGeen tekstuele inhoud gevonden of bestand kon niet worden gelezen.\n\nBestandstype: ${fileType}\nDit kan betekenen dat:\n- Het bestand leeg is\n- Het alleen afbeeldingen bevat\n- Het een niet-ondersteund formaat is\n- Er een technische fout is opgetreden`
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
        extractionMethod: fileType === 'pdf' ? 'pdf-parse' : 
                         fileType === 'docx' ? 'mammoth' : 
                         fileType === 'image' ? 'placeholder' : 'direct'
      })

    } catch (dropboxError: any) {
      console.error('Dropbox download error:', dropboxError)
      
      let errorMessage = 'Failed to download file content'
      if (dropboxError.error?.error_summary) {
        errorMessage = dropboxError.error.error_summary
      } else if (dropboxError.message) {
        errorMessage = dropboxError.message
      }

      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: 400 }
      )
    }

  } catch (error) {
    console.error('Content API error:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}