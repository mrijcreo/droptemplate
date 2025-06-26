/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  env: {
    NEXT_PUBLIC_HAS_GEMINI_KEY: process.env.GEMINI_API_KEY ? 'true' : 'false'
  }
}

module.exports = nextConfig