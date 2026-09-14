# Security

## What this package is

`atomicreps` is a thin client. It signs in, reads your working tree locally,
asks the server for one question, and prints what comes back. The server (the
"door") and the question corpus are closed source. Everything that runs on your
machine is in this repository, and `dist/cli.js` is built from `src` and nothing
else. There are no runtime dependencies.

## What leaves your machine

On a `rep` call:

- catalog handles (`react.hooks_core`) with small integer weights;
- the names of packages, file extensions and folders that the public catalog
  already knows, in the catalog's own words;
- your settings, when you change them, and the letter you answer with.

The server publishes the vocabulary it knows. Anything outside it is dropped
here, before the call. The words your agent puts in `touched` are matched
against that vocabulary locally and only the handle they resolve to is sent. A
private package name is sent as the public alias word it resolves through
(`@acme/react-internal` becomes `react`) or not at all.

What never leaves: your code, the contents of any file, your prompts, your file
paths, your branch names, your commit messages.

`npx atomicreps setup` prints the exact payload for the repository you are
standing in, before you sign in.

## The token

The token lives in `~/.config/atomicreps/config.json`, mode 0600, in a
directory created 0700. It is prefixed `arep_` so secret scanners recognise it,
and you can revoke it on your account page. `npx atomicreps logout` forgets it;
`logout --purge` also deletes the reps and status this machine cached.

## Origins

The token is attached to whatever `ATOMICREPS_API` names, and the browser is
sent to whatever `ATOMICREPS_SITE` names, so both are honoured only for an
Atomic Reps origin or a loopback address. Anything else is ignored, the default
origin is used, and `npx atomicreps doctor` names the value it ignored. Set `ATOMICREPS_UNSAFE_ORIGIN=1` for local development against your
own door.

## Reporting a vulnerability

Mail security@atomicreps.com. Plain English is fine. Say what you found, how to
reproduce it, and what you think it lets someone do. We will reply, and we will
tell you what we did about it. There is no bounty programme.

Please do not open a public issue for anything that affects other people's
accounts or data until it is fixed.

## This repository

Its git history is not the development history, so commits here do not map one
to one onto the work. The published package and this source are built from the
same files.
