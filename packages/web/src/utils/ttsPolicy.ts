export interface NavigatorLike {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}

export interface AutoTtsPolicyInput {
  enabled: boolean;
  supported: boolean;
  requiresUserGestureForSpeech: boolean;
  unlocked: boolean;
}

export function detectRequiresUserGestureForSpeech(navigatorLike?: NavigatorLike): boolean {
  if (!navigatorLike) {
    return false;
  }

  const userAgent = navigatorLike.userAgent ?? '';
  const platform = navigatorLike.platform ?? '';
  const touchPoints = navigatorLike.maxTouchPoints ?? 0;
  const isiOSDevice = /iPad|iPhone|iPod/i.test(userAgent);
  const isIpadDesktopMode = platform === 'MacIntel' && touchPoints > 1;
  return isiOSDevice || isIpadDesktopMode;
}

export function isAutoTtsAllowed(input: AutoTtsPolicyInput): boolean {
  if (!input.enabled || !input.supported) {
    return false;
  }

  if (!input.requiresUserGestureForSpeech) {
    return true;
  }

  return input.unlocked;
}
