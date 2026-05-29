import { supabase } from '../supabase';

/**
 * ACTION 1: Initialize a contact entry path by upgrading the current note 
 * to act as the primary profile anchor.
 */
export async function createNewContactAndLink(noteId: string, name: string, userId: string) {
  try {
    console.log(`Creating contact profile text entry for: ${name} on Note ID: ${noteId}`);
    const { data, error } = await supabase
      .from('network_notes')
      .update({
        contact_name: name, // Fill the text marker name column
        processing_status: 'completed' // Mark this specific row task clear
      })
      .eq('id', noteId) // ◄ Rely cleanly on the unique Note UUID match
      .select();

      console.log("🔥 Supabase direct mutation return row:", data);

    if (error) throw error;

    if (!data || data.length === 0) {
      console.warn("⚠️ RLS GUARD TRIGGERED: Supabase found the row but refused to alter it. Check your table's UPDATE policies.");
    } else {
      console.log("🔥 Supabase direct mutation return row:", data);
    }
    
    return { success: data && data.length > 0 };
  } catch (err) {
    console.error("triageService [createNewContactAndLink] Failure:", err);
    return { success: false, error: err };
  }
}

/**
 * ACTION 2: Link an alias name directly to a master profile row name context
 */
export async function linkToExistingContact(
  noteId: string, 
  detectedName: string, 
  existingContactName: string, 
  currentAliases: string[]
) {
  try {
    console.log(`Linking alias "${detectedName}" to master contact profile "${existingContactName}"`);

    // Ensure we don't push duplicate string tags into the tracking index
    const updatedAliases = Array.from(new Set([...currentAliases, detectedName]));

    const { error } = await supabase
      .from('network_notes')
      .update({
        contact_name: existingContactName, // Associate this text group cluster
        aliases: updatedAliases, // Store the appended tracking string slice
        processing_status: 'completed' // Clear the flag
      })
      .eq('id', noteId); // ◄ Rely cleanly on the unique Note UUID match

    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error("triageService [linkToExistingContact] Failure:", err);
    return { success: false, error: err };
  }
}