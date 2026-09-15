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

## What we keep

Against your account: your editor tokens, stored as a hash, never the
plaintext you were shown once, with when each was created, last used and
revoked; your practice settings (rate, mutes, preferred areas, level range,
confidence prompts, whether the letter answers in a native dialog); and your
practice record, which catalog item was served, when, and whether you
answered it, since that is what your accuracy and level per topic are
computed from. Never the question text, your working tree, your code, or your
prompts; see What leaves your machine, above.

Export it, reset it, or delete the whole account from your account page
(atomicreps.com/account). Export is self-serve, one a day. Reset
lets you clear specific categories, such as answer history or practice
memory, without losing the account. Deleting the account removes the tokens,
the settings and the practice record along with everything else tied to it.

## On a class seat

If your account is a seat in a class a tutor controls, the tutor can see your
participation across the roster: whether you answered, your pace, and
rollups over time. Never the question text, and nothing about your code.
What an institution can see and do with a class is set out in full in the
Data Processing Agreement: atomicreps.com/dpa (Schedule E).

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
