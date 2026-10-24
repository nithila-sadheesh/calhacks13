// Nithila's token endpoint (STUB). GET /api/cartesia-token will call Cartesia's access-token
// API with the server-side key and return a short-lived token with tts + stt grants.
// The key comes only from process.env.CARTESIA_API_KEY; never log it or send it to the client.
// Vercel only serves functions from /api, so Nithila decides how to wire this file there.
export function GET(): Response {
  return Response.json({ error: 'not implemented' }, { status: 501 });
}
