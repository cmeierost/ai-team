# Business Definition

> The core business problem this software solves.

> Generated during `ait init` onboarding with the CTO.

**Developer:** We are building a tool, that makes it easy for developers to set up ai  agents by using best practices in defining agent.mds and using other widely  used tools to narrow context for llms. it is the app we are working with to  build it too. the goal is that a developer can talk to a team of virtual  employees that are alwayst focussed on what they are doing like in an ideal   human software team. the primary pain to solve is that we constantly need to learn how to   narrow context by writing these files. the process of writing a software with  ai should not be knowing everything about that. ai should do it for us just by asking questions and optimizing our agents. we talk to an employee that is  always focussed on his task.

**john-smith:** Understood. Let’s pin this down in business terms.

1. What is the *core problem statement* in a single sentence? For example: “Developers waste time and mental energy learning prompt/agent design and context-narrowing techniques instead of just building software.”

2. Who exactly is the first target user: solo indie devs, small startup teams, or enterprise engineering orgs? “Developers” is broad — who do you want to win first?

3. In one line, what is the product’s promise to that target user? e.g., “Spin up a focused virtual software team that handles all agent configuration and context management for you.”

4. Imagine a developer using this for a full project: what are they *not* doing anymore that they have to do today (concretely: writing agent.md, fiddling with system prompts, managing tools, etc.)?

**Developer:** we have a code base.. maybe we need to look at it before we start to hire

**john-smith:** That’s fine; we shouldn’t hire blindly. But I don’t need to see the code to define the business problem, and without that clarity, the code review won’t tell us whether we’re building the right thing.

Let’s anchor a few points first, then we can talk about how the current codebase maps to it:

1. Can you state the core problem as one simple sentence? For example:  
   “Developers waste time manually designing and maintaining AI agents and context strategies, instead of just building software.”

2. Who is the *first* user you want to win with this:  
   - (a) solo indie devs  
   - (b) small startup teams (2–20 engineers)  
   - (c) larger product/engineering orgs?

3. If I pitch this in one line to that user, is this close or how would you change it:  
   “Create a focused virtual software team that automatically handles agent setup, context narrowing, and best-practice configs so you can just describe what you’re building”?

4. Today, in your own workflow with the existing codebase, what are the top 2–3 most painful, repetitive things you still have to do manually around agents/context that you wish this tool did for you?

Answer those briefly, then we can talk about whether the current codebase actually delivers on that, or is solving a different problem. When you feel the business definition is clear enough, type “done” or say “forward me to HR” to move on to the hiring/HR planning phase.

**Developer:** “Developers waste time manually designing and maintaining AI agents and context strategies, instead of just building software.

**john-smith:** Good, that’s a clean core problem.

Let’s tighten the rest of the definition:

1. First target user: which one do you want to win *first* and design around?  
   - Solo indie devs  
   - Small startup teams (2–20 engineers)  
   - Larger product/engineering orgs  

2. One-sentence promise to that user — try to fill this in:  
   “You describe the product you want, and our tool spins up and maintains a focused virtual dev team (agents, context, best practices) so you don’t have to learn prompt engineering or agent design.”

3. What is the *primary outcome metric* that would tell us it’s working, e.g.:  
   - Time to go from idea → working prototype  
   - % reduction in manual agent/config editing  
   - Number of successful “full projects” completed with almost no prompt/config tinkering  

4. Given your current codebase, what *one or two* things does it already do well toward this vision, and what’s the biggest missing capability?

Once you answer these, we’ll have a solid business definition. When you feel it’s clear enough, type “done” or say “forward me to HR” to move into the hiring/HR planning phase with Emily.
