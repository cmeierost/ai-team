import { describe, expect, it } from 'vitest';
import {
  agentMessageBackground,
  type AgentDisplayInfo,
} from './agent-color.js';

function agent(color: AgentDisplayInfo['color']): AgentDisplayInfo {
  return { name: 'Agent', color };
}

describe('agentMessageBackground', () => {
  it('chooses a light tinted surface for a dark agent color', () => {
    const background = agentMessageBackground(agent({ r: 30, g: 40, b: 50 }));
    expect(background.r).toBeGreaterThan(240);
    expect(background.b).toBeGreaterThan(background.r);
  });

  it('chooses a dark tinted surface for a bright agent color', () => {
    const background = agentMessageBackground(agent({ r: 230, g: 180, b: 80 }));
    expect(background.r).toBeLessThan(40);
    expect(background.g).toBeLessThan(30);
  });
});
