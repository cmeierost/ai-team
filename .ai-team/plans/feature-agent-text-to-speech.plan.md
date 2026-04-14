---
id: agent-text-to-speech
type: feature
title: Agent Text-to-Speech
status: todo
priority: low
tags:
  - web
  - ui
createdAt: 2026-04-12T12:00:00.000Z
updatedAt: 2026-04-12T12:00:00.000Z
deadline: null
createdBy: human
createdByType: human
requiresApproval: false
estimatedHours: null
assignedTo: daniel-navarro

------

## Goal

The Web UI currently has a speech-to-text button, but it would be beneficial if the agents could also talk back to the user. This should be implemented using the browser's built-in Text-to-Speech (TTS) API (`SpeechSynthesis`).

Additionally, agents should have selectable or configurable voices so that the spoken voice matches the agent's visual persona (e.g., an agent that looks like a man shouldn't talk like a woman).

## Action Items

- [ ] Integrate the browser `SpeechSynthesis` API in the Web UI for agent responses.
- [ ] Add a voice configuration/mapping for each agent to ensure their voice matches their persona.
- [ ] Implement a UI toggle to enable or disable the agent text-to-speech feature.
