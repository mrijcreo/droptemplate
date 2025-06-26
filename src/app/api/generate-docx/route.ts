import { NextRequest, NextResponse } from 'next/server'
import { Document, Paragraph, TextRun, Packer } from 'docx'

export async function POST(request: NextRequest) {
  try {
    const { content } = await request.json()

    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'Content is required and must be a string' },
        { status: 400 }
      )
    }

    // Convert markdown to Word document
    const doc = convertMarkdownToWordDocument(content)
    
    // Generate Word document buffer
    const buffer = await Packer.toBuffer(doc)
    
    // Generate filename with timestamp
    const now = new Date()
    const timestamp = now.toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-')
    const filename = `Chatbot_Response_${timestamp}.docx`

    // Return the Word document as a downloadable file
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length.toString(),
      },
    })

  } catch (error) {
    console.error('DOCX generation error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to generate Word document',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

// Advanced markdown to Word document converter
function convertMarkdownToWordDocument(markdown: string): Document {
  const lines = markdown.split('\n')
  const paragraphs: Paragraph[] = []
  let currentBulletList: string[] = []
  let currentNumberedList: Array<{number: string, text: string}> = []
  let isInCodeBlock = false
  let codeBlockContent = ''
  let codeBlockLanguage = ''
  let isInBlockquote = false
  let blockquoteContent: string[] = []

  // Flush different types of content
  const flushBulletList = () => {
    if (currentBulletList.length > 0) {
      currentBulletList.forEach(item => {
        const formattedRuns = parseInlineFormatting(item)
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: "• " }), ...formattedRuns],
          spacing: { after: 120 },
          indent: { left: 400 }
        }))
      })
      currentBulletList = []
    }
  }

  const flushNumberedList = () => {
    if (currentNumberedList.length > 0) {
      currentNumberedList.forEach(item => {
        const formattedRuns = parseInlineFormatting(item.text)
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: `${item.number}. ` }), ...formattedRuns],
          spacing: { after: 120 },
          indent: { left: 400 }
        }))
      })
      currentNumberedList = []
    }
  }

  const flushCodeBlock = () => {
    if (codeBlockContent) {
      // Add language label if specified
      if (codeBlockLanguage) {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ 
            text: `[${codeBlockLanguage.toUpperCase()}]`,
            italics: true,
            size: 18,
            color: "666666"
          })],
          spacing: { after: 80 }
        }))
      }
      
      // Split code into lines for better formatting
      const codeLines = codeBlockContent.trim().split('\n')
      codeLines.forEach(codeLine => {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ 
            text: codeLine || " ", // Empty line becomes space
            font: "Consolas",
            size: 20,
            color: "000080"
          })],
          spacing: { after: 40 },
          indent: { left: 400 },
          border: {
            left: { color: "CCCCCC", space: 1, style: "single", size: 6 }
          }
        }))
      })
      
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: "" })],
        spacing: { after: 200 }
      }))
      
      codeBlockContent = ''
      codeBlockLanguage = ''
    }
  }

  const flushBlockquote = () => {
    if (blockquoteContent.length > 0) {
      blockquoteContent.forEach(line => {
        const formattedRuns = parseInlineFormatting(line)
        paragraphs.push(new Paragraph({
          children: formattedRuns,
          spacing: { after: 120 },
          indent: { left: 600 },
          border: {
            left: { color: "4472C4", space: 1, style: "single", size: 12 }
          }
        }))
      })
      blockquoteContent = []
    }
  }

  // Parse inline formatting (bold, italic, code, links, strikethrough)
  const parseInlineFormatting = (text: string): TextRun[] => {
    const runs: TextRun[] = []
    
    // Enhanced regex to handle complex combinations
    const regex = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|___[^_]+___|__[^_]+__|_[^_]+_|`[^`]+`|~~[^~]+~~|\[([^\]]+)\]\(([^)]+)\))/g
    
    let lastIndex = 0
    let match
    
    while ((match = regex.exec(text)) !== null) {
      // Add regular text before the match
      if (match.index > lastIndex) {
        const beforeText = text.slice(lastIndex, match.index)
        if (beforeText) {
          runs.push(new TextRun({ text: beforeText }))
        }
      }
      
      const matchedText = match[0]
      
      if (matchedText.startsWith('***') && matchedText.endsWith('***')) {
        // Bold + Italic
        runs.push(new TextRun({ 
          text: matchedText.slice(3, -3), 
          bold: true, 
          italics: true 
        }))
      } else if (matchedText.startsWith('**') && matchedText.endsWith('**')) {
        // Bold
        runs.push(new TextRun({ 
          text: matchedText.slice(2, -2), 
          bold: true 
        }))
      } else if (matchedText.startsWith('*') && matchedText.endsWith('*')) {
        // Italic
        runs.push(new TextRun({ 
          text: matchedText.slice(1, -1), 
          italics: true 
        }))
      } else if (matchedText.startsWith('___') && matchedText.endsWith('___')) {
        // Bold + Italic (alternative)
        runs.push(new TextRun({ 
          text: matchedText.slice(3, -3), 
          bold: true, 
          italics: true 
        }))
      } else if (matchedText.startsWith('__') && matchedText.endsWith('__')) {
        // Bold (alternative)
        runs.push(new TextRun({ 
          text: matchedText.slice(2, -2), 
          bold: true 
        }))
      } else if (matchedText.startsWith('_') && matchedText.endsWith('_')) {
        // Italic (alternative)
        runs.push(new TextRun({ 
          text: matchedText.slice(1, -1), 
          italics: true 
        }))
      } else if (matchedText.startsWith('`') && matchedText.endsWith('`')) {
        // Inline code
        runs.push(new TextRun({ 
          text: matchedText.slice(1, -1), 
          font: "Consolas",
          color: "DC143C",
          highlight: "yellow"
        }))
      } else if (matchedText.startsWith('~~') && matchedText.endsWith('~~')) {
        // Strikethrough
        runs.push(new TextRun({ 
          text: matchedText.slice(2, -2), 
          strike: true 
        }))
      } else if (matchedText.startsWith('[') && match[2] && match[3]) {
        // Links [text](url)
        runs.push(new TextRun({ 
          text: match[2],
          color: "0000EE",
          underline: {}
        }))
      }
      
      lastIndex = regex.lastIndex
    }
    
    // Add remaining text
    if (lastIndex < text.length) {
      const remainingText = text.slice(lastIndex)
      if (remainingText) {
        runs.push(new TextRun({ text: remainingText }))
      }
    }
    
    return runs.length > 0 ? runs : [new TextRun({ text: text })]
  }

  // Process each line
  lines.forEach((line, index) => {
    const trimmedLine = line.trim()
    const originalLine = line

    // Handle code blocks
    const codeBlockMatch = trimmedLine.match(/^```(\w+)?/)
    if (codeBlockMatch) {
      if (isInCodeBlock) {
        flushCodeBlock()
        isInCodeBlock = false
      } else {
        flushBulletList()
        flushNumberedList()
        flushBlockquote()
        isInCodeBlock = true
        codeBlockLanguage = codeBlockMatch[1] || ''
      }
      return
    }

    if (isInCodeBlock) {
      codeBlockContent += originalLine + '\n'
      return
    }

    // Handle blockquotes
    const blockquoteMatch = trimmedLine.match(/^>\s*(.*)$/)
    if (blockquoteMatch) {
      if (!isInBlockquote) {
        flushBulletList()
        flushNumberedList()
        isInBlockquote = true
      }
      blockquoteContent.push(blockquoteMatch[1])
      return
    } else if (isInBlockquote) {
      flushBlockquote()
      isInBlockquote = false
    }

    // Handle horizontal rules
    if (trimmedLine.match(/^(-{3,}|\*{3,}|_{3,})$/)) {
      flushBulletList()
      flushNumberedList()
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: "─────────────────────────────────" })],
        spacing: { after: 200, before: 200 },
        alignment: "center"
      }))
      return
    }

    // Handle headers
    const headerMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/)
    if (headerMatch) {
      flushBulletList()
      flushNumberedList()
      const level = headerMatch[1].length
      const headerText = headerMatch[2]
      const formattedRuns = parseInlineFormatting(headerText)

      paragraphs.push(new Paragraph({
        children: formattedRuns.map(run => new TextRun({
          ...run,
          bold: true,
          size: level === 1 ? 32 : level === 2 ? 28 : level === 3 ? 24 : level === 4 ? 22 : level === 5 ? 20 : 18,
          color: level <= 2 ? "1F4E79" : "2F75B5"
        })),
        spacing: { after: 240, before: level === 1 ? 480 : 240 }
      }))
      return
    }

    // Handle bullet lists
    const bulletMatch = trimmedLine.match(/^([-*+])\s+(.+)$/)
    if (bulletMatch) {
      flushNumberedList()
      currentBulletList.push(bulletMatch[2])
      return
    }

    // Handle numbered lists
    const numberedMatch = trimmedLine.match(/^(\d+)\.\s+(.+)$/)
    if (numberedMatch) {
      flushBulletList()
      currentNumberedList.push({
        number: numberedMatch[1],
        text: numberedMatch[2]
      })
      return
    }

    // Handle regular paragraphs
    if (trimmedLine) {
      flushBulletList()
      flushNumberedList()
      
      const formattedRuns = parseInlineFormatting(trimmedLine)
      paragraphs.push(new Paragraph({
        children: formattedRuns,
        spacing: { after: 200 }
      }))
    } else {
      // Empty line
      flushBulletList()
      flushNumberedList()
      if (index < lines.length - 1) { // Don't add spacing for last empty line
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: "" })],
          spacing: { after: 120 }
        }))
      }
    }
  })

  // Flush any remaining content
  flushBulletList()
  flushNumberedList()
  flushCodeBlock()
  flushBlockquote()

  return new Document({
    creator: "Chatbot AI Assistant",
    title: "AI Generated Response",
    description: "Professional document generated from AI chatbot response",
    sections: [{
      properties: {},
      children: paragraphs.length > 0 ? paragraphs : [
        new Paragraph({
          children: [new TextRun({ text: "No content available" })]
        })
      ]
    }]
  })
}