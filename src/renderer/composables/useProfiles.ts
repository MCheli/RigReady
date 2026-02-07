/**
 * Composable for unified profile management.
 */

import { ref } from 'vue';
import type { Profile, ProfileSummary, ChecklistItem } from '../../shared/profileTypes';
import type { Simulator } from '../../shared/types';

function getApi() {
  return window.rigReady;
}

export function useProfiles() {
  const profiles = ref<ProfileSummary[]>([]);
  const allProfiles = ref<Profile[]>([]);
  const currentProfile = ref<Profile | null>(null);
  const activeProfileId = ref<string | null>(null);
  const loading = ref(false);

  async function loadProfiles(): Promise<void> {
    loading.value = true;
    try {
      profiles.value = await getApi().profiles.list();
      activeProfileId.value = await getApi().profiles.getActiveId();
    } finally {
      loading.value = false;
    }
  }

  async function loadAllProfiles(): Promise<void> {
    loading.value = true;
    try {
      allProfiles.value = await getApi().profiles.getAll();
    } finally {
      loading.value = false;
    }
  }

  async function getProfile(id: string): Promise<Profile | undefined> {
    const profile = await getApi().profiles.getById(id);
    if (profile) {
      currentProfile.value = profile;
    }
    return profile;
  }

  async function createProfile(data: {
    name: string;
    game: Simulator;
    checklistItems?: ChecklistItem[];
  }): Promise<Profile> {
    const profile = await getApi().profiles.create({
      name: data.name,
      game: data.game,
      checklistItems: data.checklistItems || [],
      trackedConfigurations: [],
    });
    await loadProfiles();
    return profile;
  }

  async function saveProfile(profile: Profile): Promise<void> {
    await getApi().profiles.save(profile);
    await loadProfiles();
  }

  async function deleteProfile(id: string): Promise<boolean> {
    const result = await getApi().profiles.delete(id);
    if (result) {
      await loadProfiles();
      if (currentProfile.value?.id === id) {
        currentProfile.value = null;
      }
    }
    return result;
  }

  async function cloneProfile(id: string, newName: string): Promise<Profile | undefined> {
    const result = await getApi().profiles.clone(id, newName);
    if (result) {
      await loadProfiles();
    }
    return result;
  }

  async function setActiveProfile(id: string): Promise<boolean> {
    const result = await getApi().profiles.setActive(id);
    if (result) {
      activeProfileId.value = id;
      await loadProfiles();
    }
    return result;
  }

  async function getActiveProfile(): Promise<Profile | null> {
    return getApi().profiles.getActive();
  }

  return {
    profiles,
    allProfiles,
    currentProfile,
    activeProfileId,
    loading,
    loadProfiles,
    loadAllProfiles,
    getProfile,
    createProfile,
    saveProfile,
    deleteProfile,
    cloneProfile,
    setActiveProfile,
    getActiveProfile,
  };
}
