import DropboxAISearch from '@/components/DropboxAISearch'

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-full mb-6">
            <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12.01 2C6.5 2 2.02 6.48 2.02 12s4.48 10 9.99 10c5.51 0 10.01-4.48 10.01-10S17.52 2 12.01 2zM18 13h-5v4h-2v-4H6v-2h5V7h2v4h5v2z"/>
            </svg>
          </div>
          
          <h1 className="text-5xl font-bold text-gray-800 mb-4">
            Dropbox AI Search
          </h1>
          
          <p className="text-xl text-blue-700 font-medium mb-6">
            Doorzoek al je Dropbox bestanden met AI - Gemaakt door Tom Naberink
          </p>
        </div>

        {/* Main App */}
        <div className="max-w-6xl mx-auto">
          <DropboxAISearch />
        </div>

        {/* Footer */}
        <div className="text-center mt-12">
          <div className="inline-flex items-center space-x-4 text-blue-600">
            <span>📁</span>
            <span>Powered by Dropbox API & Gemini AI</span>
            <span>🤖</span>
          </div>
          <p className="text-gray-500 text-sm mt-2">
            Dropbox AI Search door Tom Naberink • Next.js & Gemini 2.5 Flash
          </p>
        </div>
      </div>
    </div>
  )
}