# Business Definition

> The core business problem this software solves.

> Generated during `ait init` onboarding with the CEO.

**Developer:** We are building a tool, that makes it easy for developers to set up ai  agents by using best practices in defining agent.mds and using other widely  used tools to narrow context for llms. it is the app we are working with to  build it too. the goal is that a developer can talk to a team of virtual  employees that are alwayst focussed on what they are doing like in an ideal   human software team. the primary pain to solve is that we constantly need to learn how to   narrow context by writing these files. the process of writing a software with  ai should not be knowing everything about that. ai should do it for us just by asking questions and optimizing our agents. we talk to an employee that is  always focussed on his task.

**michael-brown:** Understood. Let me play this back at a business level: you’re building a developer tool that auto-creates and maintains high-quality agent definitions (agent.mds, tools, context narrowing) so developers can just “talk to a focused virtual team” instead of learning prompt/agent engineering. 

I want to sharpen this a bit:

1. **Primary problem**: Is the core pain (a) “it’s hard and time-consuming to write/maintain good agent configs,” (b) “AI agents drift/unfocus and waste tokens,” or (c) “it’s hard to coordinate multiple agents like a real team”? Which of these is most important?

2. **Target users**: Who is the first customer you’re building for:  
   - Solo indie devs experimenting with AI?  
   - Startup teams building AI-powered products?  
   - Larger orgs with multiple squads using AI in their SDLC?

3. **Core behavior**: In the ideal flow, what does a developer *actually do*? For example: “They describe their project and roles in natural language → the system generates agents + configs → the dev just chats with ‘Front-end Dev’, ‘Architect’, ‘QA’, etc., and the system keeps their scopes tight automatically.” Is that roughly right, or different?

4. **Definition of “always focused”**: Concretely, how would you know an agent is “always focused” on its task? Less hallucination? Less off-topic code? Lower token usage? Tasks completed with fewer back-and-forths?

Answer those, and we’ll turn this into a crisp one-sentence value proposition and a clear success metric. When you feel the business definition is solid, type **“done”** or **“forward me to HR”** to move to the HR / org planning phase.
