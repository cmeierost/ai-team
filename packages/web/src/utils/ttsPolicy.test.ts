import { describe, expect, it } from 'vitest';
import {
  detectRequiresUserGestureForSpeech,
  isAutoTtsAllowed,
  type NavigatorLike,
} from './ttsPolicy';

describe('detectRequiresUserGestureForSpeech', () => {
  it('returns true for iPhone user agents', () => {
    const nav: NavigatorLike = {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
    };

    expect(detectRequiresUserGestureForSpeech(nav)).toBe(true);
  });

  it('returns true for iPad desktop-mode safari', () => {
    const nav: NavigatorLike = {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    };

    expect(detectRequiresUserGestureForSpeech(nav)).toBe(true);
  });

  it('returns false for desktop chrome', () => {
    const nav: NavigatorLike = {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      platform: 'Win32',
      maxTouchPoints: 0,
    };

    expect(detectRequiresUserGestureForSpeech(nav)).toBe(false);
  });
});

describe('isAutoTtsAllowed', () => {
  it('returns false when TTS is disabled', () => {
    expect(
      isAutoTtsAllowed({
        enabled: false,
        supported: true,
        requiresUserGestureForSpeech: false,
        unlocked: true,
      })
    ).toBe(false);
  });

  it('returns false when TTS is unsupported', () => {
    expect(
      isAutoTtsAllowed({
        enabled: true,
        supported: false,
        requiresUserGestureForSpeech: false,
        unlocked: true,
      })
    ).toBe(false);
  });

  it('returns false on iOS-like policy before unlock', () => {
    expect(
      isAutoTtsAllowed({
        enabled: true,
        supported: true,
        requiresUserGestureForSpeech: true,
        unlocked: false,
      })
    ).toBe(false);
  });

  it('returns true on iOS-like policy after unlock', () => {
    expect(
      isAutoTtsAllowed({
        enabled: true,
        supported: true,
        requiresUserGestureForSpeech: true,
        unlocked: true,
      })
    ).toBe(true);
  });

  it('returns true on non-gesture browsers', () => {
    expect(
      isAutoTtsAllowed({
        enabled: true,
        supported: true,
        requiresUserGestureForSpeech: false,
        unlocked: false,
      })
    ).toBe(true);
  });
});
