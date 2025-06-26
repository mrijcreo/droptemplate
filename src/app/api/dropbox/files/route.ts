import { NextRequest, NextResponse } from 'next/server'
import { Dropbox } from 'dropbox'
import fetch from 'node-fetch'

export async function POST(request: NextRequest) {
  try {
    const { accessToken } = await request.json()

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: 'Access token is required' },
        { status: 400 }
      )
    }

    const dbx = new Dropbox({ accessToken, fetch: fetch as any })
    const allFiles: any[] = []

    // Recursive function to get all files
    const getAllFiles = async (path: string = '', cursor?: string): Promise<void> => {
      try {
        let response: any

        if (cursor) {
          // Continue listing with cursor
          response = await dbx.filesListFolderContinue({ cursor })
        } else {
          // Start listing from path
          response = await dbx.filesListFolder({
            path: path,
            recursive: true,
            include_media_info: false,
            include_deleted: false,
            include_has_explicit_shared_members: false
          })
        }

        // Filter for files only (not folders)
        const files = response.result.entries.filter((entry: any) => entry['.tag'] === 'file')
        allFiles.push(...files)

        // If there are more files, continue with cursor
        if (response.result.has_more) {
          await getAllFiles('', response.result.cursor)
        }

      } catch (error: any) {
        console.error('Error listing files:', error)
        throw error
      }
    }

    await getAllFiles()

    return NextResponse.json({
      success: true,
      files: allFiles,
      count: allFiles.length
    })

  } catch (error: any) {
    console.error('Files API error:', error)
    
    let errorMessage = 'Failed to fetch files from Dropbox'
    if (error.error?.error_summary) {
      errorMessage = error.error.error_summary
    } else if (error.message) {
      errorMessage = error.message
    }

    return NextResponse.json(
      { 
        success: false, 
        error: errorMessage 
      },
      { status: 500 }
    )
  }
}