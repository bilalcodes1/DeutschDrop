# DeutschDrop 🇩🇪

Telegram bot for learning German vocabulary using **Spaced Repetition System (SRS)**, XP, levels, daily tasks, achievements, and challenges.

DeutschDrop is built with **Cloudflare Workers**, **TypeScript**, **grammy.js**, and **Cloudflare D1**.
It is designed to help learners save German words, review them at the right time, train with different quiz modes, and stay motivated through gamification.

---

## Project Overview

**DeutschDrop** is a German vocabulary learning bot on Telegram.

The bot allows users to add words manually or upload them using CSV files, then review them using a dynamic SRS system based on the SM-2 algorithm.

It also includes training modes, XP, levels, leaderboard, achievements, daily tasks, hard words, export, and asynchronous challenges between users.

The project was built as a practical language-learning tool with a serverless backend.

---

## Main Purpose

The goal of DeutschDrop is to make German vocabulary learning easier, more consistent, and more motivating through Telegram.

It helps users:

* Save German words
* Review words using SRS
* Practice vocabulary through training modes
* Track learning progress
* Build daily consistency
* Compete with other users
* Export their words
* Focus on difficult words

---

## Tech Stack

| Layer                  | Technology                                   |
| ---------------------- | -------------------------------------------- |
| Runtime                | Cloudflare Workers                           |
| Language               | TypeScript                                   |
| Telegram Bot Framework | grammy.js                                    |
| Database               | Cloudflare D1                                |
| Database Engine        | SQLite                                       |
| Storage                | Cloudflare R2-ready for future audio support |
| Scheduling             | Cloudflare Scheduled Jobs / Cron             |
| Testing                | TypeScript checks and project tests          |

---

## Features

* Telegram bot built with grammy.js
* Cloudflare Workers backend
* Cloudflare D1 database
* User registration
* Profile system
* Rename support
* Manual word adding
* CSV upload
* Safe CSV parsing
* Dynamic SRS system
* SM-2 based review scheduling
* Multiple training modes
* XP system
* Level system
* Leaderboard
* Achievements
* Daily tasks
* Daily summary
* Review reminders
* Hard words screen
* CSV export
* Asynchronous challenges between users
* Persistent learning sessions
* Persistent training sessions
* Persistent word-adding sessions
* Daily streak system
* Cron jobs for reminders, summaries, streak updates, and session cleanup
* ARASAAC pictogram selection support for educational symbols
* R2-ready structure for future TTS/audio support

---

## Bot Commands

| Command         | Description                                 |
| --------------- | ------------------------------------------- |
| `/start`        | Register the user and show the main menu    |
| `/profile`      | Show user profile                           |
| `/rename`       | Change the display name inside the bot      |
| `/achievements` | Show user achievements                      |
| `/learn`        | Review due words using SRS                  |
| `/train`        | Start training mode                         |
| `/addword`      | Add a word manually                         |
| `/upload`       | Upload a CSV file                           |
| `/stats`        | Show statistics, XP, level, and daily tasks |
| `/leaderboard`  | Show leaderboard                            |
| `/challenge`    | Start an asynchronous challenge             |
| `/hard_words`   | Show and train difficult words              |
| `/export`       | Export user words as CSV                    |
| `/settings`     | Open settings                               |
| `/menu`         | Show the main menu                          |

---

## Learning System

DeutschDrop uses a spaced repetition approach to help users review words at the right time.

The system tracks each word and schedules future reviews depending on how well the user remembers it.

The SRS flow helps learners:

* Review weak words more often
* Delay easy words gradually
* Improve long-term memory
* Avoid random unorganized review

---

## Gamification

DeutschDrop includes several motivation features:

* XP points
* Levels
* Leaderboard
* Achievements
* Daily tasks
* Daily streaks
* Challenges
* Hard words practice

These features make learning more engaging and encourage users to return daily.

---

## Challenge System

The bot supports asynchronous challenges between users.

Challenge features include:

* Choose challenge size
* Same questions for both users
* Compare score and time
* Give XP to the winner
* Notify the other user
* Store challenge results

This makes German vocabulary practice more competitive and fun.

---

## CSV Import

Users can upload vocabulary using CSV files.

The CSV parser supports safer handling of:

* Quoted fields
* Commas inside examples
* Existing words
* New words
* Already linked words
* Skipped rows
* Invalid rows

This makes it easier to import vocabulary from external tools or prepared word lists.

---

## Project Structure

```txt
src/
├── index.ts              # Worker entry point
├── routes/
│   └── webhook.ts        # Telegram webhook handler
├── models/
│   └── index.ts          # TypeScript types
├── repositories/         # Data access layer
├── services/             # Business logic
├── commands/             # Telegram command handlers
├── bot/
│   ├── bot.ts            # grammy bot setup
│   └── context.ts        # Custom bot context
└── db/
    ├── schema.sql        # D1 database schema
    └── migrations/       # D1 migrations
```

---

## Local Development

### Requirements

* Node.js
* npm
* Wrangler CLI
* Cloudflare account
* Telegram bot token from BotFather

### Install Dependencies

```bash
npm install
```

### Apply Local Database Migrations

```bash
npm run db:migrate:local
```

### Run Locally

```bash
npm run dev
```

---

## Deployment

### 1. Create Cloudflare D1 Database

```bash
npx wrangler d1 create deutschdrop-db
```

Copy the generated `database_id` and place it inside `wrangler.toml`.

---

### 2. Apply D1 Migrations

```bash
npx wrangler d1 migrations apply deutschdrop-db
```

Database files:

```txt
src/db/schema.sql
src/db/migrations/
```

---

### 3. Set Telegram Bot Token

```bash
wrangler secret put TELEGRAM_BOT_TOKEN
```

---

### 4. Deploy Worker

```bash
npm run deploy
```

---

### 5. Set Telegram Webhook

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<YOUR_WORKER>.workers.dev/webhook"
```

Replace:

```txt
<TOKEN>
```

with your Telegram bot token, and:

```txt
<YOUR_WORKER>
```

with your Cloudflare Worker URL.

---

## Implemented

* [x] User registration
* [x] Profile system
* [x] Rename command
* [x] Manual word adding
* [x] CSV upload
* [x] Safe CSV parsing
* [x] Dynamic SRS system
* [x] SM-2 review scheduling
* [x] Multiple training modes
* [x] XP system
* [x] Levels
* [x] Leaderboard
* [x] Basic achievements
* [x] XP rewards for achievements
* [x] User notifications
* [x] Asynchronous challenges
* [x] Daily tasks
* [x] Daily summary
* [x] Hard words screen
* [x] CSV export
* [x] ARASAAC pictogram selection support
* [x] Persistent learning sessions in D1
* [x] Persistent training sessions in D1
* [x] Persistent word-adding sessions in D1
* [x] Daily streak system
* [x] Review reminder cron
* [x] Daily summary cron
* [x] Streak update cron
* [x] Session cleanup cron

---

## Planned

* [ ] TTS support
* [ ] Audio pronunciation support
* [ ] Cloudflare R2 audio storage
* [ ] More advanced training modes
* [ ] Better word collection sharing
* [ ] More detailed statistics
* [ ] Admin tools
* [ ] Web dashboard

---

## Security Notes

* Do not commit Telegram bot tokens.
* Store secrets using Wrangler secrets.
* Do not commit `.env` or `.dev.vars`.
* Keep production database IDs and sensitive credentials safe.
* Use Cloudflare secrets for deployment credentials.

Recommended `.gitignore` entries:

```gitignore
node_modules
.env
.dev.vars
.wrangler
dist
.DS_Store
npm-debug.log*
```

---

## Purpose

DeutschDrop was created as a practical German vocabulary learning project.

It combines language learning, Telegram automation, serverless backend development, and gamification in one project.

It can be used as:

* A German vocabulary trainer
* A Telegram bot project
* A Cloudflare Workers project
* A TypeScript backend project
* A gamified learning system
* A portfolio project

---

## Author

**Bilal Zamil Ahmed**
Computer Science Student
University of Anbar

GitHub: [@bilalcodes1](https://github.com/bilalcodes1)
YouTube: [Bilal Codes](https://www.youtube.com/@bilalcodes1)

---

## License

MIT License
