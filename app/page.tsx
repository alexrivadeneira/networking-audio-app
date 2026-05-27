'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import getOrCreateEncryptionKey, { encryptData, decryptData } from './crypto';
import { linkToExistingContact, createNewContactAndLink } from '../utils/services/triageService';

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
  const [notes, setNotes] = useState<any[]>([]);
  const [fetchingNotes, setFetchingNotes] = useState(true);
  const [triageQueue, setTriageQueue] = useState<any[]>([]);
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

  // --- CHOOSE THE FIRST ITEM IN THE QUEUE TO TRIAGE ---
  const currentTriageItem = triageQueue[0] || null;

  // Search local decrypted notes for matching names or aliases
  const matchingContacts = currentTriageItem 
    ? notes.filter(contact => 
        contact.name?.toLowerCase() === currentTriageItem.detected_name?.toLowerCase() ||
        contact.aliases?.some((a: string) => a.toLowerCase() === currentTriageItem.detected_name?.toLowerCase())
      )
    : [];

  const hasMatch = matchingContacts.length > 0;
  const suggestedContact = hasMatch ? matchingContacts[0] : null;

  // Actions wired to the buttons
  const onConfirmSuggestedMatch = async () => {
    if (!currentTriageItem || !suggestedContact) return;
    await linkToExistingContact(currentTriageItem.id, currentTriageItem.detected_name, suggestedContact.id, suggestedContact.aliases);
    setTriageQueue(prev => prev.slice(1)); // Slide item out, move next one up
    await fetchAndDecryptNotes();
  };

  const onConfirmAsNewPerson = async () => {
    if (!currentTriageItem) return;
    await createNewContactAndLink(currentTriageItem.id, currentTriageItem.detected_name, session?.user?.id);
    setTriageQueue(prev => prev.slice(1));
    await fetchAndDecryptNotes();
  };

const fetchAndDecryptNotes = async () => {
    try {
      setFetchingNotes(true);
      const key = await getOrCreateEncryptionKey();

      // 1. Pull the encrypted strings from Supabase
      const { data, error: fetchError } = await supabase
        .from('network_notes')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;

      if (data) {
        // 2. Decrypt each row locally in the browser memory
        const decryptedRows = await Promise.all(
          data.map(async (note: any) => {
            const headline = await decryptData(note.encrypted_headline, key);
            const transcript = await decryptData(note.encrypted_transcript, key);
            return { ...note, headline, transcript };
          })
        );

        if (data) {
  // 🔍 WITNESS 1: Look at the raw, locked blocks coming from the cloud
  console.log("🔒 1. CLOUD STORAGE GENERATED:", data);

  const decryptedRows = await Promise.all(
    data.map(async (note: any) => {
      const headline = await decryptData(note.encrypted_headline, key);
      const transcript = await decryptData(note.encrypted_transcript, key);
      
      return { ...note, headline, transcript };
    })
  );

  // 🔍 WITNESS 2: Look at the clean, unlocked objects ready for your UI
  console.log("🔓 2. LOCAL MEMORY DECRYPTED:", decryptedRows);
  setNotes(decryptedRows);
}
        setNotes(decryptedRows);
      }
    } catch (err: any) {
      console.error("Failed to decrypt notes:", err);
      setError("Could not fully decrypt your secure notes archive.");
    } finally {
      setFetchingNotes(false);
    }
  };

  // Automatically trigger fetch when a user is logged in
  useEffect(() => {
    if (session) {
      fetchAndDecryptNotes();
    }
  }, [session]);

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
      const audioBlob = new Blob(chunks, { type: "audio/webm" });
      setAudioChunks([]); // Reset buffer memory immediately
      setIsSaving(true);
      setStatusMessage("Processing voice with AI...");

      try {
        // 1. Ship raw audio blob off to our updated backend route
        const formData = new FormData();
        formData.append("file", audioBlob, "memo.webm");

        const response = await fetch("/api/transcribe", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || "Failed to process audio.");
        }

        // 2. Ingest our brand new detected_names array from Groq
        const { transcript, headline, detected_names } = await response.json();

        // 3. Fetch local crypto key from client browser memory
        setStatusMessage("Encrypting data locally...");
        const key = await getOrCreateEncryptionKey();

        // 4. Securely transform plain text to ciphertext on device
        const encryptedHeadline = await encryptData(headline, key);
        const encryptedTranscript = await encryptData(transcript, key);

        // 5. Check if the AI caught any names to determine triage path
        const needsTriage = detected_names && detected_names.length > 0;
        const processing_status = needsTriage ? "needs_review" : "completed";

        const user_id = session?.user?.id;
        const { data: newNote, error: insertError } = await supabase
          .from("network_notes")
          .insert([{ 
            user_id, 
            encrypted_headline: encryptedHeadline, 
            encrypted_transcript: encryptedTranscript,
            processing_status: processing_status,
            aliases: detected_names || [] // Seed initial tracking names array
          }])
          .select()
          .single();

        if (insertError) throw insertError;

        // 6. Push individual items directly into your local UI triage alert loop
        if (needsTriage) {
          const newQueueItems = detected_names.map((name: string) => ({
            id: newNote.id,
            detected_name: name,
            user_id: user_id
          }));
          
          setTriageQueue(prev => [...prev, ...newQueueItems]);
        }

        setStatusMessage("✓ Securely locked in your vault!");
        await fetchAndDecryptNotes();

      } catch (err: any) {
        console.error("MVP Pipeline Error:", err);
        setError(err.message || "Failed to finalize audio recording.");
      } finally {
        setIsSaving(false);
        setTimeout(() => setStatusMessage(null), 3000);
      }
    };
    
    // --- KEEP THESE HARDWARE INITIALIZERS EXACTLY AS THEY WERE ---
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
      </div> {/* ← This is the end of your recording card div */}

      {/* ↓ PASTE THE NEW LOGS ARCHIVE CONTAINER HERE ↓ */}
      <div className="w-full max-w-md mt-6">
        {/* ↓ THE PENDING TRIAGE QUEUE CARD ↓ */}
        {currentTriageItem && (
          <div className="bg-slate-900 border border-indigo-500/30 text-white p-4 rounded-xl shadow-md text-left mb-4">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse"></span>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Incoming Network Sync</h3>
            </div>

            {hasMatch ? (
              <div>
                <p className="text-sm text-slate-200">
                  We detected <strong className="text-indigo-300">"{currentTriageItem.detected_name}"</strong>. Does this reference your existing contact <strong className="text-white">{suggestedContact?.name}</strong>?
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <button onClick={onConfirmSuggestedMatch} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition">
                    Yes, Link Note
                  </button>
                  <button onClick={onConfirmAsNewPerson} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition">
                    No, Create New Contact
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-sm text-slate-200">
                  We detected <strong className="text-indigo-300">"{currentTriageItem.detected_name}"</strong>. It looks like they are new to your network.
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <button onClick={onConfirmAsNewPerson} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition">
                    Create Contact Profile
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3 px-1">Your Encrypted Log</h2>
        
        {fetchingNotes ? (
          <div className="py-8 text-center bg-white rounded-xl border border-slate-100 text-xs text-slate-400">
            Unlocking vault and decrypting archives...
          </div>
        ) : notes.length === 0 ? (
          <div className="py-12 text-center bg-white rounded-xl border border-dashed border-slate-200 p-6">
            <p className="text-sm text-slate-400 font-medium">No networking notes captured yet.</p>
            <p className="text-xs text-slate-300 mt-1">Your saved memos will compile privately here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {notes.map((note) => (
              <div key={note.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 text-left transition hover:border-slate-200">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-slate-800 text-base leading-tight">{note.headline}</h3>
                  <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
                    {new Date(note.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">{note.transcript}</p>
                <div className="mt-3 pt-2.5 border-t border-slate-50">
                  <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded font-medium border border-emerald-100/50">
                    AES-GCM Decrypted
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      
    </main>
  );
}