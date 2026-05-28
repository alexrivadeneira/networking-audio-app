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
const [mergeTargetName, setMergeTargetName] = useState<string>('');

  const [email, setEmail] = useState('');
  const [authMessage, setAuthMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);

  const [authView, setAuthView] = useState<'landing' | 'login'>('landing');

  
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
      // Check if we have an active guest session to upgrade
      const isAnonymous = session?.user?.app_metadata?.provider === 'anonymous';

      if (session && isAnonymous) {
        // SCENARIO A: User is currently an anonymous guest and wants to claim their vault
        const { error } = await supabase.auth.updateUser({ email: email });
        if (error) throw error;
      } else {
        // SCENARIO B: No session exists (incognito/signed out) or user is returning.
        // Send a clean magic link login token.
        const { error } = await supabase.auth.signInWithOtp({
          email: email,
          options: {
            // This ensures that clicking the link signs them right back in
            emailRedirectTo: window.location.origin, 
          }
        });
        if (error) throw error;
      }

      setAuthMessage({
        type: 'success',
        text: '✉️ Magic link sent! Check your inbox to securely unlock your vault.'
      });
      setEmail('');
    } catch (err: any) {
      console.error("Auth process failed:", err);
      setAuthMessage({
        type: 'error',
        text: err.message || 'Verification failed. Please try again.'
      });
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const updateTriageContact = async (noteId: string, contactName: string) => {
    // We update the specific row inside your table with the targeted contact string
    const { data, error } = await supabase
      .from('network_notes')
      .update({ 
        contact_name: contactName,
        processing_status: 'completed' // Marks the pipeline loop as officially processed
      })
      .eq('id', noteId)
      .select();

    if (error) {
      console.error("Supabase update failure:", error.message);
      throw error;
    }
    return data;
  };

const onConfirmMatchWithName = async (targetName: string) => {
    if (!currentTriageItem) return;
    
    try {
      // 1. Direct mutation helper to lock the target string into the DB row
      await updateTriageContact(currentTriageItem.id, targetName);
      
      // 2. Update local application notes state dynamically so UI updates instantly
      setNotes(prev => prev.map(n => 
        n.id === currentTriageItem.id ? { ...n, contact_name: targetName } : n
      ));
      
      // 3. REMOVE FROM QUEUE: Drop the first item we just processed
      setTriageQueue(prev => prev.slice(1));
      
    } catch (err) {
      console.error("Error merging contact nickname:", err);
    }
  };

const onConfirmAsNewPerson = async () => {
    if (!currentTriageItem) return;

    try {
      const targetName = currentTriageItem.detected_name;
      
      await updateTriageContact(currentTriageItem.id, targetName);
      setTriageQueue(prev => prev.slice(1));

      setNotes(prev => {
        const exists = prev.some(n => n.id === currentTriageItem.id);
        if (exists) {
          return prev.map(n => 
            n.id === currentTriageItem.id 
              ? { ...n, contact_name: targetName, processing_status: 'completed' } 
              : n
          );
        } else {
          return [
            { ...currentTriageItem, contact_name: targetName, processing_status: 'completed' },
            ...prev
          ];
        }
      });
      
    } catch (err) {
      console.error("Error creating fresh profile contact:", err);
    }
  };
  

  const handleStartGuestSession = async () => {
    setIsSubmittingAuth(true);
    setAuthMessage(null);
    try {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      // Your existing Supabase auth state listener will automatically 
      // see this new session and unlock the main dashboard!
    } catch (err: any) {
      console.error("Failed to start guest session:", err);
      setAuthMessage({
        type: 'error',
        text: err.message || 'Could not start guest session. Please try again.'
      });
    } finally {
      setIsSubmittingAuth(false);
    }
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
// ↓ UNAUTHENTICATED LANDING & LOGIN PORTAL ↓
  if (!session) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 text-center">
        {authView === 'landing' ? (
          /* A: THE STANDARD GETTING STARTED VIEW */
          <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl border border-slate-100 flex flex-col items-center">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white text-xl font-bold shadow-md shadow-indigo-200 mb-4">
              🎙️
            </div>
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Private Network Ledger</h1>
            <p className="text-xs text-slate-500 mt-2 max-w-xs leading-relaxed">
              Record voice summaries of your local interactions. Encrypted instantly via local browser AES keys.
            </p>
            
            <button
              onClick={handleStartGuestSession}
              disabled={isSubmittingAuth}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-xl py-3 text-sm font-bold mt-6 transition shadow-md disabled:opacity-50"
            >
              {isSubmittingAuth ? 'Opening Vault...' : 'Start Recording Asynchronously'}
            </button>

            <button
              onClick={() => setAuthView('login')}
              className="mt-4 text-xs font-semibold text-indigo-600 hover:text-indigo-500 transition"
            >
              Already have an encrypted vault? Sign In
            </button>
          </div>
        ) : (
          /* B: THE RETURNING USER LOGIN PORTAL */
          <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl border border-slate-100 text-left">
            <button
              onClick={() => { setAuthView('landing'); setAuthMessage(null); }}
              className="text-xs font-semibold text-slate-400 hover:text-slate-600 flex items-center gap-1 mb-4 transition"
            >
              ← Back
            </button>
            
            <h2 className="text-lg font-bold text-slate-900">Unlock Your Vault</h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Enter your registered email address. We will send a secure magic link straight to your inbox to instantly decrypt your archives.
            </p>

            <form onSubmit={handleEmailSignUp} className="mt-5 flex flex-col gap-2.5">
              <input
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmittingAuth}
                required
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white text-slate-900 transition disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isSubmittingAuth}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-2.5 text-xs font-bold transition shadow-sm disabled:opacity-50"
              >
                {isSubmittingAuth ? 'Sending Link...' : 'Send Magic Sign-In Link'}
              </button>
            </form>

            {authMessage && (
              <div className={`mt-4 p-3 rounded-xl text-xs font-medium border ${
                authMessage.type === 'success' 
                  ? 'bg-emerald-50 border-emerald-100 text-emerald-700' 
                  : 'bg-rose-50 border-rose-100 text-rose-700'
              }`}>
                {authMessage.text}
              </div>
            )}
          </div>
        )}
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
<main className="flex min-h-screen flex-col items-center justify-center p-4 bg-[#f7f7ed] text-[#3c5671]">
  <div className="w-full max-w-md bg-white p-6 rounded-2xl shadow-xl shadow-[#dfcaab]/30 border border-[#dfcaab] text-center relative">
    
    {/* LEVEL TOP ROW: BRANDING LEFT, UTILITIES RIGHT */}
    <div className="flex flex-row items-center justify-between w-full border-b border-[#dfcaab]/30 pb-4 mb-4 select-none">
      
      {/* BRANDING LOGO BLOCK (Left-Justified) */}
      <div className="flex flex-col items-start text-left">
        <div className="flex flex-row items-center gap-2.5">
          {/* 1. BRAND MASCOT IMAGE */}
          <div className="flex-shrink-0">
            <img 
              src="/mascot.png" 
              alt="Namewise Mascot" 
              className="w-10 h-auto object-contain mix-blend-multiply drop-shadow-sm pointer-events-none" 
            />
          </div>

          {/* 2. LOGO TYPOGRAPHY */}
          <div className="flex items-center">
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              viewBox="0 0 240 45" 
              className="w-36 h-auto"
            >
              {/* "namewise.ai" Lowercase Custom Wordmark */}
              <text x="0" y="34" fill="#3c5671" fontSize="32" fontWeight="900" fontFamily="system-ui, -apple-system, sans-serif" letterSpacing="-1.2">
                namewise<tspan fill="#3c5671">.ai </tspan>
              </text>

              
            </svg>
          </div>
        </div>
        
        {/* New App Subtitle */}
        <p className="text-[11px] font-bold uppercase tracking-wider text-[#7eabc2] mt-0.5 pl-1">
          Connect Better
        </p>
      </div>

      {/* USER INFO & UTILITIES (Right-Justified, Level with Branding) */}
      <div className="flex flex-col items-end gap-1.5 text-right">
        {!isAnonymousUser && userEmail && (
          <span className="text-[10px] font-medium text-[#3c5671] bg-[#f7f7ed] px-2 py-0.5 rounded border border-[#dfcaab]">
            👤 {userEmail}
          </span>
        )}
        <button 
          onClick={handleSignOut}
          className="text-xs font-semibold text-[#3c5671]/70 hover:text-[#3c5671] transition"
        >
          Sign Out
        </button>
      </div>

    </div>

    {/* 2. REMOVED OLD REDUNDANT BLOCKS FROM REFACTOR */}

    {/* Interactive Recording Button Frame */}
    <div className="flex flex-col items-center justify-center my-8">
      <button
        onClick={isRecording ? stopRecording : startRecording}
        disabled={isSaving}
        className={`w-28 h-28 rounded-full flex flex-col items-center justify-center cursor-pointer transition-all relative outline-none select-none ${
          isRecording 
            ? 'bg-[#f6e7ca] text-[#3c5671] shadow-lg shadow-[#f6e7ca]/50 scale-105 animate-pulse' 
            : 'bg-[#f7f7ed] p-2 text-[#7eabc2] hover:bg-[#dfcaab]/20 border-4 border-white shadow-md shadow-[#dfcaab]/30'
        } disabled:opacity-40`}
      >
        {isRecording ? (
          <div className="flex flex-col items-center gap-1">
            <span className="h-3 w-3 bg-[#3c5671] rounded-sm"></span>
            <span className="text-xs font-bold uppercase tracking-wider">Stop</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <span className="h-4 w-4 bg-[#7eabc2] rounded-full"></span>
            <span className="text-xs font-bold uppercase tracking-wider text-[#3c5671]">Record</span>
          </div>
        )}
      </button>

      {/* Real-time Status Displayer */}
      {statusMessage && (
        <p className="mt-4 text-xs font-medium text-[#7eabc2] bg-[#f7f7ed] px-3 py-1.5 rounded-full border border-[#dfcaab]">
          {statusMessage}
        </p>
      )}

      {error && (
        <p className="mt-4 text-xs font-medium text-red-600 bg-red-50 px-3 py-1.5 rounded-full border border-red-200">
          {error}
        </p>
      )}
    </div>
    
    <p className="text-xs text-[#3c5671]/70 max-w-xs mx-auto leading-relaxed">
      {isRecording 
        ? "Listening to your thoughts... Tap again to process seamlessly." 
        : "Who is top of mind for you? Tap record immediately after stepping away from an interaction to record details."}
    </p>
  </div>

    {/* ↓ CONVERSION LANDING SIGNUP CARD (Only visible to guest accounts) ↓ */}
    {isAnonymousUser && (
      <div className="w-full max-w-md mt-6 bg-[#3c5671] text-white p-5 rounded-2xl shadow-xl border border-[#3c5671]/20 text-left">
        <h3 className="font-bold text-base text-[#f7f7ed]">Save Your Timeline</h3>
        <p className="text-xs text-[#f7f7ed]/80 mt-1 leading-relaxed">
          Your interactions are stored safely in this browser sandbox. Enter your email to connect your account and verify your identity across other screens.
        </p>

        <form onSubmit={handleEmailSignUp} className="mt-4 flex flex-col gap-2">
          <input
            type="email"
            placeholder="Enter your email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isSubmittingAuth}
            required
            className="w-full px-3 py-2 bg-[#f7f7ed]/10 border border-[#f7f7ed]/20 rounded-xl text-sm placeholder-[#f7f7ed]/50 focus:outline-none focus:border-[#7eabc2] text-[#f7f7ed] transition disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isSubmittingAuth}
            className="w-full bg-[#f6e7ca] hover:bg-[#dfcaab] text-[#3c5671] rounded-xl py-2 text-xs font-bold transition shadow-sm disabled:opacity-50"
          >
            {isSubmittingAuth ? 'Securing Link...' : 'Keep My Logs Saved'}
          </button>
        </form>

        {authMessage && (
          <div className={`mt-3 p-2.5 rounded-lg text-xs font-medium border ${
            authMessage.type === 'success' 
              ? 'bg-[#7eabc2]/10 border-[#7eabc2]/20 text-[#7eabc2]' 
              : 'bg-red-500/10 border-red-500/20 text-red-300'
          }`}>
            {authMessage.text}
          </div>
        )}
      </div>
    )}


    {/* ↓ TABS CONTROLLER ↓ */}

    <div className="w-full max-w-md mt-6 flex border-b border-[#dfcaab]/50">
      <button
        onClick={() => { setActiveTab('memos'); setSelectedContact(null); }}
        className={`flex-1 pb-3 text-sm font-semibold border-b-2 transition ${
          activeTab === 'memos' 
            ? 'border-[#7eabc2] text-[#7eabc2]' 
            : 'border-transparent text-[#3c5671]/60 hover:text-[#3c5671]'
        }`}
      >
        Memos Timeline
      </button>
      <button
        onClick={() => setActiveTab('rolodex')}
        className={`flex-1 pb-3 text-sm font-semibold border-b-2 transition ${
          activeTab === 'rolodex' 
            ? 'border-[#7eabc2] text-[#7eabc2]' 
            : 'border-transparent text-[#3c5671]/60 hover:text-[#3c5671]'
        }`}
      >
        Your Rolodex ({sortedContactNames.length})
      </button>
    </div>

    {/* Main Content View Switcher Container */}
    <div className="w-full max-w-md mt-6">
      
      {/* Always display incoming triage flags at the top regardless of current tab */}
      {currentTriageItem && (
        <div className="bg-[#3c5671] border border-[#7eabc2]/20 text-white p-5 rounded-2xl shadow-lg text-left mb-6">
          <div className="flex items-center gap-1.5 mb-2.5">
            <span className="h-2 w-2 rounded-full bg-[#f6e7ca] animate-pulse"></span>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#f7f7ed]/70">Incoming Conversation Sync</h3>
          </div>
          
          <p className="text-sm text-[#f7f7ed] leading-relaxed">
            We noticed <strong className="text-[#f6e7ca]">"{currentTriageItem.detected_name}"</strong> referenced in this record.
          </p>

          {/* Smart linking suggestion block */}
          {hasMatch && (
            <div className="mt-3 p-3 bg-[#f7f7ed]/10 border border-[#f7f7ed]/20 rounded-xl">
              <p className="text-xs text-[#f7f7ed]/80">
                Looks like an existing profile: <strong className="text-white">"{suggestedContact?.contact_name}"</strong>
              </p>
              <path 
                onClick={onConfirmSuggestedMatch} 
                className="mt-2 w-full bg-[#7eabc2] hover:bg-[#7eabc2]/80 text-[#3c5671] font-bold rounded-lg py-1.5 text-xs transition text-center block cursor-pointer"
              >
                Yes, Link to {suggestedContact?.contact_name}
              </path>
            </div>
          )}

          {/* Manual Merge or Create New Interface */}
          <div className="mt-4 pt-3.5 border-t border-[#f7f7ed]/10 flex flex-col gap-2.5">
            <label className="text-[11px] font-bold text-[#f7f7ed]/70 uppercase tracking-wider">
              Or arrange manually:
            </label>
            
            <div className="flex gap-2">
              {sortedContactNames.length > 0 && (
                <select
                  value={mergeTargetName}
                  onChange={(e) => setMergeTargetName(e.target.value)}
                  className="flex-1 bg-[#f7f7ed]/10 border border-[#f7f7ed]/20 rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-[#7eabc2]"
                >
                  <option value="" className="text-[#3c5671]">-- Merge into existing --</option>
                  {sortedContactNames.map((name) => (
                    <option key={name} value={name} className="text-[#3c5671]">{name}</option>
                  ))}
                </select>
              )}

              <button
                onClick={() => {
                  if (mergeTargetName) {
                    onConfirmMatchWithName(mergeTargetName);
                    setMergeTargetName('');
                  } else {
                    onConfirmAsNewPerson();
                  }
                }}
                className="px-3 py-2 bg-[#f6e7ca] hover:bg-[#dfcaab] border border-[#f6e7ca] text-[#3c5671] rounded-xl text-xs font-bold transition shadow-sm whitespace-nowrap"
              >
                {mergeTargetName ? 'Confirm Merge' : 'Create New Profile'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW A: MEMOS TIMELINE FLOW */}
      {activeTab === 'memos' && (
        <>
          <h2 className="text-sm font-bold text-[#3c5671]/60 uppercase tracking-wider mb-3 px-1">Your Logs</h2>
          {fetchingNotes ? (
            <div className="py-8 text-center bg-white rounded-xl border border-[#dfcaab]/50 text-xs text-[#3c5671]/60">
              Opening history logs...
            </div>
          ) : notes.length === 0 ? (
            <div className="py-12 text-center bg-white rounded-xl border border-dashed border-[#dfcaab] p-6">
              <p className="text-sm text-[#3c5671]/50 font-medium">No interaction notes captured yet.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {notes.map((note) => (
                <div key={note.id} className="bg-white p-5 rounded-xl shadow-sm border border-[#dfcaab]/50 text-left transition hover:border-[#dfcaab]/80">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-bold text-[#3c5671] text-base leading-tight">{note.headline}</h3>
                    <span className="text-[10px] text-[#3c5671]/80 font-medium bg-[#f7f7ed] px-2 py-0.5 rounded border border-[#dfcaab]/50">
                      {new Date(note.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <p className="text-sm text-[#3c5671]/80 leading-relaxed">{note.transcript}</p>
                  <div className="mt-3 pt-2.5 border-t border-[#dfcaab]/20 flex items-center justify-between">
                    <span className="text-[10px] text-[#3c5671]/60 font-medium">
                      Saved Privately
                    </span>
                    {note.contact_name && (
                      <span className="text-[10px] text-[#3c5671] bg-[#f6e7ca]/30 px-2 py-0.5 rounded font-bold border border-[#dfcaab]/40">
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
              <h2 className="text-sm font-bold text-[#3c5671]/60 uppercase tracking-wider mb-3 px-1">Directory</h2>
              {sortedContactNames.length === 0 ? (
                <div className="py-12 text-center bg-white rounded-xl border border-dashed border-[#dfcaab] text-sm text-[#3c5671]/50">
                  Your records will sort themselves here as profiles accumulate.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {sortedContactNames.map((name) => (
                    <button
                      key={name}
                      onClick={() => setSelectedContact(name)}
                      className="w-full bg-white p-4 rounded-xl shadow-sm border border-[#dfcaab]/50 text-left flex items-center justify-between hover:border-[#dfcaab]/80 transition"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#f7f7ed] border border-[#dfcaab] flex items-center justify-center text-sm font-bold text-[#7eabc2]">
                          {name[0].toUpperCase()}
                        </div>
                        <div>
                          <span className="font-semibold text-[#3c5671] text-sm">{name}</span>
                          <p className="text-[11px] text-[#3c5671]/60">{contactsDirectory[name].length} mapped entries</p>
                        </div>
                      </div>
                      <span className="text-[#dfcaab] font-bold">→</span>
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
                className="mb-4 text-xs font-semibold text-[#3c5671] flex items-center gap-1 bg-[#f7f7ed] px-2.5 py-1.5 rounded-lg border border-[#dfcaab]/60 hover:bg-[#dfcaab]/20 transition"
              >
                ← Back to Directory
              </button>
              
              <div className="bg-white p-5 rounded-xl border border-[#dfcaab]/50 shadow-sm text-left mb-4">
                <div className="w-12 h-12 rounded-full bg-[#f7f7ed] flex items-center justify-center text-lg font-bold text-[#7eabc2] mb-2 border border-[#dfcaab]">
                  {selectedContact[0].toUpperCase()}
                </div>
                <h2 className="text-xl font-bold text-[#3c5671]">{selectedContact}</h2>
                <p className="text-xs text-[#3c5671]/60 mt-0.5">Compiled Network Timeline</p>
              </div>

              <h3 className="text-xs font-bold text-[#3c5671]/60 uppercase tracking-wider mb-3 px-1">Linked Interactions</h3>
              <div className="flex flex-col gap-3">
                {contactsDirectory[selectedContact].map((note) => (
                  <div key={note.id} className="bg-white p-4 rounded-xl border border-[#dfcaab]/50 shadow-sm text-left">
                    <div className="flex justify-between items-start mb-1.5">
                      <h4 className="font-bold text-[#3c5671] text-sm">{note.headline}</h4>
                      <span className="text-[9px] text-[#3c5671]/80 bg-[#f7f7ed] px-1.5 py-0.5 rounded border border-[#dfcaab]/50">
                        {new Date(note.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <p className="text-xs text-[#3c5671]/80 leading-relaxed">{note.transcript}</p>
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