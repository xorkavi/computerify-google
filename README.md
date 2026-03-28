# Copy-that — Google Workspace Add-on

Turn your writing into on-brand copy – instantly.

Powered by a DevRev AI agent trained on Computer's brand voice guidelines.

## How it works

Select text in your document, click **Fix copy**, and the add-on replaces it with an on-brand version. It supports single and multi-shape selection in Slides, and highlighted text or cursor-paragraph detection in Docs.

## Setup for users

### 1. Install the add-on

Open a Google Doc or Slides presentation, then go to **Extensions → Apps Script**. Copy all the `.gs` and `.json` files from this repo into the script editor.

### 2. Get a DevRev PAT token

1. Go to your DevRev account settings
2. Generate a **Personal Access Token** (PAT)
3. Copy the token

### 3. Configure the token

**Option A — Extensions menu:**
- Go to **Extensions → Copy-that → Set PAT token**
- Paste your token and click OK

**Option B — Sidebar panel:**
- Click the Copy-that icon in the right sidebar panel
- Click **Settings**
- Paste your token and click **Save**

### 4. Use it

1. Select text in your document (highlight text in Docs, or click text boxes in Slides)
2. Go to **Extensions → Copy-that → Fix copy**
3. Or click **Fix copy** in the sidebar panel
4. The text is replaced in-place with the on-brand version

### Tips

- **Multi-select in Slides:** Select multiple text boxes and they'll all be transformed in a single batch call.
- **Edit prompt:** Go to **Extensions → Copy-that → Edit prompt** to customize the editing instructions.
- **New session:** Click **New session** in the sidebar or menu to reset the agent's session context.

## For developers

### Project structure

```
├── appsscript.json      # Manifest — scopes, add-on config, homepage triggers
├── Code.gs              # Entry points — Extensions menu + CardService sidebar
├── Config.gs            # Constants, storage helpers, session management
├── AgentService.gs      # DevRev API calls, SSE parsing, response cleaning
├── DocsService.gs       # Google Docs text extraction and replacement
├── SlidesService.gs     # Google Slides text extraction and replacement
├── Static.svg           # Copy-that logo (SVG source)
└── icons/               # PNG icons at 16, 32, 48, 128px
```

### Architecture

The add-on has two parallel entry points:

1. **Extensions menu** (`onOpen`) — registers menu items that call server functions directly. Uses `ui.alert()` and `ui.prompt()` for feedback. Has a 6-minute execution timeout.

2. **CardService sidebar** (`onDocsHomepage` / `onSlidesHomepage`) — renders card-based UI in the right sidebar panel. Uses `ActionResponse` with notifications for feedback. Has a 30-second execution timeout.

Both paths share the same core functions:

- `callAgent(text)` — single text transformation
- `callAgentBatch(texts)` — multi-text batch transformation (joins with `===` separators, single API call)
- `getDocsSelection()` / `replaceDocsSelection()` — Docs text handling with cursor fallback
- `getSelectedSlidesShapes()` — returns individual shape objects for per-shape processing

### DevRev agent integration

The add-on calls DevRev's AI agent API:

- **Endpoint:** `https://api.devrev.ai/internal/ai-agents.events.execute-sync`
- **Auth:** PAT token in the `Authorization` header
- **Protocol:** POST with JSON payload, SSE response
- **Session:** Persistent session ID stored in `PropertiesService` — reused across calls so the agent caches its knowledge base lookups

The response is streamed as Server-Sent Events. `parseSSEResponse()` handles both `data: {json}` formats and line-by-line fallback parsing.

### Extending the add-on

**Add a new editor (e.g. Sheets):**
1. Create a `SheetsService.gs` with `getSheetsSelection()` and `replaceSheetsSelection()`
2. Add a case in `getEditorType_()` for `SpreadsheetApp`
3. Add the Sheets handling to `menuFixCopy_()` and `cardFixCopy()`
4. Add `sheets` homepage trigger in `appsscript.json`
5. Add the `spreadsheets.currentonly` OAuth scope

**Change the AI agent:**
1. Update `AGENT_ID` and `API_URL` in `Config.gs`
2. Adjust `parseSSEResponse()` if the new agent uses a different response format
3. Update `cleanAgentResponse()` for any agent-specific artifacts

**Add new card UI:**
1. Build cards with `CardService.newCardBuilder()`
2. Return `ActionResponse` with navigation from action handlers
3. Keep actions fast (under 30 seconds) — use batch calls for multi-item operations

### OAuth scopes

| Scope | Purpose |
|-------|---------|
| `documents.currentonly` | Read/write the active Google Doc |
| `presentations.currentonly` | Read/write the active Google Slides |
| `script.container.ui` | Show menus, modals, and alerts |
| `script.external_request` | HTTP calls to DevRev API |
| `drive.file` | Required by CardService sidebar |

### Storage

All user settings are stored in `PropertiesService.getUserProperties()` — per-user, encrypted, never in source code:

| Key | Value |
|-----|-------|
| `pat` | DevRev Personal Access Token |
| `customPrompt` | User's custom prompt (empty = use default) |
| `sessionId` | Persistent agent session ID |
