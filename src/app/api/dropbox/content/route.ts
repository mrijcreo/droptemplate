import { NextRequest, NextResponse } from 'next/server'
import { Dropbox } from 'dropbox'
import fetch from 'node-fetch'

// Enhanced PDF parsing with multiple advanced strategies
let pdfParse: any = null
let pdfParseInitialized = false

async function initializePdfParse() {
  if (!pdfParseInitialized) {
    try {
      // Import pdf-parse with enhanced configuration
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
    // Fix PDF text extraction artifacts
    .replace(/([a-z])([A-Z])/g, '$1 $2') // Add space between camelCase
    .replace(/([.!?])([A-Z])/g, '$1 $2') // Add space after sentence endings
    .replace(/([a-zA-Z])(\d)/g, '$1 $2') // Add space between letters and numbers
    .replace(/(\d)([a-zA-Z])/g, '$1 $2') // Add space between numbers and letters
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim()
}

// Function to detect if text contains meaningful Dutch/English content
function hasReadableContent(text: string): boolean {
  if (!text || text.length < 20) return false
  
  // Count Dutch/English words and readable patterns
  const words = text.match(/\b[a-zA-ZàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿĀāĂăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĦħĨĩĪīĬĭĮįİıĲĳĴĵĶķĸĹĺĻļĽľĿŀŁłŃńŅņŇňŉŊŋŌōŎŏŐőŒœŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŦŧŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽž]{2,}\b/g) || []
  const readableChars = text.match(/[a-zA-Z0-9\s.,!?;:()\-]/g) || []
  
  // Check for common Dutch/English words
  const commonWords = ['de', 'het', 'een', 'van', 'en', 'in', 'op', 'voor', 'met', 'aan', 'door', 'over', 'bij', 'naar', 'uit', 'om', 'als', 'zijn', 'hebben', 'worden', 'kunnen', 'zullen', 'moeten', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about', 'into', 'over', 'after', 'beneath', 'under', 'above']
  const foundCommonWords = commonWords.filter(word => text.toLowerCase().includes(word)).length
  
  // Check if we have enough words and readable characters
  const wordRatio = words.length / (text.split(/\s+/).length || 1)
  const readableRatio = readableChars.length / text.length
  
  return words.length >= 10 && wordRatio > 0.4 && readableRatio > 0.8 && foundCommonWords >= 3
}

// NIEUWE FUNCTIE: Geavanceerde PDF stream parsing
function parseAdvancedPdfStreams(pdfBuffer: Buffer): string {
  const pdfText = pdfBuffer.toString('binary')
  const extractedTexts: string[] = []
  
  // Strategy 1: Find text objects with advanced patterns
  const textObjectPatterns = [
    // BT...ET blocks with text positioning
    /BT\s+.*?(?:Tf|TL|Td|TD|Tm|T\*)\s+.*?(?:\([^)]*\)|<[^>]*>)\s+(?:Tj|TJ|'|")\s+.*?ET/gs,
    // Direct text in parentheses with positioning
    /(?:Tf|TL|Td|TD|Tm|T\*)\s+[^(]*\(([^)]{5,})\)\s*(?:Tj|TJ|'|")/g,
    // Hex encoded text
    /<([0-9A-Fa-f\s]{10,})>\s*(?:Tj|TJ)/g,
    // Text with font and positioning info
    /\/F\d+\s+\d+(?:\.\d+)?\s+Tf\s+[^(]*\(([^)]{5,})\)/g
  ]
  
  for (const pattern of textObjectPatterns) {
    const matches = [...pdfText.matchAll(pattern)]
    for (const match of matches) {
      let text = match[1] || match[0]
      
      // Clean up text object commands
      text = text
        .replace(/BT\s+|ET\s+/g, '')
        .replace(/\/F\d+\s+[\d.]+\s+Tf\s+/g, '')
        .replace(/\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+(?:Td|TD|Tm)\s+/g, '')
        .replace(/\d+(?:\.\d+)?\s+TL\s+/g, '')
        .replace(/T\*\s+/g, ' ')
        .replace(/Tj\s+|TJ\s+|'\s+|"\s+/g, '')
        .replace(/^\(|\)$/g, '')
        .trim()
      
      if (text.length > 5 && /[a-zA-Z]/.test(text)) {
        extractedTexts.push(text)
      }
    }
  }
  
  // Strategy 2: Parse hex-encoded text
  const hexPattern = /<([0-9A-Fa-f\s]+)>/g
  const hexMatches = [...pdfText.matchAll(hexPattern)]
  for (const match of hexMatches) {
    try {
      const hexString = match[1].replace(/\s/g, '')
      if (hexString.length % 2 === 0 && hexString.length > 10) {
        let decodedText = ''
        for (let i = 0; i < hexString.length; i += 2) {
          const charCode = parseInt(hexString.substr(i, 2), 16)
          if (charCode >= 32 && charCode <= 126) {
            decodedText += String.fromCharCode(charCode)
          }
        }
        if (decodedText.length > 3 && /[a-zA-Z]/.test(decodedText)) {
          extractedTexts.push(decodedText)
        }
      }
    } catch (e) {
      // Skip invalid hex
    }
  }
  
  // Strategy 3: Look for stream content with text
  const streamPattern = /stream\s+(.*?)\s+endstream/gs
  const streamMatches = [...pdfText.matchAll(streamPattern)]
  for (const match of streamMatches) {
    const streamContent = match[1]
    
    // Look for readable text in streams
    const readableText = streamContent.match(/[a-zA-Z][a-zA-Z0-9\s.,!?;:()\-]{10,}/g) || []
    extractedTexts.push(...readableText)
  }
  
  return extractedTexts.join(' ')
}

// NIEUWE FUNCTIE: Intelligente character sequence detection
function detectReadableSequences(pdfBuffer: Buffer): string {
  const pdfText = pdfBuffer.toString('latin1') // Latin1 often works better for PDFs
  const sequences: string[] = []
  let currentSequence = ''
  let consecutiveReadable = 0
  
  for (let i = 0; i < Math.min(pdfText.length, 100000); i++) {
    const char = pdfText[i]
    const charCode = char.charCodeAt(0)
    
    // Check if character is readable
    if ((charCode >= 32 && charCode <= 126) || (charCode >= 160 && charCode <= 255)) {
      if (/[a-zA-ZàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿĀāĂăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĦħĨĩĪīĬĭĮįİıĲĳĴĵĶķĸĹĺĻļĽľĿŀŁłŃńŅņŇňŉŊŋŌōŎŏŐőŒœŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŦŧŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽž0-9\s.,!?;:()\-]/.test(char)) {
        currentSequence += char
        consecutiveReadable++
      } else if (currentSequence.length > 0) {
        if (consecutiveReadable >= 10 && hasReadableContent(currentSequence)) {
          sequences.push(currentSequence.trim())
        }
        currentSequence = ''
        consecutiveReadable = 0
      }
    } else {
      if (currentSequence.length > 0 && consecutiveReadable >= 10 && hasReadableContent(currentSequence)) {
        sequences.push(currentSequence.trim())
      }
      currentSequence = ''
      consecutiveReadable = 0
    }
  }
  
  // Add final sequence
  if (currentSequence.length > 0 && consecutiveReadable >= 10 && hasReadableContent(currentSequence)) {
    sequences.push(currentSequence.trim())
  }
  
  return sequences.join(' ')
}

// NIEUWE FUNCTIE: PDF font mapping and text reconstruction
function reconstructTextWithFontMapping(pdfBuffer: Buffer): string {
  const pdfText = pdfBuffer.toString('binary')
  const extractedTexts: string[] = []
  
  // Look for font definitions and character mappings
  const fontPattern = /\/Type\s*\/Font[\s\S]*?(?=\/Type|endobj)/g
  const fontMatches = [...pdfText.matchAll(fontPattern)]
  
  // Simple character mapping for common PDF encodings
  const charMappings: { [key: string]: string } = {
    '\\040': ' ', '\\041': '!', '\\042': '"', '\\043': '#', '\\044': '$',
    '\\045': '%', '\\046': '&', '\\047': "'", '\\050': '(', '\\051': ')',
    '\\052': '*', '\\053': '+', '\\054': ',', '\\055': '-', '\\056': '.',
    '\\057': '/', '\\072': ':', '\\073': ';', '\\074': '<', '\\075': '=',
    '\\076': '>', '\\077': '?', '\\100': '@', '\\133': '[', '\\134': '\\',
    '\\135': ']', '\\136': '^', '\\137': '_', '\\140': '`', '\\173': '{',
    '\\174': '|', '\\175': '}', '\\176': '~'
  }
  
  // Look for text with escape sequences
  const escapedTextPattern = /\(([^)]*(?:\\[0-9]{3}[^)]*)*)\)/g
  const escapedMatches = [...pdfText.matchAll(escapedTextPattern)]
  
  for (const match of escapedMatches) {
    let text = match[1]
    
    // Replace escape sequences
    for (const [escaped, char] of Object.entries(charMappings)) {
      text = text.replace(new RegExp(escaped.replace('\\', '\\\\'), 'g'), char)
    }
    
    // Replace octal sequences
    text = text.replace(/\\([0-7]{3})/g, (_, octal) => {
      const charCode = parseInt(octal, 8)
      return charCode >= 32 && charCode <= 126 ? String.fromCharCode(charCode) : ''
    })
    
    if (text.length > 5 && /[a-zA-Z]/.test(text)) {
      extractedTexts.push(text)
    }
  }
  
  return extractedTexts.join(' ')
}

// Enhanced PDF text extraction with multiple advanced strategies
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

  // Strategy 1: Enhanced pdf-parse with multiple configurations
  try {
    const pdfParseLib = await initializePdfParse()
    
    if (pdfParseLib) {
      console.log(`📖 Trying enhanced pdf-parse for ${filePath}`)
      
      // Try multiple pdf-parse configurations
      const configurations = [
        { max: 0, normalizeWhitespace: true, disableCombineTextItems: false },
        { max: 0, normalizeWhitespace: false, disableCombineTextItems: true },
        { max: 0, normalizeWhitespace: true, disableCombineTextItems: true }
      ]
      
      for (const config of configurations) {
        try {
          const pdfData = await pdfParseLib(pdfBuffer, config)
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
              
              method = `pdf-parse-enhanced-config-${configurations.indexOf(config) + 1}`
              success = true
              
              console.log(`✅ PDF-parse successful for ${filePath}: ${content.length} chars, readable content detected`)
              return { content, method, success }
            }
          }
        } catch (configError) {
          console.warn(`PDF-parse config ${configurations.indexOf(config) + 1} failed:`, configError.message)
        }
      }
    }
    
    throw new Error('PDF-parse produced no readable content with any configuration')
    
  } catch (pdfParseError) {
    console.warn(`⚠️ PDF-parse failed for ${filePath}:`, pdfParseError.message)
  }

  // Strategy 2: Advanced PDF stream parsing
  try {
    console.log(`🔄 Trying advanced stream parsing for ${filePath}`)
    
    const streamText = parseAdvancedPdfStreams(pdfBuffer)
    
    if (streamText && streamText.length > 50) {
      const cleanedText = cleanPdfText(streamText)
      
      if (hasReadableContent(cleanedText)) {
        content = cleanedText.substring(0, 50000) // Limit to 50KB
        method = 'advanced-stream-parsing'
        success = true
        
        console.log(`✅ Advanced stream parsing successful for ${filePath}: ${content.length} chars`)
        return { content, method, success }
      }
    }
    
    throw new Error('Advanced stream parsing found no readable content')
    
  } catch (streamError) {
    console.warn(`⚠️ Advanced stream parsing failed for ${filePath}:`, streamError.message)
  }

  // Strategy 3: Font mapping and text reconstruction
  try {
    console.log(`🔄 Trying font mapping reconstruction for ${filePath}`)
    
    const reconstructedText = reconstructTextWithFontMapping(pdfBuffer)
    
    if (reconstructedText && reconstructedText.length > 50) {
      const cleanedText = cleanPdfText(reconstructedText)
      
      if (hasReadableContent(cleanedText)) {
        content = cleanedText.substring(0, 40000) // Limit to 40KB
        method = 'font-mapping-reconstruction'
        success = true
        
        console.log(`✅ Font mapping reconstruction successful for ${filePath}: ${content.length} chars`)
        return { content, method, success }
      }
    }
    
    throw new Error('Font mapping reconstruction found no readable content')
    
  } catch (fontError) {
    console.warn(`⚠️ Font mapping reconstruction failed for ${filePath}:`, fontError.message)
  }

  // Strategy 4: Intelligent character sequence detection
  try {
    console.log(`🔄 Trying intelligent character detection for ${filePath}`)
    
    const detectedText = detectReadableSequences(pdfBuffer)
    
    if (detectedText && detectedText.length > 50) {
      const cleanedText = cleanPdfText(detectedText)
      
      if (hasReadableContent(cleanedText)) {
        content = cleanedText.substring(0, 30000) // Limit to 30KB
        method = 'intelligent-character-detection'
        success = true
        
        console.log(`✅ Intelligent character detection successful for ${filePath}: ${content.length} chars`)
        return { content, method, success }
      }
    }
    
    throw new Error('Intelligent character detection found no readable sequences')
    
  } catch (charError) {
    console.warn(`⚠️ Intelligent character detection failed for ${filePath}:`, charError.message)
  }

  // Strategy 5: Multi-encoding brute force
  try {
    console.log(`🔄 Trying multi-encoding extraction for ${filePath}`)
    
    const encodings = ['utf8', 'latin1', 'ascii', 'utf16le', 'base64']
    let bestContent = ''
    let bestScore = 0
    
    for (const encoding of encodings) {
      try {
        const encodedText = pdfBuffer.toString(encoding as BufferEncoding)
        
        // Extract readable sequences from encoded text
        const readableMatches = encodedText.match(/[a-zA-ZàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿĀāĂăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĦħĨĩĪīĬĭĮįİıĲĳĴĵĶķĸĹĺĻļĽľĿŀŁłŃńŅņŇňŉŊŋŌōŎŏŐőŒœŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŦŧŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽž\s.,!?;:()\-]{15,}/g) || []
        
        if (readableMatches.length > 0) {
          const combinedText = readableMatches.join(' ')
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
    
    if (bestContent && bestScore > 200) {
      content = bestContent.substring(0, 35000) // Limit to 35KB
      method = 'multi-encoding-extraction'
      success = true
      
      console.log(`✅ Multi-encoding extraction successful for ${filePath}: ${content.length} chars`)
      return { content, method, success }
    }
    
    throw new Error('Multi-encoding extraction found no readable content')
    
  } catch (encodingError) {
    console.warn(`⚠️ Multi-encoding extraction failed for ${filePath}:`, encodingError.message)
  }

  // If all strategies fail, provide informative error
  throw new Error(`Alle geavanceerde PDF tekstextractie strategieën faalden voor ${filePath}. Dit is waarschijnlijk een gescand document (alleen afbeeldingen), beveiligd PDF, of gebruikt een zeer complexe encoding die OCR vereist.`)
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

      // FOCUS: Alleen PDF verwerking met geavanceerde extractie
      try {
        let pdfBuffer: Buffer
        
        if (fileBlob instanceof ArrayBuffer) {
          pdfBuffer = Buffer.from(fileBlob)
        } else if (Buffer.isBuffer(fileBlob)) {
          pdfBuffer = fileBlob
        } else {
          pdfBuffer = Buffer.from(fileBlob)
        }

        console.log(`🔍 Processing PDF with advanced extraction: ${filePath} (${(pdfBuffer.length / 1024).toFixed(1)} KB)`)
        
        const result = await extractPdfTextAdvanced(pdfBuffer, filePath)
        content = result.content
        extractionMethod = result.method
        extractionSuccess = result.success
        
        console.log(`✅ PDF processed successfully: ${filePath} using ${extractionMethod}`)
        
      } catch (pdfError) {
        console.error(`❌ Advanced PDF extraction failed for ${filePath}:`, pdfError)
        
        let errorMessage = 'Onbekende fout bij geavanceerde PDF verwerking'
        
        if (pdfError instanceof Error) {
          if (pdfError.message.includes('Invalid PDF') || pdfError.message.includes('not a valid')) {
            errorMessage = 'Ongeldig PDF formaat'
          } else if (pdfError.message.includes('encrypted') || pdfError.message.includes('password')) {
            errorMessage = 'PDF is beveiligd met een wachtwoord'
          } else if (pdfError.message.includes('corrupted')) {
            errorMessage = 'PDF bestand is beschadigd'
          } else if (pdfError.message.includes('gescand document')) {
            errorMessage = 'Gescand document - OCR vereist'
          } else {
            errorMessage = pdfError.message
          }
        }
        
        content = `[PDF: ${filePath}]
[Status: Geavanceerde extractie gefaald - ${errorMessage}]

Dit PDF bestand kon niet automatisch worden gelezen met alle beschikbare technieken.

Mogelijke oorzaken:
- Gescand document (alleen afbeeldingen, geen tekst)
- Beveiligd/versleuteld PDF met complexe beveiliging
- Beschadigd bestand of ongewone PDF structuur
- Zeer complexe formatting of speciale encoding
- PDF gebruikt niet-standaard fonts of character mappings

Voor gescande documenten is OCR (Optical Character Recognition) nodig.
Het bestand is wel geregistreerd voor bestandsnaam-zoekopdrachten.`
        
        extractionSuccess = false
        extractionMethod = 'advanced-pdf-error-fallback'
      }

      // Final content validation and enhancement
      if (content && content.length > 0) {
        // Advanced cleanup for PDF content
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
        
        // Add extraction quality indicator
        if (extractionSuccess) {
          content = `[PDF Extractie: ${extractionMethod} - Succesvol]\n\n${content}`
        }
      }

      // Ensure we always have indexable content
      if (!content || content.trim().length < 10) {
        content = `[PDF: ${filePath}]
[Status: Geen leesbare tekst gevonden met geavanceerde extractie]

Dit PDF bestand bevat waarschijnlijk:
- Alleen afbeeldingen (gescand document)
- Beveiligde/versleutelde inhoud met complexe beveiliging
- Zeer complexe formatting die niet kan worden gedecodeerd

Voor gescande PDF's is OCR (Optical Character Recognition) nodig.
Het bestand wordt geregistreerd voor bestandsnaam-zoekopdrachten.`
        extractionSuccess = false
      }

      console.log(`✅ Advanced PDF processed: ${filePath} -> ${content.length} chars (${extractionMethod}, success: ${extractionSuccess})`)

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

Technische fout bij geavanceerde PDF verwerking.`
    
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