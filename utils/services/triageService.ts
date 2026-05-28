import { supabase } from '../supabase'; // ◄ Verified correct path

/**
 * ACTION 1: Initialize a contact entry path by upgrading the current note 
 * to act as the primary profile anchor.
 */
export const createNewContactAndLink = async (
  noteId: string, 
  contactName: string, 
  userId: string,
  isLastItemForThisNote: boolean // ◄ Add this flag to safely manage the queue status
) => {
  try {
    // 1. Create the master entry in the 'contacts' table
    const { data: newContact, error: contactError } = await supabase
      .from('contacts')
      .insert([{ user_id: userId, name: contactName }])
      .select()
      .single();

    if (contactError) {
      console.error("❌ Database Error creating contact row:", contactError.message);
      throw contactError;
    }

    // 2. Map the relationship in the new junction table
    const { error: linkError } = await supabase
      .from('note_contacts')
      .insert([{
        user_id: userId,
        note_id: noteId,
        contact_id: newContact.id
      }]);

    if (linkError) {
      console.error("❌ Database Error creating relational link:", linkError.message);
      throw linkError;
    }

    // 3. Conditional Note Update: Only clear from triage when the last sibling card is cleared
    if (isLastItemForThisNote) {
      const { error: noteUpdateError } = await supabase
        .from('network_notes')
        .update({ processing_status: 'completed' })
        .eq('id', noteId);

      if (noteUpdateError) {
        console.error("❌ Database Error completing note status:", noteUpdateError.message);
        throw noteUpdateError;
      }
    }

    return newContact;

  } catch (error) {
    console.error("🚨 Complete failure inside createNewContactAndLink:", error);
    throw error;
  }
};
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

    const updatedAliases = Array.from(new Set([...currentAliases, detectedName]));

    const { error } = await supabase
      .from('network_notes')
      .update({
        contact_name: existingContactName, 
        aliases: updatedAliases, 
        processing_status: 'completed' 
      })
      .eq('id', noteId); 

    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error("triageService [linkToExistingContact] Failure:", err);
    return { success: false, error: err };
  }
}