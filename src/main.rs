use cloudflare_worker::*;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
struct Song {
    id: String,
    title: String,
    artist: String,
    duration: u32,
}

#[event(fetch)]
pub async fn main(req: Request, env: Env, ctx: Context) -> Result<Response> {
    let router = Router::new()
        .post("/add-song", add_song)
        .get("/get-song/:id", get_song)
        .get("/search-song", search_song);

    router.run(req, env, ctx).await
}

async fn add_song(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let song: Song = req.json().await?;
    ctx.env.d1("DB")
        .query("INSERT INTO songs (id, title, artist, duration) VALUES (?, ?, ?, ?)")
        .bind(song.id, song.title, song.artist, song.duration)
        .execute()
        .await?;
    Ok(Response::ok("Song added successfully"))
}

async fn get_song(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let song_id = ctx.param("id").unwrap();
    let song = ctx.env.d1("DB")
        .query("SELECT * FROM songs WHERE id = ?")
        .bind(song_id)
        .fetch_one::<Song>()
        .await?;
    Ok(Response::from_json(&song)?)
}

async fn search_song(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let query = ctx.param("query").unwrap_or_default();
    let results = ctx.env.d1("DB")
        .query("SELECT * FROM songs WHERE title LIKE ? OR artist LIKE ?")
        .bind(format!("%{}%", query), format!("%{}%", query))
        .fetch_all::<Song>()
        .await?;
    Ok(Response::from_json(&results)?)
}
