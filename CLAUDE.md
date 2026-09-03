# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Telegram bot for managing sign-ups for game events. Users interact via inline buttons (sign up / opt out) on game announcement messages. The bot uses **Fibery** as its backend database for players, games, and registrations.

## Commands

- `npm run release` — deploy to AWS via Serverless Framework
- `npm run release -- --stage prod` — deploy to production
- `npm run purge` — remove the deployed stack

No test suite exists.

## Architecture

Two AWS Lambda functions exposed as HTTP endpoints via API Gateway:

- **`ui.js`** (`POST /bot`) — Telegram webhook handler. Processes inline button callbacks (SIGN_UP, OPT_OUT) by creating/updating Registration entities in Fibery. Uses an in-memory cache for players, kept at module level so it survives across invocations in a warm Lambda container.

- **`sync.js`** (`POST /sync-game`) — Called externally (from Fibery automations) to announce or update game messages in Telegram. On first call (no `messageId`), sends a new message and writes the Telegram message ID back to Fibery. On subsequent calls, edits the existing message.

Both handlers wrap their respective apps with `serverless-http` for Lambda compatibility.

## Key Details

- **ESM modules** (`"type": "module"` in package.json)
- **Environment variables** loaded via Serverless Framework's built-in `useDotenv: true` from `.env.dev` / `.env.prod` based on stage, then explicitly mapped in `serverless.yaml` under `provider.environment`. Required vars: `BOT_TOKEN`, `FIBERY_HOST`, `FIBERY_SYNC_TOKEN` (for sync), `FIBERY_UI_TOKEN` (for ui), `FIBERY_APP` (defaults to `Organizer`)
- **Fibery queries** use the `fibery-unofficial` npm package with a custom query language (s-expression style with `q/from`, `q/select`, `q/where`)
- **Writes in `ui.js` are idempotent.** Telegram redelivers an update until the webhook answers with a 200, and the Lambda's 6s timeout means a slow Fibery call can kill the invocation after the write has landed — so both entity creations go through `createUnlessDuplicate`, which uses Fibery's `fibery.entity.batch/create-or-update` with `conflict-action: skip-create`. Players conflict on `Telegram User ID`, Registrations on `Telegram Callback Query ID` (identical across redeliveries of the same tap). Conflict Fields must be `fibery/text`, `fibery/int` or `fibery/date`, which is why Registrations key on the callback query id rather than on Game + Player.
- Both Conflict Fields are **unique** in Fibery, and that constraint — not the command's own duplicate check — is what holds under concurrency: two simultaneous upserts can both find no duplicate, and the unique index rejects the loser with an error rather than skipping it. That's why `createUnlessDuplicate` re-queries by the Conflict Field value when the command throws and treats an existing row as success. Getting this wrong would tell a signed-up player "Something went wrong 😬", and their next tap carries a *new* callback query id — which would create the duplicate the whole mechanism exists to prevent.
- Residual: two genuinely simultaneous taps carry different callback query ids, so they can still produce two Registrations. Opting out clears all active ones, so it's recoverable.
- **Telegram messages** use HTML parse mode (`parse_mode: 'HTML'`), with `escape-html` for user-generated content
