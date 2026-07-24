# 📝 TODO - Quick Fixes

Lightweight task list for small fixes, improvements, and refactorings that come to mind while working on other features. These are not part of a larger feature plan—just incremental improvements discovered during development.

**For agents:** Pick 2-4 tasks that are close together by functionality or code location. These tasks are quickly formulated and may require planning—ask the user which ones should be planned before implementation. Get approval, then implement them in one focused session. Remove tasks as they're completed.

---

## 📦 Package: Tool Call Rendering

- [ ] **TUI tool call rendering control**  
  Tool calls should not show "Agent Name -> Developer Name:" header (that's only for conversation messages). The handler component for each tool should decide whether to render as a chat bubble or not.

- [ ] **TUI tool call agent identification**  
  Tool calls show "Agent Name → Developer Name:" which doesn't make sense. When resuming, these indicators don't show—that's the correct behavior from the start. Instead, show which agent called the tool (e.g., "Sarah Lee called com_handoff") using the agent's color. Find why it renders initially but not on resume, and show agent identification instead of name indicators.

---

## 📦 Package: Session Persistence & Display

- [ ] **Chat session resumption visual consistency**  
  When resuming a chat, it should look exactly the same as before. Need to store all visual information (spacing, layout, rendering state) in the database for the session so it can be fully reconstructed.

- [ ] **Error visibility and persistence**  
  Errors must always be shown to the user and saved in the conversation history/database. No silent failures or lost error messages.

- [ ] **Save and display LLM response metadata**  
  Save LLM response metadata in the database: response time (already in LLM response), input tokens, and output tokens. Display this information in the UI for better observability of LLM performance and costs.

- [ ] **Store thought process metadata**  
  Thought process is shown but not persisted. Store it as a message with a "thought" flag that excludes it from context (doesn't count toward token limits). Also save the time it took to generate the thought. Display as "AgentName is thinking..." instead of "💭 Thought process".

---

## 📦 Package: UI Cleanup

- [ ] **Slash command name uniqueness**  
  Slash command suggestions are showing duplicate names (e.g., multiple /list commands). Command names must be unique to avoid confusion in suggestions.

- [ ] **Remove tools list from TUI footer**  
  The footer is displaying a list of possible tools at the bottom, which is unnecessary and clutters the interface. Remove this display.
