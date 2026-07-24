# 📝 TODO - Quick Fixes

Lightweight task list for small fixes, improvements, and refactorings that come to mind while working on other features. These are not part of a larger feature plan—just incremental improvements discovered during development.

**For agents:** Pick 2-4 tasks that are close together by functionality or code location. These tasks are quickly formulated and may require planning—ask the user which ones should be planned before implementation. Get approval, then implement them in one focused session. Remove tasks as they're completed.

---

## 📦 Package: TUI Message Rendering

- [ ] **TUI ask tool message rendering**  
  The ask tool question renders in the input field but looks too similar to normal input (especially for type input). No line break, text cuts off on right side. The message should be clearly visually distinct from input/output, perhaps as a separate line above the input field with distinct formatting or styling.

- [ ] **TUI chat message spacing**  
  Regular chat messages in the TUI need padding and margin at the top and bottom for better visual separation and readability.

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

---

## 📦 Package: UI Cleanup

- [ ] **Slash command name uniqueness**  
  Slash command suggestions are showing duplicate names (e.g., multiple /list commands). Command names must be unique to avoid confusion in suggestions.

- [ ] **Remove tools list from TUI footer**  
  The footer is displaying a list of possible tools at the bottom, which is unnecessary and clutters the interface. Remove this display.
