import { useCallback, useEffect, useRef, useState } from 'react';
import { detectRequiresUserGestureForSpeech } from '../utils/ttsPolicy';
import { resolveSpokenWordBoundary } from '../utils/ttsHighlight';

export interface UseSpeechSynthesisResult {
  supported: boolean;
  supportsAutoTts: boolean;
  requiresUserGestureForSpeech: boolean;
  speaking: boolean;
  paused: boolean;
  speakingWord: string | null;
  speakingOccurrence: number | null;
  lastError: string | null;
  voices: SpeechSynthesisVoice[];
  speakChunk: (text: string, voice?: SpeechSynthesisVoice, rate?: number) => void;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  clearError: () => void;
}

function normalizeSpeechErrorMessage(errorCode?: string): string {
  switch (errorCode) {
    case 'interrupted':
      return 'Speech playback was interrupted.';
    case 'not-allowed':
      return 'Speech playback was blocked by the browser. Please tap enable/play and try again.';
    case 'audio-busy':
      return 'Audio output is currently busy. Please try again.';
    default:
      return `Speech playback failed (${errorCode || 'unknown'}).`;
  }
}

export function useSpeechSynthesis(): UseSpeechSynthesisResult {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [requiresUserGestureForSpeech] = useState<boolean>(() => {
    if (typeof navigator === 'undefined') {
      return false;
    }
    return detectRequiresUserGestureForSpeech(navigator);
  });
  const supportsAutoTts = supported && !requiresUserGestureForSpeech;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speakingWord, setSpeakingWord] = useState<string | null>(null);
  const [speakingOccurrence, setSpeakingOccurrence] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const speakingRef = useRef(false);

  const resetSpeakingHighlightTracking = useCallback(() => {
    setSpeakingWord(null);
    setSpeakingOccurrence(null);
  }, []);

  useEffect(() => {
    if (!supported) return;

    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices();
      if (available.length > 0) {
        setVoices(available);
      }
    };

    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    };
  }, [supported]);

  const cancel = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    speakingRef.current = false;
    setSpeaking(false);
    setPaused(false);
    resetSpeakingHighlightTracking();
  }, [supported, resetSpeakingHighlightTracking]);

  const clearError = useCallback(() => {
    setLastError(null);
  }, []);

  const pause = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.pause();
    setPaused(true);
  }, [supported]);

  const resume = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.resume();
    setPaused(false);
  }, [supported]);

  const speakChunk = useCallback(
    (text: string, voice?: SpeechSynthesisVoice, rate = 1) => {
      if (!supported || !text.trim()) return;
      setLastError(null);
      const utterance = new SpeechSynthesisUtterance(text);
      if (voice) {
        utterance.voice = voice;
      }
      utterance.rate = rate;
      utterance.onstart = () => {
        // Reset for every utterance so occurrence mapping is always scoped to
        // the currently spoken chunk and can start from the first token.
        resetSpeakingHighlightTracking();
        speakingRef.current = true;
        setSpeaking(true);
      };
      utterance.onend = () => {
        // Only clear speaking flag when the queue drains
        if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
          speakingRef.current = false;
          setSpeaking(false);
          setPaused(false);
          resetSpeakingHighlightTracking();
        }
      };
      utterance.onerror = (e) => {
        const normalizedError = normalizeSpeechErrorMessage(e.error);

        if (e.error !== 'interrupted') {
          console.error('[TTS] utterance error:', e);
        }
        setLastError(normalizedError);
        speakingRef.current = false;
        setSpeaking(false);
        setPaused(false);
        resetSpeakingHighlightTracking();
      };
      utterance.onboundary = (e) => {
        const resolvedBoundary = resolveSpokenWordBoundary(utterance.text, e.charIndex);
        if (!resolvedBoundary?.word) {
          // Some boundary events can point at punctuation/whitespace; keep
          // the previous highlight stable until a resolvable word arrives.
          return;
        }

        setSpeakingWord(resolvedBoundary.word);
        setSpeakingOccurrence(resolvedBoundary.occurrence);
      };
      // Note: we do NOT call resume() here unconditionally anymore — pause/resume
      // is now user-controlled. Only resume if paused from a previous bug state.
      if (window.speechSynthesis.paused && !paused) {
        window.speechSynthesis.resume();
      }
      console.debug(
        '[TTS] speaking:',
        JSON.stringify(text).slice(0, 80),
        'voice:',
        voice?.name ?? 'default'
      );
      window.speechSynthesis.speak(utterance);
    },
    [supported, paused, resetSpeakingHighlightTracking]
  );

  return {
    supported,
    supportsAutoTts,
    requiresUserGestureForSpeech,
    speaking,
    paused,
    speakingWord,
    speakingOccurrence,
    lastError,
    voices,
    speakChunk,
    pause,
    resume,
    cancel,
    clearError,
  };
}
