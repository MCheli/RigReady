import { onMounted, onUnmounted, ref } from 'vue';

export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  description: string;
  action: () => void;
}

const showShortcutsHelp = ref(false);

export function useKeyboardShortcuts() {
  const shortcuts = ref<KeyboardShortcut[]>([]);

  function registerShortcuts(newShortcuts: KeyboardShortcut[]) {
    shortcuts.value = newShortcuts;
  }

  function handleKeydown(event: KeyboardEvent) {
    // Don't trigger shortcuts when typing in input fields
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    // Check for ? key to show help
    if (event.key === '?' && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      showShortcutsHelp.value = !showShortcutsHelp.value;
      return;
    }

    // Escape to close help
    if (event.key === 'Escape' && showShortcutsHelp.value) {
      showShortcutsHelp.value = false;
      return;
    }

    // Find matching shortcut
    for (const shortcut of shortcuts.value) {
      const ctrlMatch = shortcut.ctrl ? event.ctrlKey : !event.ctrlKey;
      const altMatch = shortcut.alt ? event.altKey : !event.altKey;
      const shiftMatch = shortcut.shift ? event.shiftKey : !event.shiftKey;
      const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase();

      if (keyMatch && ctrlMatch && altMatch && shiftMatch) {
        event.preventDefault();
        shortcut.action();
        return;
      }
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown);
  });

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown);
  });

  function formatShortcut(shortcut: KeyboardShortcut): string {
    const parts: string[] = [];
    if (shortcut.ctrl) parts.push('Ctrl');
    if (shortcut.alt) parts.push('Alt');
    if (shortcut.shift) parts.push('Shift');
    parts.push(shortcut.key.toUpperCase());
    return parts.join('+');
  }

  function hideHelp() {
    showShortcutsHelp.value = false;
  }

  return {
    shortcuts,
    showShortcutsHelp,
    registerShortcuts,
    formatShortcut,
    hideHelp,
  };
}
