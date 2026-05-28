'use client';

import { useEffect, useState, useMemo } from 'react';
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

  // recording state hooks
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
  const [isProcessingTriage, setIsProcessingTriage] = useState(false);
  const [contactsList, setContactsList] = useState<any[]>([]);

  // 1. Core Auth Listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        getOrCreateEncryptionKey().catch(console.error);
        fetchAndDecryptNotes(true); // Load triage queue ONLY on initial page load
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      setSession(currentSession);
      if (currentSession) {
        await getOrCreateEncryptionKey().catch(console.error);
        fetchAndDecryptNotes(true); // Load triage queue ONLY on initial sign-in
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // --- COMPUTED STATES FOR ACTIVE ITEM ---
  const currentTriageItem = triageQueue[0] || null;
  const isAnonymousUser = session?.user?.app_metadata?.provider === 'anonymous';
  const userEmail = session?.user?.email;

  // Strict, memoized matching calculation to prevent ghost matching states
  const matchingContacts = useMemo(() => {
    if (!currentTriageItem || !currentTriageItem.detected_name) return [];
    const searchTarget = currentTriageItem.detected_name.toLowerCase().trim();

    return notes.filter(note => 
      note.processing_status === "completed" && 
      note.contact_name && 
      (note.contact_name.toLowerCase().trim() === searchTarget ||
       note.aliases?.some((a: string) => a.toLowerCase().trim() === searchTarget))
    );
  }, [currentTriageItem, notes]);

  const hasMatch = matchingContacts.length > 0;
  const suggestedContact = hasMatch ? matchingContacts[0] : null;

  // --- ACTIONS & NETWORKING ---

const fetchAndDecryptNotes = async (shouldLoadQueue = false) => {
    try {
      setFetchingNotes(true);
      const key = await getOrCreateEncryptionKey();

      // 1. Fetch notes
      const { data, error: fetchError } = await supabase
        .from('network_notes')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;

      // 2. Fetch the Junction Table links (The "Glue")
      const { data: linksData, error: linksError } = await supabase
        .from('note_contacts')
        .select('note_id, contacts(name)'); 

      if (linksError) throw linksError;

      if (data) {
        const decryptedRows = await Promise.all(
          data.map(async (note: any) => {
            // Find which contacts belong to this specific note
            const associatedContacts = linksData
              ?.filter((link: any) => link.note_id === note.id)
              .map((link: any) => (link.contacts as any)?.name) || [];

            try {
              const headline = await decryptData(note.encrypted_headline, key);
              const transcript = await decryptData(note.encrypted_transcript, key);
              return { 
                ...note, 
                headline, 
                transcript, 
                associated_contact_names: associatedContacts // ◄ Hydrated names
              };
            } catch (decHalt) {
              return { 
                ...note, 
                headline: "Encrypted Entry", 
                transcript: "Decryption unavailable.", 
                associated_contact_names: associatedContacts 
              };
            }
          })
        );
        
        setNotes(decryptedRows);

        // 3. Fetch Master Contacts List for the Rolodex sidebar
        const { data: fetchedContacts, error: contactsError } = await supabase
          .from('contacts')
          .select('*')
          .order('name', { ascending: true });

        if (contactsError) {
          console.error("❌ Error fetching master contacts table:", contactsError.message);
        } else if (fetchedContacts) {
          setContactsList(fetchedContacts); 
        }

        // 4. Queue processing logic
        if (shouldLoadQueue) {
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
      }
    } catch (err: any) {
      console.error("Failed to decrypt notes:", err);
      setError("Could not fully decrypt your secure notes archive.");
    } finally {
      setFetchingNotes(false);
    }
  };

  const updateTriageContact = async (noteId: string, contactName: string) => {
    const { data, error } = await supabase
      .from('network_notes')
      .update({ 
        contact_name: contactName,
        processing_status: 'completed'
      })
      .eq('id', noteId)
      .select();

    if (error) throw error;
    return data;
  };

  // Action A: Create New Contact
const onConfirmAsNewPerson = async () => {
  if (!currentTriageItem || isProcessingTriage) return;

  const targetItemId = currentTriageItem.id;
  const targetName = currentTriageItem.detected_name;
  const user_id = session?.user?.id;

  try {
    setIsProcessingTriage(true);
    setMergeTargetName(''); 

    // 1. Peek ahead: are there other cards sharing this exact note ID?
    const siblingNamesInQueue = triageQueue.filter(
      item => item.id === targetItemId && item.detected_name !== targetName
    );
    const isLastItemForThisNote = siblingNamesInQueue.length === 0;

    // 2. Advance the local UI queue state instantly
    setTriageQueue(prevQueue => prevQueue.slice(1));

    // 3. Pass the target note, name, user context, AND the status flag
    await createNewContactAndLink(targetItemId, targetName, user_id, isLastItemForThisNote);
    
    // 4. Smoothly pull baseline updates
    await fetchAndDecryptNotes(false);

  } catch (err) {
    console.error("Error generating customized profile loop:", err);
    setError("Failed to verify profile creation with database service.");
  } finally {
    setIsProcessingTriage(false);
  }
};
  // Action B: Merge into Existing Profile from Dropdown Select
const onConfirmMatchWithName = async (targetName: string) => {
  if (!currentTriageItem || isProcessingTriage) return;
  
  const targetItemId = currentTriageItem.id;
  const targetDetectedName = currentTriageItem.detected_name;

  try {
    setIsProcessingTriage(true);
    setMergeTargetName('');
    setTriageQueue(prevQueue => prevQueue.slice(1));

    //  CALL YOUR UTILITY SERVICE LAYER TO MERGE
    // Pass the note ID, the name found (Pirate Joe), and the target profile (Ilya)
    // Your service backend should append 'Pirate Joe' to Ilya's alias array in the database!
    await linkToExistingContact(
      targetItemId, 
      targetDetectedName, 
      targetName, 
      [] // Pass existing aliases if you track them locally, or let the backend append
    );
    
    setNotes(prev => prev.map(n => 
      n.id === targetItemId ? { ...n, contact_name: targetName, processing_status: 'completed' } : n
    ));
    
  } catch (err) {
    console.error("Error merging contact profile nickname:", err);
  } finally {
    setIsProcessingTriage(false);
  }
};

  // Action C: Link to Suggested AI Match Profile
  const onConfirmSuggestedMatch = async () => {
    if (!currentTriageItem || !suggestedContact || isProcessingTriage) return;
    
    const targetItemId = currentTriageItem.id;
    const targetDetectedName = currentTriageItem.detected_name;
    const masterContactName = suggestedContact.contact_name;
    const currentAliases = suggestedContact.aliases || [];

    try {
      setIsProcessingTriage(true);
      setMergeTargetName('');

      // 1. Advance UI
      setTriageQueue(prev => prev.slice(1)); 

      const res = await linkToExistingContact(
        targetItemId, 
        targetDetectedName, 
        masterContactName, 
        currentAliases
      );

      if (res.success) {
        // Fetch rows to populate decrypted records, but do NOT rebuild the queue array
        await fetchAndDecryptNotes(false);
      } else {
        setError("Failed to link alias to existing profile.");
      }
    } catch (err) {
      console.error("Link processing failure:", err);
    } finally {
      setIsProcessingTriage(false);
    }
  };

  // --- AUDIO HANDLING HARDWARE UTILITIES ---
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
        setAudioChunks([]); 
        setIsSaving(true);
        setStatusMessage("Processing voice with AI...");

        try {
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

          const { transcript, headline, detected_names } = await response.json();

          setStatusMessage("Encrypting data locally...");
          const key = await getOrCreateEncryptionKey();

          const encryptedHeadline = await encryptData(headline, key);
          const encryptedTranscript = await encryptData(transcript, key);

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
              aliases: detected_names || [] 
            }])
            .select()
            .single();

          if (insertError) throw insertError;

          setStatusMessage("✓ Securely locked in your vault!");
          
          // Fetch raw records, and explicitly rebuild the active layout queue because this is a brand new audio entry
          await fetchAndDecryptNotes(true);

        } catch (err: any) {
          console.error("MVP Pipeline Error:", err);
          setError(err.message || "Failed to finalize audio recording.");
        } finally {
          setIsSaving(false);
          setTimeout(() => setStatusMessage(null), 3000);
        }
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
      mediaRecorder.stream.getTracks().forEach(track => track.stop()); 
      setIsRecording(false);
    }
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setIsSubmittingAuth(true);
    setAuthMessage(null);

    try {
      const isAnonymous = session?.user?.app_metadata?.provider === 'anonymous';
      if (session && isAnonymous) {
        const { error } = await supabase.auth.updateUser({ email: email });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email: email,
          options: { emailRedirectTo: window.location.origin }
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
      setAuthMessage({ type: 'error', text: err.message || 'Verification failed. Please try again.' });
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const handleStartGuestSession = async () => {
    setIsSubmittingAuth(true);
    setAuthMessage(null);
    try {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
    } catch (err: any) {
      console.error("Failed to start guest session:", err);
      setAuthMessage({ type: 'error', text: err.message || 'Could not start guest session. Please try again.' });
    } finally {
      setIsSubmittingAuth(false);
    }
  };

// --- DERIVED ROLODEX LOGIC (UPDATED FOR RELATIONAL MODEL) ---
const contactsDirectory = contactsList.reduce((acc: Record<string, any[]>, contact) => {
    // 1. Initialize an empty history array for EVERY person in your database
    if (!acc[contact.name]) {
      acc[contact.name] = [];
    }
    
    // 2. Scan your notes using the new hydrated array
    notes.forEach((note: any) => {
      // We check our new array instead of the old string!
      if (
        note.processing_status === 'completed' && 
        note.associated_contact_names?.includes(contact.name)
      ) {
        acc[contact.name].push(note);
      }
    });

    return acc;
  }, {});

  // This ensures the sidebar list reads from your true contacts table!
  const sortedContactNames = Object.keys(contactsDirectory).sort((a, b) => 
    a.localeCompare(b)
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-emerald-600"></div>
      </div>
    );
  }

  if (!session) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 text-center">
        {authView === 'landing' ? (
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
                authMessage.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-rose-50 border-rose-100 text-rose-700'
              }`}>
                {authMessage.text}
              </div>
            )}
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-[#f7f7ed] text-[#3c5671]">
      <div className="w-full max-w-md bg-white p-6 rounded-2xl shadow-xl shadow-[#dfcaab]/30 border border-[#dfcaab] text-center relative">
        
        {/* LEVEL TOP ROW: BRANDING LEFT, UTILITIES RIGHT */}
        <div className="flex flex-row items-center justify-between w-full border-b border-[#dfcaab]/30 pb-4 mb-4 select-none">
          <div className="flex flex-col items-start text-left">
            <div className="flex flex-row items-center gap-2.5">
              <div className="flex-shrink-0">
                <img src="/mascot.png" alt="Namewise Mascot" className="w-10 h-auto object-contain mix-blend-multiply drop-shadow-sm pointer-events-none" />
              </div>
              <div className="flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 45" className="w-36 h-auto">
                  <text x="0" y="34" fill="#3c5671" fontSize="32" fontWeight="900" fontFamily="system-ui, -apple-system, sans-serif" letterSpacing="-1.2">
                    namewise<tspan fill="#3c5671">.ai</tspan>
                  </text>
                </svg>
              </div>
            </div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#7eabc2] mt-0.5 pl-1">
              Connect Better
            </p>
          </div>

          <div className="flex flex-col items-end gap-1.5 text-right">
            {!isAnonymousUser && userEmail && (
              <span className="text-[10px] font-medium text-[#3c5671] bg-[#f7f7ed] px-2 py-0.5 rounded border border-[#dfcaab]">
                👤 {userEmail}
              </span>
            )}
            <button onClick={handleSignOut} className="text-xs font-semibold text-[#3c5671]/70 hover:text-[#3c5671] transition">
              Sign Out
            </button>
          </div>
        </div>

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

      {/* ↓ CONVERSION LANDING SIGNUP CARD ↓ */}
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
              authMessage.type === 'success' ? 'bg-[#7eabc2]/10 border-[#7eabc2]/20 text-[#7eabc2]' : 'bg-red-500/10 border-red-500/20 text-red-300'
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
            activeTab === 'memos' ? 'border-[#7eabc2] text-[#7eabc2]' : 'border-transparent text-[#3c5671]/60 hover:text-[#3c5671]'
          }`}
        >
          Memos Timeline
        </button>
        <button
          onClick={() => setActiveTab('rolodex')}
          className={`flex-1 pb-3 text-sm font-semibold border-b-2 transition ${
            activeTab === 'rolodex' ? 'border-[#7eabc2] text-[#7eabc2]' : 'border-transparent text-[#3c5671]/60 hover:text-[#3c5671]'
          }`}
        >
          Your Rolodex ({sortedContactNames.length})
        </button>
      </div>

      {/* Main Content View Switcher Container */}
      <div className="w-full max-w-md mt-6">
        
        {/* Incoming Triage Cards Container */}
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
                <button 
                  type="button"
                  onClick={onConfirmSuggestedMatch} 
                  className="mt-2 w-full bg-[#7eabc2] hover:bg-[#7eabc2]/80 text-[#3c5671] font-bold rounded-lg py-1.5 text-xs transition text-center block cursor-pointer outline-none"
                >
                  Yes, Link to {suggestedContact?.contact_name}
                </button>
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
                  type="button"
                  onClick={() => {
                    if (mergeTargetName) {
                      onConfirmMatchWithName(mergeTargetName);
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
                      <span className="text-[10px] text-[#3c5671]/60 font-medium">Saved Privately</span>
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