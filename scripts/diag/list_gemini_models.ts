import 'dotenv/config';

async function listModels() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY;
  console.log('Fetching available models from Google AI API...');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  const data = await res.json();
  console.log('Available models status:', res.status);
  if (data.models) {
    console.log('Models list:');
    data.models.forEach((m: any) => console.log(' -', m.name, '| methods:', m.supportedGenerationMethods?.join(', ')));
  } else {
    console.log('Response data:', data);
  }
}

listModels().catch(console.error);
