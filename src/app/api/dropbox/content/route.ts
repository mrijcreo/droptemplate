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
        // For PDF files, use pdf-parse
        try {
          const pdfParse = (await import('pdf-parse')).default
          let pdfBuffer: Buffer
          
          if (fileBlob instanceof ArrayBuffer) {
            pdfBuffer = Buffer.from(fileBlob)
          } else if (Buffer.isBuffer(fileBlob)) {
            pdfBuffer = fileBlob
          } else {
            pdfBuffer = Buffer.from(fileBlob)
          }
          
          const pdfData = await pdfParse(pdfBuffer)
          content = pdfData.text
          
          // Add metadata if available
          if (pdfData.info) {
            const metadata = []
            if (pdfData.info.Title) metadata.push(`Titel: ${pdfData.info.Title}`)
            if (pdfData.info.Author) metadata.push(`Auteur: ${pdfData.info.Author}`)
            if (pdfData.info.Subject) metadata.push(`Onderwerp: ${pdfData.info.Subject}`)
            if (pdfData.numpages) metadata.push(`Pagina's: ${pdfData.numpages}`)
            
            if (metadata.length > 0) {
              content = `[PDF Metadata]\n${metadata.join('\n')}\n\n[PDF Inhoud]\n${content}`
            }
          }
          
        } catch (pdfError) {
          console.error('PDF parsing error:', pdfError)
          content = `[PDF bestand: ${filePath}]\nFout bij PDF extractie: ${pdfError instanceof Error ? pdfError.message : 'Onbekende fout'}\n\nDit PDF bestand kon niet worden gelezen. Mogelijk is het beveiligd, beschadigd, of gebruikt het een niet-ondersteund formaat.`
        }
      } else if (fileType === 'docx') {
        // For DOCX files, use mammoth
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
          
          const result = await mammoth.extractRawText({ buffer: docxBuffer })
          content = result.value
          
          // Add warnings if any
          if (result.messages && result.messages.length > 0) {
            const warnings = result.messages.map(msg => msg.message).join('\n')
            content = `[DOCX Extractie Waarschuwingen]\n${warnings}\n\n[DOCX Inhoud]\n${content}`
          }
          
        } catch (docxError) {
          console.error('DOCX parsing error:', docxError)
          content = `[DOCX bestand: ${filePath}]\nFout bij DOCX extractie: ${docxError instanceof Error ? docxError.message : 'Onbekende fout'}\n\nDit DOCX bestand kon niet worden gelezen. Mogelijk is het beschadigd of gebruikt het een niet-ondersteund formaat.`
        }
      } else if (fileType === 'image') {
        // For images, provide placeholder for future OCR implementation
        content = `[Afbeelding: ${filePath}]\nAfbeelding OCR nog niet geïmplementeerd. Dit bestand zou geanalyseerd kunnen worden met computer vision voor tekst extractie.`
      }

      // Basic content validation and cleaning
      if (content.length > 100000) {
        // Truncate very large files but keep more content for better search
        content = content.substring(0, 100000) + '\n\n[Bestand ingekort - te groot voor volledige indexering]'
      }

      // Remove null bytes and other problematic characters
      content = content.replace(/\0/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      
      // Remove excessive whitespace but preserve structure
      content = content.replace(/\n{3,}/g, '\n\n').trim()

      // Ensure we have some content
      if (!content || content.length < 10) {
        content = `[Bestand: ${filePath}]\nGeen tekstuele inhoud gevonden of bestand kon niet worden gelezen.`
      }

      return NextResponse.json({
        success: true,
        content: content,
        filePath: filePath,
        fileType: fileType,
        size: content.length,
        originalSize: fileBlob instanceof ArrayBuffer ? fileBlob.byteLength : 
                     Buffer.isBuffer(fileBlob) ? fileBlob.length : 
                     String(fileBlob).length
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