import { NextRequest, NextResponse } from 'next/server'

interface FileIndex {
  id: string
  name: string
  path: string
  content: string
  size: number
  modified: string
  type: 'text' | 'pdf' | 'docx' | 'image' | 'other'
}

interface SearchResult {
  file: FileIndex
  relevanceScore: number
  matchedContent: string
}

export async function POST(request: NextRequest) {
  try {
    const { query, fileIndex, maxResults = 10 } = await request.json()

    if (!query || !fileIndex) {
      return NextResponse.json(
        { success: false, error: 'Query and file index are required' },
        { status: 400 }
      )
    }

    const searchTerms = query.toLowerCase().split(/\s+/).filter((term: string) => term.length > 2)
    const results: SearchResult[] = []

    // Search through each file
    for (const file of fileIndex) {
      const fileName = file.name.toLowerCase()
      const filePath = file.path.toLowerCase()
      const fileContent = file.content.toLowerCase()
      const searchText = `${fileName} ${filePath} ${fileContent}`

      let relevanceScore = 0
      let matchedContent = ''
      const matches: string[] = []

      // Calculate relevance score
      for (const term of searchTerms) {
        // File name matches (highest weight)
        if (fileName.includes(term)) {
          relevanceScore += 10
        }

        // Path matches (medium weight)
        if (filePath.includes(term)) {
          relevanceScore += 5
        }

        // Content matches (base weight)
        const contentMatches = (fileContent.match(new RegExp(term, 'gi')) || []).length
        relevanceScore += contentMatches * 1

        // Find context around matches
        if (contentMatches > 0) {
          const regex = new RegExp(`(.{0,100}${term}.{0,100})`, 'gi')
          const contextMatches = fileContent.match(regex) || []
          matches.push(...contextMatches.slice(0, 3)) // Max 3 context snippets per term
        }
      }

      // Only include files with some relevance
      if (relevanceScore > 0) {
        // Create matched content from the best matches
        if (matches.length > 0) {
          matchedContent = matches
            .slice(0, 3) // Max 3 snippets
            .map(match => match.trim())
            .join('\n\n...\n\n')
        } else {
          // If no content matches but filename/path matched, show beginning of file
          matchedContent = file.content.substring(0, 300)
        }

        // Normalize relevance score (0-1)
        const normalizedScore = Math.min(relevanceScore / 50, 1)

        results.push({
          file,
          relevanceScore: normalizedScore,
          matchedContent
        })
      }
    }

    // Sort by relevance score (descending)
    results.sort((a, b) => b.relevanceScore - a.relevanceScore)

    // Limit results
    const limitedResults = results.slice(0, maxResults)

    return NextResponse.json({
      success: true,
      results: limitedResults,
      totalFound: results.length,
      query: query,
      searchTerms: searchTerms
    })

  } catch (error) {
    console.error('Search API error:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown search error' 
      },
      { status: 500 }
    )
  }
}