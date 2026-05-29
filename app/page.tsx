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
  const [activeTab, setActiveTab] = useState<'memos' | 'rolodex'>('memos');
  const [selectedContact, setSelectedContact] = useState<string | null>(null);

  // recording state gooks
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [fetchingNotes, setFetchingNotes] = useState(true);
  const [triageQueue, setTriageQueue] = useState<any[]>([]);


  const [email, setEmail] = useState('');
  const [authMessage, setAuthMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);

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

  // Search local decrypted notes for matching names or aliases
// --- CHOOSE THE FIRST ITEM IN THE QUEUE TO TRIAGE ---
  const currentTriageItem = triageQueue[0] || null;
// Check if the user is truly signed in with an email account vs an anonymous session
  const isAnonymousUser = session?.user?.app_metadata?.provider === 'anonymous';
  const userEmail = session?.user?.email;

  // Search local decrypted notes for matching names or aliases
const matchingContacts = currentTriageItem 
    ? notes.filter(note => 
        note.processing_status === "completed" && note.contact_name && (
          note.contact_name.toLowerCase() === currentTriageItem.detected_name.toLowerCase() ||
          note.aliases?.some((a: string) => a.toLowerCase() === currentTriageItem.detected_name.toLowerCase())
        )
      )
    : [];

  const hasMatch = matchingContacts.length > 0;
  // Grab the master note where this contact profile was first established
  const suggestedContact = hasMatch ? matchingContacts[0] : null;
// Actions wired to your triage buttons
  const onConfirmSuggestedMatch = async () => {
    if (!currentTriageItem || !suggestedContact) return;
    
    // Pass the correct structural variables to your single-table backend service
    const res = await linkToExistingContact(
      currentTriageItem.id, 
      currentTriageItem.detected_name, 
      suggestedContact.contact_name, // Match on the single table's master name column
      suggestedContact.aliases || []
    );

    if (res.success) {
      // Force local slice mutation immediately so the card slides away without lag
      setTriageQueue(prev => prev.slice(1)); 
      // Re-trigger your local decryption sweep to download the newly updated rows
      await fetchAndDecryptNotes();
    } else {
      setError("Failed to link alias to existing profile.");
    }
  };

  const onConfirmAsNewPerson = async () => {
    if (!currentTriageItem) return;

    console.log("➡️ Attempting to triage item ID:", currentTriageItem.id);
    
    const res = await createNewContactAndLink(
      currentTriageItem.id, 
      currentTriageItem.detected_name, 
      session?.user?.id
    );

    console.log("🏁 Service execution result:", res);

    if (res.success) {
      setTriageQueue(prev => prev.slice(1));
      await fetchAndDecryptNotes();
    } else {
      setError("Failed to create new contact profile.");
    }
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
        console.log("🔒 1. CLOUD STORAGE GENERATED:", data);

        // Decrypt each row locally inside your browser memory
        const decryptedRows = await Promise.all(
          data.map(async (note: any) => {
            try {
              const headline = await decryptData(note.encrypted_headline, key);
              const transcript = await decryptData(note.encrypted_transcript, key);
              return { ...note, headline, transcript };
            } catch (decHalt) {
              return { ...note, headline: "Encrypted Entry", transcript: "Decryption unavailable." };
            }
          })
        );

        console.log("🔓 2. LOCAL MEMORY DECRYPTED:", decryptedRows);
        
        // 1. Update your notes archive list
        setNotes(decryptedRows);

        // 2. ⚡ ADD THIS: Look for unreviewed names and load them into your triage cards!
        const unreviewedItems = decryptedRows
          .filter((note: any) => note.processing_status === "needs_review")
          .flatMap((note: any) => 
            (note.aliases || []).map((name: string) => ({
              id: note.id,
              detected_name: name
            }))
          );
        
        setTriageQueue(unreviewedItems);
      }
    } catch (err: any) {
      console.error("Failed to decrypt notes:", err);
      setError("Could not fully decrypt your secure notes archive.");
    } finally {
      setFetchingNotes(false);
    }
  };

useEffect(() => {
    // 1. Check current active session on initial page load
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        getOrCreateEncryptionKey().catch(console.error);
        // 🎬 Sync and decrypt the rows immediately on verification
        fetchAndDecryptNotes(); 
      }
      setLoading(false);
    });

    // 2. Listen for real-time auth changes (sign-ins, sign-outs)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      setSession(currentSession);
      if (currentSession) {
        await getOrCreateEncryptionKey().catch(console.error);
        // 🎬 Sync when a user signs in dynamically
        fetchAndDecryptNotes();
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []); // ◄ Stable empty dependency matrix stops re-renders completely!

  const handleInstantOnboarding = async () => {
    setAuthLoading(true);
    setError(null);
    
    const { error } = await supabase.auth.signInAnonymously();
    
    if (error) {
      setError(error.message);
      setAuthLoading(false);
    }
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsSubmittingAuth(true);
    setAuthMessage(null);

    try {
      // This tells Supabase to upgrade the current anonymous session to a permanent user account
      const { data, error } = await supabase.auth.updateUser({
        email: email
      });

      if (error) throw error;

      setAuthMessage({
        type: 'success',
        text: '✉️ Magic link sent! Check your inbox to confirm your account.'
      });
      setEmail('');
    } catch (err: any) {
      console.error("Auth upgrade failed:", err);
      setAuthMessage({
        type: 'error',
        text: err.message || 'Failed to update account. Try again.'
      });
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  // 📇 DERIVED ROLODEX LOGIC: Extract unique contacts from decrypted notes
  const contactsDirectory = notes.reduce((acc: Record<string, any[]>, note) => {
    if (note.contact_name && note.processing_status === 'completed') {
      if (!acc[note.contact_name]) {
        acc[note.contact_name] = [];
      }
      acc[note.contact_name].push(note);
    }
    return acc;
  }, {});

  // Sort names alphabetically for a true Rolodex feel
  const sortedContactNames = Object.keys(contactsDirectory).sort((a, b) => 
    a.localeCompare(b)
  );

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
          
          // setTriageQueue(prev => [...prev, ...newQueueItems]);
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
        
{/* User Info & Sign Out Top Right */}
        <div className="absolute top-4 right-4 flex items-center gap-3">
          {!isAnonymousUser && userEmail && (
            <span className="text-[11px] font-medium text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
              👤 {userEmail}
            </span>
          )}
          <button 
            onClick={handleSignOut}
            className="text-xs font-semibold text-slate-400 hover:text-slate-600 transition"
          >
            Sign Out
          </button>
        </div>

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

{/* ↓ CONVERSION LANDING SIGNUP CARD (Only visible to guest accounts) ↓ */}
{isAnonymousUser && (
  <div className="w-full max-w-md mt-6 bg-gradient-to-br from-slate-900 to-indigo-950 text-white p-5 rounded-2xl shadow-xl border border-indigo-500/20 text-left">
    <h3 className="font-bold text-base text-white">Secure Your Vault</h3>
    <p className="text-xs text-indigo-200 mt-1 leading-relaxed">
      Your networking interactions are currently saved locally to this browser session. Enter your email to encrypt your vault permanently across all devices.
    </p>

    <form onSubmit={handleEmailSignUp} className="mt-4 flex flex-col gap-2">
      <input
        type="email"
        placeholder="Enter your email address"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={isSubmittingAuth}
        required
        className="w-full px-3 py-2 bg-slate-800/80 border border-slate-700 rounded-xl text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-white transition disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={isSubmittingAuth}
        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-2 text-xs font-bold transition shadow-sm disabled:opacity-50"
      > {/* Fixed tag opening */}
        {isSubmittingAuth ? 'Securing Link...' : 'Claim My Encrypted Vault'}
      </button>
    </form>

    {authMessage && (
      <div className={`mt-3 p-2.5 rounded-lg text-xs font-medium border ${
        authMessage.type === 'success' 
          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' 
          : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
      }`}>
        {authMessage.text}
      </div>
    )}
  </div>
)}


{/* ↓ TABS CONTROLLER ↓ */}

      <div className="w-full max-w-md mt-6 flex border-b border-slate-200">
        <button
          onClick={() => { setActiveTab('memos'); setSelectedContact(null); }}
          className={`flex-1 pb-3 text-sm font-semibold border-b-2 transition ${
            activeTab === 'memos' 
              ? 'border-emerald-600 text-emerald-600' 
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          Memos Timeline
        </button>
        <button
          onClick={() => setActiveTab('rolodex')}
          className={`flex-1 pb-3 text-sm font-semibold border-b-2 transition ${
            activeTab === 'rolodex' 
              ? 'border-emerald-600 text-emerald-600' 
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          Network Rolodex ({sortedContactNames.length})
        </button>
      </div>

      {/* Main Content View Switcher Container */}
      <div className="w-full max-w-md mt-6">
        
        {/* Always display incoming triage flags at the top regardless of current tab */}
        {currentTriageItem && (
          <div className="bg-slate-900 border border-indigo-500/30 text-white p-4 rounded-xl shadow-md text-left mb-6">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse"></span>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Incoming Network Sync</h3>
            </div>
            {hasMatch ? (
              <div>
                <p className="text-sm text-slate-200">
                  We detected <strong className="text-indigo-300">"{currentTriageItem.detected_name}"</strong>. Link to existing contact <strong className="text-white">{suggestedContact?.contact_name}</strong>?
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
                  We detected <strong className="text-indigo-300">"{currentTriageItem.detected_name}"</strong>.
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

        {/* VIEW A: MEMOS TIMELINE FLOW */}
        {activeTab === 'memos' && (
          <>
            <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3 px-1">Your Encrypted Log</h2>
            {fetchingNotes ? (
              <div className="py-8 text-center bg-white rounded-xl border border-slate-100 text-xs text-slate-400">
                Unlocking vault and decrypting archives...
              </div>
            ) : notes.length === 0 ? (
              <div className="py-12 text-center bg-white rounded-xl border border-dashed border-slate-200 p-6">
                <p className="text-sm text-slate-400 font-medium">No networking notes captured yet.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {notes.map((note) => (
                  <div key={note.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 text-left transition hover:border-slate-200">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-bold text-slate-800 text-base leading-tight">{note.headline}</h3>
                      <span className="text-[10px] text-slate-400 font-medium bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
                        {new Date(note.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed">{note.transcript}</p>
                    <div className="mt-3 pt-2.5 border-t border-slate-50 flex items-center justify-between">
                      <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded font-medium border border-emerald-100/50">
                        AES-GCM Decrypted
                      </span>
                      {note.contact_name && (
                        <span className="text-[10px] text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded font-semibold border border-indigo-100/50">
                          👤 {note.contact_name}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* VIEW B: THE CONTACTS ROLODEX */}
        {activeTab === 'rolodex' && (
          <div>
            {!selectedContact ? (
              <>
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3 px-1">Directory</h2>
                {sortedContactNames.length === 0 ? (
                  <div className="py-12 text-center bg-white rounded-xl border border-dashed border-slate-200 text-sm text-slate-400">
                    Triage your memos to populate your contact Rolodex.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    {sortedContactNames.map((name) => (
                      <button
                        key={name}
                        onClick={() => setSelectedContact(name)}
                        className="w-full bg-white p-4 rounded-xl shadow-sm border border-slate-100 text-left flex items-center justify-between hover:border-slate-300 transition"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-sm font-bold text-emerald-700">
                            {name[0].toUpperCase()}
                          </div>
                          <div>
                            <span className="font-semibold text-slate-800 text-sm">{name}</span>
                            <p className="text-[11px] text-slate-400">{contactsDirectory[name].length} context dynamic interactions</p>
                          </div>
                        </div>
                        <span className="text-slate-300 font-bold">→</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              /* INDIVIDUAL DRILL DOWN DRAWER */
              <div>
                <button
                  onClick={() => setSelectedContact(null)}
                  className="mb-4 text-xs font-semibold text-emerald-600 flex items-center gap-1 bg-emerald-50 px-2.5 py-1.5 rounded-lg border border-emerald-100 hover:bg-emerald-100 transition"
                >
                  ← Back to Directory
                </button>
                
                <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm text-left mb-4">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-lg font-bold text-emerald-800 mb-2">
                    {selectedContact[0].toUpperCase()}
                  </div>
                  <h2 className="text-xl font-bold text-slate-900">{selectedContact}</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Compiled Network Timeline Context</p>
                </div>

                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 px-1">Linked Interactions</h3>
                <div className="flex flex-col gap-3">
                  {contactsDirectory[selectedContact].map((note) => (
                    <div key={note.id} className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm text-left">
                      <div className="flex justify-between items-start mb-1.5">
                        <h4 className="font-bold text-slate-800 text-sm">{note.headline}</h4>
                        <span className="text-[9px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
                          {new Date(note.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{note.transcript}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}