import { describe, expect, it } from 'vitest';

import { ChatCommand as ChatFromPrimary } from './chat.command.js';
import { ChatCommand as ChatFromAlias, ChatCommandMetadata } from './chat-i.command.js';

describe('chat-i.command alias', () => {
  it('re-exports the same ChatCommand class implementation', () => {
    expect(ChatFromAlias).toBe(ChatFromPrimary);
  });

  it('re-exports metadata compatible with ChatCommand.metadata', () => {
    expect(ChatCommandMetadata).toBe(ChatFromPrimary.metadata);
    expect(ChatCommandMetadata.key).toBe('chat');
  });
});
