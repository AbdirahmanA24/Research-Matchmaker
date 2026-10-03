# Research Matchmaker

An English research exploration agent for undergraduates. It connects an initial interest to a few research directions, an achievable weekly plan, relevant faculty, and a truthful outreach draft.

## Private cloud preview

[Open Research Matchmaker](https://research-matchmaker-fyl.ipigeonkingi.chatgpt.site) — deployed privately with ChatGPT Sites on October 3, 2026. Sign in with the owning ChatGPT account if prompted.

The cloud preview runs the complete guided demo, with UMN faculty examples and browser-local progress. Live AI and OpenClaw are not connected. The Sites-compatible source is in `sites/research-matchmaker/`; its hosting manifest records the existing Site identity for updates.

## Run locally

Requires Node.js 22 or newer and npm.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The API runs on port 3001. The app starts in a clearly labelled guided demo, with no API key required.

For a production build on your own computer:

```sh
npm run build
npm start
```

Then open **http://127.0.0.1:3001**. Keep the server on its default localhost address. This version is a personal/local prototype, without public user authentication or a hosted database.

## Connect the live agent

Copy `.env.example` to `.env` and set `OPENAI_API_KEY` on your computer. Do not paste a key into the browser or commit it to source control.

```sh
cp .env.example .env
```

The default model is `gpt-5-mini`; change `OPENAI_MODEL` if your account uses a different compatible model. Restart the server after changing the environment file, then select live mode in the app. The live agent uses the OpenAI Responses API and calls tools to retrieve research directions, learning resources, and faculty evidence. The server applies validated actions to the student's workspace.

Without a key, guided demo mode uses local rules and templates. It is useful for testing the complete workflow and is explicitly labelled as a demo. It does not represent an AI model response. Model errors stay visible rather than being silently replaced with demo responses.

## The first version

- Describe interests in English and edit the student profile.
- Explore a few research directions and compare questions, activities, and starter resources.
- Select a direction and create a weekly plan that respects available time.
- Complete tasks, ask for a simpler plan, and return to an earlier stage.
- Tell the agent your university when you are ready to find faculty. There is no default school.
- Find faculty in the curated University of Minnesota Twin Cities sample catalog, or use live mode to search public sources for another university.
- Read each professor's evidence, source links, and source-check or retrieval date. Research relevance does not imply an available position.
- Draft, edit, copy, or download an outreach email. The app never sends email.
- Import plain-text background information, save progress in the browser, and export or clear your workspace.

The starter catalog contains eight research directions and eight University of Minnesota Twin Cities faculty profiles. The guided demo's faculty coverage is intentionally limited to that sample catalog. Live search uses the requested school and selected research direction, verifies that candidate source URLs occurred in search evidence, and may return fewer than three results or no matches. Live results are labelled AI-sourced suggestions and still need a human source check. Recruitment status remains unknown. See [source notes](docs/sources.md) for catalog coverage and verification details.

## Data and privacy

The browser retains your confirmed profile, conversation, plan, and draft so you can continue later. Clear the workspace to remove the saved session. Imported text becomes part of your profile only when you confirm it. Resume import supports `.txt` and `.md` files up to 100 KB with an editable confirmation preview. For PDF or Word resumes, paste the relevant text into the profile; direct PDF/Word parsing is not included in this version.

Demo mode stays on your local app server. In live mode, the current conversation and profile are sent to OpenAI to generate a response. Faculty web searches receive only the school and public research topic, not the resume or conversation. The server does not put the API key in browser code, save student records in a database, or send messages to professors. Avoid adding personal information that is unnecessary for research exploration.

The catalog records source verification dates; it does not continuously monitor recruitment. Confirm current availability and application requirements directly with a lab.

## Check the app

```sh
npm test
npm run build
npm run test:e2e
```

Install the isolated Playwright Chromium browser before running browser tests:

```sh
npx playwright install chromium
npm run test:e2e
```

The tests cover the guided research flow, state changes, input validation, and browser interactions. Live model access also requires a valid API key and API account; local tests do not prove that a particular account has model access.

## Project layout

- `src/`: React interface and local workspace state.
- `server/`: Express API, guided engine, live agent, and curated catalog.
- `shared/types.ts`: the shared request, response, and workspace contract.
- `tests/`: automated checks.
- `docs/sources.md`: evidence for catalog entries and update notes.

The original Chinese and English design documents remain in the project root.

The live integration follows the official [function calling guide](https://developers.openai.com/api/docs/guides/function-calling) and [structured outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).
# Research-matchmaker
