import { create } from 'zustand';

interface BackendConnectionState {
  isReachable: boolean;
  setReachable: (isReachable: boolean) => void;
}

export const useBackendConnectionStore = create<BackendConnectionState>((set) => ({
  isReachable: true, // Optimistically assume true
  setReachable: (isReachable) => set({ isReachable }),
}));
