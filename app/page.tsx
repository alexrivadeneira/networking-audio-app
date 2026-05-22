'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import getOrCreateEncryptionKey, { encryptData, decryptData } from './crypto';

export default function Home() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // recording state gooks
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);


  useEffect(() => {
    // 1. Check current active session on initial load
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        getOrCreateEncryptionKey().catch(console.error);
      }
      setLoading(false);
    });

    // 2. Listen for real-time auth changes (sign-ins, sign-outs)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      setSession(currentSession);
      if (currentSession) {
        await getOrCreateEncryptionKey().catch(console.error);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleInstantOnboarding = async () => {
    setAuthLoading(true);
    setError(null);
    
    const { error } = await supabase.auth.signInAnonymously();
    
    if (error) {
      setError(error.message);
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  // Loading state placeholder while checking browser cookies/tokens
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-emerald-600"></div>
      </div>
    );
  }

  // VIEW 1: Onboarding Card (If user is NOT logged in yet)
  if (!session) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-slate-50 text-slate-900">
        <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-sm border border-slate-100 text-center">
          <h1 className="text-2xl font-bold tracking-tight mb-2">Network Notes AI</h1>
          <p className="text-sm text-slate-500 mb-6">
            Step aside after a conversation, dictate your notes, and let AI organize the rest.
          </p>
          
          <div className="rounded-lg bg-slate-50 p-3.5 text-xs text-slate-600 border border-slate-100 mb-6 text-left">
            🔒 **Zero-Knowledge Privacy Layer Active:** Every note is encrypted directly on your device using a local key. Even the admin cannot read your database entries.
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-xs text-red-600 font-medium text-left">
              {error}
            </div>
          )}

          <button
            onClick={handleInstantOnboarding}
            disabled={authLoading}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition shadow-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            {authLoading ? 'Creating secure session...' : 'Get Started Instantly'}
          </button>
          
          <p className="mt-4 text-xs text-slate-400">
            No email required. A private cryptographic vault will be set up in your browser.
          </p>
        </div>
      </main>
    );
  }

// VIEW 2: The Main Secure Dashboard (If user IS logged in)
  // Let's add some quick local state variables for recording at the top of your Home() function later, 
  // but for now, let's update the layout to handle recording actions:

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        setIsSaving(true);
        setStatusMessage("Processing & Encrypting note...");
        
        const audioBlob = new Blob(chunks, { type: 'audio/webm' });
        
        // 1. Grab our local private key from memory
        const key = await getOrCreateEncryptionKey();

        // 2. Mock AI Transcription (We will plug in your Whisper/OpenAI API next!)
        const rawTranscript = "Met with an absolute powerhouse developer at the coffee shop. They are building an offline-first iOS app and want to sync up next Tuesday regarding database architecture choices.";
        const rawHeadline = "Coffee meeting - App architecture sync";

        // 3. Encrypt the data locally BEFORE hitting the wire
        const secretHeadline = await encryptData(rawHeadline, key);
        const secretTranscript = await encryptData(rawTranscript, key);

        // 4. Save directly into Supabase
        const { error: dbError } = await supabase.from('network_notes').insert({
          user_id: session.user.id,
          encrypted_headline: secretHeadline,
          encrypted_transcript: secretTranscript,
          audio_url: null // We will handle audio storage bucket setup shortly!
        });

        if (dbError) {
          setError(dbError.message);
        } else {
          setStatusMessage("✓ Note safely encrypted and saved to database!");
          setTimeout(() => setStatusMessage(null), 4000);
        }
        setIsSaving(false);
      };

      recorder.start();
      setMediaRecorder(recorder);
      setAudioChunks(chunks);
      setIsRecording(true);
      setError(null);
    } catch (err) {
      setError("Microphone access denied or unavailable.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(track => track.stop()); // Turn mic off hardware-level
      setIsRecording(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-slate-50 text-slate-900">
      <div className="w-full max-w-md bg-white p-6 rounded-2xl shadow-sm border border-slate-100 text-center relative">
        
        {/* Sign Out Top Right */}
        <button 
          onClick={handleSignOut}
          className="absolute top-4 right-4 text-xs font-medium text-slate-400 hover:text-slate-600 transition"
        >
          Sign Out
        </button>

        <h1 className="text-2xl font-bold tracking-tight mb-1 mt-4">Network Notes AI</h1>
        <p className="text-xs font-semibold text-emerald-600 flex items-center justify-center gap-1 mb-6">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          Zero-Knowledge Encryption Active
        </p>
        
        {/* Interactive Recording Button Frame */}
        <div className="flex flex-col items-center justify-center my-8">
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isSaving}
            className={`w-28 h-28 rounded-full flex flex-col items-center justify-center cursor-pointer transition-all relative outline-none select-none ${
              isRecording 
                ? 'bg-red-500 text-white shadow-lg shadow-red-200 scale-105 animate-pulse' 
                : 'bg-red-50 p-2 text-red-600 hover:bg-red-100 border-4 border-white shadow-md'
            } disabled:opacity-40`}
          >
            {isRecording ? (
              <div className="flex flex-col items-center gap-1">
                <span className="h-3 w-3 bg-white rounded-sm animate-scale"></span>
                <span className="text-xs font-bold uppercase tracking-wider">Stop</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1">
                <span className="h-4 w-4 bg-red-600 rounded-full"></span>
                <span className="text-xs font-bold uppercase tracking-wider">Record</span>
              </div>
            )}
          </button>

          {/* Real-time Status Displayer */}
          {statusMessage && (
            <p className="mt-4 text-xs font-medium text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">
              {statusMessage}
            </p>
          )}

          {error && (
            <p className="mt-4 text-xs font-medium text-red-600 bg-red-50 px-3 py-1.5 rounded-full border border-red-100">
              {error}
            </p>
          )}
        </div>

        <p className="text-xs text-slate-400 max-w-xs mx-auto">
          {isRecording 
            ? "Listening to your thoughts... Tap again to process seamlessly." 
            : "Tap record immediately after stepping away from a conversation to dictate what happened."}
        </p>
      </div>
    </main>
  );
}