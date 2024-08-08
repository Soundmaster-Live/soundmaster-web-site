import { Database } from './database';

export async function handleDatabaseRequest(request, env) {
  const db = new Database(env);

  const logs = await db.getLogs();
  return new Response(JSON.stringify(logs), {
    headers: {
      'Content-Type': 'application/json'
    }
  });
}
