export function getGroqKey(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error("GROQ_API_KEY is not defined in the environment!");
  }
    // If your Vercel value still has that "GROQ_API_KEY=" prefix,
    // we clean it here in one single place.
    return key.replace("GROQ_API_KEY=", "");
}