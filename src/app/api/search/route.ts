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

// Nederlandse synoniemen en gerelateerde termen
const synonymMap: { [key: string]: string[] } = {
  'rubrieken': ['rubriek', 'categorie', 'categorieën', 'sectie', 'secties', 'onderdeel', 'onderdelen', 'hoofdstuk', 'hoofdstukken', 'paragraaf', 'paragrafen', 'punt', 'punten', 'item', 'items', 'thema', 'themas', 'onderwerp', 'onderwerpen'],
  'evaluatie': ['beoordeling', 'beoordelingen', 'evalueren', 'beoordelen', 'assessment', 'toets', 'toetsen', 'test', 'testen'],
  'criteria': ['criterium', 'eisen', 'eis', 'voorwaarden', 'voorwaarde', 'standaarden', 'standaard', 'normen', 'norm'],
  'competenties': ['competentie', 'vaardigheden', 'vaardigheid', 'skills', 'skill', 'bekwaamheden', 'bekwaamheid'],
  'leeruitkomsten': ['leeruitkomst', 'leerdoelen', 'leerdoel', 'doelstellingen', 'doelstelling', 'objectieven', 'objectief'],
  'portfolio': ['portfolios', 'dossier', 'dossiers', 'verzameling', 'collectie', 'map', 'mappen'],
  'reflectie': ['reflecteren', 'nadenken', 'overdenken', 'zelfreflectie', 'terugblik', 'evalueren'],
  'feedback': ['terugkoppeling', 'reactie', 'reacties', 'commentaar', 'opmerkingen', 'opmerking', 'advies'],
  'project': ['projecten', 'opdracht', 'opdrachten', 'assignment', 'assignments', 'taak', 'taken'],
  'presentatie': ['presentaties', 'voordracht', 'voordrachten', 'pitch', 'pitches', 'toelichting'],
  'rapport': ['rapporten', 'verslag', 'verslagen', 'document', 'documenten', 'paper', 'papers'],
  'onderzoek': ['research', 'studie', 'studies', 'analyse', 'analyses', 'investigatie'],
  'samenwerking': ['teamwork', 'groepswerk', 'collaboration', 'samen', 'team', 'groep'],
  'communicatie': ['communiceren', 'contact', 'gesprek', 'gesprekken', 'overleg'],
  'planning': ['plannen', 'schema', 'schemas', 'tijdlijn', 'tijdlijnen', 'rooster'],
  'kwaliteit': ['kwaliteiten', 'niveau', 'niveaus', 'standaard', 'standaarden'],
  'ontwikkeling': ['ontwikkelen', 'groei', 'vooruitgang', 'verbetering', 'verbeteringen'],
  'leren': ['studeren', 'onderwijs', 'educatie', 'training', 'cursus', 'cursussen'],
  'student': ['studenten', 'leerling', 'leerlingen', 'cursist', 'cursisten'],
  'docent': ['docenten', 'leraar', 'leraren', 'instructor', 'instructeur', 'begeleider'],
  'school': ['scholen', 'universiteit', 'hogeschool', 'instituut', 'instelling'],
  'examen': ['examens', 'tentamen', 'tentamens', 'toets', 'toetsen', 'test', 'testen']
}

// Functie om synoniemen toe te voegen aan zoektermen
function expandSearchTerms(terms: string[]): string[] {
  const expandedTerms = new Set(terms)
  
  terms.forEach(term => {
    const lowerTerm = term.toLowerCase()
    
    // Voeg directe synoniemen toe
    if (synonymMap[lowerTerm]) {
      synonymMap[lowerTerm].forEach(synonym => expandedTerms.add(synonym))
    }
    
    // Zoek naar termen waar de huidige term een synoniem van is
    Object.entries(synonymMap).forEach(([key, synonyms]) => {
      if (synonyms.includes(lowerTerm)) {
        expandedTerms.add(key)
        synonyms.forEach(synonym => expandedTerms.add(synonym))
      }
    })
    
    // Voeg variaties toe (meervoud/enkelvoud)
    if (lowerTerm.endsWith('en') && lowerTerm.length > 3) {
      expandedTerms.add(lowerTerm.slice(0, -2)) // verwijder 'en'
    } else if (lowerTerm.endsWith('s') && lowerTerm.length > 2) {
      expandedTerms.add(lowerTerm.slice(0, -1)) // verwijder 's'
    } else {
      expandedTerms.add(lowerTerm + 'en') // voeg 'en' toe
      expandedTerms.add(lowerTerm + 's') // voeg 's' toe
    }
    
    // Voeg woordstam variaties toe
    if (lowerTerm.length > 4) {
      // Probeer verschillende uitgangen
      const stems = [
        lowerTerm.replace(/ing$/, ''), // beoordeling -> beoordeel
        lowerTerm.replace(/tie$/, ''), // evaluatie -> evalua
        lowerTerm.replace(/atie$/, ''), // communicatie -> communic
        lowerTerm.replace(/eren$/, ''), // evalueren -> evalu
        lowerTerm.replace(/en$/, ''), // criteria -> criterium
      ].filter(stem => stem.length > 2 && stem !== lowerTerm)
      
      stems.forEach(stem => expandedTerms.add(stem))
    }
  })
  
  return Array.from(expandedTerms).filter(term => term.length > 1)
}

// Verbeterde relevantie scoring
function calculateRelevanceScore(
  searchTerms: string[], 
  fileName: string, 
  filePath: string, 
  fileContent: string
): { score: number, matches: string[] } {
  const lowerFileName = fileName.toLowerCase()
  const lowerFilePath = filePath.toLowerCase()
  const lowerFileContent = fileContent.toLowerCase()
  
  let totalScore = 0
  const foundMatches: string[] = []
  
  searchTerms.forEach(term => {
    const lowerTerm = term.toLowerCase()
    let termScore = 0
    
    // Exacte matches krijgen hogere score
    const exactFileNameMatches = (lowerFileName.match(new RegExp(`\\b${lowerTerm}\\b`, 'g')) || []).length
    const exactPathMatches = (lowerFilePath.match(new RegExp(`\\b${lowerTerm}\\b`, 'g')) || []).length
    const exactContentMatches = (lowerFileContent.match(new RegExp(`\\b${lowerTerm}\\b`, 'g')) || []).length
    
    // Gedeeltelijke matches
    const partialFileNameMatches = (lowerFileName.match(new RegExp(lowerTerm, 'g')) || []).length
    const partialPathMatches = (lowerFilePath.match(new RegExp(lowerTerm, 'g')) || []).length
    const partialContentMatches = (lowerFileContent.match(new RegExp(lowerTerm, 'g')) || []).length
    
    // Scoring systeem
    termScore += exactFileNameMatches * 20 // Exacte match in bestandsnaam = zeer hoog
    termScore += exactPathMatches * 10 // Exacte match in pad = hoog
    termScore += exactContentMatches * 3 // Exacte match in content = medium
    
    termScore += partialFileNameMatches * 10 // Gedeeltelijke match in bestandsnaam = hoog
    termScore += partialPathMatches * 5 // Gedeeltelijke match in pad = medium
    termScore += partialContentMatches * 1 // Gedeeltelijke match in content = laag
    
    if (termScore > 0) {
      foundMatches.push(term)
      totalScore += termScore
    }
  })
  
  // Bonus voor meerdere termen gevonden
  if (foundMatches.length > 1) {
    totalScore *= (1 + (foundMatches.length - 1) * 0.2)
  }
  
  // Bonus voor kortere bestanden (meer relevante content)
  if (fileContent.length < 5000) {
    totalScore *= 1.2
  } else if (fileContent.length > 50000) {
    totalScore *= 0.8
  }
  
  return { score: totalScore, matches: foundMatches }
}

// Verbeterde context extractie
function extractContext(content: string, searchTerms: string[], maxLength: number = 400): string {
  const lowerContent = content.toLowerCase()
  const contexts: string[] = []
  
  searchTerms.forEach(term => {
    const lowerTerm = term.toLowerCase()
    const regex = new RegExp(`(.{0,100}\\b${lowerTerm}\\b.{0,100})`, 'gi')
    const matches = content.match(regex) || []
    
    matches.slice(0, 2).forEach(match => { // Max 2 contexten per term
      if (!contexts.some(existing => existing.includes(match.trim()))) {
        contexts.push(match.trim())
      }
    })
  })
  
  if (contexts.length === 0) {
    // Als geen exacte matches, probeer gedeeltelijke matches
    searchTerms.forEach(term => {
      const lowerTerm = term.toLowerCase()
      const index = lowerContent.indexOf(lowerTerm)
      if (index !== -1) {
        const start = Math.max(0, index - 100)
        const end = Math.min(content.length, index + lowerTerm.length + 100)
        contexts.push(content.substring(start, end).trim())
      }
    })
  }
  
  if (contexts.length === 0) {
    // Als nog steeds geen matches, geef begin van bestand
    return content.substring(0, maxLength).trim()
  }
  
  let result = contexts.join('\n\n...\n\n')
  
  if (result.length > maxLength) {
    result = result.substring(0, maxLength) + '...'
  }
  
  return result
}

export async function POST(request: NextRequest) {
  try {
    const { query, fileIndex, maxResults = 15 } = await request.json()

    if (!query || !fileIndex) {
      return NextResponse.json(
        { success: false, error: 'Query and file index are required' },
        { status: 400 }
      )
    }

    // Verbeterde query preprocessing
    const originalTerms = query.toLowerCase()
      .split(/[\s,;.!?]+/)
      .filter((term: string) => term.length > 1)
      .map((term: string) => term.replace(/[^\w\u00C0-\u017F]/g, '')) // Behoud Nederlandse karakters
      .filter((term: string) => term.length > 1)

    // Uitbreiden met synoniemen en variaties
    const expandedTerms = expandSearchTerms(originalTerms)
    
    console.log('Original terms:', originalTerms)
    console.log('Expanded terms:', expandedTerms)

    const results: SearchResult[] = []

    // Zoek door elk bestand
    for (const file of fileIndex) {
      const relevanceData = calculateRelevanceScore(
        expandedTerms,
        file.name,
        file.path,
        file.content
      )

      // Alleen bestanden met relevantie score > 0
      if (relevanceData.score > 0) {
        const matchedContent = extractContext(file.content, expandedTerms, 500)
        
        // Normaliseer score (0-1)
        const normalizedScore = Math.min(relevanceData.score / 100, 1)

        results.push({
          file,
          relevanceScore: normalizedScore,
          matchedContent
        })
      }
    }

    // Sorteer op relevantie score (aflopend)
    results.sort((a, b) => b.relevanceScore - a.relevanceScore)

    // Limiteer resultaten
    const limitedResults = results.slice(0, maxResults)

    console.log(`Search completed: ${results.length} results found for "${query}"`)
    console.log('Top results:', limitedResults.slice(0, 3).map(r => ({ 
      name: r.file.name, 
      score: r.relevanceScore,
      path: r.file.path 
    })))

    return NextResponse.json({
      success: true,
      results: limitedResults,
      totalFound: results.length,
      query: query,
      searchTerms: originalTerms,
      expandedTerms: expandedTerms,
      debug: {
        originalTermsCount: originalTerms.length,
        expandedTermsCount: expandedTerms.length,
        filesSearched: fileIndex.length,
        resultsFound: results.length
      }
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