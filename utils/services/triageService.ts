import { supabase } from "../supabase";

/**
 * PATH 1 & 4: Link a note to an existing contact name 
 * and passively append any new nickname to their alias list across records.
 */
export async function linkToExistingContact(
  noteId: string, 
  spokenName: string, 
  targetContactName: string, 
  currentAliases: string[] = []
) {
  try {
    // 1. Stamp the target contact's master name onto this note entry
    const { error: noteError } = await supabase
      .from("network_notes")
      .update({
        contact_name: targetContactName,
        processing_status: "completed"
      })
      .eq("id", noteId);

    if (noteError) throw noteError;

    // 2. Train the system: Add the nickname to the alias list if it's missing
    const cleanSpokenName = spokenName.trim();
    const aliasExists = currentAliases.some(
      (a) => a.toLowerCase() === cleanSpokenName.toLowerCase()
    );

    if (!aliasExists && cleanSpokenName !== "") {
      const updatedAliases = [...currentAliases, cleanSpokenName];
      
      // Update the alias array on all records sharing this master contact name
      const { error: aliasError } = await supabase
        .from("network_notes")
        .update({ aliases: updatedAliases })
        .eq("contact_name", targetContactName);

      if (aliasError) throw aliasError;
      console.log(`PASSIVE LEARNING: Linked "${cleanSpokenName}" to ${targetContactName}`);
    }

    return { success: true };
  } catch (err) {
    console.error("Failed to merge triage entry:", err);
    return { success: false, error: err };
  }
}

/**
 * PATH 3: Initialize a brand new contact profile directly on this note item
 */
export async function createNewContactAndLink(
  noteId: string, 
  newName: string, 
  userId: string
) {
  try {
    const cleanName = newName.trim();

    // Set this note's master contact name, and seed its alias index with itself
    const { error } = await supabase
      .from("network_notes")
      .update({
        contact_name: cleanName,
        aliases: [cleanName],
        processing_status: "completed"
      })
      .eq("id", noteId);

    if (error) throw error;

    console.log(`DIRECTORY EXPANDED: Created profile for "${cleanName}"`);
    return { success: true };
  } catch (err) {
    console.error("Failed to establish new contact profile:", err);
    return { success: false, error: err };
  }
}