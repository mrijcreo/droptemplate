import { NextRequest, NextResponse } from 'next/server'
import { Dropbox } from 'dropbox'

export async function POST(request: NextRequest) {
  try {
    const { accessToken, filePath, fileType } = await request.json()

    if (!accessToken || !filePath) {
      return NextResponse.json(
        { success: false, error: 'Access token and file path are required' },
        { status: 400 }
      )
    }

    const dbx = new Dropbox({ accessToken })

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
        // For PDF files, we would need a PDF parser
        // For now, return a placeholder
        content = `[PDF bestand: ${filePath}]\nPDF inhoud extractie nog niet geïmplementeerd. Dit bestand bevat waarschijnlijk tekst die geëxtraheerd kan worden met een PDF parser.`
      } else if (fileType === 'docx') {
        // For DOCX files, we would need a DOCX parser
        content = `[DOCX bestand: ${filePath}]\nDOCX inhoud extractie nog niet geïmplementeerd. Dit bestand bevat waarschijnlijk tekst die geëxtraheerd kan worden met een DOCX parser.`
      } else if (fileType === 'image') {
        // For images, we could use OCR
        content = `[Afbeelding: ${filePath}]\nAfbeelding OCR nog niet geïmplementeerd. Dit bestand zou geanalyseerd kunnen worden met computer vision.`
      }

      // Basic content validation and cleaning
      if (content.length > 50000) {
        // Truncate very large files
        content = content.substring(0, 50000) + '\n\n[Bestand ingekort - te groot voor volledige indexering]'
      }

      // Remove null bytes and other problematic characters
      content = content.replace(/\0/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

      return NextResponse.json({
        success: true,
        content: content,
        filePath: filePath,
        fileType: fileType,
        size: content.length
      })

    } catch (dropboxError: any) {
      console.error('Dropbox download error:', dropboxError)
      
      let errorMessage = 'Failed to download file content'
      if (dropboxError.error?.error_summary) {
        errorMessage = dropboxError.error.error_summary
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