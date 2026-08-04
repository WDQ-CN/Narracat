# Character Chat OSS Audit

Date: 2026-06-05

Purpose:
- Find open-source references for Character chat without changing the MVP boundary.
- Decide what can be reused, what can only be studied, and what should be avoided.

## Recommendation

MVP should not embed an existing character-chat product.

Build NarraCat's Character chat as a native App feature:
- Use NarraCat `bible/characters/*.md` as the character source of truth.
- Use NovelMemory read tools for completed-story recall.
- Store Character chat transcript in the App layer.
- Keep it separate from Agent run, Result notification, and NarraCat writing workflow.

Use OSS only as reference:
- Product pattern reference: SillyTavern, Agnai, ChatterUI.
- Engineering reference: ChatClaw, LibreChat.
- Schema inspiration: Character Card V2, OpenRouter character utilities.

Do not copy AGPL source code into NarraCat-app.

## Reviewed Projects

### SillyTavern

Source:
- https://github.com/SillyTavern/SillyTavern

Useful:
- Strong roleplay / character-chat product precedent.
- Visual Novel Mode, character cards, lorebooks / WorldInfo, multi-provider support.
- Good reference for roleplay prompt layering and world/lore injection concepts.

Risk:
- AGPL-3.0.
- Power-user UI and prompt controls are too heavy for NarraCat's MVP.

Decision:
- Study product mechanics only. Do not reuse code.

### Character Card V2 Spec

Source:
- https://github.com/malfoyslastname/character-card-spec-v2
- https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md

Useful:
- Separates character definition, first message, example messages, system prompt, post-history instructions, tags, and character-specific lorebook.
- The `character_book` idea maps conceptually to NarraCat's completed-story knowledge, but NarraCat already has NovelMemory.

Risk:
- External character-card schema should not become NarraCat's primary character contract.

Decision:
- Use as prompt-card inspiration only.
- Map NarraCat role files into an internal Character contact prompt, not into external Tavern card files.

### OpenRouter Character

Source:
- https://github.com/OpenRouterTeam/character

Useful:
- MIT utility library for character cards.
- Could be useful only if NarraCat later imports / exports external character cards.

Risk:
- Tiny project with no releases at audit time; not necessary for MVP.

Decision:
- Do not add dependency for MVP.
- Revisit only if external Character Card import/export enters scope.

### ChatClaw

Source:
- https://github.com/fastclaw-ai/chatclaw

Useful:
- MIT.
- Good engineering reference for DM-style agent chat, multi-conversation storage, IndexedDB default persistence, SSE streaming, and avatar picker with random / emoji / upload modes.
- Avatar upload model aligns with future role-setting avatar reuse.

Risk:
- Multi-agent company/team domain does not match NarraCat roleplay.
- Next.js app architecture does not map directly to Electron renderer.

Decision:
- Safe to study and selectively adapt patterns.
- If code is reused later, keep attribution and verify dependency footprint.

### Agnai

Source:
- https://github.com/agnaistic/agnai
- https://agnai.chat/

Useful:
- Fictional character chat, group conversations, multiple persona schema formats, memory/lore books, generated characters.
- Good product reference for future group chat and memory-book concepts.

Risk:
- AGPL-3.0.
- Multi-tenant / subscription / hosted product scope is irrelevant to desktop MVP.

Decision:
- Study product mechanics only. Do not reuse code.

### ChatterUI

Source:
- https://github.com/Vali-98/ChatterUI

Useful:
- Character chat, Character Card V2 support, multiple chats per character, on-device and remote modes.
- Good mobile reference for compact character-chat UX.

Risk:
- AGPL-3.0.
- React Native architecture is not useful for Electron renderer implementation.

Decision:
- Study product mechanics only. Do not reuse code.

### LibreChat

Source:
- https://github.com/danny-avila/LibreChat

Useful:
- MIT.
- Mature provider / preset / conversation branching / multi-model chat patterns.

Risk:
- General AI assistant platform, not character immersion.
- Too heavy for a focused Workbench feature.

Decision:
- Use as provider and conversation-system reference only.
- Do not embed.

### Open WebUI

Source:
- https://github.com/open-webui/open-webui

Useful:
- Strong RAG / knowledge UI reference.

Risk:
- License requires preserving Open WebUI branding except under limited conditions.
- Architecture and branding terms make it unsuitable for embedding into NarraCat-app.

Decision:
- Do not reuse code.
- Study RAG patterns only if future knowledge browsing expands.

## MVP Implications

Implementation direction:
- Native `CharacterContact` and `CharacterChatTranscript` App models.
- Dedicated Character chat runner / IPC contract, separate from Agent run.
- Reuse Model service verification and SDK call infrastructure where appropriate.
- Build prompt context from role file + latest completed chapter + on-demand NovelMemory reads.

Explicit non-goals:
- No external character-card import/export.
- No AGPL code reuse.
- No group chat.
- No background Character ping.
- No Character chat to Agent action handoff.
