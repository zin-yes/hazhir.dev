# hazhir.dev

This project is my personal web development portfolio presented in a operating system theme and is available at [hazhir.dev](https://hazhir.dev/).

## Prerequisites

The project was built with the following dependencies but may still work on older/newer versions. Bun is my runtime of choice, but the project runs fine with the Node version listed below.

- [Node v20.16.0 (LTS)](https://nodejs.org/en/download/package-manager)
- [Bun 1.1.8](https://bun.sh/)

## Setup

Get this project's code by either cloning the repository

```txt
git clone https://github.com/zin-yes/hazhir.dev.git
```

or [downloading the zip](https://github.com/zin-yes/hazhir.dev/archive/master.zip) file for the master branch.

Once cloned/downloaded, run the install command for provided by the package manager of your choice (e.g. `bun install` or `npm install`).

You then finally should fill in the environment variables by copying the `.env.example` or renaming it to `.env`.

My setup of the project is configured for using [Turso](https://turso.tech/) (database provider) and [Discord](https://discord.com/developers/docs/topics/oauth2) (authentication provider) but you can easily modify these to work with whichever services you choose to go with, since the project uses [Drizzle ORM](https://orm.drizzle.team/docs/overview), and [NextAuth/Auth.js](https://authjs.dev/reference/nextjs).

## Finally

Run `bun dev` or `npm run dev` to start the development server.
