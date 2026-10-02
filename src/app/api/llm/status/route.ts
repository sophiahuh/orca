/** GET → whether the server can answer without a student key, and with which model. */
export function GET() {
  const model = process.env.ANTHROPIC_API_KEY ? "claude-opus-5-5" : null;
  return Response.json({ serverModel: model }, { headers: { "cache-control": "no-store" } });
}
