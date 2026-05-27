import { NextRequest, NextResponse } from "next/server";
import { Groq } from "groq-sdk";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing GROQ_API_KEY in environment variables." }, { status: 500 });
    }

    const groq = new Groq({ apiKey });

    // 1. Extract the file blob from the form submission
    const formData = await req.formData();
    const audioFileBlob = formData.get("file") as Blob;

    if (!audioFileBlob) {
      return NextResponse.json({ error: "Missing audio payload file." }, { status: 400 });
    }

    // 2. Convert generic blob to a Node File object for Groq
    const buffer = Buffer.from(await audioFileBlob.arrayBuffer());
    const fileForGroq = new File([buffer], "memo.webm", { type: "audio/webm" });

    console.log("Dispatching audio to Groq Whisper...");
    
    // 3. Request rapid transcription from Groq's Whisper v3 model
    const transcriptionResponse = await groq.audio.transcriptions.create({
      file: fileForGroq,
      model: "whisper-large-v3",
    });

    const transcript = transcriptionResponse.text;

    if (!transcript || transcript.trim() === "") {
      return NextResponse.json({ error: "No voice data parsed from recording." }, { status: 422 });
    }

    console.log("Transcription success. Running structural distillation...");

    // 4. One single Llama call to extract the headline and names using structured JSON output
    const completionResponse = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant", // Using your active instant model
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a precise relationship data assistant. Take the raw voice transcript provided and return a JSON object with exactly three keys:
          
          1. "transcript": The clean, punctuated text of what was spoken.
          2. "headline": A short, 4-7 word title summarized for a card view. Do not include quotes, markdown bold, or trailing periods.
          3. "detected_names": An array of strings containing the unique names of human individuals mentioned in the text (e.g. ["Janie", "Mikey"]). If no specific people are named, return an empty array []. Only extract names of real individuals, not companies, products, or locations.
          
          Your output must strictly follow this JSON format with no additional commentary.`
        },
        {
          role: "user",
          content: transcript, // This is your variable holding the text string from Whisper
        },
      ],
      temperature: 0.2,
    });

    // 5. Parse out the structured JSON payload returned by the model
    const aiOutputString = completionResponse.choices[0]?.message?.content || "{}";
    const structuredData = JSON.parse(aiOutputString);

    // 6. Respond back to your frontend with all three metrics cleanly packed up
    return NextResponse.json({
      transcript: structuredData.transcript || transcript,
      headline: structuredData.headline || "New Audio Memo",
      detected_names: structuredData.detected_names || []
    });

  } catch (error: any) {
    console.error("Detailed Groq API Failure:", error);
    return NextResponse.json(
      { error: "Internal processing failed.", details: error.message },
      { status: 500 }
    );
  }
}