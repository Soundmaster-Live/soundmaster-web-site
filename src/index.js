import { Ai } from '@cloudflare/ai';
import { Hono } from 'hono';
import indexTemplate from './index.html';

const CHUNK_SIZE = 24 * 1024 * 1024; // 24 MB per chunk
const app = new Hono();

app.get('/', (c) => c.html(indexTemplate));

// Function to fetch metadata from MusicBrainz
async function fetchMetadataFromMusicBrainz(artist, title) {
  const query = `${artist} ${title}`;
  const response = await fetch(`https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json`);
  const data = await response.json();
  if (data.recordings && data.recordings.length > 0) {
    return data.recordings[0]; // Get the first matching recording
  } else {
    return null;
  }
}

app.get('/stream', async (c) => {
  const ai = new Ai(c.env.AI);
  const query = c.req.query('query');
  const useWhisper = c.req.query('useWhisper') === 'true';

  if (!query) {
    return c.text('Query parameter is missing', 400);
  }

  try {
    let aiResponse;

    if (useWhisper) {
      const audioUrl = "https://github.com/Azure-Samples/cognitive-services-speech-sdk/raw/master/samples/cpp/windows/console/samples/enrollment_audio_katie.wav";
      aiResponse = await transcribeAudio(ai, audioUrl);
    } else {
      const systemPrompt = 'You are a helpful assistant.';
      aiResponse = await ai.run(
        '@cf/meta/llama-3-8b-instruct',
        {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: query },
          ],
          stream: false,
        }
      );
    }

    const dbResults = await c.env.DB.prepare('SELECT * FROM nodejs_compt WHERE title LIKE ?').bind(`%${query}%`).all();

    const combinedResults = {
      aiResults: aiResponse,
      dbResults: dbResults.results,
    };

    return c.json(combinedResults, 200);

  } catch (error) {
    console.error('Error in handleRequest:', error);
    return c.text('Internal Server Error', 500);
  }
});

app.post('/upload', async (c) => {
  const formData = await c.req.formData();
  const songFile = formData.get('songFile');

  if (!songFile) {
    await logAction(c.env.MY_KV, "Upload failed: File not found");
    return c.json({ error: "File not found" }, 400);
  }

  const fileName = songFile.name;
  const fileData = await songFile.arrayBuffer();
  const chunks = Math.ceil(fileData.byteLength / CHUNK_SIZE);

  // Store each chunk in KV and report progress
  for (let i = 0; i < chunks; i++) {
    const chunk = fileData.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    await c.env.MY_KV.put(`${fileName}_chunk_${i}`, chunk);

    // Report progress
    const progress = ((i + 1) / chunks) * 100;
    await c.env.MY_KV.put(`progress_${fileName}`, `${progress}`);
  }

  await logAction(c.env.MY_KV, `File uploaded: ${fileName} in ${chunks} chunks`);

  const ai = new Ai(c.env.AI);
  const systemPrompt = `
    You are an assistant that extracts metadata from music files.
    Provide the title, artist, album, and genre for the following song file.
  `;
  const aiResponse = await ai.run("@cf/meta/llama-3-8b-instruct", {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Extract metadata from the song: ${fileName}` },
    ],
    stream: false,
  });

  const metadata = {
    title: aiResponse?.choices?.[0]?.message?.content?.title || "Unknown Title",
    artist: aiResponse?.choices?.[0]?.message?.content?.artist || "Unknown Artist",
    album: aiResponse?.choices?.[0]?.message?.content?.album || "Unknown Album",
    genre: aiResponse?.choices?.[0]?.message?.content?.genre || "Unknown Genre",
    filename: fileName,
    chunks
  };

  // Fetch additional metadata from MusicBrainz
  const musicBrainzMetadata = await fetchMetadataFromMusicBrainz(metadata.artist, metadata.title);

  // Update metadata with MusicBrainz data if available
  if (musicBrainzMetadata) {
    metadata.title = musicBrainzMetadata.title || metadata.title;
    metadata.artist = musicBrainzMetadata['artist-credit'][0]?.name || metadata.artist;
    metadata.album = musicBrainzMetadata.releases[0]?.title || metadata.album;
    metadata.genre = musicBrainzMetadata.tags[0]?.name || metadata.genre;
  }

  await c.env.DB.prepare('INSERT INTO nodejs_compt (title, artist, album, genre, filename, chunks) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(metadata.title, metadata.artist, metadata.album, metadata.genre, metadata.filename, metadata.chunks)
    .run();

  await logAction(c.env.MY_KV, `Metadata extracted and stored for file: ${fileName}`);

  // Clear progress
  await c.env.MY_KV.delete(`progress_${fileName}`);

  return c.json({ success: true, metadata });
});

app.get('/progress/:filename', async (c) => {
  const filename = c.req.param('filename');
  const progress = await c.env.MY_KV.get(`progress_${filename}`);
  return c.json({ progress: progress || '0' });
});

app.get('/songs/:filename', async (c) => {
  const filename = c.req.param('filename');
  let fileData = new Uint8Array();

  for (let i = 0; ; i++) {
    const chunk = await c.env.MY_KV.get(`${filename}_chunk_${i}`, 'arrayBuffer');
    if (!chunk) break;
    const newData = new Uint8Array(fileData.length + chunk.byteLength);
    newData.set(fileData);
    newData.set(new Uint8Array(chunk), fileData.length);
    fileData = newData;
  }

  if (fileData.length > 0) {
    await logAction(c.env.MY_KV, `Playing file: ${filename}`);
    return new Response(fileData, { headers: { 'Content-Type': 'audio/mpeg' } });
  } else {
    return new Response('File not found', { status: 404 });
  }
});

async function logAction(kv, message) {
  const timestamp = new Date().toISOString();
  await kv.put(`log-${timestamp}`, message);

  // Clean logs older than 48 hours
  const keys = await kv.list();
  for (const key of keys.keys) {
    const logTime = new Date(key.name.replace('log-', ''));
    if ((new Date().getTime() - logTime.getTime()) > 48 * 60 * 60 * 1000) {
      await kv.delete(key.name);
    }
  }
}

app.onError((err, c) => {
  return c.text(err.message);
});

export default app;
