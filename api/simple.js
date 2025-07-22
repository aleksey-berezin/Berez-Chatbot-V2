export default (req, res) => {
  try {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    console.log('Simple function called!');
    console.log('Vercel Region:', process.env.VERCEL_REGION);
    console.log('Method:', req.method);
    console.log('URL:', req.url);

    const response = {
      status: 'ok',
      message: 'Simple function working',
      timestamp: new Date().toISOString(),
      vercelRegion: process.env.VERCEL_REGION || 'unknown',
      nodeVersion: process.version,
      method: req.method,
      url: req.url,
      success: true
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Function error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}; 