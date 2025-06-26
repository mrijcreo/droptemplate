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

// NIEUWE FUNCTIE: Ultra-geavanceerde text cleaning specifiek voor Canvas PDF's
function ultraCleanPdfText(text: string): string {
  if (!text) return ''
  
  return text
    // Remove null bytes and problematic control characters
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
    // Fix common PDF encoding issues
    .replace(/\uFFFD/g, '') // Remove replacement characters
    .replace(/\u00A0/g, ' ') // Non-breaking space to regular space
    .replace(/\u2019/g, "'") // Smart apostrophe
    .replace(/\u201C/g, '"') // Smart quote left
    .replace(/\u201D/g, '"') // Smart quote right
    .replace(/\u2013/g, '-') // En dash
    .replace(/\u2014/g, '--') // Em dash
    .replace(/\u2026/g, '...') // Ellipsis
    // Fix PDF text extraction artifacts specific to educational content
    .replace(/([a-z])([A-Z])/g, '$1 $2') // Add space between camelCase
    .replace(/([.!?])([A-Z])/g, '$1 $2') // Add space after sentence endings
    .replace(/([a-zA-Z])(\d)/g, '$1 $2') // Add space between letters and numbers
    .replace(/(\d)([a-zA-Z])/g, '$1 $2') // Add space between numbers and letters
    .replace(/([a-z])([A-Z][a-z])/g, '$1 $2') // Fix CamelCase words
    // Fix common Canvas/educational PDF issues
    .replace(/rubrieken?/gi, 'rubrieken') // Normalize rubrieken
    .replace(/evaluatie/gi, 'evaluatie') // Normalize evaluatie
    .replace(/beoordeling/gi, 'beoordeling') // Normalize beoordeling
    .replace(/criteria?/gi, 'criteria') // Normalize criteria
    .replace(/competenties?/gi, 'competenties') // Normalize competenties
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim()
}

// NIEUWE FUNCTIE: Detecteer Nederlandse educatieve content
function hasEducationalContent(text: string): boolean {
  if (!text || text.length < 20) return false
  
  // Nederlandse educatieve termen die vaak voorkomen in Canvas PDF's
  const educationalTerms = [
    'rubrieken', 'rubriek', 'evaluatie', 'beoordeling', 'criteria', 'criterium',
    'competenties', 'competentie', 'leeruitkomsten', 'leerdoelen', 'portfolio',
    'reflectie', 'feedback', 'assessment', 'toets', 'toetsen', 'student', 'studenten',
    'docent', 'docenten', 'onderwijs', 'educatie', 'leren', 'studeren', 'cursus',
    'module', 'vak', 'college', 'universiteit', 'hogeschool', 'school', 'klas',
    'opdracht', 'opdrachten', 'project', 'projecten', 'presentatie', 'rapport',
    'verslag', 'onderzoek', 'analyse', 'samenwerking', 'groepswerk', 'teamwork',
    'planning', 'schema', 'rooster', 'deadline', 'inleveren', 'nakijken',
    'cijfer', 'punt', 'punten', 'score', 'resultaat', 'prestatie', 'niveau',
    'kwaliteit', 'standaard', 'norm', 'eis', 'vereiste', 'voorwaarde'
  ]
  
  const lowerText = text.toLowerCase()
  const foundTerms = educationalTerms.filter(term => lowerText.includes(term))
  
  // Check for common Dutch/English words
  const commonWords = ['de', 'het', 'een', 'van', 'en', 'in', 'op', 'voor', 'met', 'aan', 'door', 'over', 'bij', 'naar', 'uit', 'om', 'als', 'zijn', 'hebben', 'worden', 'kunnen', 'zullen', 'moeten', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by']
  const foundCommonWords = commonWords.filter(word => lowerText.includes(word)).length
  
  // Count readable words
  const words = text.match(/\b[a-zA-ZàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿĀāĂăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĦħĨĩĪīĬĭĮįİıĲĳĴĵĶķĸĹĺĻļĽľĿŀŁłŃńŅņŇňŉŊŋŌōŎŏŐőŒœŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŦŧŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽž]{2,}\b/g) || []
  const readableChars = text.match(/[a-zA-Z0-9\s.,!?;:()\-]/g) || []
  
  // Calculate ratios
  const wordRatio = words.length / (text.split(/\s+/).length || 1)
  const readableRatio = readableChars.length / text.length
  const educationalRatio = foundTerms.length / educationalTerms.length
  
  console.log(`📊 Content analysis: ${words.length} words, ${foundTerms.length} educational terms, ${foundCommonWords} common words`)
  
  return words.length >= 10 && 
         wordRatio > 0.3 && 
         readableRatio > 0.7 && 
         foundCommonWords >= 3 &&
         (foundTerms.length >= 2 || educationalRatio > 0.05) // Educational content bonus
}

// NIEUWE FUNCTIE: Brute force text extraction met alle mogelijke encodings
function bruteForceTextExtraction(pdfBuffer: Buffer): string {
  console.log('🔨 Starting brute force text extraction...')
  
  const extractedTexts: string[] = []
  const encodings = ['utf8', 'latin1', 'ascii', 'utf16le', 'base64', 'hex', 'binary']
  
  for (const encoding of encodings) {
    try {
      const text = pdfBuffer.toString(encoding as BufferEncoding)
      
      // Strategy 1: Look for readable text patterns
      const readablePatterns = [
        /[a-zA-Z][a-zA-Z0-9\s.,!?;:()\-]{20,}/g,
        /\b[a-zA-Z]{3,}\b[\s\w.,!?;:()\-]{10,}/g,
        /[A-Z][a-z]+[\s\w.,!?;:()\-]{15,}/g
      ]
      
      for (const pattern of readablePatterns) {
        const matches = text.match(pattern) || []
        extractedTexts.push(...matches)
      }
      
      // Strategy 2: Look for educational terms specifically
      const educationalPattern = /(?:rubrieken?|evaluatie|beoordeling|criteria?|competenties?|leeruitkomsten?|portfolio|feedback|assessment|student|docent|onderwijs)[\s\w.,!?;:()\-]{50,}/gi
      const educationalMatches = text.match(educationalPattern) || []
      extractedTexts.push(...educationalMatches)
      
    } catch (error) {
      // Skip invalid encodings
    }
  }
  
  return extractedTexts.join(' ')
}

// NIEUWE FUNCTIE: PDF stream decompression en text extraction
function advancedStreamExtraction(pdfBuffer: Buffer): string {
  console.log('🌊 Starting advanced stream extraction...')
  
  const pdfText = pdfBuffer.toString('binary')
  const extractedTexts: string[] = []
  
  // Strategy 1: Find and extract all text streams
  const streamRegex = /stream\s*([\s\S]*?)\s*endstream/g
  let streamMatch
  
  while ((streamMatch = streamRegex.exec(pdfText)) !== null) {
    const streamContent = streamMatch[1]
    
    // Try to find readable text in the stream
    const readableText = streamContent.match(/[a-zA-Z][a-zA-Z0-9\s.,!?;:()\-]{10,}/g) || []
    extractedTexts.push(...readableText)
    
    // Look for hex-encoded text
    const hexMatches = streamContent.match(/<([0-9A-Fa-f\s]{10,})>/g) || []
    for (const hexMatch of hexMatches) {
      try {
        const hexString = hexMatch.replace(/[<>\s]/g, '')
        if (hexString.length % 2 === 0) {
          let decodedText = ''
          for (let i = 0; i < hexString.length; i += 2) {
            const charCode = parseInt(hexString.substr(i, 2), 16)
            if (charCode >= 32 && charCode <= 126) {
              decodedText += String.fromCharCode(charCode)
            }
          }
          if (decodedText.length > 5) {
            extractedTexts.push(decodedText)
          }
        }
      } catch (e) {
        // Skip invalid hex
      }
    }
  }
  
  // Strategy 2: Look for text objects with positioning
  const textObjectRegex = /BT\s+([\s\S]*?)\s+ET/g
  let textMatch
  
  while ((textMatch = textObjectRegex.exec(pdfText)) !== null) {
    const textObject = textMatch[1]
    
    // Extract text from parentheses
    const textInParens = textObject.match(/\(([^)]+)\)/g) || []
    for (const parenText of textInParens) {
      const cleanText = parenText.replace(/[()]/g, '')
      if (cleanText.length > 3 && /[a-zA-Z]/.test(cleanText)) {
        extractedTexts.push(cleanText)
      }
    }
    
    // Extract text from angle brackets (hex)
    const textInBrackets = textObject.match(/<([^>]+)>/g) || []
    for (const bracketText of textInBrackets) {
      try {
        const hexString = bracketText.replace(/[<>\s]/g, '')
        if (hexString.length % 2 === 0 && hexString.length > 6) {
          let decodedText = ''
          for (let i = 0; i < hexString.length; i += 2) {
            const charCode = parseInt(hexString.substr(i, 2), 16)
            if (charCode >= 32 && charCode <= 126) {
              decodedText += String.fromCharCode(charCode)
            }
          }
          if (decodedText.length > 2) {
            extractedTexts.push(decodedText)
          }
        }
      } catch (e) {
        // Skip invalid hex
      }
    }
  }
  
  return extractedTexts.join(' ')
}

// NIEUWE FUNCTIE: Character frequency analysis voor text detection
function characterFrequencyExtraction(pdfBuffer: Buffer): string {
  console.log('📊 Starting character frequency analysis...')
  
  const text = pdfBuffer.toString('latin1') // Latin1 often works well for PDFs
  const sequences: string[] = []
  
  // Look for sequences with high character frequency of readable characters
  let currentSequence = ''
  let readableCount = 0
  let totalCount = 0
  
  for (let i = 0; i < Math.min(text.length, 200000); i++) {
    const char = text[i]
    const charCode = char.charCodeAt(0)
    
    totalCount++
    
    if ((charCode >= 32 && charCode <= 126) || (charCode >= 160 && charCode <= 255)) {
      if (/[a-zA-ZàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿĀāĂăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĦħĨĩĪīĬĭĮįİıĲĳĴĵĶķĸĹĺĻļĽľĿŀŁłŃńŅņŇňŉŊŋŌōŎŏŐőŒœŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŦŧŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽž0-9\s.,!?;:()\-]/.test(char)) {
        currentSequence += char
        readableCount++
      } else {
        // Check if we have a good sequence
        if (currentSequence.length > 20 && readableCount / totalCount > 0.8) {
          const cleanedSequence = ultraCleanPdfText(currentSequence)
          if (hasEducationalContent(cleanedSequence)) {
            sequences.push(cleanedSequence)
          }
        }
        currentSequence = ''
        readableCount = 0
        totalCount = 0
      }
    } else {
      // Non-readable character
      if (currentSequence.length > 20 && readableCount / totalCount > 0.8) {
        const cleanedSequence = ultraCleanPdfText(currentSequence)
        if (hasEducationalContent(cleanedSequence)) {
          sequences.push(cleanedSequence)
        }
      }
      currentSequence = ''
      readableCount = 0
      totalCount = 0
    }
  }
  
  // Add final sequence
  if (currentSequence.length > 20 && readableCount / totalCount > 0.8) {
    const cleanedSequence = ultraCleanPdfText(currentSequence)
    if (hasEducationalContent(cleanedSequence)) {
      sequences.push(cleanedSequence)
    }
  }
  
  return sequences.join(' ')
}

// NIEUWE FUNCTIE: PDF object extraction met focus op text objects
function extractPdfObjects(pdfBuffer: Buffer): string {
  console.log('🎯 Starting PDF object extraction...')
  
  const pdfText = pdfBuffer.toString('binary')
  const extractedTexts: string[] = []
  
  // Find all PDF objects
  const objectRegex = /(\d+)\s+(\d+)\s+obj\s+([\s\S]*?)\s+endobj/g
  let objectMatch
  
  while ((objectMatch = objectRegex.exec(pdfText)) !== null) {
    const objectContent = objectMatch[3]
    
    // Look for text-related objects
    if (objectContent.includes('/Type') && (objectContent.includes('/Font') || objectContent.includes('/Text'))) {
      // Extract any readable text from font/text objects
      const readableText = objectContent.match(/[a-zA-Z][a-zA-Z0-9\s.,!?;:()\-]{15,}/g) || []
      extractedTexts.push(...readableText)
    }
    
    // Look for content streams
    if (objectContent.includes('stream')) {
      const streamContent = objectContent.match(/stream\s*([\s\S]*?)\s*endstream/)?.[1] || ''
      
      // Extract text from streams
      const streamText = streamContent.match(/[a-zA-Z][a-zA-Z0-9\s.,!?;:()\-]{10,}/g) || []
      extractedTexts.push(...streamText)
      
      // Look for text commands in streams
      const textCommands = streamContent.match(/\(([^)]{5,})\)\s*(?:Tj|TJ|'|")/g) || []
      for (const command of textCommands) {
        const text = command.match(/\(([^)]+)\)/)?.[1]
        if (text && text.length > 3) {
          extractedTexts.push(text)
        }
      }
    }
  }
  
  return extractedTexts.join(' ')
}

// ULTIEME PDF text extraction met alle strategieën gecombineerd
async function ultimatePdfTextExtraction(pdfBuffer: Buffer, filePath: string): Promise<{ content: string, method: string, success: boolean }> {
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

  console.log(`🚀 ULTIMATE PDF EXTRACTION: ${filePath} (${(pdfBuffer.length / 1024).toFixed(1)} KB)`)

  // Strategy 1: Enhanced pdf-parse with ultra configuration
  try {
    const pdfParseLib = await initializePdfParse()
    
    if (pdfParseLib) {
      console.log(`📖 Trying ULTIMATE pdf-parse for ${filePath}`)
      
      // Ultra-enhanced configurations specifically for Canvas PDFs
      const ultraConfigurations = [
        { 
          max: 0, 
          normalizeWhitespace: false, 
          disableCombineTextItems: true,
          useWorker: false
        },
        { 
          max: 0, 
          normalizeWhitespace: true, 
          disableCombineTextItems: false,
          useWorker: false
        },
        { 
          max: 0, 
          normalizeWhitespace: false, 
          disableCombineTextItems: false,
          useWorker: false
        },
        { 
          max: 50, // Limit pages for faster processing
          normalizeWhitespace: true, 
          disableCombineTextItems: true,
          useWorker: false
        }
      ]
      
      for (const config of ultraConfigurations) {
        try {
          console.log(`🔧 Trying pdf-parse config ${ultraConfigurations.indexOf(config) + 1}/4`)
          
          const pdfData = await pdfParseLib(pdfBuffer, config)
          let extractedText = pdfData.text || ''
          
          if (extractedText && extractedText.trim().length > 50) {
            extractedText = ultraCleanPdfText(extractedText)
            
            if (hasEducationalContent(extractedText)) {
              content = extractedText
              
              // Add comprehensive metadata
              const metadata = []
              if (pdfData.info) {
                if (pdfData.info.Title && pdfData.info.Title.trim() && hasEducationalContent(pdfData.info.Title)) {
                  metadata.push(`📋 Titel: ${ultraCleanPdfText(pdfData.info.Title)}`)
                }
                if (pdfData.info.Author && pdfData.info.Author.trim()) {
                  metadata.push(`👤 Auteur: ${ultraCleanPdfText(pdfData.info.Author)}`)
                }
                if (pdfData.info.Subject && pdfData.info.Subject.trim() && hasEducationalContent(pdfData.info.Subject)) {
                  metadata.push(`📚 Onderwerp: ${ultraCleanPdfText(pdfData.info.Subject)}`)
                }
                if (pdfData.info.Creator && pdfData.info.Creator.trim()) {
                  metadata.push(`🛠️ Gemaakt met: ${ultraCleanPdfText(pdfData.info.Creator)}`)
                }
                if (pdfData.numpages) {
                  metadata.push(`📄 Pagina's: ${pdfData.numpages}`)
                }
              }
              
              if (metadata.length > 0) {
                content = `${metadata.join(' | ')}\n\n${content}`
              }
              
              method = `ultimate-pdf-parse-config-${ultraConfigurations.indexOf(config) + 1}`
              success = true
              
              console.log(`✅ ULTIMATE PDF-parse successful for ${filePath}: ${content.length} chars, educational content detected`)
              return { content, method, success }
            }
          }
        } catch (configError) {
          console.warn(`PDF-parse config ${ultraConfigurations.indexOf(config) + 1} failed:`, configError.message)
        }
      }
    }
    
    throw new Error('PDF-parse produced no educational content with any configuration')
    
  } catch (pdfParseError) {
    console.warn(`⚠️ Ultimate PDF-parse failed for ${filePath}:`, pdfParseError.message)
  }

  // Strategy 2: Advanced stream extraction
  try {
    console.log(`🌊 Trying ULTIMATE stream extraction for ${filePath}`)
    
    const streamText = advancedStreamExtraction(pdfBuffer)
    
    if (streamText && streamText.length > 50) {
      const cleanedText = ultraCleanPdfText(streamText)
      
      if (hasEducationalContent(cleanedText)) {
        content = cleanedText.substring(0, 80000) // Increased limit
        method = 'ultimate-stream-extraction'
        success = true
        
        console.log(`✅ Ultimate stream extraction successful for ${filePath}: ${content.length} chars`)
        return { content, method, success }
      }
    }
    
    throw new Error('Ultimate stream extraction found no educational content')
    
  } catch (streamError) {
    console.warn(`⚠️ Ultimate stream extraction failed for ${filePath}:`, streamError.message)
  }

  // Strategy 3: PDF object extraction
  try {
    console.log(`🎯 Trying ULTIMATE object extraction for ${filePath}`)
    
    const objectText = extractPdfObjects(pdfBuffer)
    
    if (objectText && objectText.length > 50) {
      const cleanedText = ultraCleanPdfText(objectText)
      
      if (hasEducationalContent(cleanedText)) {
        content = cleanedText.substring(0, 70000)
        method = 'ultimate-object-extraction'
        success = true
        
        console.log(`✅ Ultimate object extraction successful for ${filePath}: ${content.length} chars`)
        return { content, method, success }
      }
    }
    
    throw new Error('Ultimate object extraction found no educational content')
    
  } catch (objectError) {
    console.warn(`⚠️ Ultimate object extraction failed for ${filePath}:`, objectError.message)
  }

  // Strategy 4: Character frequency analysis
  try {
    console.log(`📊 Trying ULTIMATE character frequency analysis for ${filePath}`)
    
    const frequencyText = characterFrequencyExtraction(pdfBuffer)
    
    if (frequencyText && frequencyText.length > 50) {
      const cleanedText = ultraCleanPdfText(frequencyText)
      
      if (hasEducationalContent(cleanedText)) {
        content = cleanedText.substring(0, 60000)
        method = 'ultimate-frequency-analysis'
        success = true
        
        console.log(`✅ Ultimate frequency analysis successful for ${filePath}: ${content.length} chars`)
        return { content, method, success }
      }
    }
    
    throw new Error('Ultimate frequency analysis found no educational content')
    
  } catch (frequencyError) {
    console.warn(`⚠️ Ultimate frequency analysis failed for ${filePath}:`, frequencyError.message)
  }

  // Strategy 5: Brute force extraction
  try {
    console.log(`🔨 Trying ULTIMATE brute force extraction for ${filePath}`)
    
    const bruteForceText = bruteForceTextExtraction(pdfBuffer)
    
    if (bruteForceText && bruteForceText.length > 50) {
      const cleanedText = ultraCleanPdfText(bruteForceText)
      
      if (hasEducationalContent(cleanedText)) {
        content = cleanedText.substring(0, 50000)
        method = 'ultimate-brute-force'
        success = true
        
        console.log(`✅ Ultimate brute force successful for ${filePath}: ${content.length} chars`)
        return { content, method, success }
      }
    }
    
    throw new Error('Ultimate brute force found no educational content')
    
  } catch (bruteError) {
    console.warn(`⚠️ Ultimate brute force failed for ${filePath}:`, bruteError.message)
  }

  // Strategy 6: Last resort - raw text scanning
  try {
    console.log(`🔍 Trying ULTIMATE raw text scanning for ${filePath}`)
    
    const rawText = pdfBuffer.toString('latin1')
    const educationalMatches = rawText.match(/(?:rubrieken?|evaluatie|beoordeling|criteria?|competenties?|leeruitkomsten?|portfolio|feedback|assessment|student|docent|onderwijs|canvas|module|cursus|vak|college)[\s\S]{0,500}/gi) || []
    
    if (educationalMatches.length > 0) {
      const combinedText = educationalMatches.join(' ')
      const cleanedText = ultraCleanPdfText(combinedText)
      
      if (cleanedText.length > 100) {
        content = cleanedText.substring(0, 40000)
        method = 'ultimate-raw-scanning'
        success = true
        
        console.log(`✅ Ultimate raw scanning successful for ${filePath}: ${content.length} chars`)
        return { content, method, success }
      }
    }
    
    throw new Error('Ultimate raw scanning found no educational content')
    
  } catch (rawError) {
    console.warn(`⚠️ Ultimate raw scanning failed for ${filePath}:`, rawError.message)
  }

  // If all ultimate strategies fail, provide comprehensive error
  throw new Error(`🚫 ALLE ULTIEME PDF EXTRACTIE STRATEGIEËN FAALDEN voor ${filePath}. 

Dit PDF bestand is waarschijnlijk:
• Een gescand document (alleen afbeeldingen, geen tekst)
• Zwaar beveiligd/versleuteld met complexe beveiliging
• Gebruikt zeer ongewone encoding of font mapping
• Heeft een beschadigde of non-standaard PDF structuur
• Vereist OCR (Optical Character Recognition) voor tekstextractie

Voor gescande Canvas documenten is professionele OCR software nodig.`)
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

    // FOCUS: Alleen PDF bestanden verwerken
    if (fileType !== 'pdf') {
      return NextResponse.json(
        { success: false, error: 'Only PDF files are supported' },
        { status: 400 }
      )
    }

    const dbx = new Dropbox({ accessToken, fetch: fetch as any })

    try {
      // Download file content
      console.log(`📥 Downloading PDF for ULTIMATE extraction: ${filePath}`)
      const response = await dbx.filesDownload({ path: filePath })
      const fileBlob = (response.result as any).fileBinary

      let content = ''
      let extractionMethod = 'unknown'
      let extractionSuccess = false

      // ULTIMATE PDF PROCESSING
      try {
        let pdfBuffer: Buffer
        
        if (fileBlob instanceof ArrayBuffer) {
          pdfBuffer = Buffer.from(fileBlob)
        } else if (Buffer.isBuffer(fileBlob)) {
          pdfBuffer = fileBlob
        } else {
          pdfBuffer = Buffer.from(fileBlob)
        }

        console.log(`🚀 ULTIMATE PDF PROCESSING: ${filePath} (${(pdfBuffer.length / 1024).toFixed(1)} KB)`)
        
        const result = await ultimatePdfTextExtraction(pdfBuffer, filePath)
        content = result.content
        extractionMethod = result.method
        extractionSuccess = result.success
        
        console.log(`🎉 ULTIMATE PDF SUCCESS: ${filePath} using ${extractionMethod} - ${content.length} chars`)
        
      } catch (pdfError) {
        console.error(`💥 ULTIMATE PDF extraction failed for ${filePath}:`, pdfError)
        
        let errorMessage = 'Onbekende fout bij ultieme PDF verwerking'
        
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
[Status: ULTIEME EXTRACTIE GEFAALD - ${errorMessage}]

🚫 ALLE GEAVANCEERDE PDF EXTRACTIE STRATEGIEËN HEBBEN GEFAALD

Dit Canvas PDF bestand kon niet automatisch worden gelezen met 6 verschillende ultieme technieken:
1. ✗ Enhanced PDF-parse (4 configuraties)
2. ✗ Advanced stream extraction
3. ✗ PDF object extraction  
4. ✗ Character frequency analysis
5. ✗ Brute force text extraction
6. ✗ Raw text scanning

🔍 MOGELIJKE OORZAKEN:
• Gescand document (alleen afbeeldingen, geen tekst)
• Zwaar beveiligd/versleuteld Canvas PDF
• Zeer complexe formatting of speciale encoding
• Beschadigd bestand of ongewone PDF structuur
• Canvas gebruikt speciale PDF generatie die niet-standaard is

📋 AANBEVELINGEN:
• Voor gescande Canvas documenten: gebruik OCR software
• Probeer het originele document opnieuw te downloaden uit Canvas
• Controleer of het bestand correct is geüpload naar Dropbox
• Vraag de docent om een tekstversie van het document

Het bestand is wel geregistreerd voor bestandsnaam-zoekopdrachten.`
        
        extractionSuccess = false
        extractionMethod = 'ultimate-pdf-error-fallback'
      }

      // Ultra content validation and enhancement
      if (content && content.length > 0) {
        // Ultra-advanced cleanup for Canvas PDF content
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
          // Canvas-specific cleaning
          .replace(/Canvas\s*3\s*-?\s*Evalueren/gi, 'Canvas 3 - Evalueren')
          .replace(/rubrieken?/gi, 'rubrieken')
          .replace(/evaluatie/gi, 'evaluatie')
          .replace(/beoordeling/gi, 'beoordeling')
          .trim()
        
        // Intelligent truncation for very large Canvas PDFs
        if (content.length > 120000) {
          let truncateAt = 120000
          const sentenceEnd = content.lastIndexOf('.', truncateAt)
          const paragraphEnd = content.lastIndexOf('\n\n', truncateAt)
          
          if (sentenceEnd > truncateAt - 1000) {
            truncateAt = sentenceEnd + 1
          } else if (paragraphEnd > truncateAt - 2000) {
            truncateAt = paragraphEnd + 2
          }
          
          content = content.substring(0, truncateAt) + '\n\n[Canvas PDF ingekort - eerste 120.000 karakters getoond voor optimale indexering en zoekfunctionaliteit]'
        }
        
        // Add extraction quality indicator
        if (extractionSuccess) {
          content = `[✅ Canvas PDF Extractie: ${extractionMethod} - SUCCESVOL]\n[📊 Kwaliteit: Educatieve inhoud gedetecteerd en geoptimaliseerd]\n\n${content}`
        }
      }

      // Ensure we always have indexable content
      if (!content || content.trim().length < 10) {
        content = `[PDF: ${filePath}]
[Status: GEEN LEESBARE TEKST GEVONDEN MET ULTIEME EXTRACTIE]

🚫 ULTIEME PDF EXTRACTIE RESULTAAT: GEFAALD

Dit Canvas PDF bestand bevat waarschijnlijk:
• Alleen afbeeldingen (gescand Canvas document)
• Zwaar beveiligde/versleutelde inhoud
• Zeer complexe Canvas formatting die niet kan worden gedecodeerd
• Beschadigde PDF structuur

🔧 UITGEPROBEERDE TECHNIEKEN:
1. Enhanced PDF-parse (4 configuraties)
2. Advanced stream extraction
3. PDF object extraction
4. Character frequency analysis  
5. Brute force text extraction
6. Raw text scanning

📋 Voor gescande Canvas PDF's is OCR (Optical Character Recognition) nodig.
Het bestand wordt geregistreerd voor bestandsnaam-zoekopdrachten.`
        extractionSuccess = false
      }

      console.log(`🎯 ULTIMATE PDF RESULT: ${filePath} -> ${content.length} chars (${extractionMethod}, success: ${extractionSuccess})`)

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
        isUltimateExtraction: true
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
[Status: DROPBOX DOWNLOAD FOUT - ${errorMessage}]

Dit Canvas PDF bestand kon niet worden gedownload van Dropbox.
Mogelijke oorzaken:
• Tijdelijke Dropbox verbindingsproblemen
• Bestand is verplaatst of verwijderd
• Toegangsrechten zijn gewijzigd
• Dropbox API limiet bereikt

Het bestand wordt geregistreerd voor bestandsnaam-zoekopdrachten.`

      return NextResponse.json({
        success: true,
        content: fallbackContent,
        filePath: filePath,
        fileType: fileType,
        size: fallbackContent.length,
        originalSize: 0,
        extractionMethod: 'dropbox-download-error-fallback',
        extractionSuccess: false,
        error: errorMessage
      })
    }

  } catch (error) {
    console.error('Ultimate PDF API error:', error)
    
    const errorContent = `[ULTIEME PDF API FOUT]
[Fout: ${error instanceof Error ? error.message : 'Unknown error'}]

Technische fout bij ultieme Canvas PDF verwerking.
Alle geavanceerde extractie strategieën zijn niet uitgevoerd.`
    
    return NextResponse.json(
      { 
        success: true,
        content: errorContent,
        filePath: 'unknown',
        fileType: 'pdf',
        size: errorContent.length,
        originalSize: 0,
        extractionMethod: 'ultimate-api-error-fallback',
        extractionSuccess: false,
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 200 }
    )
  }
}