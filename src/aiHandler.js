import { Ai } from "@cloudflare/ai";

export async function handleRequest(req, env) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('query');
  const useWhisper = searchParams.get('useWhisper') === 'true'; // Parameter to choose Whisper AI

  if (!query) {
    return new Response('Query parameter is missing', { status: 400 });
  }

  try {
    const ai = env.AI;
    let aiResponse;

    if (useWhisper) {
      // Use Whisper AI for audio transcription
      const audioUrl = "https://github.com/Azure-Samples/cognitive-services-speech-sdk/raw/master/samples/cpp/windows/console/samples/enrollment_audio_katie.wav";
      aiResponse = await transcribeAudio(ai, audioUrl);
    } else {
      // Use text generator AI for database search and text generation
      const systemPrompt = `You are a helpful assistant.`;
      aiResponse = await ai.run(
        "@cf/meta/llama-3-8b-instruct",
        {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: query },
          ],
          stream: false,
        }
      );
    }

    // Database query logic
    const dbResults = await env.DB.prepare('SELECT * FROM nodejs_compt WHERE title LIKE ?').bind(`%${query}%`).all();

    // Combine AI and database results
    const combinedResults = {
      aiResults: aiResponse,
      dbResults: dbResults.results,
    };

    return new Response(JSON.stringify(combinedResults), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error('Error in handleRequest:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

async function transcribeAudio(ai, audioUrl) {
  const res = await fetch(audioUrl);
  const blob = await res.arrayBuffer();

  const input = {
    audio: [...new Uint8Array(blob)],
  };

  const response = await ai.run(
    "@cf/openai/whisper-tiny-en",
    input
  );

  return response;
}
