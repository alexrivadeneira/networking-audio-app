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
      model: "whisper-large-v3", // Hyper-accurate, blazing fast version
    });

    const transcript = transcriptionResponse.text;

    if (!transcript || transcript.trim() === "") {
      return NextResponse.json({ error: "No voice data parsed from recording." }, { status: 422 });
    }

    console.log("Transcription success. Distilling headline...");

    // 4. Use Groq's hosted Llama-3 model to instantly generate a headline
    const completionResponse = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: "You are an elite executive assistant. Summarize the following raw voice memo into a punchy, professional, single sentence title or headline (max 7 words). Do not include quotes, markdown bold formatting, or trailing periods.",
        },
        {
          role: "user",
          content: transcript,
        },
      ],
      max_tokens: 30,
      temperature: 0.3,
    });

    const headline = completionResponse.choices[0]?.message?.content?.trim() || "New Audio Memo";

    return NextResponse.json({ transcript, headline });
  } catch (error: any) {
    console.error("Detailed Groq API Failure:", error);
    return NextResponse.json(
      { error: "Internal processing failed.", details: error.message },
      { status: 500 }
    );
  }
}