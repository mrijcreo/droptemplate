import { NextRequest, NextResponse } from 'next/server'
import { Dropbox } from 'dropbox'

export async function POST(request: NextRequest) {
  try {
    const { accessToken } = await request.json()

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: 'Access token is required' },
        { status: 400 }
      )
    }

    // Initialize Dropbox client
    const dbx = new Dropbox({ accessToken })

    try {
      // Test 1: Get account info
      const accountInfo = await dbx.usersGetCurrentAccount()
      
      // Test 2: Get space usage
      const spaceUsage = await dbx.usersGetSpaceUsage()

      return NextResponse.json({
        success: true,
        account: {
          name: accountInfo.result.name.display_name,
          email: accountInfo.result.email,
          accountId: accountInfo.result.account_id
        },
        usage: {
          used: spaceUsage.result.used,
          allocated: spaceUsage.result.allocation
        },
        message: 'Dropbox API test successful'
      })

    } catch (dropboxError: any) {
      console.error('Dropbox API error:', dropboxError)
      
      let errorMessage = 'Unknown Dropbox API error'
      if (dropboxError.error) {
        if (dropboxError.error.error_summary) {
          errorMessage = dropboxError.error.error_summary
        } else if (dropboxError.error.error) {
          errorMessage = dropboxError.error.error['.tag'] || 'Dropbox API error'
        }
      } else if (dropboxError.message) {
        errorMessage = dropboxError.message
      }

      return NextResponse.json(
        { 
          success: false, 
          error: errorMessage,
          details: dropboxError.status ? `HTTP ${dropboxError.status}` : 'Network error'
        },
        { status: 400 }
      )
    }

  } catch (error) {
    console.error('Test API error:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}