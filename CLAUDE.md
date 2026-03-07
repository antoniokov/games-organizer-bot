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

- **`ui.js`** (`POST /bot`) — Telegram webhook handler. Processes inline button callbacks (SIGN_UP, OPT_OUT) by creating/updating Registration entities in Fibery. Uses an in-memory cache for players and games within a single Lambda invocation.

- **`sync.js`** (`POST /sync-game`) — Called externally (from Fibery automations) to announce or update game messages in Telegram. On first call (no `messageId`), sends a new message and writes the Telegram message ID back to Fibery. On subsequent calls, edits the existing message.

Both handlers wrap their respective apps with `serverless-http` for Lambda compatibility.

## Key Details

- **ESM modules** (`"type": "module"` in package.json)
- **Environment variables** loaded via Serverless Framework's built-in `useDotenv: true` from `.env.dev` / `.env.prod` based on stage, then explicitly mapped in `serverless.yaml` under `provider.environment`. Required vars: `BOT_TOKEN`, `FIBERY_HOST`, `FIBERY_SYNC_TOKEN` (for sync), `FIBERY_UI_TOKEN` (for ui), `FIBERY_APP` (defaults to `Organizer`)
- **Fibery queries** use the `fibery-unofficial` npm package with a custom query language (s-expression style with `q/from`, `q/select`, `q/where`)
- **Telegram messages** use HTML parse mode (`parse_mode: 'HTML'`), with `escape-html` for user-generated content
