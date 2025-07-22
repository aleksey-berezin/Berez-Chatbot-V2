export default (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    vercelRegion: process.env.VERCEL_REGION || 'unknown',
    openaiKeyPresent: !!process.env.OPENAI_API_KEY,
    openaiKeyLength: process.env.OPENAI_API_KEY?.length || 0,
    redisUrlPresent: !!process.env.REDIS_URL,
    redisUrlLength: process.env.REDIS_URL?.length || 0,
    allEnvVars: Object.keys(process.env).filter(key => key.includes('OPENAI') || key.includes('REDIS'))
  });
}; 